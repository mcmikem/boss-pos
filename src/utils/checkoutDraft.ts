import type { SaleItem, SplitTender } from '../types';
import { idbDraftGet, idbDraftSet } from './outboxIdb';

export const CHECKOUT_DRAFT_VERSION = 2 as const;

export type CheckoutPaymentMethod = 'Cash' | 'MTN MoMo' | 'Airtel Money' | 'Credit / Book' | 'Split';

export interface CheckoutDraft {
  version: 1;
  paymentMethod: CheckoutPaymentMethod;
  customerName: string;
  discount: string;
  discountType: 'fixed' | 'percent';
  customCashReceived: string;
  splitLeg1Method: SplitTender['method'];
  splitLeg1Amount: string;
  splitLeg2Method: SplitTender['method'];
}

export interface CheckoutDraftScope {
  branch?: string;
  tillId?: string;
  till?: string;
}

export interface ActiveCheckoutDraft extends Omit<CheckoutDraft, 'version'> {
  version: typeof CHECKOUT_DRAFT_VERSION;
  cart: SaleItem[];
  branch: string;
  tillId: string;
  savedAt: number;
  cleared?: boolean;
}

export type ActiveCheckoutDraftInput = Partial<Omit<ActiveCheckoutDraft, 'version' | 'branch' | 'tillId' | 'savedAt'>> & {
  cart?: SaleItem[];
  branch?: string;
  tillId?: string;
  till?: string;
  version?: 1 | typeof CHECKOUT_DRAFT_VERSION;
};

const KEY = 'boss_pos_checkout_draft';
const CART_KEY = 'boss_pos_cart';
const SCOPE_PREFIX = `boss_pos_checkout_draft_v${CHECKOUT_DRAFT_VERSION}`;
const METHODS: CheckoutPaymentMethod[] = ['Cash', 'MTN MoMo', 'Airtel Money', 'Credit / Book', 'Split'];
const TENDERS: SplitTender['method'][] = ['Cash', 'MTN MoMo', 'Airtel Money'];

const text = (value: unknown, max = 120): string => typeof value === 'string' ? value.slice(0, max) : '';

function scopeValue(scope?: CheckoutDraftScope): { branch: string; tillId: string } {
  let savedBranch = '';
  try { savedBranch = localStorage.getItem('boss_pos_branch') || ''; } catch {}
  const branch = String(scope?.branch ?? savedBranch).trim().slice(0, 120);
  const tillId = String(scope?.tillId ?? scope?.till ?? 'device').trim().slice(0, 120) || 'device';
  return { branch, tillId };
}

export function checkoutDraftScopeKey(scope?: CheckoutDraftScope): string {
  const value = scopeValue(scope);
  return `${SCOPE_PREFIX}:${encodeURIComponent(value.branch)}:${encodeURIComponent(value.tillId)}`;
}

type CheckoutFields = Omit<ActiveCheckoutDraft, 'version' | 'cart' | 'branch' | 'tillId' | 'savedAt'>;

function defaultFields(): CheckoutFields {
  return {
    paymentMethod: 'Cash',
    customerName: '',
    discount: '',
    discountType: 'fixed',
    customCashReceived: '',
    splitLeg1Method: 'Cash',
    splitLeg1Amount: '',
    splitLeg2Method: 'MTN MoMo',
  };
}

function normalizeFields(value: unknown): CheckoutFields {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const method = source.paymentMethod as CheckoutPaymentMethod;
  const first = source.splitLeg1Method as SplitTender['method'];
  const second = source.splitLeg2Method as SplitTender['method'];
  return {
    paymentMethod: METHODS.includes(method) ? method : 'Cash',
    customerName: text(source.customerName),
    discount: text(source.discount, 40),
    discountType: source.discountType === 'percent' ? 'percent' : 'fixed',
    customCashReceived: text(source.customCashReceived, 40),
    splitLeg1Method: TENDERS.includes(first) ? first : 'Cash',
    splitLeg1Amount: text(source.splitLeg1Amount, 40),
    splitLeg2Method: TENDERS.includes(second) ? second : 'MTN MoMo',
  };
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCart(value: unknown): SaleItem[] {
  if (!Array.isArray(value)) return [];
  const items: SaleItem[] = [];
  for (const valueItem of value.slice(0, 500)) {
    if (!valueItem || typeof valueItem !== 'object' || Array.isArray(valueItem)) continue;
    const row = valueItem as Record<string, unknown>;
    const productId = text(row.productId, 200);
    const productName = text(row.productName, 240);
    const qty = finiteNumber(row.qty, -1);
    const unitPrice = finiteNumber(row.unitPrice, -1);
    const unitCost = finiteNumber(row.unitCost, -1);
    const lineTotal = finiteNumber(row.lineTotal, -1);
    if (!productId || !productName || qty <= 0 || unitPrice < 0 || unitCost < 0 || lineTotal < 0) continue;
    const item: SaleItem = { productId, productName, qty, unitPrice, unitCost, lineTotal };
    const variantId = text(row.variantId, 200);
    const variantLabel = text(row.variantLabel, 240);
    const saleUnit = text(row.saleUnit, 80);
    const lineDiscount = finiteNumber(row.lineDiscount, 0);
    if (variantId) item.variantId = variantId;
    if (variantLabel) item.variantLabel = variantLabel;
    if (saleUnit) item.saleUnit = saleUnit;
    if (lineDiscount > 0) item.lineDiscount = lineDiscount;
    items.push(item);
  }
  return items;
}

function parseValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function normalizeActive(value: unknown, scope: { branch: string; tillId: string }, fallbackCart: SaleItem[] = []): ActiveCheckoutDraft | null {
  const source = parseValue(value);
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const row = source as Record<string, unknown>;
  const version = row.version;
  if (version !== 1 && version !== CHECKOUT_DRAFT_VERSION) return null;
  const hasCart = Array.isArray(row.cart);
  if (version === CHECKOUT_DRAFT_VERSION && !hasCart) return null;
  const scopeSource = row.scope && typeof row.scope === 'object' && !Array.isArray(row.scope)
    ? row.scope as Record<string, unknown>
    : row;
  const storedBranch = typeof scopeSource.branch === 'string' ? scopeSource.branch.trim().slice(0, 120) : '';
  const storedTill = typeof scopeSource.tillId === 'string'
    ? scopeSource.tillId.trim().slice(0, 120)
    : typeof scopeSource.till === 'string' ? scopeSource.till.trim().slice(0, 120) : '';
  if (storedBranch !== scope.branch || storedTill !== scope.tillId) return null;
  const fieldSource = row.checkout && typeof row.checkout === 'object' && !Array.isArray(row.checkout)
    ? row.checkout
    : row;
  const savedAt = finiteNumber(row.savedAt, 0);
  const cart = hasCart ? normalizeCart(row.cart) : normalizeCart(fallbackCart);
  return {
    version: CHECKOUT_DRAFT_VERSION,
    ...normalizeFields(fieldSource),
    cart,
    branch: scope.branch,
    tillId: scope.tillId,
    savedAt: savedAt > 0 ? savedAt : Date.now(),
    cleared: row.cleared === true || (version === CHECKOUT_DRAFT_VERSION && hasCart && cart.length === 0),
  };
}

function readLocalRecord(scope: CheckoutDraftScope, fallbackCart: SaleItem[] = []): ActiveCheckoutDraft | null {
  try {
    const raw = localStorage.getItem(checkoutDraftScopeKey(scope));
    return normalizeActive(raw, scopeValue(scope), fallbackCart);
  } catch {
    return null;
  }
}

function writeLocalRecord(key: string, record: ActiveCheckoutDraft): boolean {
  try { localStorage.setItem(key, JSON.stringify(record)); return true; } catch { return false; }
}

function readLegacyFields(): CheckoutDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    const value = parseValue(raw) as Record<string, unknown> | null;
    if (!value || value.version !== 1 || !METHODS.includes(value.paymentMethod as CheckoutPaymentMethod)) return null;
    return { version: 1, ...normalizeFields(value) };
  } catch {
    return null;
  }
}

function readLegacyCart(): SaleItem[] {
  try { return normalizeCart(parseValue(localStorage.getItem(CART_KEY))); } catch { return []; }
}

type DraftRecordInput = Partial<Omit<ActiveCheckoutDraft, 'version'>> & {
  version?: 1 | typeof CHECKOUT_DRAFT_VERSION;
  till?: string;
};

function makeRecord(scope: CheckoutDraftScope, input: DraftRecordInput = {}, savedAt = Date.now()): ActiveCheckoutDraft {
  const normalizedScope = scopeValue({
    ...scope,
    branch: input.branch ?? scope.branch,
    tillId: input.tillId ?? input.till ?? scope.tillId,
  });
  const cart = normalizeCart(input.cart);
  return {
    version: CHECKOUT_DRAFT_VERSION,
    ...defaultFields(),
    ...normalizeFields(input),
    cart,
    branch: normalizedScope.branch,
    tillId: normalizedScope.tillId,
    savedAt,
    cleared: input.cleared === true || cart.length === 0,
  };
}

function dispatchUpdate(): void {
  try { window.dispatchEvent(new Event('boss-pos-checkout-draft-updated')); } catch {}
}

export function loadCheckoutDraft(): CheckoutDraft | null {
  return readLegacyFields();
}

export function saveCheckoutDraft(draft: Omit<CheckoutDraft, 'version'>): void {
  try { localStorage.setItem(KEY, JSON.stringify({ ...draft, version: 1 } satisfies CheckoutDraft)); } catch {}
}

export function clearCheckoutDraft(): void {
  try { localStorage.removeItem(KEY); } catch {}
}

export function readCheckoutDraftSync(scope?: CheckoutDraftScope): ActiveCheckoutDraft | null {
  const normalizedScope = scopeValue(scope);
  const legacyCart = readLegacyCart();
  const local = readLocalRecord(normalizedScope, legacyCart);
  if (local) return local.cleared ? null : local;
  const legacyFields = readLegacyFields();
  const legacy = legacyFields ? makeRecord(normalizedScope, { ...legacyFields, cart: legacyCart }) : null;
  if (legacy && !legacy.cleared) return legacy;
  return legacyCart.length > 0 ? makeRecord(normalizedScope, { cart: legacyCart }) : null;
}

export const loadCheckoutDraftSync = readCheckoutDraftSync;

async function loadCheckoutDraftRecord(scope?: CheckoutDraftScope): Promise<ActiveCheckoutDraft | null> {
  const normalizedScope = scopeValue(scope);
  const key = checkoutDraftScopeKey(normalizedScope);
  const legacyCart = readLegacyCart();
  let stored: unknown;
  try { stored = await idbDraftGet(key); } catch {}
  const fromIdb = normalizeActive(stored, normalizedScope, legacyCart);
  const local = readLocalRecord(normalizedScope, legacyCart);
  const winner = fromIdb && local
    ? local.savedAt > fromIdb.savedAt ? local : fromIdb
    : fromIdb || local;
  if (winner) {
    const json = JSON.stringify(winner);
    try { await idbDraftSet(key, json); } catch {}
    writeLocalRecord(key, winner);
    return winner;
  }

  const legacy = readLegacyFields();
  if (legacy || legacyCart.length > 0) {
    const migrated = makeRecord(normalizedScope, { ...(legacy || {}), cart: legacyCart });
    try { await idbDraftSet(key, JSON.stringify(migrated)); } catch {}
    return migrated;
  }
  return null;
}

export async function loadActiveCheckoutDraft(scope?: CheckoutDraftScope): Promise<ActiveCheckoutDraft | null> {
  const record = await loadCheckoutDraftRecord(scope);
  return record?.cleared ? null : record;
}

export const loadCheckoutDraftAsync = loadActiveCheckoutDraft;

const writeChains = new Map<string, Promise<unknown>>();

function queueWrite<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = writeChains.get(key) || Promise.resolve();
  const run = previous.then(work, work);
  writeChains.set(key, run.then(() => undefined, () => undefined));
  return run;
}

async function persistRecord(key: string, record: ActiveCheckoutDraft): Promise<void> {
  const json = JSON.stringify(record);
  let idbSaved = false;
  let localSaved = false;
  try { await idbDraftSet(key, json); idbSaved = true; } catch {}
  try { localSaved = writeLocalRecord(key, record); } catch { localSaved = false; }
  if (!idbSaved && !localSaved) throw new Error('Checkout draft storage unavailable');
  if (localSaved) {
    try { localStorage.removeItem(KEY); localStorage.removeItem(CART_KEY); } catch {}
  }
}

export async function saveActiveCheckoutDraft(input: ActiveCheckoutDraftInput, scope?: CheckoutDraftScope): Promise<ActiveCheckoutDraft> {
  const effectiveScope = scopeValue({
    ...scope,
    branch: input.branch ?? scope?.branch,
    tillId: input.tillId ?? input.till ?? scope?.tillId,
  });
  const key = checkoutDraftScopeKey(effectiveScope);
  return queueWrite(key, async () => {
    const current = await loadCheckoutDraftRecord(effectiveScope);
    const next = makeRecord(effectiveScope, {
      ...(current || {}),
      ...input,
      cart: input.cart ?? current?.cart ?? [],
      branch: effectiveScope.branch,
      tillId: effectiveScope.tillId,
      cleared: input.cleared,
    }, Math.max(Date.now(), (current?.savedAt || 0) + 1));
    await persistRecord(key, next);
    dispatchUpdate();
    return next;
  });
}

export const saveCheckoutDraftAsync = saveActiveCheckoutDraft;

export async function clearActiveCheckoutDraft(scope?: CheckoutDraftScope): Promise<void> {
  const normalizedScope = scopeValue(scope);
  const key = checkoutDraftScopeKey(normalizedScope);
  await queueWrite(key, async () => {
    const current = await loadCheckoutDraftRecord(normalizedScope);
    const cleared = makeRecord(normalizedScope, {
      ...(current || {}),
      cart: [],
      branch: normalizedScope.branch,
      tillId: normalizedScope.tillId,
      cleared: true,
    }, Math.max(Date.now(), (current?.savedAt || 0) + 1));
    await persistRecord(key, cleared);
    try { localStorage.removeItem(KEY); } catch {}
    try { localStorage.removeItem(CART_KEY); } catch {}
    dispatchUpdate();
  });
}

export const clearCheckoutDraftAsync = clearActiveCheckoutDraft;
export const loadActiveCartDraft = loadActiveCheckoutDraft;
export const saveActiveCartDraft = saveActiveCheckoutDraft;
export const clearActiveCartDraft = clearActiveCheckoutDraft;
export type CheckoutDraftRecord = ActiveCheckoutDraft;
