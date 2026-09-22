// Render smoke test: every primary screen must mount without throwing.
// This catches init-order (TDZ) crashes like the Close-page
// "Cannot access ... before initialization" that slipped past tsc.
import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import CategoryRegister from './CategoryRegister';

const baseProps = {
  segments: ['Eatery', 'Library'],
  products: [],
  sales: [],
  creditEats: [],
  productionRegisters: [],
  wastageLogs: [],
  momoTransfers: [],
  onAddCreditEat: () => {},
  onPayCreditEat: () => {},
  onAddWastage: () => {},
  onDeleteWastage: () => {},
  onAddMomoTransfer: () => {},
  onDeleteMomoTransfer: () => {},
  formatCurrency: (v: number) => `USh ${v}`,
  triggerToast: () => {},
};

describe('CategoryRegister render', () => {
  it('mounts the Close page without throwing', () => {
    const html = renderToString(React.createElement(CategoryRegister, baseProps));
    expect(html.length).toBeGreaterThan(1000);
    expect(html).toMatch(/Close the day|close/i);
  });

  it('mounts with live drawer/phone buckets', () => {
    const html = renderToString(
      React.createElement(CategoryRegister, {
        ...baseProps,
        sales: [
          {
            id: 's-1', orderNumber: 'Order #1', timestamp: new Date().toISOString(),
            items: [{ productId: 'p-1', productName: 'Doc Scan', qty: 14, unitPrice: 500, unitCost: 100, lineTotal: 7000 }],
            subtotal: 7000, tax: 0, total: 7000, paymentMethod: 'Airtel Money', refunded: false,
          },
        ],
      }),
    );
    expect(html.length).toBeGreaterThan(1000);
  });
});
