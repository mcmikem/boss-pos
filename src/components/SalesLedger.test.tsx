import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import SalesLedger from './SalesLedger';

const baseProps = {
  sales: [],
  products: [],
  categories: ['Eatery'],
  formatCurrency: (v: number) => `USh ${v}`,
  triggerToast: () => {},
  isManager: true,
  onChanged: () => {},
};

describe('SalesLedger render', () => {
  it('mounts the sales ledger without throwing', () => {
    const html = renderToString(React.createElement(SalesLedger, baseProps));
    expect(html).toContain('Sales');
    expect(html).toContain('Today');
    expect(html).toContain('Yesterday');
    expect(html).toContain('This week');
    expect(html).toContain('This month');
  });

  it('shows live sales with totals and a fix action', () => {
    const html = renderToString(
      React.createElement(SalesLedger, {
        ...baseProps,
        sales: [
          {
            id: 's-1', orderNumber: 'Order #1', timestamp: new Date().toISOString(),
            items: [{ productId: 'p-1', productName: 'Chapati', qty: 2, unitPrice: 1000, unitCost: 400, lineTotal: 2000 }],
            subtotal: 2000, tax: 0, total: 2000, paymentMethod: 'Cash', refunded: false,
          },
        ],
      }),
    );
    expect(html).toContain('Order #1');
    expect(html).toContain('USh 2000');
    expect(html).toContain('Fix');
  });
});
