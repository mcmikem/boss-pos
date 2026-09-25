import type { SaleItem } from '../types';
import { idbRecordDelete, idbRecordGet, idbRecordSet } from './outboxIdb';

export interface ParkedCart {
  id: string;
  name: string;
  items: SaleItem[];
  paymentMethod?: string;
  customerName?: string;
  createdAt: string;
}

export interface ParkedCartScope {
  branch?: string;
  tillId?: string;
}

const KEY = 'boss_pos_parked';
const SCOPE_PREFIX = 'boss_pos_parked_v1';
const STORE_KEY = 'parked-carts';
const MAX = 12;

function scopeValue(scope?: ParkedCartScope): { branch: string; tillId: string } {
  let branch = '';
  try { branch = localStorage.getItem('boss_pos_branch') || ''; } catch {}
  return {
    branch: String(scope?.branch ?? branch).trim().slice(0, 120),
    tillId: String(scope?.tillId ?? 'device').trim().slice(0, 120) || 'device',
  };
}

function idbKey(scope?: ParkedCartScope): string {
  const value = scopeValue(scope);
  return `${STORE_KEY}:${encodeURIComponent(value.branch)}:${encodeURIComponent(value.tillId)}`;
}

function localKey(scope?: ParkedCartScope): string {
  const value = scopeValue(scope);
  return `${SCOPE_PREFIX}:${encodeURIComponent(value.branch)}:${encodeURIComponent(value.tillId)}`;
}

function parseListValue(value: unknown): ParkedCart[] | null {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return null; }
  }
  if (!Array.isArray(parsed)) return null;
  const list: ParkedCart[] = [];
  for (const entry of parsed.slice(0, MAX)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== 'string' || !row.id || typeof row.name !== 'string' || !row.name || !Array.isArray(row.items) || typeof row.createdAt !== 'string') continue;
    const parked: ParkedCart = {
      id: row.id,
      name: row.name.slice(0, 120),
      items: row.items as SaleItem[],
      createdAt: row.createdAt,
    };
    if (typeof row.paymentMethod === 'string') parked.paymentMethod = row.paymentMethod;
    if (typeof row.customerName === 'string') parked.customerName = row.customerName.slice(0, 120);
    list.push(parked);
  }
  return list;
}

function readLocal(scope?: ParkedCartScope): ParkedCart[] {
  try {
    const scoped = parseListValue(localStorage.getItem(localKey(scope)));
    if (scoped) return scoped;
  } catch {}
  return parseListValue(localStorage.getItem(KEY)) || [];
}

function writeLocal(list: ParkedCart[], scope?: ParkedCartScope): boolean {
  try {
    const json = JSON.stringify(list.slice(0, MAX));
    localStorage.setItem(KEY, json);
    localStorage.setItem(localKey(scope), json);
    return true;
  } catch {
    return false;
  }
}

export function loadParked(): ParkedCart[] {
  try { return parseListValue(localStorage.getItem(KEY)) || []; } catch { return []; }
}

function saveParked(list: ParkedCart[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch {}
}

const writeChains = new Map<string, Promise<unknown>>();

function queueWrite<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = writeChains.get(key) || Promise.resolve();
  const run = previous.then(work, work);
  writeChains.set(key, run.then(() => undefined, () => undefined));
  return run;
}

export function parkCart(entry: Omit<ParkedCart, 'id' | 'createdAt'>, scope?: ParkedCartScope): ParkedCart[] {
  const full: ParkedCart = {
    ...entry,
    id: `park-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
  };
  const next = [full, ...readLocal(scope)].slice(0, MAX);
  saveParked(next);
  void saveParkedAsync(next, scope).catch(() => {});
  return next;
}

export function unparkCart(id: string, scope?: ParkedCartScope): ParkedCart[] {
  const next = readLocal(scope).filter(p => p.id !== id);
  saveParked(next);
  void saveParkedAsync(next, scope).catch(() => {});
  return next;
}

export function parkedTotal(p: ParkedCart): number {
  return p.items.reduce((s, i) => s + (i.lineTotal || 0), 0);
}

export function parkedCount(p: ParkedCart): number {
  return p.items.reduce((s, i) => s + (i.qty || 0), 0);
}

export async function loadParkedAsync(scope?: ParkedCartScope): Promise<ParkedCart[]> {
  const key = idbKey(scope);
  let stored: unknown;
  try { stored = await idbRecordGet('parked', key); } catch {}
  const fromIdb = parseListValue(stored);
  if (fromIdb) {
    writeLocal(fromIdb, scope);
    return fromIdb;
  }
  const local = readLocal(scope);
  if (local.length > 0) {
    try { await idbRecordSet('parked', key, JSON.stringify(local)); } catch {}
  }
  return local;
}

export async function saveParkedAsync(list: ParkedCart[], scope?: ParkedCartScope): Promise<void> {
  const key = idbKey(scope);
  saveParked(list);
  await queueWrite(key, async () => {
    const next = list.slice(0, MAX);
    const localSaved = writeLocal(next, scope);
    let idbSaved = false;
    try { await idbRecordSet('parked', key, JSON.stringify(next)); idbSaved = true; } catch {}
    if (!idbSaved && !localSaved) throw new Error('Parked cart storage unavailable');
  });
}

export async function clearParkedAsync(scope?: ParkedCartScope): Promise<void> {
  const key = idbKey(scope);
  saveParked([]);
  await queueWrite(key, async () => {
    try { localStorage.removeItem(localKey(scope)); } catch {}
    await idbRecordDelete('parked', key);
  });
}
