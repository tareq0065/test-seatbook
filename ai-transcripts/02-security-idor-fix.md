# AI Transcript: 02 - Security & IDOR Fix in Booking Cancellation and Input Validation

**Session Date:** October 25, 2026

---

## 1. Context & Task Prompt

### User Prompt

> **Context:**  
> Commit 1: fix(security): resolve idor in booking cancel and sanitize user input  
> 
> **Task:**  
> Security & IDOR fix in booking cancellation; input validation  

---

## 2. Vulnerability Analysis & Implementation Design

### 2.1 The Insecure Direct Object Reference (IDOR) Flaw
- **Location:** `server/src/routes/bookings.ts` (`POST /bookings/:id/cancel`)
- **Initial Implementation:**
  ```typescript
  router.post('/:id/cancel', requireAuth, async (req: AuthRequest, res) => {
    const id = parseInt(req.params.id);
    await prisma.booking.updateMany({
      where: { id, status: 'CONFIRMED' },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    res.json({ success: true });
  });
  ```
- **Exploit Scenario:**  
  Any authenticated attendee could cancel any other attendee's booking simply by guessing or iterating the numeric booking `id`. It completely lacked an ownership check (`booking.userId === req.user.id`). Furthermore, `updateMany` quietly executed without verifying if the booking existed, was already cancelled, or belonged to an event that had already passed.

### 2.2 Comprehensive Fix Strategy

1. **Authorization & Access Control Check:**
   - Look up the target booking with its associated seat and event details:
     ```typescript
     const booking = await prisma.booking.findUnique({
       where: { id },
       include: { seat: { include: { event: true } } },
     });
     ```
   - Check if the requester is the owner (`booking.userId === req.user.id`) or the event organizer (`req.user.role === 'ORGANIZER' && booking.seat.event.organizerId === req.user.id`).
   - If neither, reject with **HTTP 403 Forbidden**: `{ error: "You are not authorized to cancel this booking" }`.

2. **Precondition & State Validation:**
   - If the booking does not exist: return **HTTP 404 Not Found** (`{ error: "Booking not found" }`).
   - If the booking is already cancelled: return **HTTP 400 Bad Request** (`{ error: "Booking is already cancelled" }`).
   - If the event has already started: return **HTTP 400 Bad Request** (`{ error: "Cannot cancel booking for an event that has already started" }`).

3. **Input Validation Across Endpoints:**
   - **`POST /bookings/:id/cancel`**: Enforce that `:id` is a valid positive integer.
   - **`POST /bookings`**: Ensure `seatId` is provided and is a positive integer before hitting the database.
   - **`GET /bookings/mine`**: Return HTTP 500 on unexpected database errors rather than masking errors with an empty array.
   - **`GET /events/:id`**: Enforce numeric `:id` validation and return **HTTP 404 Not Found** instead of HTTP 200 with `{ success: false }`.
   - **`POST /events`**: Validate required string fields (`title`, `venue`), valid dates (`startsAt`), positive integers for `rows` and `cols` (capping at 26x30), and non-negative integer for `priceCents`.
   - **`POST /auth/register` & `POST /auth/login`**: Trim and lowercase email inputs, enforce valid email syntax, minimum password length (>= 6 chars), and use `process.env.JWT_SECRET || 'seatbook-secret-123'`.
   - **`requireAuth` middleware**: Safely validate that the `Authorization` header starts with `Bearer ` and contains a non-empty token string before passing to `jwt.verify`.

---

## 3. Code Modifications Applied

1. **`server/src/routes/bookings.ts`**
   - Implemented ownership verification on `POST /:id/cancel`.
   - Added pre-checks for event start time, existing cancellation status, and booking existence.
   - Validated `seatId` in `POST /`.
   - Replaced silent fallback in `GET /mine` with standard 500 error handling.

2. **`server/src/routes/events.ts`**
   - Sanitized `:id` on `GET /:id` and returned HTTP 404 for missing events.
   - Added full type and boundary validations on `POST /` fields (`title`, `venue`, `startsAt`, `rows`, `cols`, `priceCents`).
   - Standardized error response structure to `{ error: "..." }`.

3. **`server/src/services/eventService.ts`**
   - Sanitized `req.params.id` in `getEventWithSeats`, returning `null` when `:id` is invalid.

4. **`server/src/routes/auth.ts`**
   - Standardized `JWT_SECRET` environment variable usage.
   - Added input validation for registration and login fields.
   - Normalized email strings via `.trim().toLowerCase()`.

5. **`server/src/middleware/auth.ts`**
   - Hardened `Bearer ` token extraction and returned standardized error messages on invalid/missing tokens.

6. **`server/src/index.ts`**
   - Exported `app` directly for automated testing and wrapped `app.listen()` with a non-test environment check (`process.env.NODE_ENV !== 'test'`).

7. **`server/test/security.test.ts`**
   - Added automated Vitest suite with 21 tests covering IDOR, authentication, cancellation states, and endpoint input validations.

---

## 4. Manual Verification Steps

Follow these steps in your terminal to manually verify all security patches and input validations against the running application:

### Step 1: Log in as Test Users

Obtain tokens for **Alice** (Attendee, User ID: 2) and **Bob** (Attendee, User ID: 3):

```bash
# Login as Alice
ALICE_TOKEN=$(curl -s -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@seatbook.test","password":"password123"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)

# Login as Bob
BOB_TOKEN=$(curl -s -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"bob@seatbook.test","password":"password123"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)

echo "Alice Token: $ALICE_TOKEN"
echo "Bob Token: $BOB_TOKEN"
```

### Step 2: Test IDOR Protection (Bob tries to cancel Alice's booking)

Alice owns Booking ID `1` (or check Alice's bookings via `curl -H "Authorization: Bearer $ALICE_TOKEN" http://localhost:4000/bookings/mine`).  
Bob attempts to cancel Alice's booking:

```bash
curl -i -X POST http://localhost:4000/bookings/1/cancel \
  -H "Authorization: Bearer $BOB_TOKEN"
```

**Expected Result:**
```http
HTTP/1.1 403 Forbidden
Content-Type: application/json; charset=utf-8

{"error":"You are not authorized to cancel this booking"}
```

---

### Step 3: Test Parameter Sanitization (Invalid & Non-Existent IDs)

Send non-numeric and negative booking IDs:

```bash
# Non-numeric ID
curl -i -X POST http://localhost:4000/bookings/invalid-id/cancel \
  -H "Authorization: Bearer $ALICE_TOKEN"

# Non-existent ID
curl -i -X POST http://localhost:4000/bookings/999999/cancel \
  -H "Authorization: Bearer $ALICE_TOKEN"
```

**Expected Results:**
- `invalid-id`: `HTTP/1.1 400 Bad Request` with `{"error":"Invalid booking ID"}`
- `999999`: `HTTP/1.1 404 Not Found` with `{"error":"Booking not found"}`

---

### Step 4: Test Past Event Cancellation Block

Alice has a seeded booking (Booking ID `4`) for an event in the past ("Intro to TypeScript"):

```bash
curl -i -X POST http://localhost:4000/bookings/4/cancel \
  -H "Authorization: Bearer $ALICE_TOKEN"
```

**Expected Result:**
```http
HTTP/1.1 400 Bad Request
Content-Type: application/json; charset=utf-8

{"error":"Cannot cancel booking for an event that has already started"}
```

---

### Step 5: Test Legitimate Booking Cancellation & Duplicate Cancellation

Cancel a valid upcoming booking belonging to Alice (e.g., Booking ID `1`):

```bash
# Legitimate cancellation by the owner
curl -i -X POST http://localhost:4000/bookings/1/cancel \
  -H "Authorization: Bearer $ALICE_TOKEN"
```

**Expected Result:**
```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{"success":true,"booking":{"id":1,"status":"CANCELLED",...}}
```

Now immediately attempt to cancel the exact same booking again:

```bash
curl -i -X POST http://localhost:4000/bookings/1/cancel \
  -H "Authorization: Bearer $ALICE_TOKEN"
```

**Expected Result:**
```http
HTTP/1.1 400 Bad Request
Content-Type: application/json; charset=utf-8

{"error":"Booking is already cancelled"}
```

---

### Step 6: Test Input Validation on Bookings & Events

1. **Missing or invalid `seatId` on `POST /bookings`:**
   ```bash
   curl -i -X POST http://localhost:4000/bookings \
     -H "Authorization: Bearer $ALICE_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"seatId": "abc"}'
   ```
   **Expected Result:** `HTTP/1.1 400 Bad Request` with `{"error":"Valid seatId is required"}`.

2. **Invalid event ID on `GET /events/:id`:**
   ```bash
   curl -i http://localhost:4000/events/not-a-number
   ```
   **Expected Result:** `HTTP/1.1 400 Bad Request` with `{"error":"Invalid event ID"}`.

3. **Non-existent event ID on `GET /events/:id`:**
   ```bash
   curl -i http://localhost:4000/events/999999
   ```
   **Expected Result:** `HTTP/1.1 404 Not Found` with `{"error":"Event not found","message":"Event not found"}`.

---

### Step 7: Automated Unit & Integration Testing Suite (Recommended)

To eliminate test state pollution and verify all 24 security and validation rules automatically with clear test names and pass/fail indicators, run the automated test suite:

```bash
# Run from workspace root:
npm test

# Or from server directory:
cd server && npm test
```

**Expected Result:** Vitest executes all 24 test cases with verbose names, exiting with code 0:
```text
 ✓ test/helpers.test.ts > helpers > formats cents as dollars
 ✓ test/helpers.test.ts > helpers > labels seats by row letter and column number
 ✓ test/helpers.test.ts > helpers > slugifies titles
 ✓ test/security.test.ts > Security & IDOR Tests > POST /bookings/:id/cancel - IDOR & Access Control > rejects cancellation when not authenticated (401 Unauthorized)
 ✓ test/security.test.ts > Security & IDOR Tests > POST /bookings/:id/cancel - IDOR & Access Control > prevents attendee from cancelling another user's booking (IDOR protection -> 403 Forbidden)
 ✓ test/security.test.ts > Security & IDOR Tests > POST /bookings/:id/cancel - IDOR & Access Control > rejects non-numeric booking ID with 400 Bad Request
 ✓ test/security.test.ts > Security & IDOR Tests > POST /bookings/:id/cancel - IDOR & Access Control > rejects negative or float booking ID with 400 Bad Request
 ✓ test/security.test.ts > Security & IDOR Tests > POST /bookings/:id/cancel - IDOR & Access Control > returns 404 Not Found when target booking does not exist
 ✓ test/security.test.ts > Security & IDOR Tests > POST /bookings/:id/cancel - IDOR & Access Control > rejects cancellation for an event that has already started (400 Bad Request)
 ✓ test/security.test.ts > Security & IDOR Tests > POST /bookings/:id/cancel - IDOR & Access Control > allows attendee to cancel their own valid upcoming booking (200 OK)
 ✓ test/security.test.ts > Security & IDOR Tests > POST /bookings/:id/cancel - IDOR & Access Control > rejects repeat cancellation attempt when booking is already cancelled (400 Bad Request)
 ✓ test/security.test.ts > Security & IDOR Tests > POST /bookings/:id/cancel - IDOR & Access Control > allows event organizer to cancel a booking on their event (200 OK)
 ✓ test/security.test.ts > Security & IDOR Tests > Input Validation & Sanitization Tests > POST /bookings rejects missing seatId (400 Bad Request)
 ✓ test/security.test.ts > Security & IDOR Tests > Input Validation & Sanitization Tests > POST /bookings rejects non-numeric seatId (400 Bad Request)
 ✓ test/security.test.ts > Security & IDOR Tests > Input Validation & Sanitization Tests > POST /bookings returns 404 for non-existent seatId
 ✓ test/security.test.ts > Security & IDOR Tests > Input Validation & Sanitization Tests > GET /events/:id rejects invalid event ID (400 Bad Request)
 ✓ test/security.test.ts > Security & IDOR Tests > Input Validation & Sanitization Tests > GET /events/:id returns 404 Not Found for non-existent event ID
 ✓ test/security.test.ts > Security & IDOR Tests > Input Validation & Sanitization Tests > POST /events rejects non-organizer caller (403 Forbidden)
 ✓ test/security.test.ts > Security & IDOR Tests > Input Validation & Sanitization Tests > POST /events rejects missing required fields (400 Bad Request)
 ✓ test/security.test.ts > Security & IDOR Tests > Input Validation & Sanitization Tests > POST /events rejects grid dimensions exceeding max limits (400 Bad Request)
 ✓ test/security.test.ts > Security & IDOR Tests > Input Validation & Sanitization Tests > POST /auth/register rejects invalid email format (400 Bad Request)
 ✓ test/security.test.ts > Security & IDOR Tests > Input Validation & Sanitization Tests > POST /auth/register rejects short password (400 Bad Request)
 ✓ test/security.test.ts > Security & IDOR Tests > Input Validation & Sanitization Tests > POST /auth/login rejects wrong credentials with 401 Unauthorized
 ✓ test/security.test.ts > Security & IDOR Tests > Input Validation & Sanitization Tests > requireAuth rejects malformed Authorization header (401 Unauthorized)

 Test Files  2 passed (2)
      Tests  24 passed (24)
```

### Step 8: Typecheck Verification

```bash
npm run typecheck
```
Both server and client TypeScript compilers exit cleanly with 0 errors.
