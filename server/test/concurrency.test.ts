if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://seatbook:seatbook@localhost:5433/seatbook';
}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Server } from 'http';
import jwt from 'jsonwebtoken';
import app from '../src/index';
import prisma from '../src/db';
import { seatLabel } from '../src/utils/helpers';

const JWT_SECRET = process.env.JWT_SECRET || 'seatbook-secret-123';

describe('Concurrency & Race Condition Tests', () => {
  let server: Server;
  let baseUrl: string;

  let aliceToken: string;
  let bobToken: string;
  let organizerToken: string;

  let aliceUser: any;
  let bobUser: any;
  let organizerUser: any;

  let testEvent: any;
  let testSeats: any[];

  beforeAll(async () => {
    // 1. Spin up ephemeral test server
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    // 2. Fetch seed users
    organizerUser = await prisma.user.findUnique({ where: { email: 'organizer@seatbook.test' } });
    aliceUser = await prisma.user.findUnique({ where: { email: 'alice@seatbook.test' } });
    bobUser = await prisma.user.findUnique({ where: { email: 'bob@seatbook.test' } });

    expect(organizerUser).toBeDefined();
    expect(aliceUser).toBeDefined();
    expect(bobUser).toBeDefined();

    aliceToken = jwt.sign({ id: aliceUser.id, email: aliceUser.email, role: aliceUser.role }, JWT_SECRET);
    bobToken = jwt.sign({ id: bobUser.id, email: bobUser.email, role: bobUser.role }, JWT_SECRET);
    organizerToken = jwt.sign({ id: organizerUser.id, email: organizerUser.email, role: organizerUser.role }, JWT_SECRET);

    // 3. Create fresh test event with 6 seats
    testEvent = await prisma.event.create({
      data: {
        title: 'Concurrency Stress Test Event',
        description: 'Testing simultaneous requests and race conditions',
        venue: 'Concurrency Lab',
        startsAt: new Date(Date.now() + 86400000 * 3), // 3 days in future
        rows: 2,
        cols: 3,
        priceCents: 5000,
        organizerId: organizerUser.id,
        seats: {
          create: [
            { row: 0, col: 0, label: seatLabel(0, 0) },
            { row: 0, col: 1, label: seatLabel(0, 1) },
            { row: 0, col: 2, label: seatLabel(0, 2) },
            { row: 1, col: 0, label: seatLabel(1, 0) },
            { row: 1, col: 1, label: seatLabel(1, 1) },
            { row: 1, col: 2, label: seatLabel(1, 2) },
          ],
        },
      },
      include: { seats: { orderBy: [{ row: 'asc' }, { col: 'asc' }] } },
    });

    testSeats = testEvent.seats;
  });

  afterAll(async () => {
    if (testEvent) {
      await prisma.seatHold.deleteMany({ where: { seat: { eventId: testEvent.id } } });
      await prisma.booking.deleteMany({ where: { seat: { eventId: testEvent.id } } });
      await prisma.seat.deleteMany({ where: { eventId: testEvent.id } });
      await prisma.event.delete({ where: { id: testEvent.id } });
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('handles simultaneous hold requests for the same seat: exactly 1 wins (201), the other loses (409)', async () => {
    const seat = testSeats[0];

    // Alice and Bob simultaneously attempt to hold the exact same seat
    const [resAlice, resBob] = await Promise.all([
      fetch(`${baseUrl}/events/${testEvent.id}/seats/${seat.id}/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
      }),
      fetch(`${baseUrl}/events/${testEvent.id}/seats/${seat.id}/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bobToken}` },
      }),
    ]);

    const statuses = [resAlice.status, resBob.status].sort();
    expect(statuses).toEqual([201, 409]);

    // Check DB: exactly one hold exists for this seat
    const holds = await prisma.seatHold.findMany({ where: { seatId: seat.id } });
    expect(holds.length).toBe(1);
    expect(holds[0].userId).toBeOneOf([aliceUser.id, bobUser.id]);
  });

  it('prevents another user from directly booking a held seat via POST /bookings (409 Conflict)', async () => {
    const seat = testSeats[1];

    // 1. Alice holds seat 1
    const holdRes = await fetch(`${baseUrl}/events/${testEvent.id}/seats/${seat.id}/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
    });
    expect(holdRes.status).toBe(201);

    // 2. Bob attempts to bypass hold and book directly
    const bookRes = await fetch(`${baseUrl}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bobToken}` },
      body: JSON.stringify({ seatId: seat.id }),
    });

    expect(bookRes.status).toBe(409);
    const body = await bookRes.json();
    expect(body.error).toMatch(/Seat is currently held by another attendee/i);

    // Verify no booking was created
    const booking = await prisma.booking.findFirst({ where: { seatId: seat.id } });
    expect(booking).toBeNull();
  });

  it('allows the hold owner to confirm their held seat into a confirmed booking and deletes the hold', async () => {
    const seat = testSeats[1]; // Held by Alice

    const bookRes = await fetch(`${baseUrl}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({ seatId: seat.id }),
    });

    expect(bookRes.status).toBe(201);
    const body = await bookRes.json();
    expect(body.status).toBe('CONFIRMED');
    expect(body.userId).toBe(aliceUser.id);
    expect(body.seatId).toBe(seat.id);

    // Verify hold has been deleted
    const holds = await prisma.seatHold.findMany({ where: { seatId: seat.id } });
    expect(holds.length).toBe(0);

    // Verify subsequent attempts to book or hold this seat return 409
    const subHoldRes = await fetch(`${baseUrl}/events/${testEvent.id}/seats/${seat.id}/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bobToken}` },
    });
    expect(subHoldRes.status).toBe(409);

    const subBookRes = await fetch(`${baseUrl}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bobToken}` },
      body: JSON.stringify({ seatId: seat.id }),
    });
    expect(subBookRes.status).toBe(409);
  });

  it('handles simultaneous booking requests for an unheld seat: exactly 1 succeeds (201), the other receives 409', async () => {
    const seat = testSeats[2];

    // Alice and Bob simultaneously fire POST /bookings for seat 2
    const [resAlice, resBob] = await Promise.all([
      fetch(`${baseUrl}/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
        body: JSON.stringify({ seatId: seat.id }),
      }),
      fetch(`${baseUrl}/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bobToken}` },
        body: JSON.stringify({ seatId: seat.id }),
      }),
    ]);

    const statuses = [resAlice.status, resBob.status].sort();
    expect(statuses).toEqual([201, 409]);

    // Check DB: exactly one confirmed booking exists
    const bookings = await prisma.booking.findMany({
      where: { seatId: seat.id, status: 'CONFIRMED' },
    });
    expect(bookings.length).toBe(1);
    expect(bookings[0].userId).toBeOneOf([aliceUser.id, bobUser.id]);
  });

  it('guarantees PostgreSQL partial unique index blocks duplicate active bookings', async () => {
    const seat = testSeats[3];

    // Create one confirmed booking
    await prisma.booking.create({
      data: {
        seatId: seat.id,
        userId: aliceUser.id,
        status: 'CONFIRMED',
      },
    });

    // Attempting direct raw database insertion of another CONFIRMED booking for same seat MUST throw
    await expect(
      prisma.$executeRaw`
        INSERT INTO "Booking" ("seatId", "userId", status, "createdAt")
        VALUES (${seat.id}, ${bobUser.id}, 'CONFIRMED'::"BookingStatus", NOW())
      `
    ).rejects.toThrow(/(23505|unique_active_booking_per_seat|already exists)/);

    // But inserting a CANCELLED booking is allowed by the partial index
    const cancelledInsert = await prisma.$executeRaw`
      INSERT INTO "Booking" ("seatId", "userId", status, "createdAt")
      VALUES (${seat.id}, ${bobUser.id}, 'CANCELLED'::"BookingStatus", NOW())
    `;
    expect(cancelledInsert).toBe(1);
  });
});
