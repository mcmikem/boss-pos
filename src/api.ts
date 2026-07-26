import { Product, Supplier, Sale, Expense, StoreSettings } from './types';

const BASE = '';
const CACHE_PREFIX = 'boss_api_cache_';

function cacheKey(path: string): string {
  return `${CACHE_PREFIX}${path}`;
}

function getCache<T>(path: string): T | null {
  try {
    const raw = localStorage.getItem(cacheKey(path));
    if (!raw) return null;
    const { data, expiry } = JSON.parse(raw);
    if (Date.now() > expiry) {
      localStorage.removeItem(cacheKey(path));
      return null;
    }
    return data as T;
  } catch {
    return null;
  }
}

function setCache<T>(path: string, data: T, ttlMs = 5 * 60 * 1000): void {
  try {
    localStorage.setItem(cacheKey(path), JSON.stringify({ data, expiry: Date.now() + ttlMs }));
  } catch {}
}

function clearCache(path: string): void {
  try { localStorage.removeItem(cacheKey(path)); } catch {}
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  // For GET requests, try cache first
  const isRead = !options || !options.method || options.method === 'GET';

  if (isRead) {
    const cached = getCache<T>(path);
    if (cached) return cached;
  }

  // If offline, return cache for reads
  if (isRead && !navigator.onLine) {
    const cached = getCache<T>(path);
    if (cached) return cached;
    throw new Error('Offline and no cached data');
  }

  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json();

    // Cache successful reads
    if (isRead) setCache(path, data);

    // Clear cache for mutations
    if (!isRead) {
      // Clear all related caches
      const basePath = path.split('/').slice(0, 3).join('/');
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(CACHE_PREFIX) && key.includes(basePath)) {
          localStorage.removeItem(key);
        }
      }
    }

    return data;
  } catch (err) {
    // On network error, try cache for reads
    if (isRead) {
      const cached = getCache<T>(path);
      if (cached) return cached;
    }
    throw err;
  }
}

export const productApi = {
  list: () => api<Product[]>('/api/products'),
  create: (p: Product) => api<Product>('/api/products', { method: 'POST', body: JSON.stringify(p) }),
  update: (p: Product) => api<Product>(`/api/products/${p.id}`, { method: 'PUT', body: JSON.stringify(p) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/products/${id}`, { method: 'DELETE' }),
};

export const supplierApi = {
  list: () => api<Supplier[]>('/api/suppliers'),
  create: (s: Supplier) => api<Supplier>('/api/suppliers', { method: 'POST', body: JSON.stringify(s) }),
  update: (s: Supplier) => api<Supplier>(`/api/suppliers/${s.id}`, { method: 'PUT', body: JSON.stringify(s) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/suppliers/${id}`, { method: 'DELETE' }),
};

export const saleApi = {
  list: () => api<Sale[]>('/api/sales'),
  create: (s: Sale) => api<Sale>('/api/sales', { method: 'POST', body: JSON.stringify(s) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/sales/${id}`, { method: 'DELETE' }),
};

export const expenseApi = {
  list: () => api<Expense[]>('/api/expenses'),
  create: (e: Expense) => api<Expense>('/api/expenses', { method: 'POST', body: JSON.stringify(e) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/expenses/${id}`, { method: 'DELETE' }),
};

export const settingsApi = {
  get: () => api<StoreSettings>('/api/settings'),
  update: (s: StoreSettings) => api<{ success: boolean }>('/api/settings', { method: 'PUT', body: JSON.stringify(s) }),
};
