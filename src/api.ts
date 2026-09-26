import { Product, Supplier, SupplierPrice, StaffMember, Sale, Expense, ExpenseItem, StoreSettings, CreditPayment, TailoringOrder, DesignOrder, Booking, RepairJob, CashTransfer, CreditEat, ProductionRegister, WastageLog, MomoTransfer, Quote, type CloseSummary, type ProductionPlanRecord } from './types';
export type { CloseSummary, ProductionPlanRecord };

export const productionPlanApi = {
  get: (date: string, category?: string, branch?: string) => {
    const q = new URLSearchParams({ date });
    if (category) q.set('category', category);
    if (branch !== undefined) q.set('branch', branch);
    return api<ProductionPlanRecord[]>(`/api/production-plans?${q.toString()}`, { fresh: true });
  },
  save: (body: {
    businessDate: string;
    category: string;
    branch?: string;
    lines: Array<{ productId: string; batchQty: number }>;
    overrideTotal?: number | null;
    note?: string;
    clientWriteId?: string;
  }) => api<ProductionPlanRecord & { duplicate?: boolean }>('/api/production-plans', { method: 'POST', body: JSON.stringify(withWriteId(body)) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/production-plans/${id}`, { method: 'DELETE' }),
};
import type { CustomerProfile } from './utils/customers';
import { stashSyncReview } from './utils/syncReview';

// Expense rows may carry `items` as a JSON string (server TEXT column) or as
// an array (optimistic echo / cache). Normalize to an array so receipts can
// always render the per-item breakdown.
export function normalizeExpenses(rows: unknown): Expense[] {
  const list = Array.isArray(rows) ? rows : [];
  return list.map((r) => {
    const e = r as Expense & { items?: unknown; staffname?: unknown; client_write_id?: unknown };
    let items: ExpenseItem[] | undefined;
    try {
      const raw = typeof e.items === 'string' && e.items ? JSON.parse(e.items) : e.items;
      if (Array.isArray(raw)) {
        const clean = raw.slice(0, 50).map((i) => ({
          name: String((i as ExpenseItem)?.name || '').slice(0, 120),
          amount: Math.max(0, Math.round((parseFloat(String((i as ExpenseItem)?.amount)) || 0) * 100) / 100),
        })).filter((i) => i.name);
        if (clean.length) items = clean;
      }
    } catch { /* legacy row without breakdown */ }
    // Server rows are snake_case (staffname); the till reads camelCase.
    const staffName = (e.staffName || (typeof e.staffname === 'string' ? e.staffname : '') || '').trim();
    const clientWriteId = e.clientWriteId || (typeof e.client_write_id === 'string' ? e.client_write_id : '');
    const out = { ...(e as Expense), ...(items ? { items } : {}), ...(staffName ? { staffName } : {}), ...(clientWriteId ? { clientWriteId } : {}) };
    return out;
  });
}

const BASE = '';
const CACHE_PREFIX = 'boss_api_cache_';
const CACHE_INDEX_KEY = 'boss_api_cache_keys';
const TOKEN_KEY = 'boss_pos_token';
// Staff identity (name + ROLE) lives in its own slot. The till PIN and the
// staff PIN are different credentials unlocking different things: the till
// PIN opens the device, the staff PIN says WHO is selling and grants a role.
// Sharing one slot meant the till unlock silently downgraded a logged-in
// manager to a plain till token, so every manager check started failing on a
// device that was obviously signed in as the manager.
const STAFF_TOKEN_KEY = 'boss_pos_staff_token';
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
const CONTROL_PATHS = new Set([
  '/api/export',
  '/api/export/with-credentials',
  '/api/restore',
  '/api/restore/preflight',
  '/api/backups/run',
  '/api/backups/data',
  '/api/backups/latest',
]);
const CONTROL_OFFLINE_MESSAGE = 'You are offline — backups and restores need a connection. Nothing was queued.';
const CONTROL_UNREACHABLE_MESSAGE = 'Could not reach the server — nothing was queued. Check the connection and try again.';

export function isControlPath(path: string): boolean {
  return CONTROL_PATHS.has(path);
}

function controlFailure(err: unknown): unknown {
  if (err instanceof ApiError && err.status > 0) return err;
  return new ApiError(CONTROL_UNREACHABLE_MESSAGE, 0, 'CONTROL_UNREACHABLE');
}

// Error that carries the HTTP status + server error code so callers can react
// to specific failures (e.g. 409 CONFLICT from multi-device product edits).
export class ApiError extends Error {
  status: number;
  code?: string;
  traceId?: string;
  constructor(message: string, status: number, code?: string, traceId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.traceId = traceId;
  }
}

function responseTraceId(res: unknown): string | undefined {
  try {
    const value = (res as { headers?: { get?: (name: string) => string | null } })?.headers?.get?.('X-Request-Id');
    return value ? String(value) : undefined;
  } catch {
    return undefined;
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

export function newClientWriteId(): string {
  return `${getDeviceId()}:${nextWriteSeq()}`;
}

function withWriteId<T extends object>(obj: T): T & { clientWriteId: string } {
  if ((obj as { clientWriteId?: unknown }).clientWriteId) return obj as T & { clientWriteId: string };
  return { ...obj, clientWriteId: newClientWriteId() };
}

let unlockGraceUntil = 0;

export function markUnlocked(): void {
  unlockGraceUntil = Date.now() + 25_000;
}

export function inUnlockGrace(): boolean {
  return Date.now() < unlockGraceUntil;
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

export function getStaffToken(): string | null {
  try {
    return localStorage.getItem(STAFF_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStaffToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(STAFF_TOKEN_KEY, token);
    else localStorage.removeItem(STAFF_TOKEN_KEY);
  } catch {}
}

export function clearAllTokens(): void {
  setAuthToken(null);
  setStaffToken(null);
}

// The staff token wins when present: it is the more specific credential and
// carries the role the server authorises against. A till token on its own is
// the legacy single-seller case.
function getAuthHeader(): string {
  const t = getStaffToken() || getAuthToken();
  return t ? `Bearer ${t}` : '';
}

// Auth-revoke signal: carries the endpoint (or reason) that triggered the
// lock so the UI can log *why* the till re-locked instead of a mystery loop.
// Listeners read (e as CustomEvent)?.detail?.path | .reason.
export function emitAuthRevoked(detail?: { path?: string; reason?: string }): void {
  try {
    window.dispatchEvent(new CustomEvent('boss-pos-auth-revoked', { detail: detail || {} }));
  } catch {}
}

export type WriteStatus = 'saved' | 'queued';

export interface WriteResult<T> {
  data: T;
  status: WriteStatus;
}

interface WriteMeta {
  status: WriteStatus;
}

export type OutboxSyncStatus = 'queued' | 'sending' | 'retrying' | 'blocked_auth' | 'synced' | 'failed';

export interface OutboxEntity {
  type: string;
  id?: string;
  label?: string;
  branch?: string;
  tillId?: string;
}

export interface OutboxEntry {
  id: string;
  path: string;
  method: string;
  body: string;
  queuedAt: number;
  deviceId?: string;
  seq?: number;
  status: OutboxSyncStatus;
  syncStatus?: OutboxSyncStatus;
  statusAt?: number;
  completedAt?: number;
  attempts?: number;
  lastError?: string;
  nextRetryAt?: number;
  entity?: OutboxEntity;
  entityType?: string;
  entityId?: string;
  entityLabel?: string;
  reviewKind?: 'conflict' | 'stock' | 'refused';
  reviewSummary?: string;
  reviewAt?: number;
}

export type OutboxSyncItem = OutboxEntry;
export type SyncItem = OutboxEntry;

export interface OutboxCounts {
  total: number;
  pending: number;
  queued: number;
  sending: number;
  retrying: number;
  blockedAuth: number;
  synced: number;
  failed: number;
}

export interface OutboxFlushReport {
  attempted: number;
  flushed: number;
  sent: number;
  salesQueued: number;
  salesSent: number;
  salesDropped: number;
  conflicts: number;
  dropped: number;
  reviewAdded: number;
  remaining: number;
  authFailed: boolean;
  networkFailed: boolean;
  counts?: OutboxCounts;
}

const OUTBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TERMINAL_ITEMS = 500;
const MAX_AUTO_ATTEMPTS = 5;
const SENDING_RECOVERY_MS = 2 * 60 * 1000;
const OUTBOX_STATUSES: OutboxSyncStatus[] = ['queued', 'sending', 'retrying', 'blocked_auth', 'synced', 'failed'];

function entityFor(path: string, method: string, body: string): OutboxEntity {
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(body || '{}') as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as Record<string, unknown>;
  } catch {}
  const segment = path.split('/').filter(Boolean)[1] || 'change';
  const type = segment.replace(/s$/, '') || 'change';
  const id = typeof parsed.id === 'string' && parsed.id
    ? parsed.id
    : typeof parsed.clientWriteId === 'string' ? parsed.clientWriteId : undefined;
  const label = typeof parsed.name === 'string' && parsed.name
    ? parsed.name
    : typeof parsed.description === 'string' && parsed.description
      ? parsed.description
      : typeof parsed.orderNumber === 'string' && parsed.orderNumber
        ? parsed.orderNumber
        : typeof parsed.customerName === 'string' && parsed.customerName
          ? parsed.customerName
          : undefined;
  let branch = typeof parsed.branch === 'string' ? parsed.branch : undefined;
  if (!branch) {
    try { branch = localStorage.getItem('boss_pos_branch') || undefined; } catch {}
  }
  let tillId: string | undefined;
  try { tillId = localStorage.getItem('boss_pos_till_id') || localStorage.getItem('boss_pos_device_id') || undefined; } catch {}
  return { type, id, label, branch, tillId, method } as OutboxEntity & { method: string };
}

function normalizeOutboxEntry(value: unknown): OutboxEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !row.id || typeof row.path !== 'string' || typeof row.method !== 'string') return null;
  const body = typeof row.body === 'string' ? row.body : (() => {
    try { return JSON.stringify(row.body ?? {}); } catch { return '{}'; }
  })();
  const statusValue = row.status ?? row.syncStatus;
  const status = OUTBOX_STATUSES.includes(statusValue as OutboxSyncStatus) ? statusValue as OutboxSyncStatus : 'queued';
  const entity = row.entity && typeof row.entity === 'object'
    ? row.entity as OutboxEntity
    : entityFor(row.path, row.method.toUpperCase(), body);
  const normalizedEntity = {
    ...entity,
    type: typeof entity.type === 'string' && entity.type ? entity.type : entityFor(row.path, row.method.toUpperCase(), body).type,
    id: typeof entity.id === 'string' ? entity.id : undefined,
    label: typeof entity.label === 'string' ? entity.label : undefined,
  };
  return {
    id: row.id,
    path: row.path,
    method: row.method.toUpperCase(),
    body,
    queuedAt: Number.isFinite(Number(row.queuedAt)) ? Number(row.queuedAt) : Date.now(),
    deviceId: typeof row.deviceId === 'string' ? row.deviceId : undefined,
    seq: Number.isFinite(Number(row.seq)) ? Number(row.seq) : undefined,
    status,
    syncStatus: status,
    statusAt: Number.isFinite(Number(row.statusAt)) ? Number(row.statusAt) : (Number.isFinite(Number(row.queuedAt)) ? Number(row.queuedAt) : Date.now()),
    completedAt: Number.isFinite(Number(row.completedAt)) ? Number(row.completedAt) : undefined,
    attempts: Number.isFinite(Number(row.attempts)) ? Math.max(0, Number(row.attempts)) : 0,
    lastError: typeof row.lastError === 'string' ? row.lastError : undefined,
    nextRetryAt: Number.isFinite(Number(row.nextRetryAt)) ? Number(row.nextRetryAt) : undefined,
    entity: normalizedEntity,
    entityType: typeof row.entityType === 'string' ? row.entityType : normalizedEntity.type,
    entityId: typeof row.entityId === 'string' ? row.entityId : normalizedEntity.id,
    entityLabel: typeof row.entityLabel === 'string' ? row.entityLabel : normalizedEntity.label,
    reviewKind: row.reviewKind === 'conflict' || row.reviewKind === 'stock' || row.reviewKind === 'refused' ? row.reviewKind : undefined,
    reviewSummary: typeof row.reviewSummary === 'string' ? row.reviewSummary : undefined,
    reviewAt: Number.isFinite(Number(row.reviewAt)) ? Number(row.reviewAt) : undefined,
  };
}

function normalizeOutboxEntries(value: unknown): OutboxEntry[] {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return []; }
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const mirror = parsed as { version?: unknown; entries?: unknown };
    if (mirror.version === 2 && Array.isArray(mirror.entries)) parsed = mirror.entries;
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeOutboxEntry).filter((entry): entry is OutboxEntry => !!entry);
}

function getOutbox(): OutboxEntry[] {
  try { return normalizeOutboxEntries(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch { return []; }
}

let localOutboxRevision = 0;

function writeLocalOutbox(entries: OutboxEntry[]): void {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { version?: unknown; revision?: unknown };
        if (parsed.version === 2 && Number.isFinite(Number(parsed.revision))) localOutboxRevision = Math.max(localOutboxRevision, Number(parsed.revision));
      } catch {}
    }
    const revision = Math.max(Date.now(), localOutboxRevision + 1);
    localStorage.setItem(OUTBOX_KEY, JSON.stringify({ version: 2, revision, entries }));
    localOutboxRevision = revision;
    try { window.dispatchEvent(new Event('boss-pos-outbox-updated')); } catch {}
  } catch {}
}

async function persistOutbox(entries: OutboxEntry[]): Promise<void> {
  const normalized = entries.map(normalizeOutboxEntry).filter((entry): entry is OutboxEntry => !!entry);
  await updateOutbox(current => mergeOutboxSnapshot(normalized, current));
}

async function updateOutbox(mutator: (entries: OutboxEntry[]) => OutboxEntry[]): Promise<OutboxEntry[]> {
  let m: typeof import('./utils/outboxIdb');
  try {
    m = await import('./utils/outboxIdb');
  } catch {
    const next = mutator(getOutbox());
    writeLocalOutbox(next);
    return next;
  }
  const next = await m.idbOutboxUpdate(entries => mutator(normalizeOutboxEntries(entries)));
  return normalizeOutboxEntries(next);
}

async function enqueue(path: string, method: string, body: string): Promise<void> {
  const now = Date.now();
  const entry = normalizeOutboxEntry({
    id: `${now}-${Math.random().toString(36).slice(2)}`,
    path,
    method,
    body,
    queuedAt: now,
    deviceId: getDeviceId(),
    seq: nextWriteSeq(),
    status: 'queued',
    statusAt: now,
    attempts: 0,
  });
  if (!entry) return;
  await updateOutbox(entries => [...entries, entry]);
}

function isActionable(entry: OutboxEntry): boolean {
  return entry.status === 'queued' || entry.status === 'retrying' || entry.status === 'blocked_auth';
}

function countsFor(entries: OutboxEntry[]): OutboxCounts {
  const counts: OutboxCounts = {
    total: entries.length,
    pending: 0,
    queued: 0,
    sending: 0,
    retrying: 0,
    blockedAuth: 0,
    synced: 0,
    failed: 0,
  };
  for (const entry of entries) {
    if (entry.status === 'queued') counts.queued++;
    if (entry.status === 'sending') counts.sending++;
    if (entry.status === 'retrying') counts.retrying++;
    if (entry.status === 'blocked_auth') counts.blockedAuth++;
    if (entry.status === 'synced') counts.synced++;
    if (entry.status === 'failed') counts.failed++;
  }
  counts.pending = counts.queued + counts.sending + counts.retrying + counts.blockedAuth;
  return counts;
}

export function outboxCount(): number {
  return countsFor(getOutbox()).pending;
}

export async function outboxCountAsync(): Promise<number> {
  return countsFor(await peekOutboxAsync()).pending;
}

export function outboxCounts(): OutboxCounts {
  return countsFor(getOutbox());
}

export async function outboxCountsAsync(): Promise<OutboxCounts> {
  return countsFor(await peekOutboxAsync());
}

export const getOutboxCounts = outboxCounts;
export const getOutboxCountsAsync = outboxCountsAsync;

export function peekOutbox(): OutboxEntry[] {
  return getOutbox();
}

export async function peekOutboxAsync(): Promise<OutboxEntry[]> {
  let entries: OutboxEntry[];
  try {
    const m = await import('./utils/outboxIdb');
    entries = normalizeOutboxEntries(await m.idbOutboxGet());
  } catch {
    entries = getOutbox();
  }
  const cutoff = Date.now() - SENDING_RECOVERY_MS;
  if (!entries.some(entry => entry.status === 'sending' && (entry.statusAt || entry.queuedAt) <= cutoff)) return entries;
  return updateOutbox(current => current.map(entry => (
    entry.status === 'sending' && (entry.statusAt || entry.queuedAt) <= cutoff
      ? mark(entry, 'retrying', entry.lastError || 'Sync interrupted')
      : entry
  )));
}

export async function listOutboxItemsAsync(): Promise<OutboxEntry[]> {
  return peekOutboxAsync();
}

export const listSyncItemsAsync = listOutboxItemsAsync;
export const listOutboxItems = peekOutbox;
export const listSyncItems = peekOutbox;

export function clearOutbox(): void {
  writeLocalOutbox([]);
  void import('./utils/outboxIdb').then(m => m.idbOutboxSet('[]')).catch(() => {});
}

export async function clearOutboxAsync(): Promise<void> {
  await updateOutbox(() => []);
}

export function dropOutboxEntry(id: string): void {
  const next = getOutbox().filter(entry => entry.id !== id);
  writeLocalOutbox(next);
  void updateOutbox(entries => entries.filter(entry => entry.id !== id)).catch(() => {});
}

export async function dropOutboxEntryAsync(id: string): Promise<void> {
  await updateOutbox(entries => entries.filter(entry => entry.id !== id));
}

export const dismissOutboxEntry = dropOutboxEntry;
export const dismissOutboxEntryAsync = dropOutboxEntryAsync;
export const dismissSyncItem = dropOutboxEntry;
export const dismissSyncItemAsync = dropOutboxEntryAsync;

export async function retryOutboxEntry(id: string): Promise<OutboxEntry | null> {
  let found: OutboxEntry | null = null;
  await updateOutbox(entries => entries.map(entry => {
    if (entry.id !== id) return entry;
    found = {
      ...entry,
      status: 'queued',
      syncStatus: 'queued',
      statusAt: Date.now(),
      attempts: 0,
      lastError: undefined,
      nextRetryAt: undefined,
      reviewKind: undefined,
      reviewSummary: undefined,
      reviewAt: undefined,
    };
    return found;
  }));
  return found;
}

export const retryOutboxEntryAsync = retryOutboxEntry;
export const retrySyncItem = retryOutboxEntry;
export const retrySyncItemAsync = retryOutboxEntry;

function trimOutbox(entries: OutboxEntry[]): OutboxEntry[] {
  const cutoff = Date.now() - OUTBOX_RETENTION_MS;
  const terminal = entries.filter(entry => entry.status === 'synced' || entry.status === 'failed');
  const terminalToKeep = terminal.filter(entry => (entry.completedAt || entry.statusAt || entry.queuedAt) >= cutoff).slice(-MAX_TERMINAL_ITEMS);
  const terminalIds = new Set(terminalToKeep.map(entry => entry.id));
  return entries
    .filter(entry => !terminal.some(item => item.id === entry.id) || terminalIds.has(entry.id))
    .sort((a, b) => a.queuedAt - b.queuedAt);
}

function mark(entry: OutboxEntry, status: OutboxSyncStatus, error?: string): OutboxEntry {
  const now = Date.now();
  return {
    ...entry,
    status,
    syncStatus: status,
    statusAt: now,
    lastError: error,
    nextRetryAt: status === 'retrying' ? now + 5000 : undefined,
    completedAt: status === 'synced' || status === 'failed' ? now : undefined,
  };
}

function addReview(entry: OutboxEntry, kind: 'conflict' | 'stock' | 'refused', summary: string): OutboxEntry {
  const now = Date.now();
  return { ...entry, reviewKind: kind, reviewSummary: summary, reviewAt: now };
}

function mergeOutboxSnapshot(snapshot: OutboxEntry[], current: OutboxEntry[]): OutboxEntry[] {
  const byId = new Map(current.map(entry => [entry.id, entry]));
  for (const entry of snapshot) {
    if (byId.has(entry.id)) byId.set(entry.id, entry);
  }
  return trimOutbox([...byId.values()]);
}

export async function flushOutboxDetailed(): Promise<OutboxFlushReport> {
  const list = await peekOutboxAsync();
  const active = list.filter(isActionable);
  const salesQueued = active.filter(entry => entry.path === '/api/sales' && entry.method === 'POST').length;
  if (active.length === 0) {
    return {
      attempted: 0, flushed: 0, sent: 0, salesQueued: 0, salesSent: 0,
      salesDropped: 0, conflicts: 0, dropped: 0, reviewAdded: 0, remaining: countsFor(list).pending,
      authFailed: false, networkFailed: false, counts: countsFor(list),
    };
  }
  if (!getAuthToken()) {
    const blocked = list.map(entry => isActionable(entry) ? mark(entry, 'blocked_auth', 'Authentication required') : entry);
    await persistOutbox(trimOutbox(blocked));
    return {
      attempted: active.length, flushed: 0, sent: 0, salesQueued, salesSent: 0,
      salesDropped: 0, conflicts: 0, dropped: 0, reviewAdded: 0,
      remaining: countsFor(blocked).pending, authFailed: true, networkFailed: false, counts: countsFor(blocked),
    };
  }
  let sent = 0;
  let salesSent = 0;
  let salesDropped = 0;
  let reviewAdded = 0;
  let flushed = 0;
  let conflicts = 0;
  let dropped = 0;
  let sawAuthFailure = false;
  let sawNetworkFailure = false;
  let firstAuthPath = '';
  const updated = new Map<string, OutboxEntry>();
  const save = async (entry: OutboxEntry) => {
    updated.set(entry.id, entry);
    await persistOutbox(mergeOutboxSnapshot([...updated.values()], await peekOutboxAsync()));
  };

  for (let idx = 0; idx < active.length; idx++) {
    const source = active[idx];
    const entry = mark({ ...source, attempts: (source.attempts || 0) + 1 }, 'sending');
    await save(entry);
    const isSale = entry.path === '/api/sales' && entry.method === 'POST';
    try {
      const res = await fetchTimeout(`${BASE}${entry.path}`, {
        method: entry.method,
        headers: { 'Content-Type': 'application/json', Authorization: getAuthHeader() },
        body: entry.body,
      }, WRITE_TIMEOUT_MS);
      if (res.ok) {
        sent++;
        if (isSale) salesSent++;
        flushed++;
        await save(mark(entry, 'synced'));
        continue;
      }
      if (res.status === 404) {
        if (entry.method === 'DELETE') {
          sent++;
          flushed++;
          await save(mark(entry, 'synced'));
        } else {
          dropped++;
          if (isSale) salesDropped++;
          flushed++;
          const review = stashSyncReview('refused', entry);
          reviewAdded++;
          await save(addReview(mark(entry, 'failed', 'HTTP 404'), 'refused', review.summary));
        }
        continue;
      }
      if (res.status === 401) {
        sawAuthFailure = true;
        if (!firstAuthPath) firstAuthPath = entry.path;
        await save(mark(entry, 'blocked_auth', 'Authentication required'));
        continue;
      }
      if (res.status === 409) {
        const body = await res.json().catch(() => ({})) as { code?: string };
        if (body.code === 'CONFLICT') conflicts++;
        if (isSale) salesDropped++;
        dropped++;
        flushed++;
        const kind = body.code === 'INSUFFICIENT_STOCK' ? 'stock' : 'conflict';
        const review = stashSyncReview(kind, entry);
        reviewAdded++;
        await save(addReview(mark(entry, 'failed', body.code || 'Conflict'), kind, review.summary));
        continue;
      }
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        await res.json().catch(() => ({}));
        dropped++;
        if (isSale) salesDropped++;
        flushed++;
        const review = stashSyncReview('refused', entry);
        reviewAdded++;
        await save(addReview(mark(entry, 'failed', `HTTP ${res.status}`), 'refused', review.summary));
        continue;
      }
      const retryError = `HTTP ${res.status}`;
      if ((entry.attempts || 0) >= MAX_AUTO_ATTEMPTS) {
        dropped++;
        if (isSale) salesDropped++;
        const review = stashSyncReview('refused', entry);
        reviewAdded++;
        await save(addReview(mark(entry, 'failed', retryError), 'refused', review.summary));
      } else {
        sawNetworkFailure = true;
        await save(mark(entry, 'retrying', retryError));
      }
    } catch (err) {
      const isNetwork = err instanceof TypeError;
      const message = err instanceof Error ? err.message : 'Network error';
      if (!isNetwork && (entry.attempts || 0) < MAX_AUTO_ATTEMPTS) {
        sawNetworkFailure = true;
        await save(mark(entry, 'retrying', message));
      } else if ((entry.attempts || 0) >= MAX_AUTO_ATTEMPTS) {
        const review = stashSyncReview('refused', entry);
        reviewAdded++;
        if (isSale) salesDropped++;
        dropped++;
        await save(addReview(mark(entry, 'failed', message), 'refused', review.summary));
      } else {
        await save(mark(entry, 'retrying', message));
      }
      if (isNetwork) {
        sawNetworkFailure = true;
        break;
      }
    }
  }

  const current = await peekOutboxAsync();
  await persistOutbox(mergeOutboxSnapshot([...updated.values()], current));
  const finalList = await peekOutboxAsync();
  const finalCounts = countsFor(finalList);
  if (sawAuthFailure) {
    clearAllTokens();
    emitAuthRevoked(firstAuthPath ? { path: firstAuthPath } : undefined);
  }
  if (sawNetworkFailure) {
    try { window.dispatchEvent(new Event('boss-pos-sync-offline')); } catch {}
  }
  if (flushed > 0) clearRelatedCaches('/api');
  if (conflicts > 0) {
    try { window.dispatchEvent(new CustomEvent('boss-pos-sync-conflict', { detail: conflicts })); } catch {}
  }
  if (dropped > 0) {
    try { window.dispatchEvent(new CustomEvent('boss-pos-sync-dropped', { detail: dropped })); } catch {}
  }
  return {
    attempted: active.length,
    flushed,
    sent,
    salesQueued,
    salesSent,
    salesDropped,
    conflicts,
    dropped,
    reviewAdded,
    remaining: finalCounts.pending,
    authFailed: sawAuthFailure,
    networkFailed: sawNetworkFailure,
    counts: finalCounts,
  };
}

export async function flushOutbox(): Promise<number> {
  return (await flushOutboxDetailed()).sent;
}

// Server-side PIN auth (plain PIN over HTTPS; hashing happens on the server).
export async function authVerify(pin: string, timeoutMs?: number): Promise<{ token: string; hasPin: boolean; hash?: string }> {
  const res = await fetchTimeout(`${BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  }, timeoutMs ?? WRITE_TIMEOUT_MS);
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
      const traceIdHeader = (() => {
        try {
          const header = xhr.getResponseHeader('X-Request-Id');
          return header || undefined;
        } catch {
          return undefined;
        }
      })();
      let traceId = traceIdHeader;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (data.url) return resolve(data.url as string);
        } catch {}
        return reject(new ApiError('Unexpected upload response', xhr.status, undefined, traceId));
      }
      let message = `Upload failed (${xhr.status})`;
      let code: string | undefined;
      try {
        const data = JSON.parse(xhr.responseText) as { error?: string; code?: string; traceId?: string };
        if (data.error) message = data.error;
        code = data.code;
        if (data.traceId) traceId = data.traceId;
      } catch {}
      reject(new ApiError(message, xhr.status, code, traceId));
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
  clearAllTokens();
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

function clearAllCaches(): void {
  const keys = getCacheKeys();
  for (const key of keys) localStorage.removeItem(key);
  try { localStorage.removeItem(cacheKey('/api/boot')); } catch {}
  saveCacheKeys(new Set());
}

// The till re-mints its token in the background right after unlock. Requests
// that land before it finishes get a 401; wait briefly instead of failing.
async function waitForTokenMint(): Promise<void> {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400));
    if (getAuthToken()) return;
    if (!inUnlockGrace()) return;
  }
}

async function api<T>(path: string, options?: RequestInit & { fresh?: boolean; store?: boolean | number; silentManager?: boolean }, writeMeta?: WriteMeta): Promise<T> {
  const isRead = !options || !options.method || options.method === 'GET';
  const isControl = isControlPath(path);
  const silentManager = Boolean((options as { silentManager?: boolean } | undefined)?.silentManager);

  if (isRead && !isControl) {
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
  } else if (isRead && isControl && !navigator.onLine) {
    throw new ApiError(CONTROL_OFFLINE_MESSAGE, 0, 'OFFLINE_CONTROL');
  }

  // Idempotency + write versioning: every create/update body carries a stable
  // client_write_id derived from (device, seq) so an offline outbox replay can't
  // double-insert and the write order is deterministic per device. The deviceId
  // rides along so the server could cross-device order later.
  if (!isRead && !isControl && options?.method && (options.method === 'POST' || options.method === 'PUT')) {
    let parsed: Record<string, unknown> = {};
    try { parsed = (options.body as string) ? JSON.parse(options.body as string) : {}; } catch {}
    if (!parsed.clientWriteId) parsed.clientWriteId = `${getDeviceId()}:${nextWriteSeq()}`;
    parsed.deviceId = getDeviceId();
    if (!parsed.branch && (path === '/api/sales' || path === '/api/expenses' || path === '/api/stock-purchases')) {
      try {
        const branch = localStorage.getItem('boss_pos_branch');
        if (branch) parsed.branch = branch;
      } catch {}
    }
    options = { ...options, body: JSON.stringify(parsed) };
  }

  // Offline-first: if the device knows it's offline, queue immediately instead
  // of burning 30s on a fetch that will timeout and then queue anyway.
  // Also invalidate the list/boot caches so an optimistic delete/update can't
  // be resurrected by stale cache on the next boot (deleted sale reappears).
  if (!isRead && !navigator.onLine) {
    if (isControl) throw new ApiError(CONTROL_OFFLINE_MESSAGE, 0, 'OFFLINE_CONTROL');
    const body = (options && (options.body as string)) || '';
    if (writeMeta) writeMeta.status = 'queued';
    await enqueue(path, options?.method || 'POST', body);
    try { clearRelatedCaches(path); } catch {}
    // The optimistic echo is the ONLY record of this write until the outbox
    // flushes. Returning it plainly means a caller that reads the response can
    // tell the customer "saved" vs "will sync", instead of both looking saved.
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
    let revokeRetried = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetchTimeout(`${BASE}${path}`, {
        headers: { 'Content-Type': 'application/json', Authorization: getAuthHeader() },
        ...options,
      }, isRead ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS);
      if (!res.ok) {
        let message = `API error: ${res.status}`;
        let code: string | undefined;
        let traceId = responseTraceId(res);
        try {
          const body = await res.json().catch(() => ({}));
          if (body.error) message = body.error;
          if (body.code) code = body.code;
          if (body.traceId) traceId = String(body.traceId);
        } catch {}
        if (res.status === 401 && path.startsWith('/api/') && getAuthToken()) {
          if (inUnlockGrace() && !revokeRetried) {
            // Freshly unlocked, slow network: the background re-mint may not
            // have landed. Wait for it once, then decide.
            revokeRetried = true;
            try { await waitForTokenMint(); } catch {}
          }
          if (getStaffToken() && getAuthToken()) {
            // The staff credential is the likelier stale one (it is the
            // specific token the server may have revoked). Drop just it and
            // fall back to the till token rather than re-locking the device.
            setStaffToken(null);
          } else if (!getAuthToken()) {
            clearAllTokens();
            emitAuthRevoked({ path });
          } else {
            // A valid token is already in place — this 401 was transient
            // (a request that raced the mint). Don't punish the cashier.
            revokeRetried = false;
          }
        }
        if (res.status === 403 && code === 'MANAGER_REQUIRED' && !silentManager) {
          try { window.dispatchEvent(new CustomEvent('boss-pos-manager-required', { detail: { path, usedStaffToken: Boolean(getStaffToken()) } })); } catch {}
        }
        const transientStatus =
          res.status === 502 || res.status === 503 || res.status === 504 ||
          (res.status === 500 && /temporarily unavailable|Database temporarily/i.test(message));
        if (transientStatus && attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
          continue;
        }
        throw new ApiError(message, res.status, code, traceId);
      }
      const data = await res.json();

      if (isRead) {
        if (!isControl && (!options || !options.fresh || options.store)) {
          const ttl = typeof options?.store === 'number' ? options.store : undefined;
          setCache(path, data, ttl);
        }
      }

      if (!isRead) {
        if (path === '/api/restore') clearAllCaches();
        else clearRelatedCaches(path);
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
    if (isControl) throw controlFailure(err);
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
      if (writeMeta) writeMeta.status = 'queued';
      await enqueue(path, options?.method || 'POST', body);
      try { clearRelatedCaches(path); } catch {}
      try {
        return JSON.parse(body) as T;
      } catch {
        return { success: true } as T;
      }
    }
    throw err;
  }
}

export async function apiWrite<T>(path: string, options: RequestInit): Promise<WriteResult<T>> {
  const meta: WriteMeta = { status: 'saved' };
  const data = await api<T>(path, options, meta);
  return { data, status: meta.status };
}

export interface BulkProductUpdate {
  id: string;
  stockQty: number;
  expectedUpdatedAt?: string;
}

export interface BulkProductUpdateResult {
  id: string;
  status: 'saved' | 'conflict' | 'missing' | 'failed';
  stockQty?: number;
  updatedAt?: string;
  error?: string;
  product?: Product;
}

export interface BulkProductUpdateResponse {
  results: BulkProductUpdateResult[];
  saved: number;
  conflicts: number;
  failed: number;
  queued?: boolean;
  pending?: number;
}

export interface ProductListParams {
  limit?: number;
  offset?: number;
}

export const productApi = {
  list: (params: ProductListParams = {}) => {
    const qs = new URLSearchParams();
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.offset !== undefined) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return api<Product[]>(`/api/products${q ? `?${q}` : ''}`);
  },
  create: (p: Product) => api<Product>('/api/products', { method: 'POST', body: JSON.stringify(p) }),
  update: (p: Product) => api<Product>(`/api/products/${p.id}`, { method: 'PUT', body: JSON.stringify(p) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/products/${id}`, { method: 'DELETE' }),
  bulkUpdateStocktake: async (updates: BulkProductUpdate[]): Promise<BulkProductUpdateResponse> => {
    const result = await api<BulkProductUpdateResponse | { updates: BulkProductUpdate[] }>('/api/products/bulk', {
      method: 'PUT',
      body: JSON.stringify({ updates }),
    });
    if ('updates' in result) {
      return { results: [], saved: 0, conflicts: 0, failed: 0, queued: true, pending: updates.length };
    }
    return result;
  },
};

export const supplierApi = {
  list: () => api<Supplier[]>('/api/suppliers'),
  create: (s: Supplier) => api<Supplier>('/api/suppliers', { method: 'POST', body: JSON.stringify(s) }),
  update: (s: Supplier) => api<Supplier>(`/api/suppliers/${s.id}`, { method: 'PUT', body: JSON.stringify(s) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/suppliers/${id}`, { method: 'DELETE' }),
};

export const supplierPriceApi = {
  list: () => api<SupplierPrice[]>('/api/supplier-prices'),
  upsert: (
    supplierId: string,
    productId: string,
    price: number,
    meta: { purchaseQty?: number; purchaseUnit?: string; normalizedUnit?: string } = {},
  ) => api<SupplierPrice>('/api/supplier-prices', {
    method: 'PUT',
    body: JSON.stringify({ supplierId, productId, price, ...meta }),
  }),
  remove: (id: string) => api<{ success: boolean }>(`/api/supplier-prices/${id}`, { method: 'DELETE' }),
};

export const staffApi = {
  list: () => api<StaffMember[]>('/api/staff'),
  create: (name: string, role: 'manager' | 'cashier', pin: string) =>
    api<StaffMember>('/api/staff', { method: 'POST', body: JSON.stringify({ name, role, pin }) }),
  update: (id: string, patch: { name?: string; role?: 'manager' | 'cashier'; active?: boolean; pin?: string }) =>
    api<StaffMember>(`/api/staff/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  verify: (id: string, pin: string) =>
    api<StaffMember & { ok: boolean; token?: string }>('/api/staff/verify', { method: 'POST', body: JSON.stringify({ id, pin }) }),
};

export interface SaleListParams {
  from?: string;
  to?: string;
  branch?: string;
  limit?: number;
  offset?: number;
}

export type SaleCreateInput = Sale & { override?: boolean; allowOverCap?: boolean };

const createSaleWithStatus = (s: SaleCreateInput) => apiWrite<Sale>('/api/sales', { method: 'POST', body: JSON.stringify(s) });

export const saleApi = {
  list: (params: SaleListParams = {}) => {
    const qs = new URLSearchParams();
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.branch) qs.set('branch', params.branch);
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.offset !== undefined) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return api<Sale[]>(`/api/sales${q ? `?${q}` : ''}`);
  },
  createWithStatus: createSaleWithStatus,
  create: async (s: SaleCreateInput) => (await createSaleWithStatus(s)).data,
  remove: (id: string) => api<{ success: boolean }>(`/api/sales/${id}`, { method: 'DELETE' }),
  refund: (id: string) => api<{ success: boolean }>(`/api/sales/${id}/refund`, { method: 'POST' }),
};

export interface ExpenseListParams {
  from?: string;
  to?: string;
  branch?: string;
  limit?: number;
  offset?: number;
}

export const expenseApi = {
  list: (params: ExpenseListParams = {}) => {
    const qs = new URLSearchParams();
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.branch) qs.set('branch', params.branch);
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.offset !== undefined) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return api<Expense[]>(`/api/expenses${q ? `?${q}` : ''}`).then((rows) => normalizeExpenses(rows));
  },
  create: (e: Expense) => api<Expense>('/api/expenses', { method: 'POST', body: JSON.stringify(withWriteId(e)) }).then((row) => normalizeExpenses([row])[0] || e),
  remove: (id: string) => api<{ success: boolean }>(`/api/expenses/${id}`, { method: 'DELETE' }),
};

export interface StockPurchaseInput {
  productId: string;
  quantity: number;
  unitCost: number;
  description?: string;
  category?: string;
  source?: string;
  branch?: string;
  staffName?: string;
  id?: string;
  clientWriteId?: string;
}

export interface StockPurchaseResult {
  duplicate?: boolean;
  product: Pick<Product, 'id' | 'name' | 'stockQty'>;
  expense: Expense;
}

export const stockPurchaseApi = {
  create: (purchase: StockPurchaseInput) => api<StockPurchaseResult>('/api/stock-purchases', {
    method: 'POST',
    body: JSON.stringify(withWriteId(purchase)),
  }),
};

export const creditPaymentApi = {
  list: () => api<CreditPayment[]>('/api/credit-payments'),
  create: (p: CreditPayment) => api<CreditPayment>('/api/credit-payments', { method: 'POST', body: JSON.stringify(withWriteId(p)) }),
};

export interface CreditLimitRow {
  customerKey: string;
  customerName: string;
  limit: number;
  tillOutstanding: number;
  bookOutstanding: number;
  outstanding: number;
  updatedAt?: string;
}

export interface CreditLimitOverview {
  rows: CreditLimitRow[];
  totalOutstanding: number;
}

export const creditLimitApi = {
  overview: () => api<CreditLimitOverview>('/api/credit-limits'),
  save: (customerName: string, cap: number) => api<{ customerKey: string; customerName: string; cap: number; updatedAt: string }>('/api/credit-limits', {
    method: 'PUT',
    body: JSON.stringify({ customerName, cap }),
  }),
  remove: (customerKey: string) => api<{ success: boolean }>(`/api/credit-limits/${encodeURIComponent(customerKey)}`, { method: 'DELETE' }),
};

export const cashTransferApi = {
  list: () => api<CashTransfer[]>('/api/cash-transfers'),
  create: (t: CashTransfer) => api<CashTransfer>('/api/cash-transfers', { method: 'POST', body: JSON.stringify(withWriteId(t)) }),
  settle: (id: string) => api<{ success: boolean }>(`/api/cash-transfers/${id}/settle`, { method: 'PUT' }),
};

export const tailoringOrderApi = {
  list: () => api<TailoringOrder[]>('/api/tailoring-orders'),
  create: (o: TailoringOrder) => api<TailoringOrder>('/api/tailoring-orders', { method: 'POST', body: JSON.stringify(withWriteId(o)) }),
  update: (o: TailoringOrder) => api<TailoringOrder>(`/api/tailoring-orders/${o.id}`, { method: 'PUT', body: JSON.stringify(o) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/tailoring-orders/${id}`, { method: 'DELETE' }),
};

export const designOrderApi = {
  list: () => api<DesignOrder[]>('/api/design-orders'),
  create: (o: DesignOrder) => api<DesignOrder>('/api/design-orders', { method: 'POST', body: JSON.stringify(withWriteId(o)) }),
  update: (o: DesignOrder) => api<DesignOrder>(`/api/design-orders/${o.id}`, { method: 'PUT', body: JSON.stringify(o) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/design-orders/${id}`, { method: 'DELETE' }),
};

export const bookingApi = {
  list: () => api<Booking[]>('/api/bookings'),
  create: (o: Booking) => api<Booking>('/api/bookings', { method: 'POST', body: JSON.stringify(withWriteId(o)) }),
  update: (o: Booking) => api<Booking>(`/api/bookings/${o.id}`, { method: 'PUT', body: JSON.stringify(o) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/bookings/${id}`, { method: 'DELETE' }),
};

export const repairJobApi = {
  list: () => api<RepairJob[]>('/api/repair-jobs'),
  create: (o: RepairJob) => api<RepairJob>('/api/repair-jobs', { method: 'POST', body: JSON.stringify(withWriteId(o)) }),
  update: (o: RepairJob) => api<RepairJob>(`/api/repair-jobs/${o.id}`, { method: 'PUT', body: JSON.stringify(o) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/repair-jobs/${id}`, { method: 'DELETE' }),
};

export const quoteApi = {
  list: () => api<Quote[]>('/api/quotes'),
  create: (o: Quote) => api<Quote>('/api/quotes', { method: 'POST', body: JSON.stringify(withWriteId(o)) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/quotes/${id}`, { method: 'DELETE' }),
};

export const customerApi = {
  list: () => api<CustomerProfile[]>('/api/customers'),
  create: (c: CustomerProfile) => api<CustomerProfile>('/api/customers', { method: 'POST', body: JSON.stringify(withWriteId(c)) }),
  update: (c: CustomerProfile) => api<CustomerProfile>(`/api/customers/${c.id}`, { method: 'PUT', body: JSON.stringify(c) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/customers/${id}`, { method: 'DELETE' }),
};

export type CreditEatInput = CreditEat & { override?: boolean; allowOverCap?: boolean };

export const creditEatApi = {
  list: () => api<CreditEat[]>('/api/credit-eats'),
  create: (e: CreditEatInput) => api<CreditEat>('/api/credit-eats', { method: 'POST', body: JSON.stringify(withWriteId(e)) }),
  pay: (id: string, amount: number) => api<CreditEat>(`/api/credit-eats/${id}/pay`, { method: 'POST', body: JSON.stringify({ amount }) }),
};

export const productionRegisterApi = {
  list: () => api<ProductionRegister[]>('/api/production-register'),
  create: (p: ProductionRegister) => api<ProductionRegister>('/api/production-register', { method: 'POST', body: JSON.stringify(withWriteId(p)) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/production-register/${id}`, { method: 'DELETE' }),
};

export const wastageLogApi = {
  list: () => api<WastageLog[]>('/api/wastage-log'),
  create: (w: WastageLog) => api<WastageLog>('/api/wastage-log', { method: 'POST', body: JSON.stringify(withWriteId(w)) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/wastage-log/${id}`, { method: 'DELETE' }),
};

export const momoTransferApi = {
  list: () => api<MomoTransfer[]>('/api/momo-transfers'),
  create: (t: MomoTransfer) => api<MomoTransfer>('/api/momo-transfers', { method: 'POST', body: JSON.stringify(withWriteId(t)) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/momo-transfers/${id}`, { method: 'DELETE' }),
};

export interface SaleChangeRequest {
  id: string;
  saleId: string;
  kind: 'void' | 'edit';
  payload: { lines?: Array<{ productId: string; variantId?: string | null; qty: number }> };
  reason: string;
  requestedBy?: string;
  requestedByName: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy?: string;
  decidedByName: string;
  decidedAt?: string;
  decisionNote: string;
  branch: string;
  createdAt: string;
  sale?: Sale | null;
  duplicate?: boolean;
}

export const saleChangeApi = {
  list: () => api<SaleChangeRequest[]>('/api/sale-change-requests', { fresh: true, silentManager: true }),
  create: (body: {
    saleId: string;
    kind: 'void' | 'edit';
    reason: string;
    lines?: Array<{ productId: string; variantId?: string | null; qty: number }>;
    clientWriteId?: string;
  }) => api<SaleChangeRequest & { duplicate?: boolean }>('/api/sale-change-requests', { method: 'POST', body: JSON.stringify(withWriteId(body)) }),
  approve: (id: string, note?: string) => api<{ request: SaleChangeRequest; sale: Sale | null; duplicate?: boolean }>(`/api/sale-change-requests/${id}/approve`, { method: 'POST', body: JSON.stringify({ note: note || '' }) }),
  reject: (id: string, note?: string) => api<SaleChangeRequest>(`/api/sale-change-requests/${id}/reject`, { method: 'POST', body: JSON.stringify({ note: note || '' }) }),
};

export const closeSessionApi = {
  current: () => api<{ id: string; businessDate: string; status: string } | null>('/api/close-sessions/current', { fresh: true }),
  reopen: (id: string, reason: string) => api<unknown>(`/api/close-sessions/${id}/reopen`, { method: 'POST', body: JSON.stringify({ reason }) }),
};

export const closeSummaryApi = {
  send: (body: {
    businessDate: string;
    branch?: string;
    channel?: 'in_app' | 'whatsapp';
    recipientRole?: 'owner' | 'manager';
    recipientId?: string;
    recipientName?: string;
    headline: string;
    body: string;
    totals?: Record<string, number>;
    clientWriteId?: string;
  }) => api<CloseSummary & { duplicate?: boolean }>('/api/close-summaries', { method: 'POST', body: JSON.stringify(body) }),
  inbox: (scope: 'recipient' | 'all' = 'recipient') => api<{ scope: string; count: number; rows: CloseSummary[] }>(`/api/close-summaries?scope=${scope}`, { fresh: true }),
  markRead: (id: string) => api<CloseSummary & { duplicate?: boolean }>(`/api/close-summaries/${id}/read`, { method: 'POST', body: '{}' }),
  markShared: (id: string, via = 'whatsapp') => api<CloseSummary>(`/api/close-summaries/${id}/shared`, { method: 'POST', body: JSON.stringify({ via }) }),
};

export interface HandoverSummaryRecipient {
  key: string;
  destination: 'float' | 'cash' | 'owner' | 'manager' | 'bank';
  recipientId: string | null;
  recipientName: string;
  total: number;
  count: number;
  awaiting: number;
  received: number;
}

export interface HandoverSummary {
  range: { from: string | null; to: string | null; branch: string | null };
  totals: Record<string, number>;
  awaitingConfirmation: number;
  confirmed: number;
  noReceiptNeeded: number;
  count: number;
  byRecipient: HandoverSummaryRecipient[];
}

export const handoverApi = {
  pending: () => api<{ actor: { id: string | null; name: string; role: string }; count: number; rows: MomoTransfer[] }>('/api/money-handover/pending', { fresh: true, silentManager: true }),
  confirm: (id: string, note?: string) => api<MomoTransfer & { duplicate?: boolean }>(`/api/money-handover/${id}/confirm`, { method: 'POST', body: JSON.stringify({ note: note || '' }) }),
  summary: (params?: { from?: string; to?: string; branch?: string }) => {
    const q = new URLSearchParams();
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    if (params?.branch) q.set('branch', params.branch);
    const qs = q.toString();
    return api<HandoverSummary>(`/api/money-handover/summary${qs ? `?${qs}` : ''}`, { fresh: true, silentManager: true });
  },
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

export interface EfrisStatus {
  status: 'none' | 'pending' | 'issued' | 'failed';
  invoiceNo: string;
  fdn: string;
  verifyCode: string;
  qr: string;
  error: string;
  at: string;
}

export const efrisApi = {
  config: () => api<{ config: import('./types').EfrisConfig; hasToken: boolean }>('/api/efris/config', { fresh: true }),
  save: (config: import('./types').EfrisConfig, token?: string, clearToken?: boolean) =>
    api<{ success: boolean; config: import('./types').EfrisConfig; hasToken: boolean }>('/api/efris/config', {
      method: 'PUT',
      body: JSON.stringify({ config, token, clearToken }),
    }),
  issue: (saleId: string) =>
    api<{ success: boolean; status: string; sale: import('./types').Sale }>('/api/efris/issue', {
      method: 'POST',
      body: JSON.stringify({ saleId }),
    }),
  retry: (saleId: string) =>
    api<{ success: boolean; status: string; sale: import('./types').Sale }>('/api/efris/retry', {
      method: 'POST',
      body: JSON.stringify({ saleId }),
    }),
  status: (saleId: string) => api<EfrisStatus>(`/api/efris/status?saleId=${encodeURIComponent(saleId)}`, { fresh: true }),
};

export interface BootData {
  products: Product[];
  suppliers: Supplier[];
  supplierPrices: SupplierPrice[];
  staff: StaffMember[];
  sales: Sale[];
  expenses: Expense[];
  creditPayments: CreditPayment[];
  creditEats: CreditEat[];
  customers: import('./utils/customers').CustomerProfile[];
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
  branch: string | null;
  salesCount: number;
  revenue: number;
  designRevenue: number;
  designProfit: number;
  cogs: number;
  grossProfit: number;
  expenseTotal: number;
  netProfit: number;
  creditOutstanding: number;
  vatTotal: number;
  lowStockCount: number;
  hourly?: number[];
  daily?: { date: string; revenue: number }[];
}

export const summaryApi = {
  list: (from?: string, to?: string, bucket?: 'hourly' | 'daily', branch?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    if (bucket) qs.set('bucket', bucket);
    if (branch) qs.set('branch', branch);
    const q = qs.toString();
    return api<SummaryResult>(`/api/summary${q ? `?${q}` : ''}`);
  },
};

export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  detail: string;
  actorId?: string;
  actorName?: string;
  actorRole?: string;
  metadata?: Record<string, unknown>;
  requestId?: string;
}

export interface AuditSearchQuery {
  q?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export interface AuditSearchResult {
  entries: AuditEntry[];
  nextCursor: string | null;
  total: number;
}

function headerValue(res: unknown, name: string): string | null {
  try {
    return (res as { headers?: { get?: (n: string) => string | null } })?.headers?.get?.(name) ?? null;
  } catch {
    return null;
  }
}

async function fetchJson<T>(path: string, ms: number): Promise<{ data: T; response: unknown }> {
  const res = await fetchTimeout(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json', Authorization: getAuthHeader() } }, ms);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const body = (data || {}) as { error?: string; code?: string; traceId?: string };
    throw new ApiError(body.error || `API error: ${res.status}`, res.status, body.code, body.traceId || responseTraceId(res));
  }
  return { data: data as T, response: res };
}

export async function searchAudit(query: AuditSearchQuery = {}): Promise<AuditSearchResult> {
  const qs = new URLSearchParams();
  if (query.q) qs.set('q', String(query.q).slice(0, 120));
  if (query.action) qs.set('action', String(query.action).slice(0, 120));
  if (query.from) qs.set('from', String(query.from).slice(0, 40));
  if (query.to) qs.set('to', String(query.to).slice(0, 40));
  if (query.limit) qs.set('limit', String(query.limit));
  if (query.cursor) qs.set('cursor', String(query.cursor));
  const { data, response } = await fetchJson<AuditEntry[]>(`/api/audit?${qs.toString()}`, READ_TIMEOUT_MS);
  const total = parseInt(headerValue(response, 'X-Total-Count') || '0', 10);
  return {
    entries: Array.isArray(data) ? data : [],
    nextCursor: headerValue(response, 'X-Next-Cursor'),
    total: Number.isFinite(total) ? total : 0,
  };
}

export const auditApi = {
  list: (limit = 100) => api<AuditEntry[]>(`/api/audit?limit=${limit}`, { fresh: true }),
  search: searchAudit,
};

export interface ReadyReport {
  status: 'ready' | 'degraded';
  build: string;
  startedAt: string;
  uptimeSeconds: number;
  database: { configured: boolean; ok: boolean; latencyMs: number; error: string | null };
  traceId?: string;
}

export const supportApi = {
  ready: async (): Promise<{ ok: boolean; report: ReadyReport | null; traceId?: string }> => {
    try {
      const res = await fetchTimeout(`${BASE}/api/ready`, { headers: { 'Content-Type': 'application/json', Authorization: getAuthHeader() } }, READ_TIMEOUT_MS);
      const body = await res.json().catch(() => null) as ReadyReport | null;
      if (!body || typeof body.status !== 'string') return { ok: res.ok, report: null, traceId: responseTraceId(res) };
      return { ok: res.ok && body.status === 'ready', report: body, traceId: body.traceId || responseTraceId(res) };
    } catch (err) {
      return { ok: false, report: null, traceId: err instanceof ApiError ? err.traceId : undefined };
    }
  },
};

export interface PortableTableMeta {
  rows: number;
  checksum: string;
}

export interface PortableExport {
  formatVersion?: number;
  appVersion?: string;
  exportedAt?: string;
  generator?: string;
  shop?: { id?: string; tenantId?: string; name?: string; build?: string };
  scope?: Record<string, unknown>;
  redaction?: { mode?: string; includesCredentials?: boolean; excludedSettings?: string[]; excludesStaffPinHashes?: boolean; imageBytesIncluded?: boolean };
  tables?: Record<string, PortableTableMeta>;
  checksum?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface BackupSnapshot {
  id: string;
  createdAt: string;
  formatVersion: number;
  checksum: string;
  rowCounts: Record<string, number>;
}

export interface BackupRunResult {
  success: boolean;
  records?: number;
  backup?: BackupSnapshot;
  error?: string;
  code?: string;
}

export interface RestoreCollision {
  table: string;
  incoming: number;
  columns: number;
  overwrite: number;
  insert: number;
  sample: string[];
}

export interface RestorePreflight {
  success: boolean;
  dryRun: boolean;
  mode: 'merge';
  formatVersion: number;
  appVersion: string | null;
  exportedAt: string | null;
  shop: { incoming: PortableExport['shop'] | null; local: { id: string; name: string }; matches: boolean; override: boolean };
  checks: { envelope: boolean; payloadChecksum: string; tables: number; rejectedRows: Record<string, number> };
  rows: Record<string, number>;
  collisions: RestoreCollision[];
  totals: { tables: number; incoming: number; overwrite: number; insert: number; rejected: number; skippedSettings: number };
  skipped: { settings: Record<string, string> };
  assets: { referenced: number; missing: number };
  warnings: string[];
  restored?: Record<string, number>;
  rowsWritten?: number;
  partial?: boolean;
  errors?: { table: string; error: string }[];
}
export function backupTableRows(payload: PortableExport | null | undefined, table: string): number {
  if (!payload) return 0;
  const meta = payload.tables?.[table];
  if (meta && Number.isFinite(Number(meta.rows))) return Number(meta.rows);
  const rows = payload.data ? payload.data[table] : (payload as Record<string, unknown>)[table];
  return Array.isArray(rows) ? rows.length : 0;
}

export function backupRowTotal(payload: PortableExport | null | undefined): number {
  if (!payload) return 0;
  if (payload.tables) return Object.values(payload.tables).reduce<number>((sum, meta) => sum + (Number(meta?.rows) || 0), 0);
  return Object.values<unknown>(payload.data || payload).reduce<number>((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0);
}

export const backupsApi = {
  latest: () => api<{ id: string | null; createdAt: string | null }>('/api/backups/latest', { fresh: true }),
  data: () => api<{ id: string | null; createdAt: string | null; data: PortableExport | null }>('/api/backups/data', { fresh: true }),
  run: () => api<BackupRunResult>('/api/backups/run', { method: 'POST' }),
};

export const reconcileApi = {
  check: () => api<{ salesChecked: number; totalMismatches: number; negativeStock: { id: string; name: string; qty: number }[]; dupOrderNumbers: { ordernumber: string; c: number }[] }>('/api/reconcile', { fresh: true }),
  fix: () => api<{ salesChecked: number; totalMismatches: number; totalFixes: number; negativeStock: { id: string; name: string; qty: number }[]; negativeFixed: number; dupOrderNumbers: { ordernumber: string; c: number }[] }>('/api/reconcile?fix=1', { method: 'POST' }),
};

export const exportApi = {
  download: () => api<PortableExport>('/api/export', { fresh: true }),  downloadWithCredentials: () => api<PortableExport>('/api/export/with-credentials', { fresh: true }),
};

export const restoreApi = {
  preflight: (data: PortableExport | Record<string, unknown>) => api<RestorePreflight>('/api/restore/preflight', { method: 'POST', body: JSON.stringify(data) }),
  restore: (data: PortableExport | Record<string, unknown>) => api<RestorePreflight>('/api/restore', { method: 'POST', body: JSON.stringify(data) }),
};
