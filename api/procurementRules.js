import { roundMoney } from './businessRules.js';
import { businessDate } from './operationsRules.js';

export const PURCHASE_ORDER_STATUSES = ['draft', 'ordered', 'partially_received', 'received', 'cancelled'];
export const RECEIVABLE_STATUSES = ['draft', 'ordered', 'partially_received'];

export function roundQuantity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

export function expiryDateValue(value, field = 'expiryDate') {
  const raw = value == null || value === '' ? '' : String(value).trim();
  if (!raw) return { value: null };
  const parsed = businessDate(raw, field);
  if (parsed.error) return parsed;
  return { value: parsed.value };
}

export function normalizeOrderNumber(value) {
  return String(value ?? '').trim().slice(0, 60).replace(/[^A-Za-z0-9\-_. ]/g, '');
}

export function purchaseOrderTotals(lines = []) {
  let totalQuantity = 0;
  let totalCost = 0;
  for (const line of lines) {
    totalQuantity = roundQuantity(totalQuantity + roundQuantity(line.quantityOrdered ?? line.quantity ?? 0));
    totalCost = roundMoney(totalCost + roundMoney(Number(line.unitCost || 0) * roundQuantity(line.quantityOrdered ?? line.quantity ?? 0)));
  }
  return { lineCount: lines.length, totalQuantity, totalCost: roundMoney(totalCost) };
}

export function orderStatus(lines = [], current = 'ordered') {
  if (current === 'cancelled') return 'cancelled';
  let ordered = 0;
  let received = 0;
  for (const line of lines) {
    ordered = roundQuantity(ordered + roundQuantity(line.quantityOrdered || 0));
    received = roundQuantity(received + roundQuantity(line.quantityReceived || 0));
  }
  if (ordered > 0 && received >= ordered) return 'received';
  if (received > 0) return 'partially_received';
  return RECEIVABLE_STATUSES.includes(current) ? current : 'ordered';
}

export function receiptPlan(orderLines = [], receiptLines = []) {
  const byId = new Map(orderLines.map((line) => [String(line.id), line]));
  const seen = new Set();
  const lines = [];
  const rejected = [];
  for (const raw of receiptLines) {
    const lineId = String(raw?.purchaseOrderLineId || raw?.lineId || '').trim();
    const order = byId.get(lineId);
    if (!order) {
      rejected.push({ purchaseOrderLineId: lineId || null, productId: null, code: 'UNKNOWN_LINE', requestedQty: roundQuantity(raw?.quantity ?? raw?.qty ?? 0), remainingQty: 0 });
      continue;
    }
    if (seen.has(lineId)) {
      rejected.push({ purchaseOrderLineId: lineId, productId: String(order.productId || ''), code: 'DUPLICATE_LINE', requestedQty: roundQuantity(raw?.quantity ?? raw?.qty ?? 0), remainingQty: 0 });
      continue;
    }
    seen.add(lineId);
    const ordered = roundQuantity(order.quantityOrdered);
    const received = roundQuantity(order.quantityReceived);
    const remaining = roundQuantity(Math.max(0, ordered - received));
    const requested = roundQuantity(raw?.quantity ?? raw?.qty ?? 0);
    const accepted = roundQuantity(Math.min(requested, remaining));
    const shortBy = roundQuantity(Math.max(0, requested - accepted));
    if (accepted <= 0) {
      rejected.push({ purchaseOrderLineId: lineId, productId: String(order.productId || ''), code: 'OVER_RECEIPT', requestedQty: requested, remainingQty: remaining, shortBy });
      continue;
    }
    if (shortBy > 0) rejected.push({ purchaseOrderLineId: lineId, productId: String(order.productId || ''), code: 'OVER_RECEIPT', requestedQty: requested, remainingQty: remaining, shortBy });
    const unitCostRaw = raw?.unitCost == null ? Number(order.unitCost || 0) : Number(raw.unitCost);
    const unitCost = roundMoney(Number.isFinite(unitCostRaw) && unitCostRaw > 0 ? unitCostRaw : 0);
    const expiry = expiryDateValue(raw?.expiryDate ?? order.expiryDate ?? null, 'expiryDate');
    if (expiry.error) {
      rejected.push({ purchaseOrderLineId: lineId, productId: String(order.productId || ''), code: 'INVALID_EXPIRY', requestedQty: accepted, remainingQty: remaining, shortBy: 0, error: expiry.error });
      continue;
    }
    lines.push({
      purchaseOrderLineId: lineId,
      productId: String(order.productId || ''),
      productName: String(order.productName || '').slice(0, 150),
      quantity: accepted,
      unitCost,
      amount: roundMoney(unitCost * accepted),
      expiryDate: expiry.value ?? null,
      batchNumber: raw?.batchNumber ? String(raw.batchNumber).slice(0, 80) : (order.batchNumber ? String(order.batchNumber).slice(0, 80) : null),
      quantityOrdered: ordered,
      quantityReceived: received,
      remainingBefore: remaining,
      quantityReceivedAfter: roundQuantity(received + accepted),
    });
  }
  const merged = new Map();
  for (const line of orderLines) {
    const id = String(line.id);
    const applied = lines.filter((l) => l.purchaseOrderLineId === id);
    merged.set(id, {
      id,
      productId: String(line.productId || ''),
      productName: String(line.productName || '').slice(0, 150),
      quantityOrdered: roundQuantity(line.quantityOrdered),
      quantityReceived: roundQuantity(roundQuantity(line.quantityReceived) + applied.reduce((sum, l) => roundQuantity(sum + l.quantity), 0)),
    });
  }
  const mergedLines = [...merged.values()];
  return {
    lines,
    rejected,
    expenseItems: lines.map((line) => ({ name: `${line.productName} ×${line.quantity}`, amount: line.amount })),
    totalQuantity: roundQuantity(lines.reduce((sum, line) => roundQuantity(sum + line.quantity), 0)),
    totalCost: roundMoney(lines.reduce((sum, line) => roundMoney(sum + line.amount), 0)),
    orderLines: mergedLines,
    status: orderStatus(mergedLines, 'ordered'),
  };
}

export function receiptSummary(rows = []) {
  let quantity = 0;
  let cost = 0;
  for (const row of rows) {
    quantity = roundQuantity(quantity + roundQuantity(row.quantity || 0));
    cost = roundMoney(cost + roundMoney(Number(row.amount ?? (Number(row.quantity || 0) * Number(row.unitCost || 0))) || 0));
  }
  return { lineCount: rows.length, totalQuantity: quantity, totalCost: roundMoney(cost) };
}
