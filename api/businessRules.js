export const PAYMENT_METHODS = ['Cash', 'MTN MoMo', 'Airtel Money', 'Credit / Book', 'Split'];
export const SPLIT_METHODS = ['Cash', 'MTN MoMo', 'Airtel Money'];

export function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function aggregateSaleLines(value) {
  if (!Array.isArray(value)) return { error: 'items must be an array', code: 'INVALID_ITEMS' };
  if (value.length === 0 || value.length > 500) return { error: 'items must contain 1 to 500 lines', code: 'INVALID_ITEMS' };
  const lines = new Map();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Each sale line must be an object', code: 'INVALID_ITEM' };
    const productId = String(raw.productId || '').trim().slice(0, 150);
    const productName = String(raw.productName || '').trim().slice(0, 150);
    const qty = Number(raw.qty);
    const unitPrice = Number(raw.unitPrice);
    const unitCost = Number(raw.unitCost ?? raw.cost ?? 0);
    const lineDiscount = Number(raw.lineDiscount ?? 0);
    if (!productId) return { error: 'Every sale line needs a productId', code: 'INVALID_PRODUCT' };
    if (!productName) return { error: `Product name is required for ${productId}`, code: 'INVALID_PRODUCT' };
    if (!Number.isFinite(qty) || qty <= 0) return { error: `Quantity must be positive for ${productId}`, code: 'INVALID_QUANTITY' };
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return { error: `Unit price must be non-negative for ${productId}`, code: 'INVALID_PRICE' };
    if (!Number.isFinite(unitCost) || unitCost < 0) return { error: `Unit cost must be non-negative for ${productId}`, code: 'INVALID_COST' };
    if (!Number.isFinite(lineDiscount) || lineDiscount < 0) return { error: `Line discount must be non-negative for ${productId}`, code: 'INVALID_DISCOUNT' };
    const gross = roundMoney(unitPrice * qty);
    const lineTotal = raw.lineTotal == null ? roundMoney(gross - lineDiscount) : roundMoney(raw.lineTotal);
    if (!Number.isFinite(lineTotal) || lineTotal < 0) return { error: `Line total must be non-negative for ${productId}`, code: 'INVALID_TOTAL' };
    if (lineTotal > gross + 0.01) return { error: `Line total exceeds gross for ${productId}`, code: 'INVALID_TOTAL' };
    const key = `${productId}\u0000${String(raw.variantId || '')}\u0000${String(raw.saleUnit || '')}`;
    const current = lines.get(key);
    if (!current) {
      lines.set(key, {
        productId,
        productName,
        qty,
        unitPrice: roundMoney(unitPrice),
        unitCost: roundMoney(unitCost),
        lineTotal,
        lineDiscount: roundMoney(lineDiscount),
        ...(raw.variantId ? { variantId: String(raw.variantId).slice(0, 100) } : {}),
        ...(raw.variantLabel ? { variantLabel: String(raw.variantLabel).slice(0, 150) } : {}),
        ...(raw.saleUnit ? { saleUnit: String(raw.saleUnit).slice(0, 50) } : {}),
      });
    } else {
      current.qty = roundMoney(current.qty + qty);
      current.lineTotal = roundMoney(current.lineTotal + lineTotal);
      current.lineDiscount = roundMoney(current.lineDiscount + lineDiscount);
      current.unitCost = roundMoney((current.unitCost * (current.qty - qty) + unitCost * qty) / current.qty);
    }
  }
  return { items: [...lines.values()] };
}

export function saleTotals(items, supplied = {}) {
  const subtotal = roundMoney(items.reduce((sum, item) => sum + item.lineTotal, 0));
  const discount = Number(supplied.discount ?? 0);
  if (!Number.isFinite(discount) || discount < 0) return { error: 'Discount must be a non-negative number', code: 'INVALID_DISCOUNT' };
  if (discount > subtotal + 0.01) return { error: 'Discount cannot exceed the subtotal', code: 'INVALID_DISCOUNT' };
  const total = roundMoney(Math.max(0, subtotal - discount));
  if (supplied.total != null) {
    const clientTotal = Number(supplied.total);
    if (!Number.isFinite(clientTotal) || clientTotal < 0) return { error: 'Total must be a non-negative number', code: 'INVALID_TOTAL' };
    if (Math.abs(clientTotal - total) > 0.01) return { error: 'Sale total does not match the item lines and discount', code: 'TOTAL_MISMATCH' };
  }
  return { subtotal, discount: roundMoney(discount), total };
}

export function validatePayment(paymentMethodValue, totalValue, splitValue, body = {}) {
  const paymentMethod = String(paymentMethodValue || 'Cash');
  const total = roundMoney(totalValue);
  if (!PAYMENT_METHODS.includes(paymentMethod)) return { error: 'Unsupported payment method', code: 'INVALID_PAYMENT' };
  if (!Number.isFinite(total) || total < 0) return { error: 'Payment total is invalid', code: 'INVALID_PAYMENT' };
  if (paymentMethod === 'Split') {
    if (!Array.isArray(splitValue) || splitValue.length < 2 || splitValue.length > 5) return { error: 'Split payment needs 2 to 5 legs', code: 'INVALID_SPLIT' };
    const seen = new Set();
    const legs = [];
    let sum = 0;
    for (const raw of splitValue) {
      const method = String(raw?.method || '');
      const amount = roundMoney(raw?.amount);
      if (!SPLIT_METHODS.includes(method)) return { error: `Invalid split payment method: ${method || 'missing'}`, code: 'INVALID_SPLIT' };
      if (seen.has(method)) return { error: `Duplicate split payment method: ${method}`, code: 'INVALID_SPLIT' };
      if (!Number.isFinite(amount) || amount <= 0) return { error: 'Split payment amounts must be positive', code: 'INVALID_SPLIT' };
      seen.add(method);
      legs.push({ method, amount });
      sum = roundMoney(sum + amount);
    }
    if (Math.abs(sum - total) > 0.01) return { error: 'Split payment legs must equal the sale total', code: 'SPLIT_TOTAL_MISMATCH', splitTotal: sum, total };
    return { paymentMethod, splitTenders: legs, tendered: total };
  }
  if (Array.isArray(splitValue) && splitValue.length > 0) return { error: 'Split legs are only valid for Split payment', code: 'INVALID_SPLIT' };
  const tenderedValue = body.tenderedAmount ?? body.amountPaid ?? body.cashReceived ?? body.paymentAmount;
  if (tenderedValue != null) {
    const tendered = Number(tenderedValue);
    if (!Number.isFinite(tendered) || tendered < total) return { error: 'Tendered amount is below the sale total', code: 'INVALID_TENDER' };
    return { paymentMethod, tendered: roundMoney(tendered) };
  }
  return { paymentMethod, tendered: paymentMethod === 'Credit / Book' ? null : total };
}

export function normalizeBarcode(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function normalizeImei(value) {
  return String(value ?? '').trim().replace(/[^0-9]/g, '');
}

function validImeiChecksum(value) {
  if (!/^\d{15,16}$/.test(value)) return false;
  let sum = 0;
  const digits = value.split('').map(Number);
  const parity = digits.length % 2;
  for (let i = 0; i < digits.length; i += 1) {
    let digit = digits[i];
    if (i % 2 === parity) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function validateProductIdentity(input = {}, existing = []) {
  const barcodeInput = input.barcode == null ? '' : String(input.barcode).trim();
  const imeiInput = input.imei == null ? '' : String(input.imei).trim();
  const barcode = normalizeBarcode(barcodeInput);
  const imei = normalizeImei(imeiInput);
  const errors = [];
  if (barcodeInput && !/^[A-Za-z0-9._-]+$/.test(barcodeInput)) errors.push({ field: 'barcode', code: 'INVALID_BARCODE', message: 'Barcode contains unsupported characters' });
  if (barcode && (barcode.length < 4 || barcode.length > 64)) errors.push({ field: 'barcode', code: 'INVALID_BARCODE', message: 'Barcode must contain 4 to 64 letters or digits' });
  if (imeiInput && !/^[0-9 ._-]+$/.test(imeiInput)) errors.push({ field: 'imei', code: 'INVALID_IMEI', message: 'IMEI contains unsupported characters' });
  if (imei && !validImeiChecksum(imei)) errors.push({ field: 'imei', code: 'INVALID_IMEI', message: 'IMEI must be 15 or 16 digits with a valid checksum' });
  const barcodeMatches = barcode ? existing.filter((p) => normalizeBarcode(p.barcode) === barcode && p.id !== input.id) : [];
  const imeiMatches = imei ? existing.filter((p) => normalizeImei(p.imei) === imei && p.id !== input.id) : [];
  if (barcodeMatches.length > 1 || (barcodeMatches.length === 1 && barcodeMatches[0].id !== input.id)) errors.push({ field: 'barcode', code: 'IDENTITY_AMBIGUOUS', message: 'Barcode is already assigned to another product', matches: barcodeMatches.map((p) => p.id) });
  if (imeiMatches.length > 1 || (imeiMatches.length === 1 && imeiMatches[0].id !== input.id)) errors.push({ field: 'imei', code: 'IDENTITY_AMBIGUOUS', message: 'IMEI is already assigned to another product', matches: imeiMatches.map((p) => p.id) });
  return { barcode: barcode || null, imei: imei || null, errors };
}

export function discountRequiresManager(discount, threshold) {
  const amount = Number(discount) || 0;
  const limit = Number(threshold) || 0;
  return limit > 0 && amount > limit;
}

export function actorContext(auth = {}, staff = null) {
  const role = String(auth.role || 'till');
  const id = staff?.id || auth.staffId || null;
  const name = staff?.name || '';
  return { id: id ? String(id) : null, name: String(name).slice(0, 80), role: String(role).slice(0, 30) };
}

export function structuredMetadata(value) {
  if (value == null) return null;
  try {
    const encoded = JSON.stringify(value);
    return encoded.length > 12000 ? JSON.stringify({ truncated: true }) : encoded;
  } catch {
    return null;
  }
}

export function agingBucket(days) {
  const value = Math.max(0, Math.floor(Number(days) || 0));
  if (value <= 30) return '0-30';
  if (value <= 60) return '31-60';
  if (value <= 90) return '61-90';
  return '90+';
}

export function buildAgingReport(records = [], payments = [], asOf = new Date()) {
  const parsedEnd = asOf instanceof Date ? asOf : new Date(asOf);
  const end = Number.isFinite(parsedEnd.getTime()) ? parsedEnd : new Date();
  const paymentMap = new Map();
  const paymentDetails = new Map();
  for (const payment of payments) {
    const key = String(payment.saleId || payment.recordId || payment.id || '');
    if (!key) continue;
    paymentMap.set(key, (paymentMap.get(key) || 0) + Math.max(0, Number(payment.amount) || 0));
    if (!paymentDetails.has(key)) paymentDetails.set(key, []);
    paymentDetails.get(key).push(payment);
  }
  const rows = records.map((record) => {
    const total = Math.max(0, Number(record.total) || 0);
    const paidFromPayments = paymentMap.get(String(record.id)) || 0;
    const paid = Math.min(total, Math.max(0, Number(record.paidAmount) || 0, paidFromPayments));
    const outstanding = roundMoney(Math.max(0, total - paid));
    const rawCreated = record.createdAt || record.date;
    const createdRaw = /^\d{4}-\d{2}-\d{2}$/.test(String(rawCreated || '')) ? `${rawCreated}T00:00:00.000Z` : rawCreated;
    const created = new Date(createdRaw || end);
    const createdAt = Number.isFinite(created.getTime()) ? created : end;
    const ageDays = Math.max(0, Math.floor((end.getTime() - createdAt.getTime()) / 86400000));
    return {
      id: String(record.id),
      customerName: String(record.customerName || '').trim(),
      kind: record.kind === 'book' ? 'book' : 'sale',
      total: roundMoney(total),
      paid: roundMoney(paid),
      outstanding,
      ageDays,
      bucket: agingBucket(ageDays),
      createdAt: createdAt.toISOString(),
      branch: record.branch || '',
      staffId: record.staffId || record.staff_id || record.actorId || record.actor_id || '',
      staffName: record.staffName || record.staffname || record.actorName || record.actor_name || '',
      paymentMethod: record.paymentMethod || record.payment_method || '',
      reference: record.reference || '',
      payments: paymentDetails.get(String(record.id)) || [],
    };
  }).filter((row) => row.outstanding > 0).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const totals = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  for (const row of rows) totals[row.bucket] = roundMoney(totals[row.bucket] + row.outstanding);
  return { asOf: end.toISOString(), rows, buckets: totals, totalOutstanding: roundMoney(rows.reduce((sum, row) => sum + row.outstanding, 0)) };
}
