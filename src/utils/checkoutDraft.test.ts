import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaleItem } from '../types';

const idbMocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('./outboxIdb', () => ({
  idbDraftGet: idbMocks.get,
  idbDraftSet: idbMocks.set,
  idbDraftDelete: idbMocks.delete,
}));

import {
  CHECKOUT_DRAFT_VERSION,
  checkoutDraftScopeKey,
  clearActiveCheckoutDraft,
  clearCheckoutDraft,
  loadActiveCheckoutDraft,
  loadCheckoutDraft,
  readCheckoutDraftSync,
  saveActiveCheckoutDraft,
  saveCheckoutDraft,
} from './checkoutDraft';

const store = new Map<string, string>();
const scope = { branch: 'Owino', tillId: 'cashier-1' };
const item: SaleItem = {
  productId: 'p-1', productName: 'Tea', qty: 1, unitPrice: 1000, unitCost: 400, lineTotal: 1000,
};

beforeEach(() => {
  store.clear();
  idbMocks.get.mockReset().mockResolvedValue(undefined);
  idbMocks.set.mockReset().mockResolvedValue(undefined);
  idbMocks.delete.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
  });
});

const draft = {
  paymentMethod: 'Split' as const,
  customerName: 'Amina',
  discount: '10',
  discountType: 'percent' as const,
  customCashReceived: '20000',
  splitLeg1Method: 'Cash' as const,
  splitLeg1Amount: '5000',
  splitLeg2Method: 'MTN MoMo' as const,
};

const active = (overrides: Record<string, unknown> = {}) => ({
  version: CHECKOUT_DRAFT_VERSION,
  ...draft,
  cart: [item],
  branch: scope.branch,
  tillId: scope.tillId,
  savedAt: 1,
  ...overrides,
});

describe('checkout draft', () => {
  it('round-trips legacy checkout fields', () => {
    saveCheckoutDraft(draft);
    expect(loadCheckoutDraft()).toEqual({ ...draft, version: 1 });
  });

  it('clears a completed draft', () => {
    saveCheckoutDraft(draft);
    clearCheckoutDraft();
    expect(loadCheckoutDraft()).toBeNull();
  });

  it('ignores malformed and invalid stored drafts', () => {
    store.set('boss_pos_checkout_draft', 'not-json');
    expect(loadCheckoutDraft()).toBeNull();
    store.set('boss_pos_checkout_draft', JSON.stringify({ ...draft, version: 1, paymentMethod: 'Card' }));
    expect(loadCheckoutDraft()).toBeNull();
  });

  it('loads the combined IDB record before the localStorage mirror', async () => {
    idbMocks.get.mockResolvedValue(JSON.stringify(active({ customerName: 'From IDB' })));
    store.set(checkoutDraftScopeKey(scope), JSON.stringify(active({ customerName: 'From LS' })));

    const record = await loadActiveCheckoutDraft(scope);

    expect(record).toMatchObject({ version: 2, customerName: 'From IDB', cart: [item] });
  });

  it('recovers a newer localStorage fallback and repairs IDB', async () => {
    idbMocks.get.mockResolvedValue(JSON.stringify(active({ customerName: 'Old IDB', savedAt: 1 })));
    store.set(checkoutDraftScopeKey(scope), JSON.stringify(active({ customerName: 'New LS', savedAt: 2 })));

    const record = await loadActiveCheckoutDraft(scope);

    expect(record?.customerName).toBe('New LS');
    expect(idbMocks.set).toHaveBeenCalledWith(checkoutDraftScopeKey(scope), JSON.stringify(record));
  });

  it('migrates a valid scoped localStorage record into IDB', async () => {
    store.set(checkoutDraftScopeKey(scope), JSON.stringify(active()));

    const record = await loadActiveCheckoutDraft(scope);

    expect(record).toMatchObject({ version: 2, customerName: 'Amina', cart: [item] });
    expect(idbMocks.set).toHaveBeenCalledWith(checkoutDraftScopeKey(scope), JSON.stringify(record));
  });

  it('falls back when the IDB record has an unsupported version', async () => {
    idbMocks.get.mockResolvedValue(JSON.stringify(active({ version: 99 })));
    store.set(checkoutDraftScopeKey(scope), JSON.stringify(active()));

    const record = await loadActiveCheckoutDraft(scope);

    expect(record?.version).toBe(2);
    expect(idbMocks.set).toHaveBeenCalled();
  });

  it('persists a cleared version instead of allowing stale data to return', async () => {
    const saved = await saveActiveCheckoutDraft({ ...draft, cart: [item] }, scope);
    idbMocks.set.mockClear();
    const cleared = await saveActiveCheckoutDraft({ ...draft, cart: [] }, scope);

    expect(saved.cart).toHaveLength(1);
    expect(cleared).toMatchObject({ version: 2, cart: [], cleared: true });
    expect(idbMocks.set).toHaveBeenCalledWith(checkoutDraftScopeKey(scope), JSON.stringify(cleared));
    expect(readCheckoutDraftSync(scope)).toBeNull();
  });

  it('starts a new cart after a cleared version without losing the newer timestamp', async () => {
    store.set(checkoutDraftScopeKey(scope), JSON.stringify(active()));
    await clearActiveCheckoutDraft(scope);
    idbMocks.get.mockResolvedValue(undefined);

    const revived = await saveActiveCheckoutDraft({ ...draft, cart: [item] }, scope);

    expect(revived.savedAt).toBeGreaterThan(1);
    await expect(loadActiveCheckoutDraft(scope)).resolves.toMatchObject({ cart: [item], cleared: false });
  });

  it('clears IDB and localStorage together with a newer version', async () => {
    store.set(checkoutDraftScopeKey(scope), JSON.stringify(active()));
    await clearActiveCheckoutDraft(scope);
    expect(idbMocks.set).toHaveBeenLastCalledWith(checkoutDraftScopeKey(scope), expect.stringContaining('"cleared":true'));
    expect(readCheckoutDraftSync(scope)).toBeNull();
  });
});
