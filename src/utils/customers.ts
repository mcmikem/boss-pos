import type { Sale } from '../types';
import { isLiveSale } from './saleStatus';

// Regulars directory (per device): who the frequent buyers are, how to reach
// them, what standing they have. Spend/visit stats are always computed live
// from sales — the profile only stores what sales can't say.
export interface CustomerProfile {
  id: string;
  name: string;
  phone?: string;
  birthday?: string; // MM-DD
  tags?: string[]; // e.g. VIP, Wholesale
  discountPct?: number; // one-tap VIP discount at the till
  subscribed?: boolean; // wants new-arrival alerts
  notes?: string;
  createdAt: string;
  updatedAt?: string;
  clientWriteId?: string;
}

export interface CustomerStats {
  visits: number;
  totalSpent: number;
  lastVisit: string | null;
  outstanding: number;
}

const KEY = 'boss_pos_customers';
const EVENT = 'boss-pos-customers-updated';

export function loadCustomers(): CustomerProfile[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

export function saveCustomers(list: CustomerProfile[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    window.dispatchEvent(new Event(EVENT));
  } catch {}
}

export function findProfile(list: CustomerProfile[], name: string): CustomerProfile | undefined {
  const n = (name || '').trim().toLowerCase();
  if (!n) return undefined;
  return list.find(c => (c.name || '').trim().toLowerCase() === n);
}

export function statsFor(name: string, sales: Sale[]): CustomerStats {
  const n = (name || '').trim().toLowerCase();
  let visits = 0;
  let totalSpent = 0;
  let lastVisit: string | null = null;
  for (const s of sales) {
    if ((s.customerName || '').trim().toLowerCase() !== n) continue;
    if (!isLiveSale(s)) continue;
    visits += 1;
    totalSpent += s.total || 0;
    if (!lastVisit || s.timestamp > lastVisit) lastVisit = s.timestamp;
  }
  return { visits, totalSpent, lastVisit, outstanding: 0 };
}

// Uganda phone → wa.me digits (shared with serviceSale's version for jobs).
export function customerWhatsAppUrl(phone: string | undefined, message: string): string | null {
  const digits = (phone || '').replace(/\D/g, '');
  let intl = '';
  if (/^0\d{9}$/.test(digits)) intl = `256${digits.slice(1)}`;
  else if (/^256\d{9}$/.test(digits)) intl = digits;
  else return null;
  return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
}
