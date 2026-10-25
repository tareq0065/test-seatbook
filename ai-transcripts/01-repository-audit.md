# AI Transcript: 01 - Repository Audit & Implementation Planning

**Session Date:** October 25, 2026

---

## 1. Initial Prompt & Client Requirements

### User Prompt

> **The client**  
> Mr. Rahman runs talks and workshops in Dhaka. He built Seatbook himself with AI over a few weekends. It works, but before real customers pay through it, he wants an engineer to take it over and make it safe to run in production. That's you.  
> **Repo:** https://github.com/devmonks-co/seatbook (click "Use this template")  
> **Run it:** `docker compose up --build`. Test accounts are in the README. Mr. Rahman's account is the organizer.  
> 
> **What it does today (must keep working)**  
> - Sign up and log in, as an organizer or an attendee  
> - Organizers create events with a seat grid and a ticket price  
> - Attendees browse events, pick a free seat and book it  
> - Attendees see and cancel their bookings  
> 
> **What he wants added**  
> "Can people hold a seat for 10 minutes while they decide? Nobody else can take it meanwhile. If they confirm in time it's theirs, otherwise it goes back on sale. Show them how long they have left."  
> 
> **Your job**  
> Make what's there production ready, and add holds. How you do it is your call, on the server and in the UI. Don't add other features (email, notifications, password reset, 2FA, payments, deployment). If one is needed before launch, say so in your handover note. Where the request leaves something open, decide and write down your assumption.  
> 
> **What to send**  
> - Your repo, with full git history. Public, or private with `adar2378` added as a collaborator.  
> - A handover note in the README: what you changed and why, what you'd still do before launch, the weakest part of your work, one place the AI was wrong, and how you checked it works.  
> - Your AI chat history: the conversations you had with tools like Claude Code, Cursor or ChatGPT. Export them, or take screenshots if a tool can't export, into an `ai-transcripts/` folder.  
> - Submit your repo link through the form you received.  
> 
> **Rules**  
> - Use AI freely. You own every line.  
> - `docker compose up --build` must work from a clean start.  
> - Commit as you go. Don't squash.  
> 
> **Context:** You have the codes and above are the tasks or docs sent for the tasks.  
> **Task:** make step by step tasks plans in details I need to gradually complete the tasks step by step.  
> **Requirements:** `/plan` divide the tasks very precisely not too much or not very less. All of the tasks should have proper name that I can use them in the git commit msg. Keep in mind the char limits too.

---

## 2. Repository Exploration & Technical Findings

### 2.1 Workspace Architecture
- **Backend:** Node.js, Express, TypeScript, Prisma ORM, PostgreSQL (port `4000`, Postgres on `5433`).
- **Frontend:** React, Vite, TypeScript, TailwindCSS (port `5173`).
- **Docker Compose:** Multi-container setup with healthchecks for Postgres, auto-migrating and auto-seeding on startup.

### 2.2 Critical Vulnerabilities & Architectural Flaws Discovered

#### A. Race Condition & Double-Booking Bug (Concurrency)
- **Location:** `server/src/routes/bookings.ts` (`POST /bookings`)
- **Issue:** Uses a basic check-then-insert pattern without database transaction or row-level locking:
  ```typescript
  const existing = await prisma.booking.findFirst({
    where: { seatId: seat.id, status: 'CONFIRMED' },
  });
  if (existing) {
    return res.status(409).json({ error: 'Seat already booked' });
  }
  const booking = await prisma.booking.create({ ... });
  ```
- **Consequence:** Two concurrent requests will both find `existing === null` and both insert confirmed bookings for the exact same seat. Furthermore, `schema.prisma` lacks a unique constraint or partial unique index for active bookings on a seat.

#### B. Broken Access Control / IDOR (Insecure Direct Object Reference)
- **Location:** `server/src/routes/bookings.ts` (`POST /bookings/:id/cancel`)
- **Issue:**
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
- **Consequence:** Any logged-in user can cancel any other user's booking simply by providing their booking `id`. It fails to check `userId === req.user.id`.

#### C. Availability Discrepancy Bug ("One Place the AI Was Wrong")
- **Location:** `server/src/services/eventService.ts` & `server/src/utils/helpers.ts`
- **Issue:**
  In `eventService.ts`:
  ```typescript
  export async function listEvents() {
    const events = await prisma.event.findMany({
      orderBy: { startsAt: 'asc' },
      include: { seats: { include: { bookings: true } } }, // Includes ALL bookings, including CANCELLED!
    });
    ...
  }
  ```
  In `helpers.ts`:
  ```typescript
  export function isSeatBookable(seat: Seat & { bookings: Booking[] }, event: Event): boolean {
    if (new Date(event.startsAt) < new Date()) {
      return false;
    }
    return seat.bookings.length === 0; // BUG: if a booking was cancelled, bookings.length > 0!
  }
  ```
- **Consequence:** If an attendee books a seat and later cancels it, `listEvents` still considers the seat booked (`seat.bookings.length > 0`), reporting an incorrect `seatsLeft` count. Meanwhile, `getEventWithSeats` filters `bookings: { where: { status: 'CONFIRMED' } }`, showing the seat as available on the seat grid. The two endpoints disagree.

#### D. API Status Code & Error Handling Inconsistencies
- `GET /events/:id` returns HTTP `200 OK` with `{ success: false, message: 'Event not found' }` instead of HTTP `404 Not Found`.
- `POST /events` error response uses `{ msg: '...' }` while others use `{ error: '...' }`.
- `GET /bookings/mine` catches errors and silently returns `[]` instead of reporting server failures.

#### E. Client Inconsistencies
- `EventDetailPage.tsx` and `LoginPage.tsx` hardcode `http://localhost:4000` instead of using `import.meta.env.VITE_API_URL`.
- In `MyBookingsPage.tsx`, already-cancelled bookings show a green `✓ CANCELLED` badge and still render an active "Cancel" button.

---

## 3. Implementation Plan Developed

The following 10-step atomic plan was formulated:

1. **Security & Input Validation:** Fix IDOR on `/bookings/:id/cancel`, sanitize params, standardize errors.
2. **Availability Calculation:** Fix `isSeatBookable` & `listEvents` to exclude cancelled bookings.
3. **Database Schema & Constraints:** Add Prisma `SeatHold` model and PostgreSQL partial unique index.
4. **Seat Hold & Release Endpoints:** Endpoints for 10-minute hold creation, manual release, and TTL check.
5. **Transactional Booking Logic:** Add `SELECT ... FOR UPDATE` row locks; confirm held seats atomically.
6. **Automated Test Suite:** Vitest test suite for holds, expiration, race conditions, and IDOR.
7. **Client Configuration & Grid Status:** Centralize `API_URL`; seat grid styles: Available, Held, Booked.
8. **Client Countdown & Confirm Flow:** UI 10-minute countdown timer, auto-expiry, and hold-to-confirm flow.
9. **Client UI State & Badge Fixes:** UI badge fixes on cancelled bookings and graceful 404 event views.
10. **Handover Documentation & Transcripts:** Complete README Handover Note (5 sections) and transcript logs.

---

## 4. Key Design Assumptions Agreed Upon
1. **Hold TTL:** Exactly 10 minutes (600 seconds).
2. **Hold Capacity:** 1 active hold per attendee per event to prevent denial-of-service seat hoarding. Holding another seat releases the previous one.
3. **Concurrency:** Guaranteed via PostgreSQL partial unique index (`"Booking"("seatId") WHERE status = 'CONFIRMED'`) and pessimistic transaction row locking (`SELECT * FROM "Seat" WHERE id = $1 FOR UPDATE`).
4. **Clean Docker Start:** Validated through `docker compose down -v && docker compose up --build`.
