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