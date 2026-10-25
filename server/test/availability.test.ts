if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://seatbook:seatbook@localhost:5433/seatbook';
}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Server } from 'http';
import jwt from 'jsonwebtoken';
import app from '../src/index';
import prisma from '../src/db';
import { listEvents } from '../src/services/eventService';

const JWT_SECRET = process.env.JWT_SECRET || 'seatbook-secret-123';

describe('Event & Seat Availability Tests ("AI was wrong" bug fix)', () => {
  let server: Server;
  let baseUrl: string;

  let organizerToken: string;
  let attendeeToken: string;

  let organizerUser: any;
  let attendeeUser: any;

  let testEvent: any;
  let pastEvent: any;

  beforeAll(async () => {
    // 1. Spin up ephemeral server
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    // 2. Fetch or create test users
    organizerUser = await prisma.user.findUnique({ where: { email: 'organizer@seatbook.test' } });
    attendeeUser = await prisma.user.findUnique({ where: { email: 'alice@seatbook.test' } });

    expect(organizerUser).toBeDefined();
    expect(attendeeUser).toBeDefined();

    organizerToken = jwt.sign(
      { id: organizerUser.id, email: organizerUser.email, role: organizerUser.role },
      JWT_SECRET
    );
    attendeeToken = jwt.sign(
      { id: attendeeUser.id, email: attendeeUser.email, role: attendeeUser.role },
      JWT_SECRET
    );

    // 3. Create test future event with 4 seats (2x2 grid)
    testEvent = await prisma.event.create({
      data: {
        title: 'Availability Test Event',
        description: 'Testing seatsLeft and cancelled booking availability',
        venue: 'Test Availability Arena',
        startsAt: new Date(Date.now() + 86400000 * 5), // 5 days in future
        rows: 2,
        cols: 2,
        priceCents: 2500,
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

    // 4. Create test past event with 2 seats (1x2 grid)
    pastEvent = await prisma.event.create({
      data: {
        title: 'Past Availability Test Event',
        description: 'Past event should have 0 seatsLeft',
        venue: 'Old Arena',
        startsAt: new Date(Date.now() - 86400000 * 2), // 2 days in past
        rows: 1,
        cols: 2,
        priceCents: 1000,
        organizerId: organizerUser.id,
        seats: {
          create: [
            { row: 0, col: 0, label: 'A1' },
            { row: 0, col: 1, label: 'A2' },
          ],
        },
      },
      include: { seats: true },
    });
  });

  afterAll(async () => {
    // Clean up created events and their seats/bookings
    if (testEvent) {
      await prisma.booking.deleteMany({ where: { seat: { eventId: testEvent.id } } });
      await prisma.seat.deleteMany({ where: { eventId: testEvent.id } });
      await prisma.event.delete({ where: { id: testEvent.id } });
    }
    if (pastEvent) {
      await prisma.booking.deleteMany({ where: { seat: { eventId: pastEvent.id } } });
      await prisma.seat.deleteMany({ where: { eventId: pastEvent.id } });
      await prisma.event.delete({ where: { id: pastEvent.id } });
    }

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  });

  describe('eventService.listEvents & GET /events', () => {
    it('accurately calculates seatsLeft when all seats are free', async () => {
      const events = await listEvents();
      const matched = events.find((e) => e.id === testEvent.id);
      expect(matched).toBeDefined();
      expect(matched!.totalSeats).toBe(4);
      expect(matched!.seatsLeft).toBe(4);

      // Verify over HTTP
      const res = await fetch(`${baseUrl}/events`);
      expect(res.status).toBe(200);
      const data = await res.json();
      const httpMatched = data.find((e: any) => e.id === testEvent.id);
      expect(httpMatched.seatsLeft).toBe(4);
    });

    it('returns seatsLeft = 0 for past events even if seats have no bookings', async () => {
      const events = await listEvents();
      const matched = events.find((e) => e.id === pastEvent.id);
      expect(matched).toBeDefined();
      expect(matched!.totalSeats).toBe(2);
      expect(matched!.seatsLeft).toBe(0);

      // Verify over HTTP
      const res = await fetch(`${baseUrl}/events`);
      const data = await res.json();
      const httpMatched = data.find((e: any) => e.id === pastEvent.id);
      expect(httpMatched.seatsLeft).toBe(0);
    });

    it('decrements seatsLeft when a booking is confirmed', async () => {
      // Book seat A1
      const seatA1 = testEvent.seats.find((s: any) => s.label === 'A1');
      const booking = await prisma.booking.create({
        data: {
          seatId: seatA1.id,
          userId: attendeeUser.id,
          status: 'CONFIRMED',
        },
      });

      const events = await listEvents();
      const matched = events.find((e) => e.id === testEvent.id);
      expect(matched!.seatsLeft).toBe(3);

      const res = await fetch(`${baseUrl}/events`);
      const data = await res.json();
      const httpMatched = data.find((e: any) => e.id === testEvent.id);
      expect(httpMatched.seatsLeft).toBe(3);

      // Clean up booking
      await prisma.booking.delete({ where: { id: booking.id } });
    });

    it('DOES NOT decrement seatsLeft when a booking is CANCELLED (Core Bug Fix)', async () => {
      const seatA1 = testEvent.seats.find((s: any) => s.label === 'A1');
      const seatA2 = testEvent.seats.find((s: any) => s.label === 'A2');

      // Create 1 CONFIRMED booking and 1 CANCELLED booking
      const confirmedBooking = await prisma.booking.create({
        data: {
          seatId: seatA1.id,
          userId: attendeeUser.id,
          status: 'CONFIRMED',
        },
      });

      const cancelledBooking = await prisma.booking.create({
        data: {
          seatId: seatA2.id,
          userId: attendeeUser.id,
          status: 'CANCELLED',
          cancelledAt: new Date(),
        },
      });

      // 4 total seats - 1 confirmed booking = 3 seatsLeft!
      // The bug caused it to count 2 seatsLeft because cancelledBooking.length > 0!
      const events = await listEvents();
      const matched = events.find((e) => e.id === testEvent.id);
      expect(matched!.totalSeats).toBe(4);
      expect(matched!.seatsLeft).toBe(3);

      // Verify over HTTP GET /events
      const res = await fetch(`${baseUrl}/events`);
      const data = await res.json();
      const httpMatched = data.find((e: any) => e.id === testEvent.id);
      expect(httpMatched.seatsLeft).toBe(3);

      // Clean up
      await prisma.booking.delete({ where: { id: confirmedBooking.id } });
      await prisma.booking.delete({ where: { id: cancelledBooking.id } });
    });
  });

  describe('GET /events/:id Seat Grid Consistency', () => {
    it('marks seats with cancelled bookings as available: true on the seat grid', async () => {
      const seatA1 = testEvent.seats.find((s: any) => s.label === 'A1');
      const seatA2 = testEvent.seats.find((s: any) => s.label === 'A2');

      const confirmedBooking = await prisma.booking.create({
        data: {
          seatId: seatA1.id,
          userId: attendeeUser.id,
          status: 'CONFIRMED',
        },
      });

      const cancelledBooking = await prisma.booking.create({
        data: {
          seatId: seatA2.id,
          userId: attendeeUser.id,
          status: 'CANCELLED',
          cancelledAt: new Date(),
        },
      });

      const res = await fetch(`${baseUrl}/events/${testEvent.id}`);
      expect(res.status).toBe(200);
      const data = await res.json();

      const seatA1Data = data.seats.find((s: any) => s.label === 'A1');
      const seatA2Data = data.seats.find((s: any) => s.label === 'A2');
      const seatB1Data = data.seats.find((s: any) => s.label === 'B1');

      expect(seatA1Data.available).toBe(false); // Booked (CONFIRMED)
      expect(seatA2Data.available).toBe(true);  // Available (CANCELLED booking must not block!)
      expect(seatB1Data.available).toBe(true);  // Available (Unbooked)

      // Total available seats on grid must match seatsLeft on GET /events
      const availableGridSeats = data.seats.filter((s: any) => s.available).length;
      expect(availableGridSeats).toBe(3);

      // Clean up
      await prisma.booking.delete({ where: { id: confirmedBooking.id } });
      await prisma.booking.delete({ where: { id: cancelledBooking.id } });
    });

    it('marks all seats as available: false for past events', async () => {
      const res = await fetch(`${baseUrl}/events/${pastEvent.id}`);
      expect(res.status).toBe(200);
      const data = await res.json();

      for (const seat of data.seats) {
        expect(seat.available).toBe(false);
      }
    });
  });

  describe('Full End-to-End Booking & Cancellation Availability Lifecycle', () => {
    it('restores seatsLeft and seat availability immediately after cancellation', async () => {
      const seatB2 = testEvent.seats.find((s: any) => s.label === 'B2');

      // 1. Initial State: seatsLeft = 4, B2 is available
      let listRes = await fetch(`${baseUrl}/events`);
      let listData = await listRes.json();
      let eventCard = listData.find((e: any) => e.id === testEvent.id);
      expect(eventCard.seatsLeft).toBe(4);

      let detailRes = await fetch(`${baseUrl}/events/${testEvent.id}`);
      let detailData = await detailRes.json();
      let seatDetail = detailData.seats.find((s: any) => s.id === seatB2.id);
      expect(seatDetail.available).toBe(true);

      // 2. Book Seat B2
      const bookRes = await fetch(`${baseUrl}/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${attendeeToken}`,
        },
        body: JSON.stringify({ seatId: seatB2.id }),
      });
      expect(bookRes.status).toBe(201);
      const bookingData = await bookRes.json();
      const bookingId = bookingData.id;

      // 3. Post-Booking State: seatsLeft = 3, B2 is available: false
      listRes = await fetch(`${baseUrl}/events`);
      listData = await listRes.json();
      eventCard = listData.find((e: any) => e.id === testEvent.id);
      expect(eventCard.seatsLeft).toBe(3);

      detailRes = await fetch(`${baseUrl}/events/${testEvent.id}`);
      detailData = await detailRes.json();
      seatDetail = detailData.seats.find((s: any) => s.id === seatB2.id);
      expect(seatDetail.available).toBe(false);

      // 4. Cancel the booking
      const cancelRes = await fetch(`${baseUrl}/bookings/${bookingId}/cancel`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${attendeeToken}`,
        },
      });
      expect(cancelRes.status).toBe(200);

      // 5. Post-Cancellation State: seatsLeft MUST be restored to 4, B2 MUST be available: true!
      listRes = await fetch(`${baseUrl}/events`);
      listData = await listRes.json();
      eventCard = listData.find((e: any) => e.id === testEvent.id);
      expect(eventCard.seatsLeft).toBe(4);

      detailRes = await fetch(`${baseUrl}/events/${testEvent.id}`);
      detailData = await detailRes.json();
      seatDetail = detailData.seats.find((s: any) => s.id === seatB2.id);
      expect(seatDetail.available).toBe(true);

      // 6. Verify that the seat can be re-booked without conflict
      const rebookRes = await fetch(`${baseUrl}/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${attendeeToken}`,
        },
        body: JSON.stringify({ seatId: seatB2.id }),
      });
      expect(rebookRes.status).toBe(201);
      const rebookData = await rebookRes.json();

      // Clean up re-booking
      await prisma.booking.delete({ where: { id: rebookData.id } });
    });
  });
});
