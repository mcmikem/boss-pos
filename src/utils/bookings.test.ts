import { describe, expect, it } from 'vitest';
import { timeToMin, bookingsOverlap, findOverlap } from './bookings';
import type { Booking } from '../types';

type MiniBooking = Pick<Booking, 'id' | 'date' | 'time' | 'durationMin' | 'status' | 'customerName' | 'service'>;

const b = (over: Partial<MiniBooking> = {}): MiniBooking => ({
  id: 'x',
  date: '2026-09-07',
  time: '10:00',
  durationMin: 60,
  status: 'booked',
  customerName: 'Amina',
  service: 'Braids',
  ...over,
});

describe('timeToMin', () => {
  it('parses HH:MM and rejects garbage', () => {
    expect(timeToMin('10:30')).toBe(630);
    expect(timeToMin('09:05')).toBe(545);
    expect(timeToMin('')).toBeNull();
    expect(timeToMin('25:00')).toBeNull();
    expect(timeToMin('noon')).toBeNull();
  });
});

describe('bookingsOverlap', () => {
  it('detects intersecting appointments', () => {
    expect(bookingsOverlap(b({}), b({ id: 'y', time: '10:30' }))).toBe(true);
    expect(bookingsOverlap(b({}), b({ id: 'y', time: '11:00' }))).toBe(false);
    expect(bookingsOverlap(b({}), b({ id: 'y', time: '09:30', durationMin: 30 }))).toBe(false);
  });

  it('ignores itself, other days, cancelled, and untimed bookings', () => {
    expect(bookingsOverlap(b({}), b({}))).toBe(false);
    expect(bookingsOverlap(b({}), b({ id: 'y', date: '2026-09-08' }))).toBe(false);
    expect(bookingsOverlap(b({}), b({ id: 'y', status: 'cancelled' }))).toBe(false);
    expect(bookingsOverlap(b({}), b({ id: 'y', time: '' }))).toBe(false);
  });
});

describe('findOverlap', () => {
  it('returns the conflicting booking for the warning', () => {
    const clash = findOverlap(b({ id: 'new' }), [b({ id: 'old', time: '10:30' })]);
    expect(clash?.customerName).toBe('Amina');
    expect(findOverlap(b({ id: 'new', time: '12:00' }), [b({ id: 'old' })])).toBeNull();
  });
});
