import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePurchaseOrder, validateGoodsReceipt, validateSettlement, validateExpense, validateCreditCollection, validateCloseSession, validateHandover } from '../api/operationsRules.js';

const products = [{ id: 'p1', name: 'Tea', isService: false, deleted: false }];

test('validates purchase order lines and services', () => {
  const result = validatePurchaseOrder({ supplierId: 's1', lines: [{ productId: 'p1', quantity: 2, unitCost: 1000 }] }, products);
  assert.equal(result.lines[0].quantity, 2);
  assert.equal(validatePurchaseOrder({ supplierId: 's1', lines: [{ productId: 'missing', quantity: 1 }] }, products).code, 'UNKNOWN_PRODUCT');
  assert.equal(validatePurchaseOrder({ supplierId: 's1', lines: [{ productId: 'svc', quantity: 1 }] }, [{ id: 'svc', name: 'Service', isService: true, deleted: false }]).code, 'SERVICE_PRODUCT');
});

test('rejects over-receiving and invalid settlement fields', () => {
  const receipt = validateGoodsReceipt({ lines: [{ purchaseOrderLineId: 'l1', quantity: 3 }] }, [{ id: 'l1', productId: 'p1', productName: 'Tea', quantityOrdered: 2, quantityReceived: 0, unitCost: 1000 }]);
  assert.equal(receipt.code, 'OVER_RECEIPT');
  const settlement = validateSettlement({ kind: 'bank', amount: 100, reference: '' });
  assert.equal(settlement.code, 'INVALID_SETTLEMENT');
  assert.equal(validateSettlement({ kind: 'momo', direction: 'in', amount: 100, reference: 'r1' }).amount, 100);
});

test('validates expense category and receipt metadata', () => {
  const result = validateExpense({ description: 'Fuel', amount: 10, category: 'Transport', receiptUrl: 'https://example.test/r.jpg' }, ['Transport']);
  assert.equal(result.approvalStatus, 'pending');
  assert.equal(result.receiptType, 'image');
  assert.equal(validateExpense({ description: 'Fuel', amount: 10, category: 'Unknown' }, ['Transport']).code, 'INVALID_CATEGORY');
  assert.equal(validateExpense({ description: 'Fuel', amount: 10, category: 'Transport', receiptUrl: 'javascript:bad' }, ['Transport']).code, 'INVALID_RECEIPT');
});

test('validates credit collection and durable close inputs', () => {
  assert.equal(validateCreditCollection({ amount: 5 }, { total: 10, paymentMethod: 'Credit / Book' }, 2).amount, 5);
  assert.equal(validateCreditCollection({ amount: 9 }, { total: 10, paymentMethod: 'Credit / Book' }, 2).code, 'OVERPAYMENT');
  assert.equal(validateCloseSession({ businessDate: '2026-02-30' }).code, 'INVALID_DATE');
  assert.equal(validateHandover({ toStaffId: 's2', openingCash: 10, closingCash: 0 }).toStaffId, 's2');
});
