import { describe, expect, it } from 'vitest';
import { computeKeptItems, scaleKept } from './returns';
import type { SaleItem } from '../types';

const line = (over: Partial<SaleItem> = {}): SaleItem => ({
  productId: 'p1',
  productName: 'Chapati',
  qty: 3,
  unitPrice: 1000,
  unitCost: 400,
  lineTotal: 3000,
  ...over,
});

describe('computeKeptItems', () => {
  it('removes returned qty and scales the line discount', () => {
    const kept = computeKeptItems(
      [line({ qty: 3, unitPrice: 1000, lineTotal: 3000, lineDiscount: 300 })],
      [{ productId: 'p1', qty: 1 }],
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].qty).toBe(2);
    expect(kept[0].lineDiscount).toBe(200);
    expect(kept[0].lineTotal).toBe(1800);
  });

  it('drops fully returned lines and clamps over-returns', () => {
    const kept = computeKeptItems(
      [line({ qty: 2, unitPrice: 1000, lineTotal: 2000 }), line({ productId: 'p2', productName: 'Soda', qty: 1, unitPrice: 2000, unitCost: 1200, lineTotal: 2000 })],
      [
        { productId: 'p1', qty: 9 },
        { productId: 'p2', qty: 0 },
        { productId: 'ghost', qty: 5 },
      ],
    );
    expect(kept.map((k) => k.productId)).toEqual(['p2']);
  });

  it('matches variant lines exactly', () => {
    const kept = computeKeptItems(
      [
        line({ variantId: 'v-small', variantLabel: 'Single', qty: 2, unitPrice: 500, lineTotal: 1000 }),
        line({ variantId: 'v-big', variantLabel: 'Couple', qty: 2, unitPrice: 900, lineTotal: 1800 }),
      ],
      [{ productId: 'p1', variantId: 'v-big', qty: 1 }],
    );
    expect(kept).toHaveLength(2);
    expect(kept.find((k) => k.variantId === 'v-big')?.qty).toBe(1);
    expect(kept.find((k) => k.variantId === 'v-small')?.qty).toBe(2);
  });
});

describe('scaleKept', () => {
  it('scales proportionally and guards zeros', () => {
    expect(scaleKept(1000, 2000, 4000)).toBe(500);
    expect(scaleKept(1000, 0, 4000)).toBe(0);
    expect(scaleKept(1000, 2000, 0)).toBe(0);
  });
});
