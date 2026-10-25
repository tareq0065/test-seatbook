import { Router } from 'express';
import prisma from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { formatPrice } from '../utils/helpers';

const router = Router();

router.post('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { seatId } = req.body;

    const seat = await prisma.seat.findUnique({
      where: { id: Number(seatId) },
      include: { event: true },
    });

    if (!seat) {
      return res.status(404).json({ error: 'Seat not found' });
    }

    if (seat.event.startsAt < new Date()) {
      return res.status(400).json({ msg: 'This event has already started' });
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
  } catch (err) {
    console.log(err);
    res.json([]);
  }
});

router.post('/:id/cancel', requireAuth, async (req: AuthRequest, res) => {
  const id = parseInt(req.params.id);

  await prisma.booking.updateMany({
    where: { id, status: 'CONFIRMED' },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  });

  res.json({ success: true });
});

export default router;
