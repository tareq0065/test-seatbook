import { describe, it, expect } from 'vitest';
import { formatPrice, seatLabel, slugify } from '../src/utils/helpers';

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
});
