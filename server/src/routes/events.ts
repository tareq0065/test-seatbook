import { Router } from 'express';
import prisma from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { getEventWithSeats, listEvents } from '../services/eventService';
import { formatPrice, seatLabel } from '../utils/helpers';

const router = Router();

router.get('/', async (req, res) => {
  const events = await listEvents();
  res.json(events);
});

router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!req.params.id || isNaN(id) || id <= 0 || !Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid event ID' });
  }

  const event = await getEventWithSeats(req);

  if (!event) {
    return res.status(404).json({ error: 'Event not found', message: 'Event not found' });
  }

  const seats = event.seats.map((seat) => ({
    id: seat.id,
    row: seat.row,
    col: seat.col,
    label: seat.label,
    available: seat.bookings.length === 0,
  }));

  res.json({
    id: event.id,
    title: event.title,
    description: event.description,
    venue: event.venue,
    startsAt: event.startsAt,
    price: formatPrice(event.priceCents),
    rows: event.rows,
    cols: event.cols,
    organizer: event.organizer,
    seats,
  });
});

router.post('/', requireAuth, async (req: AuthRequest, res) => {
  if (req.user!.role !== 'ORGANIZER') {
    return res.status(403).json({ error: 'Only organizers can create events' });
  }

  try {
    const { title, description, venue, startsAt, rows, cols, priceCents } = req.body;

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    if (!venue || typeof venue !== 'string' || !venue.trim()) {
      return res.status(400).json({ error: 'Venue is required' });
    }

    if (!startsAt) {
      return res.status(400).json({ error: 'startsAt is required' });
    }

    const eventDate = new Date(startsAt);
    if (isNaN(eventDate.getTime())) {
      return res.status(400).json({ error: 'Invalid startsAt date format' });
    }

    const parsedRows = Number(rows);
    const parsedCols = Number(cols);
    if (!Number.isInteger(parsedRows) || parsedRows <= 0 || !Number.isInteger(parsedCols) || parsedCols <= 0) {
      return res.status(400).json({ error: 'Rows and cols must be positive integers' });
    }

    if (parsedRows > 26 || parsedCols > 30) {
      return res.status(400).json({
        error: 'Seat grid too large (max 26 rows x 30 cols)',
        msg: 'Seat grid too large (max 26 rows x 30 cols)',
      });
    }

    const parsedPrice = priceCents !== undefined ? Number(priceCents) : 0;
    if (isNaN(parsedPrice) || parsedPrice < 0 || !Number.isInteger(parsedPrice)) {
      return res.status(400).json({ error: 'priceCents must be a non-negative integer' });
    }

    const seats = [];
    for (let r = 0; r < parsedRows; r++) {
      for (let c = 0; c < parsedCols; c++) {
        seats.push({ row: r, col: c, label: seatLabel(r, c) });
      }
    }

    const event = await prisma.event.create({
      data: {
        title: title.trim(),
        description: typeof description === 'string' ? description.trim() : '',
        venue: venue.trim(),
        startsAt: eventDate,
        rows: parsedRows,
        cols: parsedCols,
        priceCents: parsedPrice,
        organizerId: req.user!.id,
        seats: { create: seats },
      },
    });

    res.status(201).json(event);
  } catch (err: any) {
    console.error('Error creating event:', err);
    res.status(500).json({ error: 'Something went wrong creating the event' });
  }
});

export default router;
