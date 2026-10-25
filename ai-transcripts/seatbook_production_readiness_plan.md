# Seatbook Production Readiness & 10-Minute Seat Holds Plan

## Goal Description
Transform Mr. Rahman's prototype into a secure, robust, production-ready seat booking platform that adds the **10-minute Seat Hold** feature while preserving all existing functionality. The plan addresses concurrency race conditions, security vulnerabilities (IDOR in booking cancellations), availability discrepancies ("one place the AI was wrong"), and provides a polished UI with a live countdown timer, automated tests, a comprehensive handover note in `README.md`, and AI chat transcript archiving.

---

## User Review Required

> [!IMPORTANT]
> **Key Design Decisions & Assumptions:**
> 1. **10-Minute Hold Expiration (TTL):** Holds expire exactly 10 minutes (600 seconds) after creation. Expired holds immediately free up the seat for other buyers.
> 2. **One Active Hold Per User Per Event:** To prevent malicious attendees from hoarding all venue seats, an attendee may hold **1 seat per event** at a time. Holding another seat automatically releases any previous hold on that event.
> 3. **ACID Concurrency & Double-Booking Prevention:** Concurrency is guaranteed at both the database and transaction level:
>    - PostgreSQL partial unique index: `CREATE UNIQUE INDEX unique_active_booking_per_seat ON "Booking"("seatId") WHERE status = 'CONFIRMED'`.
>    - Pessimistic row locking: `SELECT * FROM "Seat" WHERE id = $1 FOR UPDATE` inside Prisma interactive transactions for hold creation and booking confirmation.
> 4. **Backwards Compatibility:** Attendees who select an available seat can hold it for 10 minutes and then confirm. Direct booking is also supported if the seat is unheld and unbooked.
> 5. **Clean Start Guarantee:** `docker compose down -v` followed by `docker compose up --build` will apply all migrations sequentially via `prisma migrate deploy` and seed cleanly.

---

## Git Commit Breakdown (Under 72 Characters)

Each step in this plan is structured as an atomic, standalone commit that can be committed incrementally:

| Commit # | Commit Message (<= 72 chars) | Scope & Focus |
|---|---|---|
| **Commit 1** | `fix(security): resolve idor in booking cancel and sanitize user input` (66) | Security & IDOR fix in booking cancellation; input validation |
| **Commit 2** | `fix(events): fix seatsLeft calculation ignoring cancelled bookings` (66) | Availability bug ("AI was wrong") in `eventService` & helpers |
| **Commit 3** | `feat(db): add SeatHold model and active booking partial index` (61) | Prisma schema & SQL migration for `SeatHold` and index |
| **Commit 4** | `feat(holds): implement 10-minute seat hold and release endpoints` (63) | Hold creation, auto-release, expiration check, seat status |
| **Commit 5** | `feat(bookings): enforce hold checks and transactional seat locks` (64) | Transactional `FOR UPDATE` seat locking; confirm held seat |
| **Commit 6** | `test(server): add tests for holds, concurrency races and auth idor` (66) | Vitest integration tests for holds, race conditions, IDOR |
| **Commit 7** | `feat(client): add dynamic api url config and seat hold grid status` (67) | Centralize `API_URL`; seat styles for Available, Held, Booked |
| **Commit 8** | `feat(client): implement 10-minute hold countdown timer and confirm` (66) | Live 10m countdown timer, hold/release actions, confirmation |
| **Commit 9** | `fix(client): fix booking cancellation badges and event 404 state` (64) | Fix canceled booking UI badges and 404 error page states |
| **Commit 10** | `docs: add production handover note and ai chat transcript` (57) | README handover note with 5 sections & `ai-transcripts/` |

---

## Proposed Changes

### Step 1: `fix(security): resolve idor in booking cancel and sanitize user input`

#### [MODIFY] [server/src/routes/bookings.ts](file:///Users/tareqaziz/workspace/tests/seatbook/server/src/routes/bookings.ts)
- Fix the IDOR vulnerability in `POST /bookings/:id/cancel`:
  - Verify `id` is a valid integer (`!isNaN(id)`).
  - Query booking with `userId` check: ensure `booking.userId === req.user!.id` (or user is organizer).
  - Return `404 Not Found` if booking doesn't exist, and `403 Forbidden` if it belongs to someone else.
  - Return `400 Bad Request` if already cancelled.
  - Fix silent error swallowing in `GET /bookings/mine` to properly log and return `500 Internal Server Error` instead of hiding errors with `[]`.

#### [MODIFY] [server/src/routes/events.ts](file:///Users/tareqaziz/workspace/tests/seatbook/server/src/routes/events.ts)
- Return `404 Not Found` with `{ error: 'Event not found' }` instead of `200 OK` with `{ success: false }`.
- Validate route params: return `400 Bad Request` if `id` is not an integer.
- Standardize error responses to use `{ error: string }`.

#### [MODIFY] [server/src/routes/auth.ts](file:///Users/tareqaziz/workspace/tests/seatbook/server/src/routes/auth.ts) & [server/src/middleware/auth.ts](file:///Users/tareqaziz/workspace/tests/seatbook/server/src/middleware/auth.ts)
- Centralize `JWT_SECRET` via `process.env.JWT_SECRET || 'seatbook-secret-123'`.
- Catch Prisma `P2002` unique constraint violation on registration and return clean `409 Conflict: 'An account with this email already exists'`.

---

### Step 2: `fix(events): fix seatsLeft calculation ignoring cancelled bookings`

#### [MODIFY] [server/src/services/eventService.ts](file:///Users/tareqaziz/workspace/tests/seatbook/server/src/services/eventService.ts)
- In `listEvents()`:
  - Update `include`: query `bookings: { where: { status: 'CONFIRMED' } }`.
  - Fix `seatsLeft` so cancelled bookings (`status = 'CANCELLED'`) do not reduce available seats.
- In `getEventWithSeats()`:
  - Add validation for `id`.

#### [MODIFY] [server/src/utils/helpers.ts](file:///Users/tareqaziz/workspace/tests/seatbook/server/src/utils/helpers.ts)
- Update `isSeatBookable()`:
  - Verify that only active `CONFIRMED` bookings make a seat unbookable.
  - Fix disparity between event list counts and event detail seat map availability.

---

### Step 3: `feat(db): add SeatHold model and active booking partial index`

#### [MODIFY] [server/prisma/schema.prisma](file:///Users/tareqaziz/workspace/tests/seatbook/server/prisma/schema.prisma)
- Add `SeatHold` model:
  ```prisma
  model SeatHold {
    id        Int      @id @default(autoincrement())
    seatId    Int
    seat      Seat     @relation(fields: [seatId], references: [id], onDelete: Cascade)
    userId    Int
    user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
    expiresAt DateTime
    createdAt DateTime @default(now())

    @@index([seatId, expiresAt])
    @@index([userId])
  }
  ```
- Add relation fields to `Seat` (`holds SeatHold[]`) and `User` (`holds SeatHold[]`).

#### [NEW] `server/prisma/migrations/20261025000000_add_seat_holds/migration.sql`
- Create `SeatHold` table with foreign keys and cascade rules.
- Add PostgreSQL partial unique index:
  ```sql
  CREATE UNIQUE INDEX "unique_active_booking_per_seat" 
  ON "Booking"("seatId") 
  WHERE status = 'CONFIRMED';
  ```
- This ensures clean execution on fresh `docker compose up --build`.

---

### Step 4: `feat(holds): implement 10-minute seat hold and release endpoints`

#### [NEW] [server/src/routes/holds.ts](file:///Users/tareqaziz/workspace/tests/seatbook/server/src/routes/holds.ts)
- `POST /events/:id/seats/:seatId/hold`:
  - Requires attendee authentication.
  - Executes inside a Prisma transaction with row lock (`FOR UPDATE`) on the `Seat`.
  - Checks if event is in the past.
  - Checks if seat has a `CONFIRMED` booking -> `409 Conflict: 'Seat already booked'`.
  - Checks if seat has an active hold (`expiresAt > NOW()`):
    - If held by another user -> `409 Conflict: 'Seat is currently held by another attendee'`.
    - If already held by the requesting user -> renews expiration and returns hold.
  - Releases any existing active hold the user has on this event.
  - Creates new `SeatHold` with `expiresAt = NOW() + 10 minutes`.
  - Returns `{ hold: { id, seatId, expiresAt, remainingSeconds: 600 } }`.
- `POST /holds/:id/release` or `DELETE /holds/:id`:
  - Allows an attendee to release their hold immediately so others don't have to wait 10 minutes.
- Add hold cleanup helper (cleans up expired holds lazily or periodically).

#### [MODIFY] [server/src/routes/events.ts](file:///Users/tareqaziz/workspace/tests/seatbook/server/src/routes/events.ts) & [server/src/services/eventService.ts](file:///Users/tareqaziz/workspace/tests/seatbook/server/src/services/eventService.ts)
- In `getEventWithSeats()`:
  - Include active holds (`expiresAt > NOW()`).
  - Read optional auth token from request header:
    - If requesting user holds the seat: `status: 'HELD'`, `heldByMe: true`, `holdExpiresAt`, `remainingSeconds`.
    - If someone else holds the seat: `status: 'HELD'`, `heldByMe: false`.
    - If booked: `status: 'BOOKED'`.
    - If free: `status: 'AVAILABLE'`.
- In `listEvents()`:
  - Account for active unexpired holds when computing `seatsLeft`.

---

### Step 5: `feat(bookings): enforce hold checks and transactional seat locks`

#### [MODIFY] [server/src/routes/bookings.ts](file:///Users/tareqaziz/workspace/tests/seatbook/server/src/routes/bookings.ts)
- In `POST /bookings`:
  - Run within Prisma interactive transaction with row locking:
    ```ts
    await prisma.$transaction(async (tx) => {
      // 1. Lock seat row
      const seats = await tx.$queryRaw<Seat[]>`SELECT * FROM "Seat" WHERE id = ${seatId} FOR UPDATE`;
      if (!seats.length) throw new HttpError(404, 'Seat not found');
      
      // 2. Check for confirmed booking
      const existing = await tx.booking.findFirst({
        where: { seatId, status: 'CONFIRMED' }
      });
      if (existing) throw new HttpError(409, 'Seat already booked');
      
      // 3. Check for active hold by another user
      const activeHold = await tx.seatHold.findFirst({
        where: { seatId, expiresAt: { gt: new Date() } }
      });
      if (activeHold && activeHold.userId !== req.user!.id) {
        throw new HttpError(409, 'Seat is currently held by another attendee');
      }
      
      // 4. Create confirmed booking
      const booking = await tx.booking.create({
        data: { seatId, userId: req.user!.id, status: 'CONFIRMED' }
      });
      
      // 5. Remove any hold on this seat
      await tx.seatHold.deleteMany({ where: { seatId } });
      
      return booking;
    });
    ```
  - Backed by the partial unique index as an absolute safety net.

---

### Step 6: `test(server): add tests for holds, concurrency races and auth idor`

#### [NEW] `server/test/holds.test.ts`
- Test hold creation with 10-minute expiration.
- Test that User B cannot hold a seat already held by User A.
- Test that User A can confirm their held seat into a confirmed booking.
- Test that when User A's hold expires, User B can acquire the hold.
- Test that releasing a hold makes the seat instantly available.

#### [NEW] `server/test/concurrency.test.ts`
- Test concurrent hold requests for the same seat (only 1 succeeds, other receives 409).
- Test concurrent booking requests (only 1 succeeds, other receives 409).

#### [NEW] `server/test/security.test.ts`
- Test IDOR prevention: User B receives 403 when trying to cancel User A's booking.
- Test that cancelled bookings do not corrupt `seatsLeft` count.

---

### Step 7: `feat(client): add dynamic api url config and seat hold grid status`

#### [MODIFY] [client/src/pages/EventDetailPage.tsx](file:///Users/tareqaziz/workspace/tests/seatbook/client/src/pages/EventDetailPage.tsx)
- Replace hardcoded `http://localhost:4000` with `API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'`.
- Send `Authorization: Bearer <token>` in `fetchEvent()` so server returns `heldByMe` flag.
- Add visual states to the seat grid:
  - **Available:** Purple/indigo gradient, hover scale, cursor pointer.
  - **Held by You:** Pulsing magenta border, glow, selected indicator.
  - **Held by Others:** Amber/orange with clock badge ⏳, disabled cursor, tooltip "Held by another attendee".
  - **Booked:** Muted gray, opacity 30%, disabled cursor.

#### [MODIFY] [client/src/pages/LoginPage.tsx](file:///Users/tareqaziz/workspace/tests/seatbook/client/src/pages/LoginPage.tsx)
- Replace hardcoded `http://localhost:4000` with `API_URL`.

---

### Step 8: `feat(client): implement 10-minute hold countdown timer and confirm`

#### [MODIFY] [client/src/pages/EventDetailPage.tsx](file:///Users/tareqaziz/workspace/tests/seatbook/client/src/pages/EventDetailPage.tsx)
- Implement two-stage hold and confirmation flow:
  1. Selecting an available seat displays a "Hold Seat for 10 Mins ⏳" button.
  2. Clicking "Hold Seat" calls `POST /events/:id/seats/:seatId/hold`.
  3. On success:
     - Live countdown timer starts (`MM:SS`).
     - Distinct countdown card in Order Summary: "Seat Held: A1 · Expires in 09:59".
     - Action button transitions to "Confirm Booking ($XX.XX)".
     - Secondary button: "Release Seat" (calls release endpoint).
  4. Timer expiry handling:
     - When timer reaches `00:00`, toast warning displays: "Your 10-minute hold has expired."
     - Hold state clears, and seat map re-fetches.
  5. Persistence across refresh:
     - On page load, if server reports `heldByMe: true` on any seat, the UI automatically restores the held seat and countdown timer with the exact remaining time.

---

### Step 9: `fix(client): fix booking cancellation badges and event 404 state`

#### [MODIFY] [client/src/pages/MyBookingsPage.tsx](file:///Users/tareqaziz/workspace/tests/seatbook/client/src/pages/MyBookingsPage.tsx)
- Show proper badge styling:
  - `CONFIRMED`: Green badge `✓ CONFIRMED`.
  - `CANCELLED`: Neutral/red badge `✕ CANCELLED`.
- Only show "Cancel" button for `CONFIRMED` bookings where `event.startsAt > now`.
- Prevent sending cancel requests for already cancelled bookings.

#### [MODIFY] [client/src/pages/EventDetailPage.tsx](file:///Users/tareqaziz/workspace/tests/seatbook/client/src/pages/EventDetailPage.tsx)
- Add 404 error boundary / fallback when event is not found, showing a friendly "Event not found" message with a button to return to the events catalog.

#### [MODIFY] [client/src/components/Navbar.tsx](file:///Users/tareqaziz/workspace/tests/seatbook/client/src/components/Navbar.tsx)
- Ensure clean state synchronization on login/logout.

---

### Step 10: `docs: add production handover note and ai chat transcript`

#### [MODIFY] [README.md](file:///Users/tareqaziz/workspace/tests/seatbook/README.md)
Add the comprehensive **Handover Note** required by Mr. Rahman with the exact 5 sections:
1. **What you changed and why:**
   - Architecture: Seat holds table, pessimistic row locking (`FOR UPDATE`), partial unique indexes.
   - Security: Solved IDOR in booking cancellation, input validation, JWT centralization, safe error handling.
   - Bugs: Fixed `seatsLeft` calculation ignoring cancelled bookings.
   - UI/UX: 10-minute live countdown timer, 4-state seat visual indicators, persistent hold restore.
2. **What you'd still do before launch:**
   - Payment gateway integration (Stripe / SSLCommerz / bKash).
   - Email ticketing / QR codes.
   - Real-time seat updates via WebSockets or Server-Sent Events (SSE).
   - Background worker (cron / Redis BullMQ) for sweeping expired holds instead of lazy evaluation.
   - Rate limiting on hold and auth endpoints.
3. **The weakest part of your work:**
   - Polling / lazy expiration vs real-time socket push (other users see holds update on poll or click rather than instant live socket).
   - Single-seat hold limit assumption.
4. **One place the AI was wrong:**
   - Detailed analysis of `isSeatBookable` in `helpers.ts` checking `seat.bookings.length === 0` which treats cancelled bookings as permanently occupied in `listEvents`, combined with returning HTTP 200 on missing events and the lack of authorization checks on booking cancellation.
5. **How you checked it works:**
   - Automated Vitest test suite commands and test scenarios.
   - Manual verification walkthrough step-by-step with Alice and Bob accounts.
   - Docker clean start verification (`docker compose down -v && docker compose up --build`).

#### [NEW] `ai-transcripts/session-transcript.md`
- Export and organize complete AI interaction logs into `ai-transcripts/` as requested in the take-home instructions.

---

## Verification Plan

### Automated Tests
1. **Run Vitest Test Suite:**
   ```bash
   cd server && npm test
   ```
   Validates:
   - Helper functions (price formatting, seat labels, availability calculations).
   - Hold creation, expiration, release, and conflict handling.
   - Concurrency race conditions (simultaneous holds/bookings on the same seat).
   - Authorization & IDOR protection in booking cancellation.
2. **Typecheck Server and Client:**
   ```bash
   cd server && npm run typecheck
   cd ../client && npm run typecheck
   ```

### Manual Verification Flow
1. **Clean Docker Start:**
   ```bash
   docker compose down -v
   docker compose up --build
   ```
2. **Hold Verification (Alice):**
   - Log in as Alice (`alice@seatbook.test` / `password123`).
   - Open "Postgres in Practice".
   - Pick an available seat (e.g. `A5`).
   - Click "Hold Seat for 10 Mins". Verify countdown timer starts at `10:00` and counts down every second.
   - Refresh the page: verify seat `A5` remains held by Alice and countdown resumes accurately.
3. **Conflict Verification (Bob):**
   - Open private browser window or second browser, log in as Bob (`bob@seatbook.test` / `password123`).
   - Open "Postgres in Practice".
   - Verify `A5` shows as "Held (⏳)" and cannot be held or booked by Bob.
4. **Confirmation Verification (Alice):**
   - In Alice's window, click "Confirm Booking".
   - Verify success toast, booking confirmed, and seat now displays as "Booked".
   - Check `My Bookings`: verify the new booking appears.
5. **Cancellation & Availability Check:**
   - Cancel the booking in `My Bookings`.
   - Verify badge updates to `CANCELLED` and "Cancel" button disappears.
   - Verify event list shows the seat available again (testing the fixed AI bug).
6. **Authorization (IDOR) Check:**
   - Send `POST /bookings/<AliceBookingId>/cancel` with Bob's token via curl. Verify Bob receives `403 Forbidden`.
