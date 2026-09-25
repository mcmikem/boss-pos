export const SETTLEMENT_STATUS_TRANSITIONS = Object.freeze({
  pending: new Set(['settled', 'voided']),
  settled: new Set(['reconciled', 'voided']),
  reconciled: new Set(),
  voided: new Set(),
});

export const EXPENSE_STATUS_TRANSITIONS = Object.freeze({
  pending: new Set(['submitted', 'approved', 'rejected']),
  submitted: new Set(['approved', 'rejected']),
  approved: new Set(),
  rejected: new Set(['submitted']),
});

export const PAYMENT_METHODS = Object.freeze([
  'Cash',
  'MTN MoMo',
  'Airtel Money',
  'Bank',
  'Other',
]);

export const DEFAULT_EXPENSE_CATEGORIES = Object.freeze([
  'General',
  'Supplies',
  'Stock Purchase',
  'Eatery',
  'Drinks',
  'Rent',
  'Utilities',
  'Transport',
  'Salaries',
  'Maintenance',
  'Bank Charges',
  'Labor',
  'Other',
]);

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function positiveMoney(value) {
  return Math.max(0, money(value));
}

function jsonValue(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function normalizePaymentMethod(value, fallback = 'Cash') {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'cash' || raw === 'cash tender') return 'Cash';
  if (raw === 'mtn' || raw === 'mtn momo' || raw === 'momo' || raw === 'mobile money') return 'MTN MoMo';
  if (raw === 'airtel' || raw === 'airtel money') return 'Airtel Money';
  if (raw === 'bank' || raw === 'bank transfer') return 'Bank';
  if (raw === 'other' || raw === 'other tender') return 'Other';
  return null;
}

export function validateSettlementTransition(currentStatus, nextStatus) {
  const current = String(currentStatus || 'pending').toLowerCase();
  const next = String(nextStatus || '').toLowerCase();
  if (!['pending', 'settled', 'reconciled', 'voided'].includes(next)) {
    return { error: 'Unknown settlement status', code: 'INVALID_SETTLEMENT_STATUS' };
  }
  if (current === next) return { duplicate: true, status: next };
  if (!SETTLEMENT_STATUS_TRANSITIONS[current] || !SETTLEMENT_STATUS_TRANSITIONS[current].has(next)) {
    return { error: `Settlement cannot move from ${current} to ${next}`, code: 'INVALID_SETTLEMENT_TRANSITION', currentStatus: current, nextStatus: next };
  }
  return { status: next };
}

export function validateExpenseTransition(currentStatus, nextStatus) {
  const current = String(currentStatus || 'submitted').toLowerCase() === 'pending' ? 'submitted' : String(currentStatus || 'submitted').toLowerCase();
  const next = String(nextStatus || '').toLowerCase() === 'pending' ? 'submitted' : String(nextStatus || '').toLowerCase();
  if (!['submitted', 'approved', 'rejected'].includes(next)) {
    return { error: 'Expense status must be submitted, approved, or rejected', code: 'INVALID_APPROVAL_STATUS' };
  }
  if (current === next) return { duplicate: true, status: next };
  if (!EXPENSE_STATUS_TRANSITIONS[current] || !EXPENSE_STATUS_TRANSITIONS[current].has(next)) {
    return { error: `Expense cannot move from ${current} to ${next}`, code: 'INVALID_APPROVAL_TRANSITION', currentStatus: current, nextStatus: next };
  }
  return { status: next };
}

export function validateReference(value, field = 'reference') {
  const result = String(value ?? '').trim();
  if (!result) return { error: `${field} is required`, code: 'INVALID_REFERENCE' };
  if (result.length > 120 || /[\u0000-\u001f\u007f]/.test(result)) return { error: `${field} is invalid`, code: 'INVALID_REFERENCE' };
  return { value: result };
}

export function normalizeExpenseCategories(configured = [], existing = []) {
  const source = Array.isArray(configured) && configured.length ? configured : DEFAULT_EXPENSE_CATEGORIES;
  const values = [...source, ...(Array.isArray(existing) ? existing : [])]
    .map((value) => String(value || '').trim().slice(0, 100))
    .filter(Boolean);
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function categoryRenameViolation(previous = [], next = [], used = []) {
  const previousKeys = new Set(previous.map((value) => String(value).trim().toLowerCase()).filter(Boolean));
  const nextKeys = new Set(next.map((value) => String(value).trim().toLowerCase()).filter(Boolean));
  const removed = [...previousKeys].filter((key) => !nextKeys.has(key));
  const usedKeys = new Set(used.map((value) => String(value).trim().toLowerCase()).filter(Boolean));
  const protectedNames = removed.filter((key) => usedKeys.has(key));
  return protectedNames.length ? protectedNames : null;
}

function addTender(target, method, amount) {
  const normalized = normalizePaymentMethod(method, 'Other') || 'Other';
  target[normalized] = roundTender(target[normalized] + positiveMoney(amount));
}

function roundTender(value) {
  return money(value);
}

function saleTenderRows(sale) {
  const split = jsonValue(sale.split ?? sale.splitTenders, null);
  if (Array.isArray(split) && split.length) return split;
  if (String(sale.paymentMethod || sale.paymentmethod || '').toLowerCase() === 'split') return [];
  return [{ method: sale.paymentMethod || sale.paymentmethod || 'Cash', amount: positiveMoney(sale.total) }];
}

function cashCategory(value) {
  return /cash|drawer|till/i.test(String(value || ''));
}

function addMovement(total, direction, amount) {
  if (direction === 'in' || direction === 'inbound' || direction === 'received') total.in += positiveMoney(amount);
  if (direction === 'out' || direction === 'outbound' || direction === 'sent') total.out += positiveMoney(amount);
}

export function calculateCloseTotals(input = {}) {
  const sales = Array.isArray(input.sales) ? input.sales : [];
  const expenses = Array.isArray(input.expenses) ? input.expenses : [];
  const transfers = Array.isArray(input.transfers) ? input.transfers : [];
  const settlements = Array.isArray(input.settlements) ? input.settlements : [];
  const momoTransfers = Array.isArray(input.momoTransfers) ? input.momoTransfers : [];
  const creditPayments = Array.isArray(input.creditPayments) ? input.creditPayments : [];
  const openingCash = positiveMoney(input.openingCash);
  const expectedTenders = { Cash: 0, 'MTN MoMo': 0, 'Airtel Money': 0, 'Credit / Book': 0, Bank: 0, Other: 0 };
  let invalidSplit = false;

  for (const sale of sales) {
    if (sale.refunded || sale.voided) continue;
    const rows = saleTenderRows(sale);
    if (String(sale.paymentMethod || sale.paymentmethod || '').toLowerCase() === 'split' && (rows.length < 2 || Math.abs(rows.reduce((sum, row) => sum + positiveMoney(row.amount), 0) - positiveMoney(sale.total)) > 0.01)) {
      invalidSplit = true;
      continue;
    }
    for (const row of rows) {
      const method = row.method;
      const key = method === 'Credit / Book' ? 'Credit / Book' : normalizePaymentMethod(method, 'Other') || 'Other';
      if (key === 'Cash' || key === 'MTN MoMo' || key === 'Airtel Money' || key === 'Credit / Book' || key === 'Bank' || key === 'Other') expectedTenders[key] = roundTender(expectedTenders[key] + positiveMoney(row.amount));
    }
  }

  const cashExpense = expenses.reduce((sum, expense) => {
    if (expense.refunded || expense.voided) return sum;
    const source = String(expense.source || 'drawer').toLowerCase();
    return ['drawer', 'cash'].includes(source) ? roundTender(sum + positiveMoney(expense.amount)) : sum;
  }, 0);
  const movement = { in: 0, out: 0 };
  for (const transfer of transfers) {
    const from = String(transfer.fromCategory ?? transfer.fromcategory ?? '');
    const to = String(transfer.toCategory ?? transfer.tocategory ?? '');
    if (cashCategory(from)) addMovement(movement, 'out', transfer.amount);
    if (cashCategory(to)) addMovement(movement, 'in', transfer.amount);
  }
  for (const transfer of momoTransfers) {
    const direction = String(transfer.direction || 'out').toLowerCase();
    addMovement(movement, direction, transfer.amount);
  }
  for (const settlement of settlements) {
    const account = `${settlement.account || ''} ${settlement.provider || ''}`;
    if (!cashCategory(account)) continue;
    addMovement(movement, settlement.direction, settlement.amount);
  }
  const collections = { cash: 0, momo: 0, airtel: 0, bank: 0, other: 0 };
  for (const payment of creditPayments) {
    const method = normalizePaymentMethod(payment.paymentMethod ?? payment.payment_method, 'Cash') || 'Other';
    if (method === 'Cash') collections.cash = roundTender(collections.cash + positiveMoney(payment.amount));
    else if (method === 'MTN MoMo') collections.momo = roundTender(collections.momo + positiveMoney(payment.amount));
    else if (method === 'Airtel Money') collections.airtel = roundTender(collections.airtel + positiveMoney(payment.amount));
    else if (method === 'Bank') collections.bank = roundTender(collections.bank + positiveMoney(payment.amount));
    else collections.other = roundTender(collections.other + positiveMoney(payment.amount));
  }

  const expectedCash = roundTender(openingCash + expectedTenders.Cash - cashExpense + movement.in - movement.out + collections.cash);
  const expectedTotals = {
    cash: expectedCash,
    momo: roundTender(expectedTenders['MTN MoMo'] + collections.momo),
    airtel: roundTender(expectedTenders['Airtel Money'] + collections.airtel),
    credit: expectedTenders['Credit / Book'],
    bank: roundTender(expectedTenders.Bank + collections.bank),
    other: roundTender(expectedTenders.Other + collections.other),
  };
  const expectedTotal = roundTender(Object.values(expectedTotals).reduce((sum, value) => sum + value, 0));
  const rawCounted = input.countedTotals && typeof input.countedTotals === 'object' ? input.countedTotals : null;
  const countedCash = input.countedCash == null && !rawCounted ? null : positiveMoney(input.countedCash ?? rawCounted?.cash ?? rawCounted?.Cash ?? 0);
  const countedTotals = rawCounted || countedCash != null ? {
    cash: positiveMoney(rawCounted?.cash ?? rawCounted?.Cash ?? countedCash ?? 0),
    momo: positiveMoney(rawCounted?.momo ?? rawCounted?.['MTN MoMo'] ?? 0),
    airtel: positiveMoney(rawCounted?.airtel ?? rawCounted?.['Airtel Money'] ?? 0),
    credit: positiveMoney(rawCounted?.credit ?? rawCounted?.['Credit / Book'] ?? 0),
    bank: positiveMoney(rawCounted?.bank ?? 0),
    other: positiveMoney(rawCounted?.other ?? 0),
  } : null;
  const varianceByTender = countedTotals ? Object.fromEntries(Object.keys(expectedTotals).map((key) => [key, roundTender(countedTotals[key] - expectedTotals[key])])) : null;
  const totalVariance = countedTotals ? roundTender(Object.values(countedTotals).reduce((sum, value) => sum + value, 0) - expectedTotal) : null;
  return {
    openingCash,
    expectedCash,
    countedCash,
    difference: countedCash == null ? null : roundTender(countedCash - expectedCash),
    variance: countedCash == null ? null : roundTender(countedCash - expectedCash),
    expectedTenders,
    expectedTotals,
    countedTotals,
    varianceByTender,
    expectedTotal,
    countedTotal: countedTotals ? roundTender(Object.values(countedTotals).reduce((sum, value) => sum + value, 0)) : null,
    totalVariance,
    cashExpense,
    cashMovements: movement,
    collections,
    invalidSplit,
  };
}

export function scopeValues(row = {}) {
  return {
    staffId: row.staff_id || row.staffId || row.actor_id || row.actorId || '',
    staffName: row.staffname || row.staffName || row.actor_name || row.actorName || '',
    branch: row.branch || '',
  };
}

export function applyReportScope(rows = [], scope = {}) {
  const branch = String(scope.branch || '').trim();
  const staffId = String(scope.staffId || '').trim();
  const staffName = String(scope.staffName || '').trim().toLowerCase();
  return rows.filter((row) => {
    const values = scopeValues(row);
    if (branch && values.branch !== branch) return false;
    if (staffId && values.staffId !== staffId) return false;
    if (staffName && values.staffName.toLowerCase() !== staffName) return false;
    return true;
  });
}
