import { describe, it, expect } from 'vitest';
import { formatPrice, seatLabel, slugify, isSeatBookable } from '../src/utils/helpers';

describe('helpers', () => {
  it('formats cents as dollars', () => {
    expect(formatPrice(1500)).toBe('$15.00');
    expect(formatPrice(0)).toBe('$0.00');
  });

  it('labels seats by row letter and column number', () => {
    expect(seatLabel(0, 0)).toBe('A1');
    expect(seatLabel(2, 4)).toBe('C5');
  });

  it('slugifies titles', () => {
    expect(slugify('  Postgres in Practice! ')).toBe('postgres-in-practice');
  });

  describe('isSeatBookable (Availability & "AI was wrong" bug fix)', () => {
    const futureDate = new Date(Date.now() + 86400000 * 7); // 7 days in future
    const pastDate = new Date(Date.now() - 86400000 * 7); // 7 days in past

    it('returns true when a seat has no bookings and the event is in the future', () => {
      const seat = { bookings: [] };
      const event = { startsAt: futureDate };
      expect(isSeatBookable(seat, event)).toBe(true);
    });

    it('returns true when seat.bookings is undefined or empty', () => {
      expect(isSeatBookable({}, { startsAt: futureDate })).toBe(true);
      expect(isSeatBookable({ bookings: [] }, { startsAt: futureDate })).toBe(true);
    });

    it('returns false when the event has already started (past event)', () => {
      const seat = { bookings: [] };
      const event = { startsAt: pastDate };
      expect(isSeatBookable(seat, event)).toBe(false);
    });

    it('returns false when a seat has a CONFIRMED booking', () => {
      const seat = { bookings: [{ status: 'CONFIRMED' as const }] };
      const event = { startsAt: futureDate };
      expect(isSeatBookable(seat, event)).toBe(false);
    });

    it('returns true when a seat only has CANCELLED bookings (Fixes AI bug)', () => {
      // The original AI prototype checked `seat.bookings.length === 0`,
      // which wrongly treated seats with cancelled bookings as unavailable!
      const seat = { bookings: [{ status: 'CANCELLED' as const }] };
      const event = { startsAt: futureDate };
      expect(isSeatBookable(seat, event)).toBe(true);
    });

    it('returns true when a seat has multiple historic CANCELLED bookings', () => {
      const seat = {
        bookings: [
          { status: 'CANCELLED' as const },
          { status: 'CANCELLED' as const },
        ],
      };
      const event = { startsAt: futureDate };
      expect(isSeatBookable(seat, event)).toBe(true);
    });

    it('returns false when a seat has both CANCELLED and an active CONFIRMED booking', () => {
      const seat = {
        bookings: [
          { status: 'CANCELLED' as const },
          { status: 'CONFIRMED' as const },
        ],
      };
      const event = { startsAt: futureDate };
      expect(isSeatBookable(seat, event)).toBe(false);
    });

    it('supports string date representation for startsAt', () => {
      const seat = { bookings: [] };
      expect(isSeatBookable(seat, { startsAt: futureDate.toISOString() })).toBe(true);
      expect(isSeatBookable(seat, { startsAt: pastDate.toISOString() })).toBe(false);
    });
  });
});
