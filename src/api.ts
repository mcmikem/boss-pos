import { Product, Supplier, Sale, Expense, StoreSettings, CreditPayment, TailoringOrder, DesignOrder, CashTransfer, CreditEat, ProductionRegister, WastageLog, MomoTransfer } from './types';

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

// Replay queued offline writes. Returns how many were flushed. On auth errors
// the entry is kept so offline work is never silently lost — an expired token
// is re-issued on the next online unlock, and the flush will then succeed.
// 404 responses count as flushed: the server DELETEs are idempotent now, and a
// 404 from an already-drained replay must not wedge the outbox forever.
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
      if (res.ok || res.status === 404) {
        flushed++;
        continue;
      }
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
export async function authVerify(pin: string): Promise<{ token: string; hasPin: boolean; hash?: string }> {
  const res = await fetch(`${BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Auth failed');
  setAuthToken(data.token);
  // Persist the verified hash so a later unlock still works offline.
  if (data.hash) {
    try { localStorage.setItem('boss_pos_pin', data.hash); } catch {}
  }
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
      // Keep the local offline fallback counter in sync so a later offline
      // sale can't hand out a number the server will already have used.
      if (data.number) {
        try { localStorage.setItem('boss_pos_order_counter', String(data.number)); } catch {}
      }
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
  const hit = getCacheMeta<T>(path);
  return hit ? hit.data : null;
}

// Returns cached data even after its TTL (stale) so slow/offline networks can
// always render last-known data. The caller decides whether to revalidate.
function getCacheMeta<T>(path: string): { data: T; expired: boolean } | null {
  try {
    const raw = localStorage.getItem(cacheKey(path));
    if (!raw) return null;
    const { data, expiry } = JSON.parse(raw);
    return { data: data as T, expired: Date.now() > expiry };
  } catch {
    return null;
  }
}

// Dedupe concurrent background refreshes per path.
const inFlightRefresh = new Set<string>();
function refreshInBackground(path: string, ttlMs?: number): void {
  if (inFlightRefresh.has(path)) return;
  inFlightRefresh.add(path);
  fetch(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json', Authorization: getAuthHeader() } })
    .then(res => {
      if (!res.ok) return;
      return res.json().then(data => setCache(path, data, ttlMs)).catch(() => {});
    })
    .catch(() => {})
    .finally(() => inFlightRefresh.delete(path));
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
    // Writes invalidate the matching list AND the combined /api/boot blob, so
    // a later offline boot never shows data that contradicts what was saved.
    if (key.includes(basePath) || key.includes('/api/boot')) {
      localStorage.removeItem(key);
      keys.delete(key);
    }
  }
  saveCacheKeys(keys);
}

async function api<T>(path: string, options?: RequestInit & { fresh?: boolean; store?: boolean | number }): Promise<T> {
  const isRead = !options || !options.method || options.method === 'GET';

  if (isRead) {
    const hit = getCacheMeta<T>(path);
    if (hit) {
      // Expired: serve the stale copy immediately and refresh in the background
      // so slow/3G networks never wait on the network for data we already have.
      if (hit.expired) {
        refreshInBackground(path, typeof options?.store === 'number' ? options.store : undefined);
        return hit.data;
      }
      // Fresh cache: no network round-trip at all.
      if (!options?.fresh) return hit.data;
    } else if (!navigator.onLine) {
      throw new Error('Offline and no cached data');
    }
  }

  // Idempotency: attach a stable client_write_id to every create/update body so
  // an offline outbox replay can't double-insert a sale/expense/etc. The same
  // id rides along when the request is queued, so the server can dedupe it.
  if (!isRead && options?.method && (options.method === 'POST' || options.method === 'PUT')) {
    let parsed: Record<string, unknown> = {};
    try { parsed = (options.body as string) ? JSON.parse(options.body as string) : {}; } catch {}
    if (!parsed.clientWriteId) parsed.clientWriteId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    options = { ...options, body: JSON.stringify(parsed) };
  }

  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', Authorization: getAuthHeader() },
      ...options,
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json();

    if (isRead) {
      if (!options || !options.fresh || options.store) {
        const ttl = typeof options?.store === 'number' ? options.store : undefined;
        setCache(path, data, ttl);
      }
    }

    if (!isRead) {
      clearRelatedCaches(path);
    }

    return data;
  } catch (err) {
    if (isRead) {
      // Any network/server failure (flaky 3G, dropped WiFi, expired token)
      // falls back to last-known data instead of erroring out.
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

export const designOrderApi = {
  list: () => api<DesignOrder[]>('/api/design-orders'),
  create: (o: DesignOrder) => api<DesignOrder>('/api/design-orders', { method: 'POST', body: JSON.stringify(o) }),
  update: (o: DesignOrder) => api<DesignOrder>(`/api/design-orders/${o.id}`, { method: 'PUT', body: JSON.stringify(o) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/design-orders/${id}`, { method: 'DELETE' }),
};

export const creditEatApi = {
  list: () => api<CreditEat[]>('/api/credit-eats'),
  create: (e: CreditEat) => api<CreditEat>('/api/credit-eats', { method: 'POST', body: JSON.stringify(e) }),
  pay: (id: string, amount: number) => api<CreditEat>(`/api/credit-eats/${id}/pay`, { method: 'POST', body: JSON.stringify({ amount }) }),
};

export const productionRegisterApi = {
  list: () => api<ProductionRegister[]>('/api/production-register'),
  create: (p: ProductionRegister) => api<ProductionRegister>('/api/production-register', { method: 'POST', body: JSON.stringify(p) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/production-register/${id}`, { method: 'DELETE' }),
};

export const wastageLogApi = {
  list: () => api<WastageLog[]>('/api/wastage-log'),
  create: (w: WastageLog) => api<WastageLog>('/api/wastage-log', { method: 'POST', body: JSON.stringify(w) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/wastage-log/${id}`, { method: 'DELETE' }),
};

export const momoTransferApi = {
  list: () => api<MomoTransfer[]>('/api/momo-transfers'),
  create: (t: MomoTransfer) => api<MomoTransfer>('/api/momo-transfers', { method: 'POST', body: JSON.stringify(t) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/momo-transfers/${id}`, { method: 'DELETE' }),
};

export const settingsApi = {
  get: () => api<StoreSettings>('/api/settings', { fresh: true, store: 24 * 60 * 60 * 1000 }),
  update: (s: StoreSettings) => api<{ success: boolean }>('/api/settings', { method: 'PUT', body: JSON.stringify(s) }),
};

export interface BootData {
  products: Product[];
  suppliers: Supplier[];
  sales: Sale[];
  expenses: Expense[];
  creditPayments: CreditPayment[];
  creditEats: CreditEat[];
  productionRegisters: ProductionRegister[];
  wastageLogs: WastageLog[];
  momoTransfers: MomoTransfer[];
  settings: StoreSettings;
}

// One round-trip boots the whole till on 3G instead of 10 serialized requests.
// fresh:true means online boots always revalidate; on failure the SWR read path
// serves the cached boot blob so offline reloads still work.
export const bootApi = {
  get: () => api<BootData>('/api/boot', { fresh: true, store: 24 * 60 * 60 * 1000 }),
};

// Seed individual list caches from a boot payload so per-endpoint reads (e.g.
// after a write invalidated the boot blob) still hit warm caches offline.
export function primeCache(path: string, data: unknown, ttlMs = 24 * 60 * 60 * 1000): void {
  setCache(path, data, ttlMs);
}

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

export const restoreApi = {
  restore: (data: Record<string, unknown>) => api<{ success: boolean; restored: Record<string, number> }>('/api/restore', { method: 'POST', body: JSON.stringify(data) }),
};
