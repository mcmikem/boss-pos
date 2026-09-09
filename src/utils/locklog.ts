// Lock-reason ring buffer. When a till "keeps asking for PIN", the cause is
// one of: boot (PIN set), idle timeout, server 401 on some endpoint, or a
// manual log-out-all. Recording every transition with its reason turns the
// next loop into a named cause instead of a mystery. Last 10, localStorage.

export interface LockEvent {
  at: string; // ISO timestamp
  reason: string; // e.g. 'boot:pin-set', 'idle', 'revoke:/api/sales', 'revoke-all'
}

const KEY = 'boss_pos_lock_log';
const MAX = 10;

export function recordLock(reason: string, at?: string): LockEvent[] {
  const entry: LockEvent = { at: at || new Date().toISOString(), reason };
  try {
    const prev = readLockLog();
    const next = [entry, ...prev].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch {
    return [entry];
  }
}

export function readLockLog(): LockEvent[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter(e => e && typeof e.at === 'string' && typeof e.reason === 'string').slice(0, MAX);
  } catch {
    return [];
  }
}

export function clearLockLog(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// True when locks are cycling: 3+ in the last 3 minutes. Used to escalate
// from "re-enter PIN" to "something structural is wrong, here's what to do".
export function isRapidRelock(log: LockEvent[], nowMs?: number): boolean {
  if (log.length < 3) return false;
  const now = nowMs ?? Date.now();
  const third = Date.parse(log[2].at);
  if (!Number.isFinite(third)) return false;
  return now - third <= 3 * 60 * 1000;
}
