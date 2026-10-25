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

    const seat = await prisma.seat.findUnique({
      where: { id: seatIdNum },
      include: { event: true },
    });

    if (!seat) {
      return res.status(404).json({ error: 'Seat not found' });
    }

    if (seat.event.startsAt < new Date()) {
      return res.status(400).json({ error: 'This event has already started', msg: 'This event has already started' });
    }

    const existing = await prisma.booking.findFirst({
      where: { seatId: seat.id, status: 'CONFIRMED' },
    });

    if (existing) {
      return res.status(409).json({ error: 'Seat already booked' });
    }

    const booking = await prisma.booking.create({
      data: {
        seatId: seat.id,
        userId: req.user!.id,
        status: 'CONFIRMED',
      },
    });

    res.status(201).json(booking);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
