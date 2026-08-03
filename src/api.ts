import { Product, Supplier, Sale, Expense, StoreSettings, CreditPayment, TailoringOrder, CashTransfer } from './types';

const BASE = '';
const CACHE_PREFIX = 'boss_api_cache_';
const CACHE_INDEX_KEY = 'boss_api_cache_keys';
const TOKEN_KEY = 'boss_pos_token';
const OUTBOX_KEY = 'boss_pos_outbox';

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

function getAuthHeader(): string {
  const t = getAuthToken();
  return t ? `Bearer ${t}` : '';
}

interface OutboxEntry {
  id: string;
  path: string;
  method: string;
  body: string;
  queuedAt: number;
}

function getOutbox(): OutboxEntry[] {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveOutbox(entries: OutboxEntry[]): void {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries));
  } catch {}
}

function enqueue(path: string, method: string, body: string): void {
  const entry: OutboxEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    path,
    method,
    body,
    queuedAt: Date.now(),
  };
  const list = getOutbox();
  list.push(entry);
  saveOutbox(list);
}

export function outboxCount(): number {
  return getOutbox().length;
}

// Replay queued offline writes. Returns how many were flushed. Auth errors
// (expired token) drop the entry rather than retrying forever.
export async function flushOutbox(): Promise<number> {
  const list = getOutbox();
  if (list.length === 0) return 0;
  let flushed = 0;
  const remaining: OutboxEntry[] = [];
  for (const entry of list) {
    try {
      const res = await fetch(`${BASE}${entry.path}`, {
        method: entry.method,
        headers: { 'Content-Type': 'application/json', Authorization: getAuthHeader() },
        body: entry.body,
      });
      if (res.ok) {
        flushed++;
        continue;
      }
      if (res.status === 401 || res.status === 403) continue;
      remaining.push(entry);
    } catch {
      remaining.push(entry);
    }
  }
  saveOutbox(remaining);
  if (flushed > 0) clearRelatedCaches('/api');
  return flushed;
}

// Server-side PIN auth (plain PIN over HTTPS; hashing happens on the server).
export async function authVerify(pin: string): Promise<{ token: string; hasPin: boolean }> {
  const res = await fetch(`${BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Auth failed');
  setAuthToken(data.token);
  return data;
}

// Public pre-auth status: shop name + whether a PIN is set. Safe to call
// before unlock because it exposes no financial data.
export async function authStatus(): Promise<{ shopName: string; hasPin: boolean }> {
  const res = await fetch(`${BASE}/api/auth/status`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Status failed');
  return { shopName: data.shopName || '', hasPin: !!data.hasPin };
}

export async function authSetPin(pin: string): Promise<{ hasPin: boolean; hash: string }> {
  const res = await fetch(`${BASE}/api/auth/set`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: getAuthHeader() },
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) throw new Error('Failed to save PIN');
  return res.json();
}

// Migrate an existing client-side SHA-256 pin hash so users keep their PIN.
export async function authMigratePin(hash: string): Promise<boolean> {
  const res = await fetch(`${BASE}/api/auth/set`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: getAuthHeader() },
    body: JSON.stringify({ hash }),
  });
  if (!res.ok) throw new Error('Failed to migrate PIN');
  return true;
}

export async function nextOrderNumber(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/orders/next`, {
      method: 'POST',
      headers: { Authorization: getAuthHeader() },
    });
    if (res.ok) {
      const data = await res.json();
      return data.orderNumber || null;
    }
  } catch {}
  return null;
}

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

async function api<T>(path: string, options?: RequestInit & { fresh?: boolean }): Promise<T> {
  const isRead = !options || !options.method || options.method === 'GET';

  if (isRead && !options?.fresh) {
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
      headers: { 'Content-Type': 'application/json', Authorization: getAuthHeader() },
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
      throw err;
    }
    // Offline / network failure: queue the write and treat it as done so the
    // optimistic UI state is kept. It replays when we're back online.
    const body = (options && (options.body as string)) || '';
    if (!navigator.onLine || err instanceof TypeError) {
      enqueue(path, options?.method || 'POST', body);
      try {
        return JSON.parse(body) as T;
      } catch {
        return { success: true } as T;
      }
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
  refund: (id: string) => api<{ success: boolean }>(`/api/sales/${id}/refund`, { method: 'POST' }),
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

export const cashTransferApi = {
  list: () => api<CashTransfer[]>('/api/cash-transfers'),
  create: (t: CashTransfer) => api<CashTransfer>('/api/cash-transfers', { method: 'POST', body: JSON.stringify(t) }),
  settle: (id: string) => api<{ success: boolean }>(`/api/cash-transfers/${id}/settle`, { method: 'PUT' }),
};

export const tailoringOrderApi = {
  list: () => api<TailoringOrder[]>('/api/tailoring-orders'),
  create: (o: TailoringOrder) => api<TailoringOrder>('/api/tailoring-orders', { method: 'POST', body: JSON.stringify(o) }),
  update: (o: TailoringOrder) => api<TailoringOrder>(`/api/tailoring-orders/${o.id}`, { method: 'PUT', body: JSON.stringify(o) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/tailoring-orders/${id}`, { method: 'DELETE' }),
};

export const settingsApi = {
  get: () => api<StoreSettings>('/api/settings', { fresh: true }),
  update: (s: StoreSettings) => api<{ success: boolean }>('/api/settings', { method: 'PUT', body: JSON.stringify(s) }),
};

export const summaryApi = {
  list: (from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    const q = qs.toString();
    return api<{
      from: string | null;
      to: string | null;
      salesCount: number;
      revenue: number;
      cogs: number;
      grossProfit: number;
      expenseTotal: number;
      netProfit: number;
      creditOutstanding: number;
      lowStockCount: number;
    }>(`/api/summary${q ? `?${q}` : ''}`);
  },
};

export const exportApi = {
  download: () => api<Record<string, unknown>>('/api/export', { fresh: true }),
};
