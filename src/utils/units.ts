// Pluralize a per-unit label for display (e.g. "20 pages", "1 page", "3 sheets").
// Keeps unit labels that are already plural-ish (ends in 's', 'm', 'min') as-is.
export function unitLabel(n: number, unit?: string): string {
  if (!unit) return String(n);
  const trimmed = unit.trim();
  if (n === 1) return `1 ${trimmed}`;
  if (/s$|m\b|min\b/i.test(trimmed) || /[\s/]/.test(trimmed)) return `${n} ${trimmed}`;
  if (/[^aeiou]y$/i.test(trimmed)) return `${n} ${trimmed.replace(/y$/i, 'ies')}`;
  return `${n} ${trimmed}s`;
}

// Parse a loose-goods quantity: up to 3 decimals (2.5 kg tomatoes, 0.5 m
// fabric), never negative, never NaN. Rounded so 0.1 + 0.2 stays 0.3.
export function parseQty(v: string | number | undefined | null): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 1000) / 1000;
}