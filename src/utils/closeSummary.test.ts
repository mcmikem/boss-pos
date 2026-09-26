import { describe, expect, it } from 'vitest';
import { buildCloseSummaryPayload, closeSummaryClientWriteId } from './closeSummary';

const base = {
  shopName: 'Test Shop',
  businessDate: '2026-09-26',
  branch: 'Eatery',
  tookToday: 63000,
  cashSales: 34000,
  phoneSales: 29000,
  openingFloat: 10000,
  drawerExpenses: 500,
  expectedInDrawer: 43500,
  assigned: 29250,
  unassigned: 14250,
  counted: 43500,
  variance: 0,
  creditGivenOut: 5000,
  creditCollectedBack: 2000,
  awaitingHandover: 0,
  closedByName: 'Mike',
};

describe('buildCloseSummaryPayload', () => {
  it('tells one consistent money story for inbox and WhatsApp', () => {
    const p = buildCloseSummaryPayload(base);
    expect(p.headline).toContain('2026-09-26');
    expect(p.headline).toContain('63,000');
    expect(p.body).toContain('Test Shop · Eatery');
    expect(p.body).toContain('Took today: 63,000 (cash 34,000 · phone 29,000)');
    expect(p.body).toContain('Expected in drawer: 43,500 (opening 10,000 − expenses 500)');
    expect(p.body).toContain('Assigned: 29,250 · Not yet assigned: 14,250');
    expect(p.body).toContain('Counted: 43,500 · Difference: ✓ 0');
    expect(p.body).toContain('Credit: 5,000 given out · 2,000 collected back');
    expect(p.body).toContain('Closed by Mike');
    expect(p.totals.tookToday).toBe(63000);
    expect(p.totals.unassigned).toBe(14250);
  });

  it('never hides an uncounted drawer or a shortfall', () => {
    const p = buildCloseSummaryPayload({ ...base, counted: null, variance: null });
    expect(p.body).toContain('Counted: not yet counted');
    const short = buildCloseSummaryPayload({ ...base, counted: 43000, variance: -500 });
    expect(short.body).toContain('Difference: −500');
  });

  it('skips empty credit and handover lines instead of printing zeros', () => {
    const p = buildCloseSummaryPayload({ ...base, creditGivenOut: 0, creditCollectedBack: 0 });
    expect(p.body).not.toContain('Credit:');
    expect(p.body).not.toContain('awaiting confirmation');
    const h = buildCloseSummaryPayload({ ...base, awaitingHandover: 17750 });
    expect(h.body).toContain('awaiting confirmation: 17,750');
  });

  it('makes repeat sends idempotent per day and department', () => {
    expect(closeSummaryClientWriteId('2026-09-26', 'Eatery')).toBe('close-summary:2026-09-26:Eatery');
    expect(closeSummaryClientWriteId('2026-09-26', '')).toBe('close-summary:2026-09-26:shop');
  });
});
