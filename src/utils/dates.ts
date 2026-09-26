// Local-timezone calendar keys. Timestamps are stored as ISO strings (UTC),
// but "today"/"this month" must be computed in the device's local time (the
// shop runs UTC+3). Using the UTC date string directly makes early-morning
// sales fall out of "Today" between 00:00 and the UTC offset.

const pad = (n: number) => String(n).padStart(2, '0');

// YYYY-MM-DD of a timestamp/date string in the device's local timezone.
// Date-only strings (e.g. "2026-08-15") parse as UTC midnight but still yield
// the same calendar day locally, so they round-trip unchanged.
export function localDayKey(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return (ts || '').slice(0, 10);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localMonthKey(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return (ts || '').slice(0, 7);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

// Today's local calendar date, ready to compare with localDayKey(ts).
export function todayLocalKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Shift a YYYY-MM-DD key by whole days in local time. Powers "plan
// tomorrow" without leaking into UTC date arithmetic.
export function shiftDayKey(dayKey: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey || '');
  if (!m) return todayLocalKey();
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + (Number.isFinite(days) ? Math.trunc(days) : 0));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Whole days from today until a YYYY-MM-DD expiry date. Negative = expired,
// 0 = expires today. NaN-safe: unparseable dates return null (no alert).
export function daysUntilExpiry(expiryDate: string | undefined | null, todayKey?: string): number | null {
  if (!expiryDate || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) return null;
  const today = todayKey || todayLocalKey();
  const ms = Date.parse(expiryDate + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z');
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / 86400000);
}

// Stamp a YYYY-MM-DD business date as a local-midday ISO string, so a
// 00:10 close-out can attribute entries to the day that just ended instead
// of leaking into the new day. Midday dodges every UTC-offset edge; invalid
// input falls back to right now rather than inventing a date.
export function middayStamp(dayKey: string | undefined | null): string {
  if (dayKey && /^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    const d = new Date(`${dayKey}T12:00:00`);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

// ---- Shop hours: when the close-out flags may fire ----
// Unaccounted-cash / MoMo-gap flags are end-of-day verdicts — firing them at
// 2pm for money that simply hasn't been moved yet is noise. The shop sets
// open/close times + days off in Settings; flags wait for close.

export interface ShopHours {
  openTime?: string; // "08:00"
  closeTime?: string; // "21:00"
  closedDays?: number[]; // 0=Sun..6=Sat
}

function parseHM(v: string | undefined | null): number | null {
  if (!v || !/^\d{1,2}:\d{2}$/.test(v)) return null;
  const [h, m] = v.split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

// True when the shop never opens on the given day (no close happens, so no
// close-out flags are expected).
export function isShopDayOff(hours: ShopHours | undefined | null, now: Date = new Date()): boolean {
  try {
    const off = hours?.closedDays;
    if (!Array.isArray(off) || off.length === 0) return false;
    return off.includes(now.getDay());
  } catch {
    return false;
  }
}

// True when the day's close has passed (or no hours are set yet — legacy
// behaviour flags immediately so shops that never configure hours lose
// nothing). Overnight shifts (close <= open, e.g. 18:00–02:00) are handled:
// after close and before next open counts as past close.
export function isPastClose(hours: ShopHours | undefined | null, now: Date = new Date()): boolean {
  try {
    if (isShopDayOff(hours, now)) return false;
    const close = parseHM(hours?.closeTime);
    if (close === null) return true;
    const open = parseHM(hours?.openTime);
    const t = now.getHours() * 60 + now.getMinutes();
    if (open === null || close > open) return t >= close;
    return t >= close && t < open;
  } catch {
    return true;
  }
}

// ---- Closing reminder: minutes left until the shop's closing time ----
// Drives the sell-screen countdown bar. Same overnight-shift handling as
// isPastClose: 18:00-02:00 shops see the countdown run past midnight.
// Returns null when the owner hasn't set a lead time (reminders off) or the
// shop has no closing time, or today is a day off.

export interface CloseReminder {
  minutesLeft: number; // can exceed 60 for early-morning shops
  isToday: boolean; // closing time still ahead of us today
}

export function minutesUntilClose(
  hours: ShopHours | undefined | null,
  now: Date = new Date(),
): number | null {
  try {
    if (isShopDayOff(hours, now)) return null;
    const close = parseHM(hours?.closeTime);
    if (close === null) return null;
    const open = parseHM(hours?.openTime);
    const t = now.getHours() * 60 + now.getMinutes();
    const day = 24 * 60;
    if (open === null || close > open) {
      const left = close - t;
      return left >= 0 ? left : left + day;
    }
    // Overnight shift: past midnight the close is later the same "shift".
    const left = close - t;
    return left >= 0 ? left : left + day;
  } catch {
    return null;
  }
}

export function closeReminderState(
  hours: ShopHours | undefined | null,
  leadMinutes: number | undefined | null,
  now: Date = new Date(),
): CloseReminder | null {
  const lead = Number(leadMinutes);
  if (!Number.isFinite(lead) || lead <= 0) return null;
  const minutesLeft = minutesUntilClose(hours, now);
  if (minutesLeft === null) return null;
  // Only nag inside the reminder window, and never the day after closing.
  if (minutesLeft > lead) return null;
  return { minutesLeft, isToday: minutesLeft >= 0 };
}

export function formatMinutesLeft(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h >= 24) {
    const days = Math.round(h / 24);
    return days === 1 ? 'tomorrow' : `${days} days`;
  }
  return rem === 0 ? `${h} hr` : `${h} hr ${rem} min`;
}

// Alert tier for a product expiry: expired (passed), soon (within 30 days),
// or ok. Services and dateless products are always ok.
export function expiryStatus(expiryDate: string | undefined | null, todayKey?: string): 'expired' | 'soon' | 'ok' {
  const days = daysUntilExpiry(expiryDate, todayKey);
  if (days === null) return 'ok';
  if (days < 0) return 'expired';
  if (days <= 30) return 'soon';
  return 'ok';
}
