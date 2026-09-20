// Per-device stock-move journal: every add/remove/set lands here with its
// reason, so "where did 10 sodas go?" always has an answer. Cap 100 entries.
export interface AdjustEntry {
  ts: string;
  productId: string;
  name: string;
  type: string;
  qty: number;
  reason: string;
}

const KEY = 'boss_pos_adjust_log';

export function readAdjustLog(): AdjustEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

export function logAdjustment(e: AdjustEntry): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([e, ...readAdjustLog()].slice(0, 100)));
  } catch {}
}
