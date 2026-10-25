import { Router, Response } from 'express';
import prisma from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

export async function handleHoldSeat(req: AuthRequest, res: Response) {
  const eventId = Number(req.params.id);
  const seatId = Number(req.params.seatId);

  if (!Number.isInteger(eventId) || eventId <= 0 || !Number.isInteger(seatId) || seatId <= 0) {
    return res.status(400).json({ error: 'Valid event ID and seat ID are required' });
  }

  const userId = req.user!.id;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Lock the Seat row to serialize concurrent hold requests
      const seats = await tx.$queryRaw<Array<{ id: number; eventId: number }>>`
        SELECT id, "eventId" FROM "Seat" WHERE id = ${seatId} FOR UPDATE
      `;
      if (!seats || seats.length === 0) {
        return { status: 404, data: { error: 'Seat not found' } };
      }
      const seat = seats[0];
      if (seat.eventId !== eventId) {
        return { status: 400, data: { error: 'Seat does not belong to this event' } };
      }

      // 2. Fetch event to verify it exists and is not in the past
      const event = await tx.event.findUnique({ where: { id: eventId } });
      if (!event) {
        return { status: 404, data: { error: 'Event not found' } };
      }
      if (new Date(event.startsAt) < new Date()) {
        return { status: 400, data: { error: 'Cannot hold a seat for an event that has already started' } };
      }

      // 3. Check for existing CONFIRMED booking
      const existingBooking = await tx.booking.findFirst({
        where: { seatId, status: 'CONFIRMED' },
      });
      if (existingBooking) {
        return { status: 409, data: { error: 'Seat already booked' } };
      }

      const now = new Date();
      // 4. Check for active unexpired hold on this seat
      const activeHold = await tx.seatHold.findFirst({
        where: {
          seatId,
          expiresAt: { gt: now },
        },
      });

      const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes (600s)

      if (activeHold) {
        if (activeHold.userId !== userId) {
          return { status: 409, data: { error: 'Seat is currently held by another attendee' } };
        }
        // Renew hold for same user
        const renewed = await tx.seatHold.update({
          where: { id: activeHold.id },
          data: { expiresAt },
        });
        return {
          status: 200,
          data: {
            message: 'Seat hold renewed',
            hold: {
              id: renewed.id,
              seatId: renewed.seatId,
              expiresAt: renewed.expiresAt.toISOString(),
              remainingSeconds: 600,
            },
          },
        };
      }

      // 5. One active hold per user per event:
      // Release any other holds this user currently has for this event
      const userOtherHolds = await tx.seatHold.findMany({
        where: {
          userId,
          seat: { eventId },
        },
      });
      if (userOtherHolds.length > 0) {
        await tx.seatHold.deleteMany({
          where: { id: { in: userOtherHolds.map((h) => h.id) } },
        });
      }

      // 6. Clean up any expired holds for this seat
      await tx.seatHold.deleteMany({
        where: { seatId, expiresAt: { lte: now } },
      });

      // 7. Create new hold
      const newHold = await tx.seatHold.create({
        data: {
          seatId,
          userId,
          expiresAt,
        },
      });

      return {
        status: 201,
        data: {
          message: 'Seat held for 10 minutes',
          hold: {
            id: newHold.id,
            seatId: newHold.seatId,
            expiresAt: newHold.expiresAt.toISOString(),
            remainingSeconds: 600,
          },
        },
      };
    });

    return res.status(result.status).json(result.data);
  } catch (err: any) {
    console.error('Error holding seat:', err);
    return res.status(500).json({ error: 'Failed to hold seat' });
  }
}

export async function handleReleaseSeat(req: AuthRequest, res: Response) {
  const eventId = Number(req.params.id);
  const seatId = Number(req.params.seatId);

  if (!Number.isInteger(eventId) || eventId <= 0 || !Number.isInteger(seatId) || seatId <= 0) {
    return res.status(400).json({ error: 'Valid event ID and seat ID are required' });
  }

  const userId = req.user!.id;

  try {
    const hold = await prisma.seatHold.findFirst({
      where: {
        seatId,
        expiresAt: { gt: new Date() },
      },
    });

    if (!hold) {
      return res.status(404).json({ error: 'No active hold found for this seat' });
    }

    if (hold.userId !== userId && req.user!.role !== 'ORGANIZER') {
      return res.status(403).json({ error: 'You are not authorized to release this hold' });
    }

    await prisma.seatHold.delete({ where: { id: hold.id } });
    return res.json({ success: true, message: 'Seat hold released successfully' });
  } catch (err: any) {
    console.error('Error releasing seat hold:', err);
    return res.status(500).json({ error: 'Failed to release seat hold' });
  }
}

router.post('/:id/release', requireAuth, async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid hold ID' });
  }

  try {
    const hold = await prisma.seatHold.findUnique({
      where: { id },
    });

    if (!hold) {
      return res.status(404).json({ error: 'Hold not found' });
    }

    if (hold.userId !== req.user!.id && req.user!.role !== 'ORGANIZER') {
      return res.status(403).json({ error: 'You are not authorized to release this hold' });
    }

    await prisma.seatHold.delete({ where: { id } });
    return res.json({ success: true, message: 'Seat hold released successfully' });
  } catch (err: any) {
    console.error('Error releasing hold:', err);
    return res.status(500).json({ error: 'Failed to release hold' });
  }
});

router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid hold ID' });
  }

  try {
    const hold = await prisma.seatHold.findUnique({
      where: { id },
    });

    if (!hold) {
      return res.status(404).json({ error: 'Hold not found' });
    }

    if (hold.userId !== req.user!.id && req.user!.role !== 'ORGANIZER') {
      return res.status(403).json({ error: 'You are not authorized to release this hold' });
    }

    await prisma.seatHold.delete({ where: { id } });
    return res.json({ success: true, message: 'Seat hold released successfully' });
  } catch (err: any) {
    console.error('Error releasing hold:', err);
    return res.status(500).json({ error: 'Failed to release hold' });
  }
});

export default router;
