import { describe, expect, it } from 'vitest';
import { summarizeRefused } from './syncReview';

describe('summarizeRefused', () => {
  it('describes a refused sale with who paid and how much', () => {
    const s = summarizeRefused({
      path: '/api/sales',
      method: 'POST',
      body: JSON.stringify({ total: 25000, paymentMethod: 'MTN MoMo', customerName: 'Mama Naki', items: [{}, {}] }),
    }, 'stock');
    expect(s).toContain('Mama Naki');
    expect(s).toContain('25,000');
    expect(s).toContain('sold out');
  });

  it('describes a lost product-edit race', () => {
    const s = summarizeRefused({
      path: '/api/products/abc',
      method: 'PUT',
      body: JSON.stringify({ name: 'Sugar' }),
    }, 'conflict');
    expect(s).toContain('Sugar');
    expect(s).toContain('another till');
  });

  it('describes a refused expense', () => {
    const s = summarizeRefused({
      path: '/api/expenses',
      method: 'POST',
      body: JSON.stringify({ amount: 5000, description: 'Charcoal' }),
    }, 'refused');
    expect(s).toContain('5,000');
    expect(s).toContain('Charcoal');
  });

  it('never throws on garbage', () => {
    expect(() => summarizeRefused({ path: '', method: '', body: 'not-json{{{' }, 'refused')).not.toThrow();
    expect(summarizeRefused({ path: '/api/x', method: 'POST' }, 'refused')).toContain('/api/x');
  });
});

describe('buildReconnectReport', () => {
  it('stays silent when nothing happened', async () => {
    const { buildReconnectReport } = await import('./syncReview');
    const r = buildReconnectReport({ salesSent: 0, otherSent: 0, needsReview: 0, remaining: 0, refreshed: false });
    expect(r.orderNumbersRefreshed).toBe(false);
    expect(r.at).toBeGreaterThan(0);
  });

  it('flags settled order numbers only when sales actually sent', async () => {
    const { buildReconnectReport } = await import('./syncReview');
    expect(buildReconnectReport({ salesSent: 3, otherSent: 0, needsReview: 0, remaining: 0, refreshed: true }).orderNumbersRefreshed).toBe(true);
    expect(buildReconnectReport({ salesSent: 0, otherSent: 2, needsReview: 0, remaining: 0, refreshed: true }).orderNumbersRefreshed).toBe(false);
  });

  it('clamps garbage to safe zeros', async () => {
    const { buildReconnectReport } = await import('./syncReview');
    const r = buildReconnectReport({ salesSent: -5, otherSent: NaN, needsReview: 1.7, remaining: 2, refreshed: 1 as unknown as boolean });
    expect(r.salesSent).toBe(0);
    expect(r.otherSent).toBe(0);
    expect(r.needsReview).toBe(2);
  });
});
