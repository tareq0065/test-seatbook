import { Request } from 'express';
import prisma from '../db';
import { formatPrice, isSeatBookable } from '../utils/helpers';

export async function listEvents() {
  const events = await prisma.event.findMany({
    orderBy: { startsAt: 'asc' },
    include: { seats: { include: { bookings: true } } },
  });

  return events.map((event) => {
    const seatsLeft = event.seats.filter((seat) => isSeatBookable(seat, event)).length;
    return {
      id: event.id,
      title: event.title,
      venue: event.venue,
      startsAt: event.startsAt,
      price: formatPrice(event.priceCents),
      totalSeats: event.seats.length,
      seatsLeft,
    };
  });
}

export async function getEventWithSeats(req: Request) {
  const id = parseInt(req.params.id);

  return prisma.event.findUnique({
    where: { id },
    include: {
      organizer: { select: { id: true, name: true } },
      seats: {
        orderBy: [{ row: 'asc' }, { col: 'asc' }],
        include: { bookings: { where: { status: 'CONFIRMED' } } },
      },
    },
  });
}
