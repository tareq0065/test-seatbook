if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://seatbook:seatbook@localhost:5433/seatbook';
}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Server } from 'http';
import jwt from 'jsonwebtoken';
import app from '../src/index';
import prisma from '../src/db';

const JWT_SECRET = process.env.JWT_SECRET || 'seatbook-secret-123';

describe('Security & IDOR Tests', () => {
  let server: Server;
  let baseUrl: string;

  let organizerToken: string;
  let aliceToken: string;
  let bobToken: string;

  let organizerUser: any;
  let aliceUser: any;
  let bobUser: any;

  let futureEvent: any;
  let pastEvent: any;

  beforeAll(async () => {
    // 1. Spin up ephemeral server on port 0
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    // 2. Fetch or create test users
    organizerUser = await prisma.user.findUnique({ where: { email: 'organizer@seatbook.test' } });
    aliceUser = await prisma.user.findUnique({ where: { email: 'alice@seatbook.test' } });
    bobUser = await prisma.user.findUnique({ where: { email: 'bob@seatbook.test' } });

    expect(organizerUser).toBeDefined();
    expect(aliceUser).toBeDefined();
    expect(bobUser).toBeDefined();

    organizerToken = jwt.sign({ id: organizerUser.id, email: organizerUser.email, role: organizerUser.role }, JWT_SECRET);
    aliceToken = jwt.sign({ id: aliceUser.id, email: aliceUser.email, role: aliceUser.role }, JWT_SECRET);
    bobToken = jwt.sign({ id: bobUser.id, email: bobUser.email, role: bobUser.role }, JWT_SECRET);

    // 3. Setup test events
    futureEvent = await prisma.event.create({
      data: {
        title: 'IDOR Test Future Event',
        description: 'Automated test event',
        venue: 'Test Hall A',
        startsAt: new Date(Date.now() + 86400000 * 7), // 7 days in future
        rows: 2,
        cols: 2,
        priceCents: 1000,
        organizerId: organizerUser.id,
        seats: {
          create: [
            { row: 0, col: 0, label: 'A1' },
            { row: 0, col: 1, label: 'A2' },
            { row: 1, col: 0, label: 'B1' },
            { row: 1, col: 1, label: 'B2' },
          ],
        },
      },
      include: { seats: true },
    });

    pastEvent = await prisma.event.create({
      data: {
        title: 'IDOR Test Past Event',
        description: 'Automated past test event',
        venue: 'Test Hall B',
        startsAt: new Date(Date.now() - 86400000 * 2), // 2 days in past
        rows: 1,
        cols: 1,
        priceCents: 1000,
        organizerId: organizerUser.id,
        seats: {
          create: [{ row: 0, col: 0, label: 'A1' }],
        },
      },
      include: { seats: true },
    });
  });

  afterAll(async () => {
    // Clean up test events (cascades seats & bookings)
    if (futureEvent) {
      await prisma.booking.deleteMany({ where: { seat: { eventId: futureEvent.id } } });
      await prisma.seat.deleteMany({ where: { eventId: futureEvent.id } });
      await prisma.event.delete({ where: { id: futureEvent.id } });
    }
    if (pastEvent) {
      await prisma.booking.deleteMany({ where: { seat: { eventId: pastEvent.id } } });
      await prisma.seat.deleteMany({ where: { eventId: pastEvent.id } });
      await prisma.event.delete({ where: { id: pastEvent.id } });
    }

    // Close server
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe('POST /bookings/:id/cancel - IDOR & Access Control', () => {
    it('rejects cancellation when not authenticated (401 Unauthorized)', async () => {
      const res = await fetch(`${baseUrl}/bookings/1/cancel`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Not logged in');
    });

    it("prevents attendee from cancelling another user's booking (IDOR protection -> 403 Forbidden)", async () => {
      // Create a confirmed booking for Alice
      const aliceBooking = await prisma.booking.create({
        data: {
          seatId: futureEvent.seats[0].id,
          userId: aliceUser.id,
          status: 'CONFIRMED',
        },
      });

      // Bob attempts to cancel Alice's booking
      const res = await fetch(`${baseUrl}/bookings/${aliceBooking.id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bobToken}` },
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('You are not authorized to cancel this booking');

      // Verify the booking is STILL confirmed in DB
      const dbBooking = await prisma.booking.findUnique({ where: { id: aliceBooking.id } });
      expect(dbBooking?.status).toBe('CONFIRMED');

      // Clean up booking
      await prisma.booking.delete({ where: { id: aliceBooking.id } });
    });

    it('rejects non-numeric booking ID with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/bookings/not-a-number/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${aliceToken}` },
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid booking ID');
    });

    it('rejects negative or float booking ID with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/bookings/-10/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${aliceToken}` },
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid booking ID');
    });

    it('returns 404 Not Found when target booking does not exist', async () => {
      const res = await fetch(`${baseUrl}/bookings/999999/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${aliceToken}` },
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Booking not found');
    });

    it('rejects cancellation for an event that has already started (400 Bad Request)', async () => {
      const pastBooking = await prisma.booking.create({
        data: {
          seatId: pastEvent.seats[0].id,
          userId: aliceUser.id,
          status: 'CONFIRMED',
        },
      });

      const res = await fetch(`${baseUrl}/bookings/${pastBooking.id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${aliceToken}` },
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Cannot cancel booking for an event that has already started');

      await prisma.booking.delete({ where: { id: pastBooking.id } });
    });

    it('allows attendee to cancel their own valid upcoming booking (200 OK)', async () => {
      const aliceBooking = await prisma.booking.create({
        data: {
          seatId: futureEvent.seats[1].id,
          userId: aliceUser.id,
          status: 'CONFIRMED',
        },
      });

      const res = await fetch(`${baseUrl}/bookings/${aliceBooking.id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${aliceToken}` },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.booking.status).toBe('CANCELLED');

      // Verify DB status
      const dbBooking = await prisma.booking.findUnique({ where: { id: aliceBooking.id } });
      expect(dbBooking?.status).toBe('CANCELLED');
      expect(dbBooking?.cancelledAt).toBeDefined();

      await prisma.booking.delete({ where: { id: aliceBooking.id } });
    });

    it('rejects repeat cancellation attempt when booking is already cancelled (400 Bad Request)', async () => {
      const alreadyCancelledBooking = await prisma.booking.create({
        data: {
          seatId: futureEvent.seats[2].id,
          userId: aliceUser.id,
          status: 'CANCELLED',
          cancelledAt: new Date(),
        },
      });

      const res = await fetch(`${baseUrl}/bookings/${alreadyCancelledBooking.id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${aliceToken}` },
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Booking is already cancelled');

      await prisma.booking.delete({ where: { id: alreadyCancelledBooking.id } });
    });

    it('allows event organizer to cancel a booking on their event (200 OK)', async () => {
      const attendeeBooking = await prisma.booking.create({
        data: {
          seatId: futureEvent.seats[3].id,
          userId: bobUser.id,
          status: 'CONFIRMED',
        },
      });

      const res = await fetch(`${baseUrl}/bookings/${attendeeBooking.id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${organizerToken}` },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.booking.status).toBe('CANCELLED');

      await prisma.booking.delete({ where: { id: attendeeBooking.id } });
    });
  });

  describe('Input Validation & Sanitization Tests', () => {
    it('POST /bookings rejects missing seatId (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Valid seatId is required');
    });

    it('POST /bookings rejects non-numeric seatId (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({ seatId: 'invalid-seat' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Valid seatId is required');
    });

    it('POST /bookings returns 404 for non-existent seatId', async () => {
      const res = await fetch(`${baseUrl}/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({ seatId: 999999 }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Seat not found');
    });

    it('GET /events/:id rejects invalid event ID (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/events/not-an-id`);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid event ID');
    });

    it('GET /events/:id returns 404 Not Found for non-existent event ID', async () => {
      const res = await fetch(`${baseUrl}/events/999999`);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Event not found');
    });

    it('POST /events rejects non-organizer caller (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`, // Alice is attendee
        },
        body: JSON.stringify({
          title: 'Unauthorized Event',
          venue: 'Venue A',
          startsAt: new Date(Date.now() + 86400000).toISOString(),
          rows: 5,
          cols: 5,
        }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('Only organizers can create events');
    });

    it('POST /events rejects missing required fields (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${organizerToken}`,
        },
        body: JSON.stringify({
          title: '', // Missing title
          venue: 'Venue',
          startsAt: new Date(Date.now() + 86400000).toISOString(),
          rows: 5,
          cols: 5,
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Title is required');
    });

    it('POST /events rejects grid dimensions exceeding max limits (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${organizerToken}`,
        },
        body: JSON.stringify({
          title: 'Oversized Event',
          venue: 'Grand Arena',
          startsAt: new Date(Date.now() + 86400000).toISOString(),
          rows: 30, // Exceeds 26 max
          cols: 10,
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Seat grid too large (max 26 rows x 30 cols)');
    });

    it('POST /auth/register rejects invalid email format (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'notanemail',
          password: 'password123',
          name: 'Test User',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Valid email is required');
    });

    it('POST /auth/register rejects short password (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'valid@test.com',
          password: '123', // < 6 chars
          name: 'Test User',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Password must be at least 6 characters');
    });

    it('POST /auth/login rejects wrong credentials with 401 Unauthorized', async () => {
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'alice@seatbook.test',
          password: 'wrongpassword',
        }),
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Invalid credentials');
    });

    it('requireAuth rejects malformed Authorization header (401 Unauthorized)', async () => {
      const res = await fetch(`${baseUrl}/bookings/mine`, {
        headers: { Authorization: 'Basic dXNlcjpwYXNz' }, // Not Bearer
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Not logged in');
    });
  });
});
