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

describe('Seat Holds Integration Tests', () => {
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

    // 3. Create fresh test event with 4 seats
    testEvent = await prisma.event.create({
      data: {
        title: 'Seat Holds Integration Event',
        description: 'Testing 10-minute hold flows',
        venue: 'Hold Test Hall',
        startsAt: new Date(Date.now() + 86400000 * 5), // 5 days in future
        rows: 2,
        cols: 2,
        priceCents: 2500,
        organizerId: organizerUser.id,
        seats: {
          create: [
            { row: 0, col: 0, label: seatLabel(0, 0) },
            { row: 0, col: 1, label: seatLabel(0, 1) },
            { row: 1, col: 0, label: seatLabel(1, 0) },
            { row: 1, col: 1, label: seatLabel(1, 1) },
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

  it('rejects hold creation when not authenticated (401 Unauthorized)', async () => {
    const seat = testSeats[0];
    const res = await fetch(`${baseUrl}/events/${testEvent.id}/seats/${seat.id}/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('allows Alice to hold an available seat for 10 minutes (201 Created)', async () => {
    const seat = testSeats[0];
    const res = await fetch(`${baseUrl}/events/${testEvent.id}/seats/${seat.id}/hold`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.hold).toBeDefined();
    expect(body.hold.seatId).toBe(seat.id);
    expect(body.hold.remainingSeconds).toBeGreaterThanOrEqual(590);
    expect(body.hold.remainingSeconds).toBeLessThanOrEqual(600);

    const expiresAt = new Date(body.hold.expiresAt).getTime();
    const expectedExpiry = Date.now() + 600 * 1000;
    expect(Math.abs(expiresAt - expectedExpiry)).toBeLessThan(5000);
  });

  it('prevents Bob from holding the seat held by Alice (409 Conflict)', async () => {
    const seat = testSeats[0];
    const res = await fetch(`${baseUrl}/events/${testEvent.id}/seats/${seat.id}/hold`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobToken}`,
      },
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/Seat is currently held by another attendee/i);
  });

  it('renews the hold when Alice requests to hold the same seat again (200 OK)', async () => {
    const seat = testSeats[0];
    const res = await fetch(`${baseUrl}/events/${testEvent.id}/seats/${seat.id}/hold`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hold).toBeDefined();
    expect(body.hold.remainingSeconds).toBeGreaterThanOrEqual(590);
  });

  it('reflects hold status and heldByMe flag correctly in GET /events/:id', async () => {
    const seat = testSeats[0];

    // 1. Alice's perspective
    const resAlice = await fetch(`${baseUrl}/events/${testEvent.id}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    const dataAlice = await resAlice.json();
    const aliceSeat = dataAlice.seats.find((s: any) => s.id === seat.id);
    expect(aliceSeat.status).toBe('HELD');
    expect(aliceSeat.heldByMe).toBe(true);
    expect(aliceSeat.available).toBe(false);
    expect(aliceSeat.remainingSeconds).toBeGreaterThanOrEqual(580);

    // 2. Bob's perspective
    const resBob = await fetch(`${baseUrl}/events/${testEvent.id}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    const dataBob = await resBob.json();
    const bobSeat = dataBob.seats.find((s: any) => s.id === seat.id);
    expect(bobSeat.status).toBe('HELD');
    expect(bobSeat.heldByMe).toBe(false);
    expect(bobSeat.available).toBe(false);

    // 3. Unauthenticated perspective
    const resAnon = await fetch(`${baseUrl}/events/${testEvent.id}`);
    const dataAnon = await resAnon.json();
    const anonSeat = dataAnon.seats.find((s: any) => s.id === seat.id);
    expect(anonSeat.status).toBe('HELD');
    expect(anonSeat.heldByMe).toBe(false);
    expect(anonSeat.available).toBe(false);
  });

  it('automatically releases previous hold when user holds another seat on the same event', async () => {
    const seat1 = testSeats[0];
    const seat2 = testSeats[1];

    // Alice currently holds seat1. Now Alice holds seat2:
    const res = await fetch(`${baseUrl}/events/${testEvent.id}/seats/${seat2.id}/hold`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
    });

    expect(res.status).toBe(201);

    // Verify seat1 is now freed! Bob can now hold seat1
    const resBobHold1 = await fetch(`${baseUrl}/events/${testEvent.id}/seats/${seat1.id}/hold`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobToken}`,
      },
    });
    expect(resBobHold1.status).toBe(201);
  });

  it('allows user to release their active hold immediately (POST /events/:id/seats/:seatId/release)', async () => {
    const seat2 = testSeats[1]; // Held by Alice

    const res = await fetch(`${baseUrl}/events/${testEvent.id}/seats/${seat2.id}/release`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify seat2 is now immediately available
    const resEvent = await fetch(`${baseUrl}/events/${testEvent.id}`);
    const data = await resEvent.json();
    const freedSeat = data.seats.find((s: any) => s.id === seat2.id);
    expect(freedSeat.status).toBe('AVAILABLE');
    expect(freedSeat.available).toBe(true);
  });

  it('allows releasing hold via dedicated hold endpoint (POST /holds/:id/release)', async () => {
    const seat3 = testSeats[2];

    // Alice holds seat 3
    const holdRes = await fetch(`${baseUrl}/events/${testEvent.id}/seats/${seat3.id}/hold`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
    });
    const holdData = await holdRes.json();
    const holdId = holdData.hold.id;

    // Bob cannot release Alice's hold (403 Forbidden)
    const bobReleaseRes = await fetch(`${baseUrl}/holds/${holdId}/release`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobToken}`,
      },
    });
    expect(bobReleaseRes.status).toBe(403);

    // Alice releases her hold (200 OK)
    const aliceReleaseRes = await fetch(`${baseUrl}/holds/${holdId}/release`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
    });
    expect(aliceReleaseRes.status).toBe(200);
  });

  it('allows another user to hold a seat once an existing hold expires', async () => {
    const seat4 = testSeats[3];

    // Create an expired hold for Alice directly in DB
    await prisma.seatHold.create({
      data: {
        seatId: seat4.id,
        userId: aliceUser.id,
        expiresAt: new Date(Date.now() - 1000 * 60), // Expired 1 min ago
      },
    });

    // Bob tries to hold seat4: should succeed because Alice's hold is expired
    const res = await fetch(`${baseUrl}/events/${testEvent.id}/seats/${seat4.id}/hold`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobToken}`,
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.hold.seatId).toBe(seat4.id);
  });

  it('rejects holding an already booked seat (409 Conflict)', async () => {
    const seat4 = testSeats[3];

    // Confirm booking for seat4
    await prisma.seatHold.deleteMany({ where: { seatId: seat4.id } });
    await prisma.booking.create({
      data: {
        seatId: seat4.id,
        userId: aliceUser.id,
        status: 'CONFIRMED',
      },
    });

    const res = await fetch(`${baseUrl}/events/${testEvent.id}/seats/${seat4.id}/hold`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobToken}`,
      },
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/Seat already booked/i);
  });
});
