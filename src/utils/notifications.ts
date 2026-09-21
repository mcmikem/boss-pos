// Notification center: ONE place for every alert, throttled so a PIN unlock
// never re-fires the whole low-stock list. Persisted in localStorage with
// read/unread + delete, so the bell shows history instead of toasts.
// Throttle rule: same dedupeKey may only create ONE unread notification per
// 24h. Unlocks, re-renders and background syncs all funnel through push()
// which enforces it.

export type NoticeKind =
  | 'low-stock'
  | 'negative-stock'
  | 'expiry'
  | 'unaccounted'
  | 'no-production'
  | 'shrinkage'
  | 'sync'
  | 'info';

export type NoticeTab = 'sales' | 'inventory' | 'analytics' | 'expenses' | 'registers';

export interface NoticeAction {
  label: string;
  tab: NoticeTab;
}

export interface AppNotice {
  id: string;
  kind: NoticeKind;
  title: string;
  body: string;
  at: string; // ISO
  read: boolean;
  dedupeKey: string; // e.g. low:p123:2026-09-12
  action?: NoticeAction; // jump button: "Restock → Stock", "Move it → Close day"
}

const LIST_KEY = 'boss_pos_notices_v1';
const THROTTLE_KEY = 'boss_pos_notice_throttle_v1';
const THROTTLE_MS = 24 * 60 * 60 * 1000;
const MAX_STORED = 100;

function loadList(): AppNotice[] {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveList(list: AppNotice[]): void {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(list.slice(0, MAX_STORED)));
  } catch {}
  try {
    window.dispatchEvent(new Event('boss-pos-notices-updated'));
  } catch {}
}

function loadThrottle(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(THROTTLE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveThrottle(m: Record<string, number>): void {
  try {
    // Prune entries older than 8 days so the map never grows forever.
    const cutoff = Date.now() - 8 * 24 * 60 * 60 * 1000;
    for (const k of Object.keys(m)) if ((m[k] || 0) < cutoff) delete m[k];
    localStorage.setItem(THROTTLE_KEY, JSON.stringify(m));
  } catch {}
}

export function listNotices(): AppNotice[] {
  return loadList().sort((a, b) => b.at.localeCompare(a.at));
}

export function unreadCount(): number {
  return loadList().filter((n) => !n.read).length;
}

/**
 * Push a notification, throttled by dedupeKey (24h). Returns the notice or
 * null when suppressed as a repeat. Set opts.force to bypass (critical).
 * opts.action adds a jump button ("Restock → Stock") so a notice is a task,
 * not just something to read.
 */
export function pushNotice(
  kind: NoticeKind,
  title: string,
  body: string,
  dedupeKey: string,
  opts?: { force?: boolean; action?: NoticeAction },
): AppNotice | null {
  const now = Date.now();
  const throttle = loadThrottle();
  const last = throttle[dedupeKey] || 0;
  if (!opts?.force && now - last < THROTTLE_MS) return null;
  // Same unread already sitting in the list? Don't duplicate.
  const existing = loadList().find((n) => n.dedupeKey === dedupeKey && !n.read);
  if (existing && !opts?.force) {
    throttle[dedupeKey] = now;
    saveThrottle(throttle);
    return null;
  }
  throttle[dedupeKey] = now;
  saveThrottle(throttle);
  const notice: AppNotice = {
    id: `n-${now}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    title,
    body,
    at: new Date(now).toISOString(),
    read: false,
    dedupeKey,
    ...(opts?.action ? { action: opts.action } : {}),
  };
  saveList([notice, ...loadList()]);
  return notice;
}

export function markNoticeRead(id: string): void {
  saveList(loadList().map((n) => (n.id === id ? { ...n, read: true } : n)));
}

export function markAllRead(): void {
  saveList(loadList().map((n) => ({ ...n, read: true })));
}

export function deleteNotice(id: string): void {
  saveList(loadList().filter((n) => n.id !== id));
}

export function clearRead(): void {
  saveList(loadList().filter((n) => !n.read));
}

export function dayKeyOf(at?: string | number): string {
  const d = at ? new Date(at) : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
