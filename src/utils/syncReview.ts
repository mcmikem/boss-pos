// Sync review queue: offline writes the server refused (edit lost a
// multi-till race, sale failed on empty stock, request the server rejected)
// used to vanish with only a toast. They now land here in plain language so
// the owner can re-enter what matters instead of silently losing it.

export type SyncReviewKind = 'conflict' | 'stock' | 'refused';

export interface SyncReviewItem {
  id: string;
  at: number;
  kind: SyncReviewKind;
  summary: string;
}

interface QueueEntry {
  id?: string;
  path: string;
  method: string;
  body?: string;
}

const REVIEW_KEY = 'boss_pos_sync_review';
const MAX_ITEMS = 50;

function parseBody(body: string | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(body || '{}') as unknown;
    return (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
}

// One plain-language line per refused write. Never throws — worst case it
// falls back to METHOD + path so the row is still reviewable.
export function summarizeRefused(entry: QueueEntry, kind: SyncReviewKind): string {
  const b = parseBody(entry.body);
  const path = entry.path || '';
  try {
    if (path === '/api/sales' && entry.method === 'POST') {
      const total = num(b.total);
      const who = typeof b.customerName === 'string' && b.customerName.trim()
        ? ` for ${b.customerName.trim()}`
        : '';
      const method = typeof b.paymentMethod === 'string' ? ` (${b.paymentMethod})` : '';
      const what = kind === 'stock' ? 'sold out before sync' : 'refused by server';
      return `Sale${who}${total !== null ? ` ${Math.round(total).toLocaleString()}` : ''}${method} — ${what}, re-enter if the customer paid`;
    }
    if (path.startsWith('/api/products') && entry.method === 'PUT') {
      const name = typeof b.name === 'string' && b.name.trim() ? ` "${b.name.trim()}"` : '';
      return `Product edit${name} — another till saved first, check the latest version`;
    }
    if (path.startsWith('/api/expenses') && entry.method === 'POST') {
      const amount = num(b.amount);
      const desc = typeof b.description === 'string' && b.description.trim() ? `: ${b.description.trim()}` : '';
      return `Expense${amount !== null ? ` ${Math.round(amount).toLocaleString()}` : ''}${desc} — re-enter if the money left`;
    }
    if (entry.method === 'DELETE') return `Delete ${path} — server already handled it or refused`;
    return `${entry.method} ${path} — refused by server`.trim() || 'Queued change — refused by server';
  } catch {
    return `${entry.method} ${path} — refused by server`.trim() || 'Queued change — refused by server';
  }
}

export function readSyncReview(): SyncReviewItem[] {
  try {
    const raw = localStorage.getItem(REVIEW_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr as SyncReviewItem[] : [];
  } catch {
    return [];
  }
}

export function stashSyncReview(kind: SyncReviewKind, entry: QueueEntry): SyncReviewItem {
  const item: SyncReviewItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    kind,
    summary: summarizeRefused(entry, kind),
  };
  try {
    const list = [item, ...readSyncReview()].slice(0, MAX_ITEMS);
    localStorage.setItem(REVIEW_KEY, JSON.stringify(list));
  } catch {}
  try {
    window.dispatchEvent(new Event('boss-pos-sync-review'));
  } catch {}
  return item;
}

export function clearSyncReview(): void {
  try {
    localStorage.removeItem(REVIEW_KEY);
  } catch {}
  try {
    window.dispatchEvent(new Event('boss-pos-sync-review'));
  } catch {}
}
