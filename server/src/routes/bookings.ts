import { Router } from 'express';
import prisma from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { formatPrice } from '../utils/helpers';

const router = Router();

router.post('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { seatId } = req.body;
    const seatIdNum = Number(seatId);

    if (!seatId || isNaN(seatIdNum) || seatIdNum <= 0 || !Number.isInteger(seatIdNum)) {
      return res.status(400).json({ error: 'Valid seatId is required' });
    }

    const userId = req.user!.id;

    const result = await prisma.$transaction(async (tx) => {
      // 1. Lock the Seat row to serialize concurrent booking and hold operations
      const seats = await tx.$queryRaw<Array<{ id: number; eventId: number }>>`
        SELECT id, "eventId" FROM "Seat" WHERE id = ${seatIdNum} FOR UPDATE
      `;

      if (!seats || seats.length === 0) {
        return { status: 404, data: { error: 'Seat not found' } };
      }

      const seat = seats[0];

      // 2. Fetch event to verify it exists and hasn't started yet
      const event = await tx.event.findUnique({ where: { id: seat.eventId } });
      if (!event) {
        return { status: 404, data: { error: 'Event not found' } };
      }

      if (new Date(event.startsAt) < new Date()) {
        return {
          status: 400,
          data: { error: 'This event has already started', msg: 'This event has already started' },
        };
      }

      // 3. Check for existing active CONFIRMED booking
      const existing = await tx.booking.findFirst({
        where: { seatId: seat.id, status: 'CONFIRMED' },
      });

      if (existing) {
        return { status: 409, data: { error: 'Seat already booked' } };
      }

      // 4. Check for active unexpired hold by another attendee
      const activeHold = await tx.seatHold.findFirst({
        where: {
          seatId: seat.id,
          expiresAt: { gt: new Date() },
        },
      });

      if (activeHold && activeHold.userId !== userId) {
        return {
          status: 409,
          data: { error: 'Seat is currently held by another attendee' },
        };
      }

      // 5. Create the confirmed booking
      const booking = await tx.booking.create({
        data: {
          seatId: seat.id,
          userId,
          status: 'CONFIRMED',
        },
      });

      // 6. Release any holds on this seat (held by this user or expired)
      await tx.seatHold.deleteMany({
        where: { seatId: seat.id },
      });

      return { status: 201, data: booking };
    });

    return res.status(result.status).json(result.data);
  } catch (err: any) {
    if (err.code === 'P2002' || err.message?.includes('unique_active_booking_per_seat')) {
      return res.status(409).json({ error: 'Seat already booked' });
    }
    console.error('Error creating booking:', err);
    res.status(500).json({ error: err.message || 'Internal server error while creating booking' });
  }
});

router.get('/mine', requireAuth, async (req: AuthRequest, res) => {
  try {
    const bookings = await prisma.booking.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      include: { seat: { include: { event: true } } },
    });

    res.json(
      bookings.map((b) => ({
        id: b.id,
        status: b.status,
        createdAt: b.createdAt,
        seat: b.seat.label,
        event: {
          id: b.seat.event.id,
          title: b.seat.event.title,
          venue: b.seat.event.venue,
          startsAt: b.seat.event.startsAt,
          price: formatPrice(b.seat.event.priceCents),
        },
      }))
    );
  } catch (err: any) {
    console.error('Error fetching bookings:', err);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

router.post('/:id/cancel', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);

    if (!req.params.id || isNaN(id) || id <= 0 || !Number.isInteger(id)) {
      return res.status(400).json({ error: 'Invalid booking ID' });
    }

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        seat: {
          include: {
            event: true,
          },
        },
      },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const isOwner = booking.userId === req.user!.id;
    const isEventOrganizer =
      req.user!.role === 'ORGANIZER' && booking.seat.event.organizerId === req.user!.id;

    if (!isOwner && !isEventOrganizer) {
      return res.status(403).json({ error: 'You are not authorized to cancel this booking' });
    }

    if (booking.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Booking is already cancelled' });
    }

    if (new Date(booking.seat.event.startsAt) < new Date()) {
      return res.status(400).json({ error: 'Cannot cancel booking for an event that has already started' });
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
      },
    });

    res.json({ success: true, booking: updated });
  } catch (err: any) {
    console.error('Error cancelling booking:', err);
    res.status(500).json({ error: 'Internal server error while cancelling booking' });
  }
});

export default router;
