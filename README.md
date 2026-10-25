# Seatbook

Seat booking for small venues. Organizers publish an event with a seat grid, attendees pick a seat and hold or book it.

---

## Handover Note for Mr. Rahman

### 1. What You Changed and Why

#### Concurrency & Double-Booking Protection (Database & Backend)
- **Problem:** The original prototype used an unprotected check-then-insert pattern in `POST /bookings`. Under concurrent traffic, multiple buyers could book the same seat simultaneously, resulting in double-bookings.
- **Solution:** 
  1. Wrapped `POST /bookings` and hold creation in interactive PostgreSQL transactions using pessimistic row locking (`SELECT id FROM "Seat" WHERE id = $1 FOR UPDATE`). This queues competing requests at the database level.
  2. Created a PostgreSQL partial unique index:
     ```sql
     CREATE UNIQUE INDEX "unique_active_booking_per_seat" 
     ON "Booking"("seatId") 
     WHERE status = 'CONFIRMED';
     ```
     This guarantees at the storage engine layer that no two `CONFIRMED` bookings can exist for the same seat, while safely allowing multiple historical `CANCELLED` bookings.

#### 10-Minute Seat Holds & Anti-Hoarding Rules
- **Problem:** Mr. Rahman requested temporary 10-minute seat reservations so buyers can decide without losing their seat.
- **Solution:**
  1. Added `SeatHold` table with foreign keys, cascade deletes, and composite index `(seatId, expiresAt)`.
  2. Implemented `POST /events/:id/seats/:seatId/hold`:
     - Checks if seat is booked or held by another attendee.
     - Enforces **one active hold per attendee per event** (holding a new seat automatically releases any previous hold the attendee had for that event, preventing bad actors from hoarding venue capacity).
     - Returns expiration timestamp and `remainingSeconds: 600`.
     - Renewing hold on the same seat by the same user idempotently refreshes the expiration window.
  3. Implemented instant hold release endpoints: `POST /events/:id/seats/:seatId/release` and `POST /holds/:id/release`.
  4. Updated `POST /bookings`: checks active holds (User B cannot buy User A's held seat; User A confirming their held seat automatically deletes the hold row).

#### Security & IDOR Remediation
- **Problem:** `POST /bookings/:id/cancel` allowed any authenticated attendee to cancel any booking in the database simply by passing a numeric ID. Additionally, non-integer inputs caused unhandled errors.
- **Solution:**
  1. Enforced strict ownership check: `booking.userId === req.user.id` or event organizer role. Rejects unauthorized cancellation attempts with `403 Forbidden`.
  2. Blocked cancellation of past events and already-cancelled bookings with `400 Bad Request`.
  3. Sanitized all path and body parameters (`isNaN`, integer validation, positive bounds).
  4. Centralized `JWT_SECRET` across auth routes and middleware.

#### Availability Bug Fix ("One Place the AI Was Wrong")
- **Problem:** `listEvents()` counted all bookings using `seat.bookings.length === 0`. Because cancelled bookings remained in the database, cancelled seats were permanently subtracted from `seatsLeft`.
- **Solution:** Updated `listEvents()` and `isSeatBookable()` in `helpers.ts` to filter bookings by `status: 'CONFIRMED'`. Cancelled bookings immediately restore seat availability.

#### Frontend UI/UX Polish & State Resilience
- **Dynamic API Config:** Centralized `API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'` across all pages, replacing hardcoded localhost URLs.
- **4-State Seat Map:** Distinct visual states for Available (🟣 Purple), Held by You (💖 Selected with ⏳ pulse), Held by Others (⏳ Amber disabled), and Booked (⬛ Gray). Added an intuitive status legend.
- **Live 10-Minute Countdown Timer:** Displays real-time `MM:SS` timer in Order Summary. If the timer reaches `00:00`, notifies user with a toast and returns seat to the available pool.
- **Persistent Holds Across Reloads:** `GET /events/:id` uses `optionalAuth` to return `heldByMe` and `remainingSeconds`. Refreshing the browser automatically restores the held seat and resumes the timer.
- **My Bookings Overhaul:** Fixed incorrect green badges on cancelled bookings (now clean rose `✕ CANCELLED` vs green `✓ CONFIRMED`), hid the Cancel button for past/cancelled bookings, and updated Total Spent to sum only active confirmed bookings.
- **404 Error Boundary:** Replaced infinite loading spinner on non-existent events with a friendly "Event Not Found" page with navigation back to catalog.

---

### 2. What You'd Still Do Before Launch

1. **Payment Gateway Integration:** Connect a trusted payment provider (e.g. Stripe Checkout, SSLCommerz, or bKash). Convert temporary holds to confirmed bookings only upon successful webhook notification.
2. **Transactional Email & QR Tickets:** Generate unique booking QR codes and send PDF confirmation tickets via Resend or SendGrid upon booking confirmation.
3. **Real-Time Push Updates (WebSockets / SSE):** Currently, seat hold status updates when users load the page, refresh, or click. Adding WebSocket or Server-Sent Events (SSE) broadcasting will push hold/release state instantly across all open browser tabs.
4. **Active Hold Sweeper Daemon:** Expired holds are currently filtered out lazily via `expiresAt > NOW()`. A background cron job or Redis BullMQ worker should periodically prune expired records from PostgreSQL.
5. **Rate Limiting & Anti-Abuse:** Add `express-rate-limit` on `/auth/login`, `/auth/register`, and `/events/:id/seats/:seatId/hold` to prevent automated bot scraping or brute-force hold spamming.
6. **Production Observability:** Configure structured JSON logging (Pino), Sentry exception monitoring, and healthcheck alerts.

---

### 3. The Weakest Part of Your Work

1. **Lazy Expiration vs. Real-Time Socket Push:** 
   While expired holds are immediately treated as free by database queries, attendees currently see seat status updates when fetching the page or clicking seats rather than receiving instantaneous live push notifications via WebSockets.
2. **Single-Seat Hold Assumption:**
   To guarantee fairness and prevent hoarding, the system restricts each attendee to 1 held seat per event. While ideal for workshops and small talks, a commercial theatre or concert ticketing release would require multi-seat selection (e.g., hold up to 4 adjacent seats for 10 minutes) with a unified composite hold timer.

---

### 4. One Place the AI Was Wrong

The most dangerous bug generated by the prototype AI was in `server/src/utils/helpers.ts` and `server/src/services/eventService.ts`:

```typescript
// Original AI implementation:
export function isSeatBookable(seat: Seat & { bookings: Booking[] }, event: Event): boolean {
  if (new Date(event.startsAt) < new Date()) {
    return false;
  }
  return seat.bookings.length === 0; // ⚠️ Fatal bug
}
```

#### Why the AI Was Wrong:
1. **Ignored Entity Lifecycle States:** In production, cancelled bookings are soft-retained (`status = 'CANCELLED'`) for audit history and financial reporting. Because `seat.bookings.length > 0`, any seat that had ever been booked and cancelled was permanently marked unavailable by `listEvents()`.
2. **Catalogue vs. Seat Map Contradiction:** While `listEvents()` leaked availability, `getEventWithSeats()` queried `bookings: { where: { status: 'CONFIRMED' } }`. As a result, the home page claimed an event was sold out (`0 seats left`), but clicking into the event showed open, clickable seats.
3. **Silent IDOR Assumption:** The AI implemented `POST /bookings/:id/cancel` using `prisma.booking.updateMany({ where: { id } })` without checking `booking.userId === req.user.id`, allowing any attendee to cancel other attendees' tickets.

#### How We Checked It Works:
- Refactored `isSeatBookable` to explicitly verify `!seat.bookings.some(b => b.status === 'CONFIRMED')` and check active unexpired holds.
- Created `test/availability.test.ts` with 7 end-to-end integration tests verifying that cancelling a booking immediately increments `seatsLeft` and restores grid availability.

---

### 5. How You Checked It Works

#### 1. Automated Vitest Test Suite (54 Tests, 5 Test Files)
Executed against real PostgreSQL database container:
- `test/helpers.test.ts` (11 tests): Price formatting, seat labels, slugification, availability permutations.
- `test/security.test.ts` (21 tests): IDOR cancellation access control, authorization token validation, boundary input sanitization.
- `test/availability.test.ts` (7 tests): `seatsLeft` calculation, cancelled booking restoration, past event zeroing, full lifecycle.
- `test/holds.test.ts` (10 tests): Hold creation, 10-minute expiration calculation, hold renewal, anti-hoarding auto-release, manual release.
- `test/concurrency.test.ts` (5 tests): Simultaneous `Promise.all` hold races, hold sniping prevention, concurrent direct booking races, PostgreSQL partial index constraint verification.

```bash
cd server && npm test
```

#### 2. Clean Docker Start Verification
Verified that spinning down all volumes and building from scratch cleanly applies all migrations and seed data:
```bash
docker compose down -v
docker compose up --build
```

#### 3. Manual Verification Steps
- **Alice Hold:** Logged in as Alice, held Seat A1. Verified digital countdown timer started at `10:00` and counted down every second.
- **State Persistence:** Refreshed browser; verified Seat A1 remained held and timer resumed accurately.
- **Bob Conflict:** Opened private window, logged in as Bob. Verified Seat A1 displayed as `Held (⏳)` and could not be held or booked.
- **Alice Confirmation:** Clicked 'Confirm Booking'. Verified Seat A1 transitioned to `Booked` and appeared in Alice's bookings.
- **Cancellation:** Cancelled booking in My Bookings. Verified badge switched to `✕ CANCELLED` and Seat A1 returned to `Available` on the catalogue and seat map.

---

## Stack

- **server/**: Node, Express, TypeScript, Prisma, Postgres
- **client/**: React, Vite, TypeScript, Tailwind

## Run It

```bash
docker compose up --build
```

- App: http://localhost:5173
- API: http://localhost:4000
- Postgres: `localhost:5433` (user / password / db: `seatbook`)

To start from a clean database:
```bash
docker compose down -v
docker compose up --build
```

### Seeded Accounts

All passwords are `password123`.

| Email | Role |
|---|---|
| organizer@seatbook.test | Organizer (Mr. Rahman) |
| alice@seatbook.test | Attendee |
| bob@seatbook.test | Attendee |

---

## API Reference

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | none | Create account, returns token |
| POST | `/auth/login` | none | Log in, returns token |
| GET | `/events` | none | List events with active `seatsLeft` |
| GET | `/events/:id` | optional | Event detail with seat map, holds & countdown |
| POST | `/events` | organizer | Create event and seat grid |
| POST | `/events/:id/seats/:seatId/hold` | attendee | Hold seat for 10 minutes |
| POST | `/events/:id/seats/:seatId/release` | attendee | Release held seat immediately |
| POST | `/holds/:id/release` | attendee | Release held seat by hold ID |
| POST | `/bookings` | attendee | Confirm booking (with lock & hold check) |
| GET | `/bookings/mine` | attendee | List attendee bookings |
| POST | `/bookings/:id/cancel` | attendee/organizer | Cancel booking (IDOR-protected) |

---

## AI Session Transcripts

All pair programming conversations, code audit findings, architectural decisions, and testing logs are preserved in `ai-transcripts/`:
- [`ai-transcripts/01-repository-audit.md`](./ai-transcripts/01-repository-audit.md): Initial audit and implementation roadmap.
- [`ai-transcripts/02-security-idor-fix.md`](./ai-transcripts/02-security-idor-fix.md): Security audit & IDOR remediation.
- [`ai-transcripts/03-availability-fix.md`](./ai-transcripts/03-availability-fix.md): Availability calculation bug fix ("AI was wrong").
- [`ai-transcripts/04-db-seat-holds-model.md`](./ai-transcripts/04-db-seat-holds-model.md): SeatHold model & PostgreSQL partial index migration.
- [`ai-transcripts/05-holds-endpoints.md`](./ai-transcripts/05-holds-endpoints.md): 10-minute hold and release endpoint implementation.
- [`ai-transcripts/06-transactional-seat-locks.md`](./ai-transcripts/06-transactional-seat-locks.md): Pessimistic row locking & transactional bookings.
- [`ai-transcripts/07-concurrency-tests.md`](./ai-transcripts/07-concurrency-tests.md): Concurrency race condition & hold security tests.
- [`ai-transcripts/08-client-api-grid-status.md`](./ai-transcripts/08-client-api-grid-status.md): Dynamic API URL configuration & 4-state seat grid.
- [`ai-transcripts/09-client-hold-timer.md`](./ai-transcripts/09-client-hold-timer.md): Live countdown timer & confirmation UI.
- [`ai-transcripts/10-client-badges-404.md`](./ai-transcripts/10-client-badges-404.md): Cancellation badge styling & 404 error boundary.
- [`ai-transcripts/11-production-handover.md`](./ai-transcripts/11-production-handover.md): Complete handover note documentation.
