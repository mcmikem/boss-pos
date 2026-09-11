import type { SaleItem } from '../types';

// Suspended carts: park a half-built sale under a customer name and recall
// it later. This till only (localStorage) — parked carts never sync; the
// completed sale syncs normally when it is rung through.
export interface ParkedCart {
  id: string;
  name: string;
  items: SaleItem[];
  paymentMethod?: string;
  customerName?: string;
  createdAt: string;
}

const KEY = 'boss_pos_parked';
const MAX = 12;

export function loadParked(): ParkedCart[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter(p => p && typeof p.id === 'string' && Array.isArray(p.items)).slice(0, MAX);
  } catch {
    return [];
  }
}

function saveParked(list: ParkedCart[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch {}
}

export function parkCart(entry: Omit<ParkedCart, 'id' | 'createdAt'>): ParkedCart[] {
  const full: ParkedCart = {
    ...entry,
    id: `park-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
  };
  const next = [full, ...loadParked()].slice(0, MAX);
  saveParked(next);
  return next;
}

export function unparkCart(id: string): ParkedCart[] {
  const next = loadParked().filter(p => p.id !== id);
  saveParked(next);
  return next;
}

export function parkedTotal(p: ParkedCart): number {
  return p.items.reduce((s, i) => s + (i.lineTotal || 0), 0);
}

export function parkedCount(p: ParkedCart): number {
  return p.items.reduce((s, i) => s + (i.qty || 0), 0);
}
