import { Booking, Event, Seat } from '@prisma/client';

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function seatLabel(row: number, col: number): string {
  return `${String.fromCharCode(65 + row)}${col + 1}`;
}

export function isSeatBookable(
  seat: {
    bookings?: Array<Pick<Booking, 'status'>> | null;
    holds?: Array<{ expiresAt: Date | string }> | null;
  },
  event: Pick<Event, 'startsAt'> | { startsAt: Date | string }
): boolean {
  if (new Date(event.startsAt) < new Date()) {
    return false;
  }
  if (seat.bookings && seat.bookings.some((booking) => booking.status === 'CONFIRMED')) {
    return false;
  }
  if (seat.holds && seat.holds.some((hold) => new Date(hold.expiresAt) > new Date())) {
    return false;
  }
  return true;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
