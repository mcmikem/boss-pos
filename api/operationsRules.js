import { normalizeBarcode, normalizeImei, roundMoney } from './businessRules.js';
import { DEFAULT_EXPENSE_CATEGORIES, normalizePaymentMethod, validateReference } from './operationsBusiness.js';

export const EXPENSE_CATEGORIES = [...DEFAULT_EXPENSE_CATEGORIES];
export const APPROVAL_STATUSES = ['pending', 'submitted', 'approved', 'rejected'];
export const SETTLEMENT_KINDS = ['momo', 'bank'];
export const SETTLEMENT_DIRECTIONS = ['in', 'out'];
export const SETTLEMENT_STATUSES = ['pending', 'settled', 'reconciled', 'voided'];

export function requiredText(value, field, max = 200) {
  const result = String(value ?? '').trim();
  if (!result) return { error: `${field} is required`, code: 'INVALID_INPUT' };
  return { value: result.slice(0, max) };
}

export function isoDate(value, field = 'date') {
  if (value == null || value === '') return { value: new Date().toISOString() };
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { error: `${field} must be a valid date`, code: 'INVALID_DATE' };
  return { value: date.toISOString() };
}

export function businessDate(value, field = 'date') {
  const raw = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { error: `${field} must use YYYY-MM-DD`, code: 'INVALID_DATE' };
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== raw) return { error: `${field} is not a real date`, code: 'INVALID_DATE' };
  return { value: raw };
}

export function quantity(value, { allowZero = false, max = 100000000 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n <= 0) || n > max) return { error: allowZero ? 'Quantity must be between 0 and the maximum' : 'Quantity must be positive', code: 'INVALID_QUANTITY' };
  return { value: Math.round(n * 1000) / 1000 };
}

export function money(value, { allowZero = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n <= 0)) return { error: allowZero ? 'Amount must be non-negative' : 'Amount must be positive', code: 'INVALID_AMOUNT' };
  return { value: roundMoney(n) };
}

export function validatePurchaseOrder(input = {}, productRows = []) {
  const supplier = requiredText(input.supplierId || input.supplierName, 'supplier', 150);
  if (supplier.error) return supplier;
  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  if (rawLines.length < 1 || rawLines.length > 500) return { error: 'Purchase order needs 1 to 500 lines', code: 'INVALID_LINES' };
  const products = new Map(productRows.map((p) => [String(p.id), p]));
  const lines = [];
  const seen = new Set();
  for (const raw of rawLines) {
    const productId = String(raw?.productId || '').trim();
    if (!productId || seen.has(productId)) return { error: 'Purchase order lines need unique product ids', code: 'INVALID_LINES' };
    const product = products.get(productId);
    if (!product || product.deleted) return { error: `Unknown or deleted product: ${productId}`, code: 'UNKNOWN_PRODUCT', productId };
    if (product.isService) return { error: `Services cannot be purchased: ${productId}`, code: 'SERVICE_PRODUCT', productId };
    const qty = quantity(raw?.quantity ?? raw?.qty);
    if (qty.error) return { ...qty, productId };
    const cost = money(raw?.unitCost ?? raw?.unitPrice, { allowZero: true });
    if (cost.error) return { ...cost, productId };
    seen.add(productId);
    lines.push({ productId, productName: product.name, quantity: qty.value, unitCost: cost.value, expiryDate: raw?.expiryDate || null, batchNumber: raw?.batchNumber ? String(raw.batchNumber).slice(0, 80) : null });
  }
  return {
    supplier: supplier.value,
    expectedDate: input.expectedDate ? businessDate(input.expectedDate, 'expectedDate').value || null : null,
    notes: String(input.notes || '').slice(0, 1000),
    branch: String(input.branch || '').trim().slice(0, 80),
    lines,
  };
}

export function validateGoodsReceipt(input = {}, orderLines = []) {
  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  if (rawLines.length < 1 || rawLines.length > 500) return { error: 'Goods receipt needs 1 to 500 lines', code: 'INVALID_LINES' };
  const byId = new Map(orderLines.map((line) => [String(line.id), line]));
  const lines = [];
  for (const raw of rawLines) {
    const lineId = String(raw?.purchaseOrderLineId || raw?.lineId || '').trim();
    const line = byId.get(lineId);
    if (!line) return { error: `Purchase order line not found: ${lineId || 'missing'}`, code: 'UNKNOWN_LINE', lineId };
    const qty = quantity(raw?.quantity ?? raw?.qty);
    if (qty.error) return { ...qty, lineId };
    const remaining = Math.max(0, Number(line.quantityOrdered || 0) - Number(line.quantityReceived || 0));
    if (qty.value > remaining + 0.0001) return { error: `Receipt exceeds the remaining quantity for ${line.productId}`, code: 'OVER_RECEIPT', lineId, remaining };
    const unitCost = raw?.unitCost == null ? Number(line.unitCost || 0) : money(raw.unitCost, { allowZero: true }).value;
    if (!Number.isFinite(unitCost) || unitCost < 0) return { error: 'Receipt unit cost must be non-negative', code: 'INVALID_AMOUNT', lineId };
    lines.push({ purchaseOrderLineId: lineId, productId: String(line.productId), productName: String(line.productName || ''), quantity: qty.value, unitCost: roundMoney(unitCost), expiryDate: raw?.expiryDate || line.expiryDate || null, batchNumber: raw?.batchNumber ? String(raw.batchNumber).slice(0, 80) : line.batchNumber || null });
  }
  return { lines };
}

export function validateSettlement(input = {}) {
  const kind = String(input.kind || input.type || '').toLowerCase();
  const direction = String(input.direction || (kind === 'bank' ? 'out' : '')).toLowerCase();
  const amount = money(input.amount);
  if (!SETTLEMENT_KINDS.includes(kind)) return { error: 'Settlement kind must be momo or bank', code: 'INVALID_SETTLEMENT' };
  if (!SETTLEMENT_DIRECTIONS.includes(direction)) return { error: 'Settlement direction must be in or out', code: 'INVALID_SETTLEMENT' };
  if (amount.error) return amount;
  const referenceResult = validateReference(input.reference, 'settlement reference');
  if (referenceResult.error) return { ...referenceResult, code: 'INVALID_SETTLEMENT' };
  const provider = String(input.provider || (kind === 'momo' ? 'MoMo' : 'Bank')).trim().slice(0, 50);
  const account = String(input.account || '').trim().slice(0, 120);
  if (kind === 'momo' && !provider) return { error: 'MoMo provider is required', code: 'INVALID_SETTLEMENT' };
  if (kind === 'bank' && !account) return { error: 'Bank account is required', code: 'INVALID_SETTLEMENT' };
  const requestedStatus = String(input.status || 'pending').toLowerCase();
  if (!SETTLEMENT_STATUSES.includes(requestedStatus)) return { error: 'Settlement status is invalid', code: 'INVALID_SETTLEMENT_STATUS' };
  if (requestedStatus === 'reconciled' || requestedStatus === 'voided') return { error: 'New settlements must start pending or settled', code: 'INVALID_SETTLEMENT_TRANSITION' };
  return {
    kind,
    direction,
    amount: amount.value,
    reference: referenceResult.value,
    provider,
    account,
    note: String(input.note || '').slice(0, 500),
    branch: String(input.branch || '').trim().slice(0, 80),
    status: requestedStatus,
    clientWriteId: String(input.clientWriteId || input.idempotencyKey || '').trim().slice(0, 200) || null,
  };
}

export function validateCloseSession(input = {}) {
  const date = businessDate(input.businessDate || input.date, 'businessDate');
  if (date.error) return date;
  const opening = input.openingCash == null ? { value: 0 } : money(input.openingCash, { allowZero: true });
  if (opening.error) return opening;
  const counted = input.countedCash == null && input.closingCash == null && input.countedTotals == null ? null : money(input.countedCash ?? input.closingCash ?? (input.countedTotals && (input.countedTotals.cash ?? input.countedTotals.Cash)) ?? 0);
  if (counted?.error) return counted;
  const countedTotals = input.countedTotals && typeof input.countedTotals === 'object' ? input.countedTotals : null;
  return {
    businessDate: date.value,
    branch: String(input.branch || '').trim().slice(0, 80),
    openingCash: opening.value,
    countedCash: counted?.value ?? null,
    countedTotals,
    note: String(input.note || '').slice(0, 1000),
    idempotencyKey: String(input.idempotencyKey || input.clientWriteId || '').trim().slice(0, 200) || null,
  };
}

export function validateHandover(input = {}) {
  const toStaffId = String(input.toStaffId || '').trim();
  if (!toStaffId) return { error: 'toStaffId is required', code: 'INVALID_HANDOVER' };
  const opening = money(input.openingCash ?? input.cashIn, { allowZero: true });
  const closing = money(input.closingCash ?? input.cashOut, { allowZero: true });
  if (opening.error) return opening;
  if (closing.error) return closing;
  return {
    fromStaffId: String(input.fromStaffId || '').trim().slice(0, 160) || null,
    toStaffId,
    openingCash: opening.value,
    closingCash: closing.value,
    branch: String(input.branch || '').trim().slice(0, 80),
    note: String(input.note || '').slice(0, 1000),
    idempotencyKey: String(input.idempotencyKey || input.clientWriteId || '').trim().slice(0, 200) || null,
  };
}

export function recipeBatchCost(recipe) {
  if (!recipe || !Array.isArray(recipe.ingredients)) return 0;
  return roundMoney(recipe.ingredients.reduce((sum, ing) => {
    const qty = Math.max(0, Number(ing?.qty) || 0);
    const unitCost = Math.max(0, Number(ing?.unitCost) || 0);
    const waste = 1 + Math.max(0, Number(ing?.wastePct) || 0) / 100;
    return sum + qty * unitCost * waste;
  }, 0));
}

export function parseProductRecipe(product) {
  if (!product) return null;
  if (product.recipe && typeof product.recipe === 'object' && !Array.isArray(product.recipe)) return product.recipe;
  if (typeof product.recipe === 'string' && product.recipe) {
    try {
      const parsed = JSON.parse(product.recipe);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }
  return null;
}

export function planLineCost(product, batchQty) {
  const recipe = parseProductRecipe(product);
  const hasRecipe = !!recipe && Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0;
  const yieldQty = Math.max(1, Number(recipe?.yield) || 1);
  const batches = batchQty > 0 ? batchQty / yieldQty : 0;
  const ingredientCost = hasRecipe ? roundMoney(recipeBatchCost(recipe) * batches) : 0;
  const overhead = roundMoney((Number(recipe?.overhead) || 0) * batches);
  return { hasRecipe, batches: roundMoney(batches), ingredientCost, overhead, totalCost: roundMoney(ingredientCost + overhead) };
}

export function validateProductionPlan(input = {}, productRows = []) {
  const date = businessDate(input.businessDate || input.date, 'businessDate');
  if (date.error) return date;
  const category = String(input.category || 'Eatery').trim().slice(0, 80);
  if (!['Eatery', 'Drinks'].includes(category)) return { error: 'Production plans cover Eatery or Drinks', code: 'INVALID_CATEGORY' };
  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  if (rawLines.length < 1 || rawLines.length > 200) return { error: 'A plan needs 1 to 200 lines', code: 'INVALID_LINES' };
  const products = new Map(productRows.map((p) => [String(p.id), p]));
  const lines = [];
  const seen = new Set();
  for (const raw of rawLines) {
    const productId = String(raw?.productId || '').trim();
    if (!productId || seen.has(productId)) return { error: 'Plan lines need unique product ids', code: 'INVALID_LINES' };
    const product = products.get(productId);
    if (!product || product.deleted) return { error: `Unknown or deleted product: ${productId}`, code: 'UNKNOWN_PRODUCT', productId };
    if (product.isService) return { error: `Services cannot be produced: ${productId}`, code: 'SERVICE_PRODUCT', productId };
    const qty = quantity(raw?.batchQty ?? raw?.quantity ?? raw?.qty);
    if (qty.error) return { ...qty, productId };
    seen.add(productId);
    lines.push({ productId, batchQty: qty.value });
  }
  const override = input.overrideTotal == null && input.override == null
    ? null
    : money(input.overrideTotal ?? input.override, { allowZero: true });
  if (override && override.error) return override;
  return {
    businessDate: date.value,
    category,
    branch: String(input.branch || '').trim().slice(0, 80),
    lines,
    overrideTotal: override ? override.value : null,
    note: String(input.note || '').slice(0, 500),
    idempotencyKey: String(input.clientWriteId || input.idempotencyKey || '').trim().slice(0, 200) || null,
  };
}

export function validateSaleChangeRequest(input = {}, sale = null) {
  const kind = String(input.kind || '').toLowerCase();
  if (kind !== 'void' && kind !== 'edit') return { error: 'Change kind must be void or edit', code: 'INVALID_KIND' };
  const reason = requiredText(input.reason, 'reason', 500);
  if (reason.error) return { error: 'Say why — the manager needs a reason', code: 'REASON_REQUIRED' };
  if (!sale) return { error: 'Sale not found', code: 'SALE_NOT_FOUND' };
  if (sale.refunded || sale.voided) return { error: 'That sale is already refunded or deleted', code: 'SALE_CLOSED' };
  let lines = null;
  if (kind === 'edit') {
    const rawLines = Array.isArray(input.lines) ? input.lines : [];
    if (rawLines.length < 1 || rawLines.length > 500) return { error: 'An edit needs 1 to 500 lines', code: 'INVALID_LINES' };
    const original = new Map();
    for (const item of sale.items || []) {
      const key = `${item.productId || ''}::${item.variantId || ''}`;
      original.set(key, item);
    }
    lines = [];
    const seen = new Set();
    for (const raw of rawLines) {
      const key = `${String(raw?.productId || '').trim()}::${String(raw?.variantId || '').trim()}`;
      if (!original.has(key) || seen.has(key)) return { error: 'Edits can only change quantities on existing lines', code: 'INVALID_LINES' };
      const qty = quantity(raw?.qty, { allowZero: true });
      if (qty.error) return { ...qty, productId: String(raw?.productId || '') };
      seen.add(key);
      lines.push({ productId: String(raw?.productId || '').trim(), variantId: String(raw?.variantId || '').trim() || null, qty: qty.value });
    }
    // Untouched original lines keep their quantities.
    for (const [key, item] of original) {
      if (!seen.has(key)) lines.push({ productId: String(item.productId || ''), variantId: item.variantId || null, qty: Number(item.qty) || 0 });
    }
    if (!lines.some((l) => l.qty > 0)) return { error: 'An edit must keep at least one item', code: 'INVALID_LINES' };
  }
  return {
    kind,
    reason: reason.value,
    lines,
    idempotencyKey: String(input.clientWriteId || input.idempotencyKey || '').trim().slice(0, 200) || null,
  };
}

export function validateExpense(input = {}, allowedCategories = []) {
  const description = requiredText(input.description, 'description', 300);
  if (description.error) return description;
  const amount = money(input.amount);
  if (amount.error) return amount;
  const category = String(input.category || '').trim().slice(0, 100);
  if (!category) return { error: 'Expense category is required', code: 'INVALID_CATEGORY' };
  const allowed = (allowedCategories.length ? allowedCategories : EXPENSE_CATEGORIES).map((v) => String(v).trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(category.toLowerCase())) return { error: `Unknown expense category: ${category}`, code: 'INVALID_CATEGORY', category };
  const requestedStatus = String(input.approvalStatus || 'pending').toLowerCase();
  const status = input.approvalStatus == null ? 'pending' : requestedStatus === 'pending' ? 'submitted' : requestedStatus;
  if (!APPROVAL_STATUSES.includes(status)) return { error: 'Expense status is invalid', code: 'INVALID_APPROVAL_STATUS' };
  const receiptUrl = String(input.receiptUrl || '').trim();
  if (receiptUrl && !/^(https:\/\/|\/uploads\/)/i.test(receiptUrl)) return { error: 'Receipt URL is invalid', code: 'INVALID_RECEIPT' };
  const receiptReference = String(input.receiptReference || input.evidenceReference || '').trim().slice(0, 200);
  if (receiptReference && /[\u0000-\u001f\u007f]/.test(receiptReference)) return { error: 'Receipt reference is invalid', code: 'INVALID_RECEIPT' };
  const receiptEvidence = String(input.receiptEvidence || input.evidence || '').trim().slice(0, 2000);
  if (receiptEvidence && !/^(https:\/\/|\/uploads\/)/i.test(receiptEvidence)) return { error: 'Receipt evidence reference is invalid', code: 'INVALID_RECEIPT' };
  const receiptType = String(input.receiptType || (receiptUrl || receiptEvidence ? 'image' : '')).trim().toLowerCase();
  if (receiptType && !['image', 'pdf', 'other'].includes(receiptType)) return { error: 'Receipt type is invalid', code: 'INVALID_RECEIPT' };
  return {
    description: description.value,
    amount: amount.value,
    category,
    approvalStatus: status,
    receiptId: String(input.receiptId || '').trim().slice(0, 160) || null,
    receiptUrl: receiptUrl.slice(0, 2000) || null,
    receiptReference: receiptReference || null,
    receiptEvidence: receiptEvidence || null,
    receiptType: receiptType || null,
    receiptData: input.receiptData == null ? null : String(input.receiptData).slice(0, 20000),
    note: String(input.note || '').slice(0, 1000),
    source: ['drawer', 'cash', 'momo', 'owner', 'bank'].includes(input.source) ? input.source : 'drawer',
    branch: String(input.branch || '').trim().slice(0, 80),
    idempotencyKey: String(input.clientWriteId || input.idempotencyKey || '').trim().slice(0, 200) || null,
  };
}

export function validateCreditCollection(input = {}, sale = null, paid = 0) {
  const amount = money(input.amount);
  if (amount.error) return amount;
  if (!sale) return { error: 'Credit target not found', code: 'NOT_FOUND' };
  if (sale.refunded || sale.voided) return { error: 'Credit target is no longer collectible', code: 'SALE_CLOSED' };
  const method = sale.paymentMethod ?? sale.paymentmethod;
  if (method !== 'Credit / Book') return { error: 'Target was not paid on credit', code: 'NOT_CREDIT' };
  const outstanding = roundMoney(Math.max(0, Number(sale.total || 0) - Number(paid || 0)));
  if (amount.value > outstanding + 0.01) return { error: 'Payment exceeds the outstanding credit balance', code: 'OVERPAYMENT', outstanding, amount: amount.value };
  const paymentMethod = normalizePaymentMethod(input.paymentMethod ?? input.payment_method, 'Cash');
  if (!paymentMethod) return { error: 'Payment method is invalid', code: 'INVALID_PAYMENT_METHOD' };
  const branch = String(input.branch || '').trim().slice(0, 80);
  if (branch && String(sale.branch || '') !== branch) return { error: 'Payment branch does not match the credit target', code: 'BRANCH_MISMATCH' };
  return {
    amount: amount.value,
    outstanding: roundMoney(outstanding - amount.value),
    paymentMethod,
    reference: String(input.reference || '').trim().slice(0, 120) || null,
    note: String(input.note || '').slice(0, 500),
    branch: branch || String(sale.branch || '').slice(0, 80),
    collectorId: String(input.collectorId || '').trim().slice(0, 160) || null,
    collectorName: String(input.collectorName || '').trim().slice(0, 80) || null,
    idempotencyKey: String(input.clientWriteId || input.idempotencyKey || '').trim().slice(0, 200) || null,
  };
}

export function identitySnapshot(input = {}) {
  return { barcode: normalizeBarcode(input.barcode) || null, imei: normalizeImei(input.imei) || null };
}
