export function normalizeCreditKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function amount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function creditLimitDecision(outstanding = 0, cap = 0, additional = 0) {
  const current = Math.max(0, Number(outstanding) || 0);
  const limit = Math.max(0, Number(cap) || 0);
  const added = Math.max(0, Number(additional) || 0);
  if (limit === 0) {
    return { limited: false, allowed: true, outstanding: current, cap: 0, additional: added, projected: current + added,     remaining: null, overBy: 0 };
  }
  const projected = current + added;
  return {
    limited: true,
    allowed: projected <= limit,
    outstanding: current,
    cap: limit,
    additional: added,
    projected,
    remaining: Math.max(0, limit - current),
    overBy: Math.max(0, projected - limit),
  };
}

export function summarizeCreditBalances(sales = [], payments = [], eats = [], limits = []) {
  const rows = new Map();
  const saleKeys = new Map();
  const ensure = (name) => {
    const customerName = String(name || '').trim();
    const key = normalizeCreditKey(customerName);
    if (!key) return null;
    let row = rows.get(key);
    if (!row) {
      row = {
        customerKey: key,
        customerName,
        limit: 0,
        tillOutstanding: 0,
        bookOutstanding: 0,
        updatedAt: '',
      };
      rows.set(key, row);
    } else if (customerName && row.customerName !== customerName) {
      row.customerName = customerName;
    }
    return row;
  };

  for (const limit of limits) {
    const row = ensure(limit.customerName);
    if (!row) continue;
    row.limit = Math.max(0, amount(limit.limit ?? limit.cap));
    if (limit.updatedAt && (!row.updatedAt || String(limit.updatedAt) > row.updatedAt)) row.updatedAt = String(limit.updatedAt);
  }
  for (const sale of sales) {
    if (sale.paymentMethod !== 'Credit / Book' || sale.refunded) continue;
    const row = ensure(sale.customerName);
    if (!row) continue;
    row.tillOutstanding += amount(sale.total);
    if (sale.id) saleKeys.set(String(sale.id), row);
  }
  for (const payment of payments) {
    const saleId = String(payment.saleId || '');
    if (saleId.startsWith('book:')) continue;
    const row = saleKeys.get(saleId);
    if (row) row.tillOutstanding -= amount(payment.amount);
  }
  for (const eat of eats) {
    const row = ensure(eat.customerName);
    if (!row) continue;
    row.bookOutstanding += Math.max(0, amount(eat.total) - amount(eat.paidAmount));
  }

  const result = [...rows.values()].map(row => ({
    ...row,
    tillOutstanding: Math.max(0, Math.round(row.tillOutstanding)),
    bookOutstanding: Math.max(0, Math.round(row.bookOutstanding)),
    outstanding: Math.max(0, Math.round(row.tillOutstanding + row.bookOutstanding)),
  }));
  result.sort((a, b) => b.outstanding - a.outstanding || a.customerName.localeCompare(b.customerName));
  return {
    rows: result,
    totalOutstanding: result.reduce((sum, row) => sum + row.outstanding, 0),
  };
}
