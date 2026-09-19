import type { Product, SaleItem } from '../types';

// Expected live price for a cart line: the variant's price when the line was
// added from a variant, otherwise the base product price. A line whose
// product (or variant) no longer exists — deleted mid-sale, stale offline
// cache — keeps its snapped price instead of being zeroed or "corrected".
export function expectedLinePrice(item: SaleItem, products: Product[]): number | null {
  const live = products.find((p) => p.id === item.productId);
  if (!live) return null;
  if (item.variantId) {
    const v = live.variants?.find((vv) => vv.id === item.variantId);
    if (!v) return null;
    return v.price;
  }
  return live.price;
}

// Reconcile cart lines against current catalog pricing (e.g. another till
// changed a price mid-sale). Variant-aware: a chapati line priced from its
// variant must never be "corrected" down to the base product price.
// Per-line discounts survive repricing (clamped to the new gross).
export function reconcileCartPrices(
  cart: SaleItem[],
  products: Product[],
): { cart: SaleItem[]; changed: boolean } {
  let changed = false;
  const next = cart.map((item) => {
    const want = expectedLinePrice(item, products);
    if (want === null || want === item.unitPrice) return item;
    changed = true;
    const disc = Math.min(Math.max(0, item.lineDiscount || 0), want * item.qty);
    return { ...item, unitPrice: want, lineDiscount: disc, lineTotal: Math.max(0, Math.round(want * item.qty - disc)) };
  });
  return { cart: changed ? next : cart, changed };
}
