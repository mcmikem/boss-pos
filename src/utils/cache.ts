import type { Product } from '../types';

const CACHE_VERSION = 'v2';
const CACHE_KEY = `boss_pos_products_cache_${CACHE_VERSION}`;
const CACHE_TIMESTAMP_KEY = `boss_pos_products_cache_ts_${CACHE_VERSION}`;
const CACHE_TTL = 1000 * 60 * 30;

export function saveProducts(products: Product[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(products));
    localStorage.setItem(CACHE_TIMESTAMP_KEY, String(Date.now()));
  } catch {
    if (products.length > 0) {
      const blob = new Blob([JSON.stringify(products)], { type: 'application/json' });
      if (blob.size > 4_500_000) {
        const compressed = products.map(p => ({
          ...p,
          imageUrl: p.imageUrl && p.imageUrl.length > 50_000
            ? p.imageUrl.slice(0, 50_000)
            : p.imageUrl || ''
        }));
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(compressed)); } catch {}
      }
    }
  }
}

export function loadProducts(): Product[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const ts = localStorage.getItem(CACHE_TIMESTAMP_KEY);
    if (!raw || !ts) return null;
    if (Date.now() - Number(ts) > CACHE_TTL) {
      return null;
    }
    return JSON.parse(raw) as Product[];
  } catch {
    return null;
  }
}

export function clearProductsCache(): void {
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(CACHE_TIMESTAMP_KEY);
}