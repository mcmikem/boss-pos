import { describe, expect, it } from 'vitest';
import { computeDayCash, moneyOutByCategory } from './cashflow';
import type { MomoTransfer } from '../types';

const today = (() => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
})();

const at = `${today}T12:00:00.000Z`;

function move(to: MomoTransfer['to'], amount: number): MomoTransfer {
  return { id: `m-${to}-${amount}`, to, amount, category: 'Eatery', createdAt: at, status: 'pending' } as MomoTransfer;
}

const day = (over: Partial<Parameters<typeof computeDayCash>[0]> = {}) => computeDayCash({
  category: 'Eatery',
  dayKey: today,
  openingCapital: 0,
  closingCapital: 0,
  collected: 500_000,
  drawerExpenses: 0,
  floatOut: 0,
  cashOut: 0,
  ownerOut: 0,
  managerOut: 0,
  ...over,
});

describe('money handed to a manager', () => {
  it('is its own destination, not the phone line', () => {
    // This is the bug that stopped a close ever balancing: 'manager' fell through
    // to the float bucket, so cash handed to a person was recorded as money put
    // on the mobile-money line.
    const moves = moneyOutByCategory([move('manager', 200_000)], today);
    expect(moves.Eatery.manager).toBe(200_000);
    expect(moves.Eatery.float).toBe(0);

    const both = moneyOutByCategory([move('manager', 200_000), move('float', 50_000)], today);
    expect(both.Eatery).toMatchObject({ manager: 200_000, float: 50_000 });
  });

  it('gives the money a home, so the day balances', () => {
    // 500,000 came in. Hand 200,000 to a manager and 100,000 is still in the
    // drawer: that is a balanced day, and it is the whole point of the claim.
    const withClaim = day({ ownerOut: 100_000, managerOut: 200_000 });
    expect(withClaim.unassigned).toBe(200_000);
    expect(withClaim.assigned).toBe(300_000);

    // Without the manager in the equation the same day is out by 200,000.
    const withoutManager = day({ ownerOut: 100_000 });
    expect(withoutManager.unassigned).toBe(400_000);
  });

  it('keeps the identity the close screen relies on', () => {
    // expectedInDrawer === assigned + unassigned, always. A claim has to keep it
    // true, or the "Close the day" maths stops meaning anything.
    const result = day({ ownerOut: 100_000, managerOut: 200_000, countedCash: 500_000 });
    expect(result.expectedInDrawer).toBe(result.assigned + result.unassigned);
    expect(result.unassigned).toBe(200_000);
    // The count happens before the handover, so the full amount is expected.
    expect(result.variance).toBe(0);
  });

  it('an over-claim is still visible as over-moved, not quietly absorbed', () => {
    const result = day({ managerOut: 600_000 });
    expect(result.unassigned).toBeLessThan(0);
    expect(result.status).toBe('over-moved');
  });

  it('float is still the phone line', () => {
    const result = day({ floatOut: 120_000, managerOut: 0 });
    expect(result.assigned).toBe(120_000);
  });
});
