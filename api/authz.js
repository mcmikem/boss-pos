export const TILL_ROLE = 'till';
export const MANAGER_ROLE = 'manager';
export const CASHIER_ROLE = 'cashier';
export const MANAGER_REQUIRED_CODE = 'MANAGER_REQUIRED';

export function managerAllowed(auth, staffCount) {
  if (!auth || typeof auth !== 'object') return false;
  if (auth.role === MANAGER_ROLE) return true;
  if (auth.role === CASHIER_ROLE) return false;
  return (staffCount || 0) === 0;
}

// How long a seller may undo their own just-rung sale without a manager.
export const SELF_UNDO_WINDOW_MS = 60 * 1000;

// Undo of your own just-rung sale, for a seller who is not a manager. Kept as a
// pure decision so the boundaries are pinned by tests rather than by prose: the
// SAME person, inside the window, a live sale, refund only. Anything else is a
// manager's job — widening this is a one-line change someone must notice.
export function selfUndoAllowed({ saleStaffId, saleActorId, actorId, ageMs, refunded, voided, windowMs = SELF_UNDO_WINDOW_MS } = {}) {
  if (!actorId) return false;
  if (refunded || voided) return false;
  const mine = String(saleStaffId || '') === String(actorId) || String(saleActorId || '') === String(actorId);
  if (!mine) return false;
  if (!Number.isFinite(ageMs) || ageMs < 0) return false;
  return ageMs <= windowMs;
}

