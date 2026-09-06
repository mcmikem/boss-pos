// EFRIS adapter unit tests — pure payload logic, no database required.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  sanitizeEfrisConfig,
  buildInvoicePayload,
  simulateSandbox,
  sendToProvider,
  goodsCodeFor,
  splitVat,
  saleVatTotal,
} from '../api/efris.js';

const sale = {
  id: 's-1',
  orderNumber: 'Order #12',
  items: [
    { productId: 'p-abc', productName: 'Soda', qty: 2, lineTotal: 4000 },
    { productId: 'p-def', productName: 'Chips', variantLabel: 'Big', qty: 1, lineTotal: 5900 },
  ],
  subtotal: 9900,
  tax: 0,
  total: 9900,
  discount: 0,
  paymentMethod: 'Cash',
  customerName: 'Amina',
  staffName: 'Musa',
};

const cfg = sanitizeEfrisConfig({ enabled: true, mode: 'sandbox', tin: ' 12345 ', vatRate: 18 });

describe('sanitizeEfrisConfig', () => {
  it('rejects unknown modes and disables without a mode', () => {
    assert.equal(sanitizeEfrisConfig({ enabled: true, mode: 'live' }).mode, 'off');
    assert.equal(sanitizeEfrisConfig({ enabled: true, mode: 'live' }).enabled, false);
  });
  it('trims TIN and clamps VAT', () => {
    assert.equal(cfg.tin, '12345');
    assert.equal(sanitizeEfrisConfig({ vatRate: 500 }).vatRate, 100);
  });
});

describe('splitVat', () => {
  it('extracts VAT from inclusive prices', () => {
    assert.deepEqual(splitVat(11800, 18, true), { net: 10000, tax: 1800 });
  });
  it('adds VAT on exclusive prices and honours zero rate', () => {
    assert.deepEqual(splitVat(10000, 18, false), { net: 10000, tax: 1800 });
    assert.deepEqual(splitVat(10000, 0, true), { net: 10000, tax: 0 });
  });
});

describe('goodsCodeFor', () => {
  it('builds stable prefixed codes within 30 chars', () => {
    const code = goodsCodeFor('p-abc-123!', 'BOSS');
    assert.equal(code, 'BOSS-p-abc-123');
    assert.ok(goodsCodeFor('x'.repeat(100), 'Y'.repeat(50)).length <= 30);
  });
});

describe('buildInvoicePayload', () => {
  it('maps lines, VAT, totals and parties', () => {
    const p = buildInvoicePayload(sale, { shopName: 'IMAC' }, cfg);
    assert.equal(p.currency, 'UGX');
    assert.equal(p.seller.tin, '12345');
    assert.equal(p.buyer.name, 'Amina');
    assert.equal(p.lines.length, 2);
    assert.equal(p.lines[1].desc, 'Chips — Big');
    assert.ok(p.lines.every((l) => l.taxRate === 18 && l.gross === l.net + l.tax));
    assert.equal(p.totals.gross, 9900);
    assert.equal(p.totals.payable, 9900);
  });
  it('applies discount to net and payable', () => {
    const p = buildInvoicePayload({ ...sale, discount: 900, total: 9000 }, { shopName: 'IMAC' }, cfg);
    assert.equal(p.totals.discount, 900);
    assert.equal(p.totals.payable, 9000);
  });
  it('throws on empty sales', () => {
    assert.throws(() => buildInvoicePayload({ ...sale, items: [] }, {}, cfg), /no items/);
  });
});

describe('simulateSandbox', () => {
  it('is deterministic and carries the payable amount', () => {
    const p = buildInvoicePayload(sale, { shopName: 'IMAC' }, cfg);
    const a = simulateSandbox(p);
    const b = simulateSandbox(p);
    assert.deepEqual(a, b);
    assert.match(a.fdn, /^FDN-SANDBOX-/);
    assert.ok(a.qr.includes('9900'));
  });
});

describe('saleVatTotal', () => {
  it('sums extracted VAT across lines', () => {
    assert.equal(saleVatTotal(sale.items, cfg), 1510);
  });
  it('is zero without a configured rate', () => {
    assert.equal(saleVatTotal(sale.items, sanitizeEfrisConfig({ vatRate: 0 })), 0);
    assert.equal(saleVatTotal([], cfg), 0);
  });
});

describe('sendToProvider', () => {
  it('normalises provider response shapes', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: { invoiceNumber: 'INV-1', fiscalDocumentNumber: 'FDN-1', verificationCode: 'V1', qrCode: 'QR1' } }));
    });
    await new Promise((r) => server.listen(0, r));
    try {
      const out = await sendToProvider({ x: 1 }, { base: `http://127.0.0.1:${server.address().port}`, token: 't' });
      assert.equal(out.invoiceNo, 'INV-1');
      assert.equal(out.fdn, 'FDN-1');
      assert.equal(out.verifyCode, 'V1');
      assert.equal(out.qr, 'QR1');
    } finally {
      server.close();
    }
  });
  it('surfaces provider rejections as errors', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(422, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown goods code' }));
    });
    await new Promise((r) => server.listen(0, r));
    try {
      await assert.rejects(
        sendToProvider({ x: 1 }, { base: `http://127.0.0.1:${server.address().port}` }),
        /Unknown goods code/,
      );
    } finally {
      server.close();
    }
  });
});
