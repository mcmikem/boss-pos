import type { Booking } from '../types';

export const DEFAULT_BOOKING_MIN = 30;

// "14:30" -> minutes since midnight. Garbage -> null (no math on bad input).
export function timeToMin(time: string | undefined | null): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time || ''));
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function bookingEnd(b: Pick<Booking, 'time' | 'durationMin'>): number | null {
  const start = timeToMin(b.time);
  if (start === null) return null;
  const dur = b.durationMin && b.durationMin > 0 ? b.durationMin : DEFAULT_BOOKING_MIN;
  return start + dur;
}

// Do two bookings overlap? Same date, both booked, timed, and intersecting.
// Untimed bookings (no time set) never block — the book stays flexible.
export function bookingsOverlap(
  a: Pick<Booking, 'id' | 'date' | 'time' | 'durationMin' | 'status'>,
  b: Pick<Booking, 'id' | 'date' | 'time' | 'durationMin' | 'status'>,
): boolean {
  if (a.id === b.id) return false;
  if (a.date !== b.date) return false;
  if (a.status !== 'booked' || b.status !== 'booked') return false;
  const aEnd = bookingEnd(a);
  const bEnd = bookingEnd(b);
  const aStart = timeToMin(a.time);
  const bStart = timeToMin(b.time);
  if (aStart === null || bStart === null || aEnd === null || bEnd === null) return false;
  return aStart < bEnd && bStart < aEnd;
}

export function findOverlap(
  candidate: Pick<Booking, 'id' | 'date' | 'time' | 'durationMin' | 'status'>,
  existing: Pick<Booking, 'id' | 'date' | 'time' | 'durationMin' | 'status' | 'customerName' | 'service'>[],
): (typeof existing)[number] | null {
  if (candidate.status !== 'booked') return null;
  return existing.find(b => bookingsOverlap(candidate, b)) || null;
}
