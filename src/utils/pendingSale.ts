import type { Sale } from '../types';
import { idbRecordDelete, idbRecordGet, idbRecordSet } from './outboxIdb';

const KEY = 'boss_pos_pending_sale';
const SCOPE_PREFIX = 'boss_pos_pending_sale_v1';
const STORE_KEY = 'pending-sale';
const PAYMENT_METHODS = ['Cash', 'MTN MoMo', 'Airtel Money', 'Credit / Book', 'Split'];

export interface PendingSaleScope {
  branch?: string;
  tillId?: string;
}

function scopeValue(scope?: PendingSaleScope): { branch: string; tillId: string } {
  let branch = '';
  try { branch = localStorage.getItem('boss_pos_branch') || ''; } catch {}
  return {
    branch: String(scope?.branch ?? branch).trim().slice(0, 120),
    tillId: String(scope?.tillId ?? 'device').trim().slice(0, 120) || 'device',
  };
}

function idbKey(scope?: PendingSaleScope): string {
  const value = scopeValue(scope);
  return `${STORE_KEY}:${encodeURIComponent(value.branch)}:${encodeURIComponent(value.tillId)}`;
}

function localKey(scope?: PendingSaleScope): string {
  const value = scopeValue(scope);
  return `${SCOPE_PREFIX}:${encodeURIComponent(value.branch)}:${encodeURIComponent(value.tillId)}`;
}

function parseSale(value: unknown): Sale | null {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return null; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const sale = parsed as Partial<Sale>;
  if (typeof sale.id !== 'string' || !sale.id || !Array.isArray(sale.items) || sale.items.length === 0) return null;
  if (typeof sale.orderNumber !== 'string' || typeof sale.timestamp !== 'string' || !PAYMENT_METHODS.includes(sale.paymentMethod as string)) return null;
  if (!Number.isFinite(Number(sale.total)) || Number(sale.total) < 0) return null;
  return sale as Sale;
}

function readLocal(scope?: PendingSaleScope): Sale | null {
  try {
    const scoped = parseSale(localStorage.getItem(localKey(scope)));
    return scoped || parseSale(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

function writeLocal(sale: Sale, scope?: PendingSaleScope): boolean {
  try {
    const json = JSON.stringify(sale);
    localStorage.setItem(KEY, json);
    localStorage.setItem(localKey(scope), json);
    return true;
  } catch {
    return false;
  }
}

function clearLocal(scope?: PendingSaleScope): boolean {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(localKey(scope));
    return true;
  } catch {
    return false;
  }
}

export function loadPendingSale(): Sale | null {
  try { return parseSale(localStorage.getItem(KEY)); } catch { return null; }
}

export function savePendingSale(sale: Sale): void {
  try { localStorage.setItem(KEY, JSON.stringify(sale)); } catch {}
}

export function clearPendingSale(): void {
  try { localStorage.removeItem(KEY); } catch {}
}

const writeChains = new Map<string, Promise<unknown>>();

function queueWrite<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = writeChains.get(key) || Promise.resolve();
  const run = previous.then(work, work);
  writeChains.set(key, run.then(() => undefined, () => undefined));
  return run;
}

export async function loadPendingSaleAsync(scope?: PendingSaleScope): Promise<Sale | null> {
  const key = idbKey(scope);
  let stored: unknown;
  try { stored = await idbRecordGet('pending', key); } catch {}
  const fromIdb = parseSale(stored);
  if (fromIdb) {
    writeLocal(fromIdb, scope);
    return fromIdb;
  }
  const local = readLocal(scope);
  if (local) {
    try { await idbRecordSet('pending', key, JSON.stringify(local)); } catch {}
  }
  return local;
}

export async function savePendingSaleAsync(sale: Sale, scope?: PendingSaleScope): Promise<void> {
  const key = idbKey(scope);
  savePendingSale(sale);
  await queueWrite(key, async () => {
    const localSaved = writeLocal(sale, scope);
    let idbSaved = false;
    try { await idbRecordSet('pending', key, JSON.stringify(sale)); idbSaved = true; } catch {}
    if (!idbSaved && !localSaved) throw new Error('Pending sale storage unavailable');
  });
}

export async function clearPendingSaleAsync(scope?: PendingSaleScope): Promise<void> {
  const key = idbKey(scope);
  clearPendingSale();
  await queueWrite(key, async () => {
    clearLocal(scope);
    await idbRecordDelete('pending', key);
  });
}
