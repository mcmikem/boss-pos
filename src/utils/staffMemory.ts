// "Ask once a day." Remembering who was selling earlier today, so the lock
// screen can offer them back in one tap instead of making them find their name
// in a list every single time the till locks itself.
//
// What this remembers is a SUGGESTION, never an identity. The seller still
// types their own PIN: a name we remembered is not a name anyone proved, and a
// sale stamped with a guessed name is a lie in the ledger. The till PIN path
// deliberately grants no name at all (that is why 194 sales carry an empty
// staffname), and this module does not change that.
import { dayKeyOf } from './notifications';

const KEY = 'boss_pos_seller_today';

export interface SellerToday {
  id: string;
  name: string;
  role: 'manager' | 'cashier';
  day: string;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function rememberSellerToday(s: { id: string; name: string; role: 'manager' | 'cashier' }): void {
  const store = storage();
  if (!store || !s.id) return;
  try {
    const record: SellerToday = { id: s.id, name: s.name, role: s.role, day: dayKeyOf() };
    store.setItem(KEY, JSON.stringify(record));
  } catch {
    // A full or blocked store must not stop anyone selling.
  }
}

// Yesterday's seller is nobody in particular. The offer expires at midnight,
// local time, which is when "this morning" stops meaning anything.
export function sellerToday(at?: string | number): SellerToday | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SellerToday;
    if (!parsed?.id || parsed.day !== dayKeyOf(at)) {
      if (parsed?.day !== dayKeyOf(at)) store.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// Handing the till over (or locking it) ends the day for this person. A stale
// offer that survives a hand-over is how the wrong name ends up on a sale.
export function forgetSellerToday(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(KEY);
  } catch {
    // nothing to do
  }
}
