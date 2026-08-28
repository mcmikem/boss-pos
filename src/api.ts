import { Product, Supplier, Sale, Expense, StoreSettings, CreditPayment, TailoringOrder, DesignOrder, CashTransfer, CreditEat, ProductionRegister, WastageLog, MomoTransfer } from './types';

const BASE = '';
const CACHE_PREFIX = 'boss_api_cache_';
const CACHE_INDEX_KEY = 'boss_api_cache_keys';
const TOKEN_KEY = 'boss_pos_token';
const OUTBOX_KEY = 'boss_pos_outbox';

// Bounded fetch: dead WiFi / no-internet Android WebViews can hang a plain
// fetch() for minutes (navigator.onLine lies on old devices). Reject after
// `ms` so callers fall through to cached data / offline mode quickly.
// Cold Neon DBs need 10-12s to wake, so writes use 30s — otherwise the first
// save after idle always timed out and showed "Failed to save" on every till.
function fetchTimeout(url: string, options: RequestInit, ms: number): Promise<Response> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new TypeError('Network timeout')), ms);
    fetch(url, options).then(
      (res) => { window.clearTimeout(timer); resolve(res); },
      (err) => { window.clearTimeout(timer); reject(err); },
    );
  });
}
const WRITE_TIMEOUT_MS = 30000;
const READ_TIMEOUT_MS = 15000;

// Error that carries the HTTP status + server error code so callers can react
// to specific failures (e.g. 409 CONFLICT from multi-device product edits).
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// Stable per-device id + monotonic write sequence. Every write body carries
// them, and clientWriteId is derived from them, so an offline outbox replay is
// deterministic per device and can never collide with another device's id.
function getDeviceId(): string {
  try {
    let id = localStorage.getItem('boss_pos_device_id');
    if (!id) {
      id = `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem('boss_pos_device_id', id);
    }
    return id;
  } catch {
    return 'd-unknown';
  }
}

function nextWriteSeq(): number {
  try {
    const raw = parseInt(localStorage.getItem('boss_pos_write_seq') || '0', 10);
    const next = raw + 1;
    localStorage.setItem('boss_pos_write_seq', String(next));
    return next;
  } catch {
    return Math.floor(Math.random() * 1e9);
  }
}

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

// Read a cache entry without any network (used by the boot path so the lock
// screen / offline render can show last-known data instantly).
export function readCached<T>(path: string): T | null {
  return getCache<T>(path);
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
  deviceId?: string;
  seq?: number;
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
    try { window.dispatchEvent(new Event('boss-pos-outbox-updated')); } catch {}
  } catch {}
  // Mirror to IndexedDB async (bypasses 5MB quota) — fire-and-forget
  import('./utils/outboxIdb').then(m => m.idbOutboxSet(JSON.stringify(entries)).catch(()=>{})).catch(()=>{});
}

function enqueue(path: string, method: string, body: string): void {
  const entry: OutboxEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    path,
    method,
    body,
    queuedAt: Date.now(),
    deviceId: getDeviceId(),
    seq: nextWriteSeq(),
  };
  const list = getOutbox();
  list.push(entry);
  saveOutbox(list);
}

export function outboxCount(): number {
  return getOutbox().length;
}

export async function outboxCountAsync(): Promise<number> {
  try {
    const m = await import('./utils/outboxIdb');
    return await m.idbOutboxCount();
  } catch { return outboxCount(); }
}

// Replay queued offline writes. Returns how many were flushed. On auth errors
// the entry is kept so offline work is never silently lost — an expired token
// is re-issued on the next online unlock, and the flush will then succeed.
// 404 responses count as flushed: the server DELETEs are idempotent now, and a
// 404 from an already-drained replay must not wedge the outbox forever.
// A 409 CONFLICT (a product edit that lost the race to a newer edit on another
// device) is also dropped — retrying forever can't change the outcome, and the
// newest version already won on the server. The caller is told so it can warn.
export function peekOutbox(): OutboxEntry[] {
  return getOutbox();
}

export async function peekOutboxAsync(): Promise<OutboxEntry[]> {
  try {
    const m = await import('./utils/outboxIdb');
    const j = await m.idbOutboxGet();
    return JSON.parse(j);
  } catch { return getOutbox(); }
}

export function clearOutbox(): void {
  saveOutbox([]);
  import('./utils/outboxIdb').then(m => m.idbOutboxSet('[]').catch(()=>{})).catch(()=>{});
}

export async function flushOutbox(): Promise<number> {
  // Prefer IndexedDB (quota-free) if available, else LS
  let list: OutboxEntry[] = getOutbox();
  try {
    const m = await import('./utils/outboxIdb');
    const j = await m.idbOutboxGet();
    const idbList = JSON.parse(j) as OutboxEntry[];
    if (idbList.length > list.length) list = idbList;
    else if (idbList.length === list.length && idbList.length > 0) list = idbList;
  } catch {}
  if (list.length === 0) return 0;
  // If there's no token (expired/cleared), don't burn through the queue with 401s — let the UI re-lock first.
  if (!getAuthToken()) {
    return 0;
  }
  let flushed = 0;
  let conflicts = 0;
  let dropped = 0;
  let sawAuthFailure = false;
  let sawNetworkFailure = false;
  const remaining: OutboxEntry[] = [];
  for (let idx = 0; idx < list.length; idx++) {
    const entry = list[idx];
    try {
      const res = await fetchTimeout(`${BASE}${entry.path}`, {
        method: entry.method,
        headers: { 'Content-Type': 'application/json', Authorization: getAuthHeader() },
        body: entry.body,
      }, WRITE_TIMEOUT_MS);
      if (res.ok || res.status === 404) {
        flushed++;
        continue;
      }
      if (res.status === 401) {
        sawAuthFailure = true;
        remaining.push(entry);
        continue;
      }
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        if (body.code === 'CONFLICT') {
          conflicts++;
          flushed++;
          continue;
        }
        if (body.code === 'INSUFFICIENT_STOCK') {
          // Stock race lost offline — retrying can't create stock. Drop and warn.
          dropped++;
          flushed++;
          continue;
        }
      }
      // Permanent client errors (except 401/429) never succeed on retry — drop to avoid infinite queue.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        await res.json().catch(() => ({}));
        dropped++;
        flushed++;
        continue;
      }
      remaining.push(entry);
    } catch (err) {
      // Network timeout / offline: don't burn 30s per remaining entry — keep the rest as-is.
      const isNetwork = err instanceof TypeError;
      remaining.push(entry);
      if (isNetwork) {
        sawNetworkFailure = true;
        // Keep every not-yet-tried entry too.
        for (let j = idx + 1; j < list.length; j++) remaining.push(list[j]);
        break;
      }
    }
  }
  saveOutbox(remaining);
  if (sawAuthFailure) {
    setAuthToken(null);
    try { window.dispatchEvent(new Event('boss-pos-auth-revoked')); } catch {}
  }
  if (sawNetworkFailure) {
    try { window.dispatchEvent(new Event('boss-pos-sync-offline')); } catch {}
  }
  if (flushed > 0) clearRelatedCaches('/api');
  if (conflicts > 0) {
    try {
      window.dispatchEvent(new CustomEvent('boss-pos-sync-conflict', { detail: conflicts }));
    } catch {}
  }
  if (dropped > 0) {
    try {
      window.dispatchEvent(new CustomEvent('boss-pos-sync-dropped', { detail: dropped }));
    } catch {}
  }
  return flushed;
}

// Server-side PIN auth (plain PIN over HTTPS; hashing happens on the server).
export async function authVerify(pin: string): Promise<{ token: string; hasPin: boolean; hash?: string }> {
  const res = await fetchTimeout(`${BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  }, WRITE_TIMEOUT_MS);
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
  const res = await fetchTimeout(`${BASE}/api/auth/status`, {}, READ_TIMEOUT_MS);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Status failed');
  return { shopName: data.shopName || '', hasPin: !!data.hasPin };
}

export async function authSetPin(pin: string): Promise<{ hasPin: boolean; hash: string }> {
  const res = await fetchTimeout(`${BASE}/api/auth/set`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: getAuthHeader() },
    body: JSON.stringify({ pin }),
  }, WRITE_TIMEOUT_MS);
  if (!res.ok) throw new Error('Failed to save PIN');
  return res.json();
}

// Migrate an existing client-side SHA-256 pin hash so users keep their PIN.
export async function authMigratePin(hash: string): Promise<boolean> {
  const res = await fetchTimeout(`${BASE}/api/auth/set`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: getAuthHeader() },
    body: JSON.stringify({ hash }),
  }, WRITE_TIMEOUT_MS);
  if (!res.ok) throw new Error('Failed to migrate PIN');
  return true;
}

// Upload a photo to the server for server-side resizing (raw file bytes — no
// canvas, no createObjectURL, no Image decode, so the old-Android renderer
// never has to load a photo into memory and OOM the whole page). Uses
// XMLHttpRequest (not fetch): XHR uploading a large File is the battle-tested
// path on old WebViews, where fetch() with a Blob body has known crashers.
async function compressImageIfNeeded(file: File | Blob): Promise<Blob> {
  try {
    if (!file.type?.startsWith('image/') || file.size < 300_000) return file;
    const bitmap = await createImageBitmap(file as Blob).catch(() => null);
    if (!bitmap) return file;
    const max = 1024;
    let { width, height } = bitmap;
    if (width <= max && height <= max && file.size < 800_000) { bitmap.close?.(); return file; }
    const scale = Math.min(max / width, max / height, 1);
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close?.(); return file; }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob: Blob | null = await new Promise(res => canvas.toBlob(r => res(r), 'image/jpeg', 0.72));
    return blob && blob.size < file.size ? blob : file;
  } catch { return file; }
}

export function uploadImage(file: File | Blob): Promise<string> {
  return new Promise(async (resolve, reject) => {
    const toSend = await compressImageIfNeeded(file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/api/uploads`);
    xhr.setRequestHeader('Authorization', getAuthHeader());
    xhr.setRequestHeader('Content-Type', (toSend as File).type || file.type || 'application/octet-stream');
    const timer = window.setTimeout(() => {
      try { xhr.abort(); } catch {}
      reject(new ApiError('Upload timed out — try a smaller photo', 0));
    }, 45000);
    xhr.onload = () => {
      window.clearTimeout(timer);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (data.url) return resolve(data.url as string);
        } catch {}
        return reject(new ApiError('Unexpected upload response', xhr.status));
      }
      let message = `Upload failed (${xhr.status})`;
      let code: string | undefined;
      try {
        const data = JSON.parse(xhr.responseText) as { error?: string; code?: string };
        if (data.error) message = data.error;
        code = data.code;
      } catch {}
      reject(new ApiError(message, xhr.status, code));
    };
    xhr.onerror = () => {
      window.clearTimeout(timer);
      reject(new ApiError('Upload failed — check your connection', 0));
    };
    try {
      xhr.send(toSend);
    } catch (err) {
      window.clearTimeout(timer);
      reject(new ApiError('Upload failed — check your connection', 0));
    }
  });
}

// Bump the server token version -> every other device's token 401s immediately.
export async function revokeAllSessions(): Promise<boolean> {
  const res = await fetchTimeout(`${BASE}/api/auth/revoke-all`, {
    method: 'POST',
    headers: { Authorization: getAuthHeader() },
  }, WRITE_TIMEOUT_MS);
  if (!res.ok) throw new Error('Failed to log out all devices');
  setAuthToken(null);
  return true;
}

export async function nextOrderNumber(): Promise<string | null> {
  try {
    const res = await fetchTimeout(`${BASE}/api/orders/next`, {
      method: 'POST',
      headers: { Authorization: getAuthHeader() },
    }, WRITE_TIMEOUT_MS);
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
  fetchTimeout(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json', Authorization: getAuthHeader() } }, READ_TIMEOUT_MS)
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

  // Idempotency + write versioning: every create/update body carries a stable
  // client_write_id derived from (device, seq) so an offline outbox replay can't
  // double-insert and the write order is deterministic per device. The deviceId
  // rides along so the server could cross-device order later.
  if (!isRead && options?.method && (options.method === 'POST' || options.method === 'PUT')) {
    let parsed: Record<string, unknown> = {};
    try { parsed = (options.body as string) ? JSON.parse(options.body as string) : {}; } catch {}
    if (!parsed.clientWriteId) parsed.clientWriteId = `${getDeviceId()}:${nextWriteSeq()}`;
    parsed.deviceId = getDeviceId();
    options = { ...options, body: JSON.stringify(parsed) };
  }

  // Offline-first: if the device knows it's offline, queue immediately instead
  // of burning 30s on a fetch that will timeout and then queue anyway.
  if (!isRead && !navigator.onLine) {
    const body = (options && (options.body as string)) || '';
    enqueue(path, options?.method || 'POST', body);
    try {
      return JSON.parse(body) as T;
    } catch {
      return { success: true } as T;
    }
  }

  // Writes get 2 quick retries for transient 503/cold-start before queuing,
  // so a brief DB wake doesn't become an "unsynced" queue entry when the
  // server would have succeeded on the next try.
  try {
    const maxAttempts = isRead ? 1 : 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetchTimeout(`${BASE}${path}`, {
        headers: { 'Content-Type': 'application/json', Authorization: getAuthHeader() },
        ...options,
      }, isRead ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS);
      if (!res.ok) {
        let message = `API error: ${res.status}`;
        let code: string | undefined;
        try {
          const body = await res.json().catch(() => ({}));
          if (body.error) message = body.error;
          if (body.code) code = body.code;
        } catch {}
        if (res.status === 401 && path.startsWith('/api/') && getAuthToken()) {
          // Revoked/expired token: drop it and re-lock the till (outbox is kept —
          // it replays after the next online unlock mints a fresh token). Only
          // fires when a token was actually present — a wrong PIN on the lock
          // screen is also a 401 and must NOT be treated as a global revoke.
          setAuthToken(null);
          try { window.dispatchEvent(new Event('boss-pos-auth-revoked')); } catch {}
        }
        const transientStatus =
          res.status === 502 || res.status === 503 || res.status === 504 ||
          (res.status === 500 && /temporarily unavailable|Database temporarily/i.test(message));
        if (transientStatus && attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
          continue;
        }
        throw new ApiError(message, res.status, code);
      }
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
      lastErr = err;
      const isTransient =
        err instanceof TypeError ||
        (err instanceof ApiError &&
          (err.status === 502 || err.status === 503 || err.status === 504 ||
            (err.status === 500 && /temporarily unavailable|Database temporarily/i.test(err.message))));
      if (isTransient && attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
        continue;
      }
      // Not retryable or out of attempts — fall through to outer catch handling
      throw err;
    }
  }
  throw lastErr;
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
    // 503/502/504 (and our 500 transient) from a cold Neon DB are also
    // transient — queue them instead of showing "Failed to save" on every till.
    const body = (options && (options.body as string)) || '';
    const isTransientApiError =
      err instanceof ApiError &&
      (err.status === 502 ||
        err.status === 503 ||
        err.status === 504 ||
        (err.status === 500 && /temporarily unavailable|Database temporarily/i.test(err.message)));
    if (!navigator.onLine || err instanceof TypeError || isTransientApiError) {
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

// Real POST to the sheets test endpoint, bypassing api()'s offline-outbox
// fallback so a failed or bogus sheet URL surfaces as an error instead of a
// silent "success".
export const sheetsApi = {
  test: async () => {
    let res: Response;
    try {
      res = await fetchTimeout(`${BASE}/api/sheets/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: getAuthHeader() },
      }, WRITE_TIMEOUT_MS);
    } catch (err) {
      throw new ApiError(err instanceof Error ? err.message : 'Network error', 0);
    }
    let body: { success?: boolean; error?: string } = {};
    try { body = await res.json(); } catch {}
    if (!res.ok || !body.success) {
      throw new ApiError(body.error || `Sheet test failed (HTTP ${res.status})`, res.status);
    }
    return { success: true } as const;
  },
  status: () => api<{ configured: boolean; lastError: string | null; lastOkAt: string | null }>('/api/sheets/status', { store: 60 }),
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
  salesTruncated?: boolean;
  expensesTruncated?: boolean;
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

export interface SummaryResult {
  from: string | null;
  to: string | null;
  salesCount: number;
  revenue: number;
  designRevenue: number;
  designProfit: number;
  cogs: number;
  grossProfit: number;
  expenseTotal: number;
  netProfit: number;
  creditOutstanding: number;
  lowStockCount: number;
  hourly?: number[];
  daily?: { date: string; revenue: number }[];
}

export const summaryApi = {
  list: (from?: string, to?: string, bucket?: 'hourly' | 'daily') => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    if (bucket) qs.set('bucket', bucket);
    const q = qs.toString();
    return api<SummaryResult>(`/api/summary${q ? `?${q}` : ''}`);
  },
};

export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  detail: string;
}

export const auditApi = {
  list: (limit = 100) => api<AuditEntry[]>(`/api/audit?limit=${limit}`, { fresh: true }),
};

export const backupsApi = {
  latest: () => api<{ createdAt: string | null }>('/api/backups/latest', { fresh: true }),
  data: () => api<{ data: Record<string, unknown> | null }>('/api/backups/data', { fresh: true }),
  run: () => api<{ success: boolean }>('/api/backups/run', { method: 'POST' }),
};

export const reconcileApi = {
  check: () => api<{ salesChecked: number; totalMismatches: number; negativeStock: { id: string; name: string; qty: number }[]; dupOrderNumbers: { ordernumber: string; c: number }[] }>('/api/reconcile', { fresh: true }),
  fix: () => api<{ salesChecked: number; totalMismatches: number; totalFixes: number; negativeStock: { id: string; name: string; qty: number }[]; negativeFixed: number; dupOrderNumbers: { ordernumber: string; c: number }[] }>('/api/reconcile?fix=1', { method: 'POST' }),
};

export const exportApi = {
  download: () => api<Record<string, unknown>>('/api/export', { fresh: true }),
};

export const restoreApi = {
  restore: (data: Record<string, unknown>) => api<{ success: boolean; restored: Record<string, number> }>('/api/restore', { method: 'POST', body: JSON.stringify(data) }),
};
