# Seatbook

Seat booking for small venues. Organizers publish an event with a seat grid, attendees pick a seat and hold or book it.

---

# Handover Note

## Assumptions & Decisions Made

Where the brief left requirements open, the following architectural assumptions and product decisions were made:
1. **Anti-Hoarding Rule (1 Hold Per User per Event):** To prevent malicious attendees or bots from locking down an entire venue without paying, each attendee is limited to **1 active hold per event**. Holding another seat on the same event automatically releases their previous hold.
2. **Idempotent Hold Renewal:** Re-clicking or re-requesting a hold on a seat the user already holds does not return an error; it refreshes the 10-minute hold window from `NOW()` and returns `200 OK`.
3. **Dual Booking Paths (Hold-First or Direct):** Attendees can choose either the 10-minute hold safety flow or book directly with 1 click. Both paths acquire pessimistic row locks and verify active hold ownership.
4. **Lazy Expiration with Instant Availability:** Expired holds (`expiresAt < NOW()`) are bypassed in database queries so seats immediately become available to other buyers the moment 10 minutes elapse, without depending on an external cron worker.
5. **Authentication Boundary:** Browsing events and seat map availability is public (`optionalAuth`), but placing a hold requires an authenticated attendee session so hold ownership is cryptographically bound to a user account.
6. **Audited Cancellations & Organizer Moderation:** Cancellations update booking status to `CANCELLED` rather than deleting rows, preserving accounting history. Organizers have permission to cancel bookings on events they own for customer service or dispute resolution.

---

## What You Changed and Why

### 1. Concurrency Control & Double-Booking Prevention (Backend & Database)
- **Problem in Prototype:** The initial prototype used a naive check-then-insert pattern in `POST /bookings` (`prisma.booking.findFirst` followed by `prisma.booking.create`). Under concurrent traffic (e.g., tickets going live), two buyers selecting the same seat at the same millisecond both saw the seat as open, creating duplicate confirmed bookings.
- **Production Solution:**
  1. Wrapped `POST /bookings` and hold operations inside Prisma interactive transactions with PostgreSQL pessimistic row locking:
     ```sql
     SELECT id, "eventId" FROM "Seat" WHERE id = $1 FOR UPDATE;
     ```
     This forces competing requests for the same seat to queue at the database level.
  2. Created a PostgreSQL partial unique index via migration:
     ```sql
     CREATE UNIQUE INDEX "unique_active_booking_per_seat" 
     ON "Booking"("seatId") 
     WHERE status = 'CONFIRMED';
     ```
     This guarantees at the storage engine level that two active bookings can never exist for the same seat, while allowing historical `CANCELLED` bookings to remain in the database for auditing.

### 2. 10-Minute Seat Holds & Anti-Hoarding Protection
- **Problem in Prototype:** Attendees had no way to hold a seat while deciding; seats could be taken mid-checkout.
- **Production Solution:**
  1. Created `SeatHold` table with cascade delete rules and composite index `(seatId, expiresAt)`.
  2. Implemented `POST /events/:id/seats/:seatId/hold`:
     - Holds the seat for exactly 10 minutes (`expiresAt = NOW() + 10 mins`).
     - **Anti-Hoarding Rule:** To prevent a malicious attendee from locking down an entire venue, each attendee is limited to **1 active hold per event**. Holding another seat automatically releases any previous hold they had for that event.
     - **Idempotent Renewal:** Re-holding the same seat refreshes the 10-minute window and returns `200 OK`.
     - Rejects requests with `409 Conflict` if held by another attendee or already booked.
  3. Implemented instant release endpoints: `POST /events/:id/seats/:seatId/release` and `POST /holds/:id/release`.
  4. Updated `POST /bookings`: verifies active holds (User B cannot buy User A's held seat; User A confirming their held seat automatically deletes the hold).

### 3. Security & IDOR Remediation
- **Problem in Prototype:** `POST /bookings/:id/cancel` allowed any authenticated user to cancel any booking in the system simply by guessing numeric IDs (`updateMany({ where: { id } })`). Additionally, non-integer inputs crashed routes.
- **Production Solution:**
  1. Added ownership verification: `booking.userId === req.user.id` or event organizer role. Rejects unauthorized attempts with `403 Forbidden`.
  2. Prevented cancelling past events or already-cancelled bookings with `400 Bad Request`.
  3. Sanitized all path parameters and request body fields (`isNaN`, positive integer validation, maximum grid limits of 26x30).
  4. Centralized `JWT_SECRET` across auth routes and middleware.

### 4. Availability Discrepancy Bug Fix ("Where the AI Was Wrong")
- **Problem in Prototype:** `listEvents()` calculated available seats using `seat.bookings.length === 0`. Because cancelled bookings remained in the database, any seat ever booked and cancelled was permanently deducted from `seatsLeft`.
- **Production Solution:** Updated `eventService.listEvents()` and `isSeatBookable()` in `helpers.ts` to filter bookings by `status: 'CONFIRMED'`. Cancelled bookings immediately restore seat availability.

### 5. Frontend Polish, Live 10-Minute Countdown Timer & State Resilience
- **Centralized API Config:** Replaced hardcoded `localhost:4000` URLs with centralized `API_URL` (`import.meta.env.VITE_API_URL || 'http://localhost:4000'`).
- **4-State Seat Grid:** Clear visual hierarchy for Available (🟣 Purple), Held by You (💖 Selected with ⏳ pulse), Held by Others (⏳ Amber disabled), and Booked (⬛ Gray), plus an intuitive status legend.
- **Live Countdown Timer:** Displays real-time `MM:SS` timer in Order Summary. If the timer reaches `00:00`, warns the user via toast and returns the seat to sale.
- **Persistence Across Reloads:** `GET /events/:id` uses `optionalAuth` to return `heldByMe` and `remainingSeconds`. Refreshing the page automatically restores the active hold and resumes the countdown.
- **My Bookings Overhaul:** Cancelled tickets now display rose `✕ CANCELLED` badges instead of confusing green checkmarks; the Cancel button is hidden once cancelled or if the event has ended; Total Spent sums only active confirmed bookings.
- **404 Error Boundary:** Replaced infinite loading spinner on missing events with a friendly "Event Not Found" page with navigation back to catalog.

---

## What You'd Still Do Before Launch

1. **Payment Gateway Integration:** Connect Stripe Checkout, SSLCommerz, or bKash. Attendees should hold the seat for 10 minutes, complete checkout, and have the hold converted to a confirmed booking via webhook callback.
2. **Transactional Emails & QR Tickets:** Generate unique booking QR codes and dispatch confirmation emails with PDF ticket attachments via Resend or SendGrid.
3. **Real-Time Push Updates (WebSockets / Server-Sent Events):** Currently, seat availability updates when a user opens, refreshes, or clicks. Adding WebSocket or SSE push notifications will broadcast hold and release events to all active browser sessions in real-time.
4. **Active Hold Sweeper Daemon:** Expired holds are lazily bypassed by database queries (`expiresAt > NOW()`). A background cron job or Redis BullMQ worker should run every minute to sweep expired rows from PostgreSQL.
5. **Rate Limiting & Abuse Prevention:** Apply `express-rate-limit` to `/auth/login`, `/auth/register`, and `/events/:id/seats/:seatId/hold` to prevent brute-force attacks and bot hold spamming.
6. **Production Observability & Monitoring:** Configure Pino for structured JSON logging, Sentry for exception tracking, and healthcheck alerts.

---

## The Weakest Part of Your Work

1. **Lazy Expiration vs. Real-Time Push Broadcasting:**
   While PostgreSQL queries immediately treat expired holds as free, other attendees browsing the page do not see a seat flip from "Held" to "Available" until they refresh or interact. WebSockets would provide an instantaneous live-updating seat map.
2. **Single-Seat Hold Limitation:**
   To guarantee fairness and prevent hoarding, the system restricts each attendee to 1 held seat per event. While ideal for Mr. Rahman's workshops and small talks, a larger theatrical or concert venue would require multi-seat selection (e.g., hold up to 4 adjacent seats for 10 minutes) with a unified hold session timer.

---

## One Place the AI Was Wrong

The primary architectural flaw generated by the AI prototype was in `server/src/utils/helpers.ts` and `server/src/services/eventService.ts`:

```typescript
// Original AI implementation:
export function isSeatBookable(seat: Seat & { bookings: Booking[] }, event: Event): boolean {
  if (new Date(event.startsAt) < new Date()) {
    return false;
  }
  return seat.bookings.length === 0; // ⚠️ ROOT CAUSE
}
```

### Why the AI Was Wrong:
1. **Ignored Entity Lifecycle States:** In a production ticketing system, cancellations soft-update records (`status = 'CANCELLED'`) for auditing and financial reporting. Because `seat.bookings.length > 0`, any seat that had ever been booked and cancelled was permanently classified as unbookable by `listEvents()`. The `seatsLeft` counter decreased and never recovered.
2. **Catalogue vs. Seat Map Contradiction:** While `listEvents()` leaked availability, `getEventWithSeats()` queried `bookings: { where: { status: 'CONFIRMED' } }`. As a result, the home page claimed an event was sold out (`0 seats left`), but clicking into the event showed open, clickable seats.
3. **Silent IDOR Assumption:** The AI implemented `POST /bookings/:id/cancel` using `prisma.booking.updateMany({ where: { id } })` without checking `booking.userId === req.user.id`, allowing any attendee to cancel other attendees' tickets.

### How We Checked It Works:
- Refactored `isSeatBookable` to verify `!seat.bookings.some(b => b.status === 'CONFIRMED')` and check active unexpired holds.
- Created `test/availability.test.ts` with 7 integration tests proving that cancelling a booking immediately restores `seatsLeft` and marks the seat available on the grid.

---

## How You Checked It Works

### 1. Automated Vitest Test Suite (54 Tests, 5 Test Files)
Executed against the live PostgreSQL database:
- **`test/helpers.test.ts` (11 tests):** Price formatting, seat labels, slugification, availability calculation permutations.
- **`test/security.test.ts` (21 tests):** IDOR cancellation access control, authorization token validation, boundary input sanitization.
- **`test/availability.test.ts` (7 tests):** `seatsLeft` calculation, cancelled booking restoration, past event zeroing, full lifecycle.
- **`test/holds.test.ts` (10 tests):** Hold creation, 10-minute expiration calculation, hold renewal, anti-hoarding auto-release, manual release.
- **`test/concurrency.test.ts` (5 tests):** Simultaneous `Promise.all` hold races, hold sniping prevention, concurrent direct booking races, PostgreSQL partial index constraint verification.

```bash
cd server && npm test
```

### 2. Clean Docker Start Verification
Verified that spinning down all volumes and building from scratch cleanly applies all migrations and seed data:
```bash
docker compose down -v
docker compose up --build
```

### 3. End-to-End Manual Verification (Alice & Bob Walkthrough)
1. **Alice Hold:** Logged in as Alice, held Seat A1. Verified digital countdown timer started at `10:00` and counted down every second.
2. **State Persistence:** Refreshed browser; verified Seat A1 remained held and timer resumed accurately.
3. **Bob Conflict:** Opened private window, logged in as Bob. Verified Seat A1 displayed as `Held (⏳)` and could not be held or booked.
4. **Alice Confirmation:** Clicked 'Confirm Booking'. Verified Seat A1 transitioned to `Booked` and appeared in Alice's bookings.
5. **Cancellation & Availability Check:** Cancelled booking in My Bookings. Verified badge switched to `✕ CANCELLED` and Seat A1 returned to `Available` on the catalogue and seat map.

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

All pair programming conversations, architectural discussions, and session exports/screenshots with AI are preserved in the [`ai-transcripts/`](./ai-transcripts/) directory per submission guidelines.

