import { Product, Supplier, Sale, Expense, StoreSettings, CreditPayment, TailoringOrder } from './types';

const BASE = '';
const CACHE_PREFIX = 'boss_api_cache_';
const CACHE_INDEX_KEY = 'boss_api_cache_keys';

function cacheKey(path: string): string {
  return `${CACHE_PREFIX}${path}`;
}

function getCacheKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(CACHE_INDEX_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveCacheKeys(keys: Set<string>): void {
  try {
    localStorage.setItem(CACHE_INDEX_KEY, JSON.stringify([...keys]));
  } catch {}
}

function getCache<T>(path: string): T | null {
  try {
    const raw = localStorage.getItem(cacheKey(path));
    if (!raw) return null;
    const { data, expiry } = JSON.parse(raw);
    if (Date.now() > expiry) {
      localStorage.removeItem(cacheKey(path));
      const keys = getCacheKeys();
      keys.delete(cacheKey(path));
      saveCacheKeys(keys);
      return null;
    }
    return data as T;
  } catch {
    return null;
  }
}

function setCache<T>(path: string, data: T, ttlMs = 5 * 60 * 1000): void {
  try {
    const key = cacheKey(path);
    localStorage.setItem(key, JSON.stringify({ data, expiry: Date.now() + ttlMs }));
    const keys = getCacheKeys();
    keys.add(key);
    saveCacheKeys(keys);
  } catch {}
}

function clearRelatedCaches(path: string): void {
  const basePath = path.split('/').slice(0, 3).join('/');
  const keys = getCacheKeys();
  for (const key of keys) {
    if (key.includes(basePath)) {
      localStorage.removeItem(key);
      keys.delete(key);
    }
  }
  saveCacheKeys(keys);
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const isRead = !options || !options.method || options.method === 'GET';

  if (isRead) {
    const cached = getCache<T>(path);
    if (cached) return cached;
  }

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

    if (isRead) setCache(path, data);

    if (!isRead) {
      clearRelatedCaches(path);
    }

    return data;
  } catch (err) {
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

export const creditPaymentApi = {
  list: () => api<CreditPayment[]>('/api/credit-payments'),
  create: (p: CreditPayment) => api<CreditPayment>('/api/credit-payments', { method: 'POST', body: JSON.stringify(p) }),
};

export const tailoringOrderApi = {
  list: () => api<TailoringOrder[]>('/api/tailoring-orders'),
  create: (o: TailoringOrder) => api<TailoringOrder>('/api/tailoring-orders', { method: 'POST', body: JSON.stringify(o) }),
  update: (o: TailoringOrder) => api<TailoringOrder>(`/api/tailoring-orders/${o.id}`, { method: 'PUT', body: JSON.stringify(o) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/tailoring-orders/${id}`, { method: 'DELETE' }),
};

export const settingsApi = {
  get: () => api<StoreSettings>('/api/settings'),
  update: (s: StoreSettings) => api<{ success: boolean }>('/api/settings', { method: 'PUT', body: JSON.stringify(s) }),
};
