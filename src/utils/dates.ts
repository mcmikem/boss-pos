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

// Alert tier for a product expiry: expired (passed), soon (within 30 days),
// or ok. Services and dateless products are always ok.
export function expiryStatus(expiryDate: string | undefined | null, todayKey?: string): 'expired' | 'soon' | 'ok' {
  const days = daysUntilExpiry(expiryDate, todayKey);
  if (days === null) return 'ok';
  if (days < 0) return 'expired';
  if (days <= 30) return 'soon';
  return 'ok';
}
