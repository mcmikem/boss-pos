import type { Product, Supplier, SupplierPrice } from '../types';

// Normalize a Ugandan phone number to wa.me-ready digits (256XXXXXXXXX).
// Returns '' when nothing usable remains — never invent digits.
export function normalizeUgPhone(phone: string | undefined | null): string {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('256')) return d;
  if (d.length === 10 && d.startsWith('0')) return `256${d.slice(1)}`;
  if (d.length === 9) return `256${d}`;
  if (d.length === 13 && d.startsWith('0256')) return d.slice(1);
  return '';
}

export function supplierWhatsAppUrl(phone: string | undefined | null, text: string): string | null {
  const digits = normalizeUgPhone(phone);
  if (digits.length < 12) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function supplierTelUrl(phone: string | undefined | null): string | null {
  const digits = normalizeUgPhone(phone);
  if (digits.length < 12) return null;
  return `tel:+${digits}`;
}

export function quotesForProduct(quotes: SupplierPrice[], productId: string): SupplierPrice[] {
  return quotes
    .filter((q) => q.productId === productId)
    .slice()
    .sort((a, b) => a.price - b.price);
}

export function bestQuoteFor(quotes: SupplierPrice[], productId: string): SupplierPrice | null {
  const list = quotesForProduct(quotes, productId);
  return list.length ? list[0] : null;
}

// How much to suggest reordering: refill to twice the low-stock threshold.
export function restockQtyFor(product: Product): number {
  if (product.isService) return 0;
  const threshold = product.lowStockThreshold || 5;
  return Math.max(threshold * 2 - Math.max(0, product.stockQty), 1);
}

export function buildRestockMessage(
  shopName: string,
  supplierName: string,
  items: { name: string; qty: number }[],
): string {
  const lines = items.map((i) => `- ${i.name} x${i.qty}`).join('\n');
  return `Hello ${supplierName}! Restock order from ${shopName}:\n${lines}\nPlease confirm availability and total. Thank you!`;
}

export function supplierName(suppliers: Supplier[], id: string | undefined): string {
  if (!id) return '';
  return suppliers.find((s) => s.id === id)?.name || '';
}
