function boundary(value, endOfDay = false) {
  if (!value) return null;
  const raw = String(value).trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T00:00:00.000Z`)
    : new Date(raw);
  if (!Number.isFinite(dateOnly.getTime())) return null;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(raw)) dateOnly.setUTCDate(dateOnly.getUTCDate() + 1);
  return dateOnly.toISOString();
}

export function normalizeReportRange(query = {}) {
  const rawFrom = String(query.from || '').trim();
  const rawTo = String(query.to || '').trim();
  const from = boundary(rawFrom);
  const to = boundary(rawTo, true);
  if (rawFrom && !from) return { error: 'Invalid from date' };
  if (rawTo && !to) return { error: 'Invalid to date' };
  if (from && to && from >= to) return { error: 'from must be before to' };
  const rawBranch = String(query.branch || '').trim();
  const branch = rawBranch && rawBranch.toLowerCase() !== 'all' ? rawBranch : null;
  return { from, to, branch };
}
