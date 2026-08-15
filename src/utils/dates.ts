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
