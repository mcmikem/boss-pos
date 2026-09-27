import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { managerAllowed, MANAGER_REQUIRED_CODE } from '../api/authz.js';

describe('managerAllowed', () => {
  it('allows manager tokens', () => {
    assert.equal(managerAllowed({ role: 'manager' }, 3), true);
  });

  it('denies cashier tokens', () => {
    assert.equal(managerAllowed({ role: 'cashier' }, 3), false);
  });

  it('allows legacy till tokens only when no staff exist', () => {
    assert.equal(managerAllowed({ role: 'till' }, 0), true);
    assert.equal(managerAllowed({}, 2), false);
    assert.equal(managerAllowed(null, 0), false);
  });

  it('exposes a stable denial code', () => {
    assert.equal(MANAGER_REQUIRED_CODE, 'MANAGER_REQUIRED');
  });
});

// The narrow permissions opened up during the Close/Sell audits are the ones
// most likely to be widened by a later "just make it work" edit. Their
// boundaries are pinned here, as behaviour rather than as a comment.
import { selfUndoAllowed, SELF_UNDO_WINDOW_MS } from '../api/authz.js';
import { recipeCostOnlyUpdate, isTillOwnedSettingsPayload, nearMissCategory } from '../api/operationsRules.js';

test('self-undo is narrow on every side', () => {
  const mine = { saleStaffId: 'st-1', saleActorId: 'st-1', actorId: 'st-1', ageMs: 5_000 };
  assert.equal(selfUndoAllowed(mine), true, 'own fresh sale may be undone');

  // Not yours.
  assert.equal(selfUndoAllowed({ ...mine, actorId: 'st-2' }), false);
  // Yours by actor_id even if staff_id differs.
  assert.equal(selfUndoAllowed({ ...mine, saleStaffId: null }), true);
  // Too old — the 10-second bar and the 60s window must agree.
  assert.equal(selfUndoAllowed({ ...mine, ageMs: SELF_UNDO_WINDOW_MS }), true);
  assert.equal(selfUndoAllowed({ ...mine, ageMs: SELF_UNDO_WINDOW_MS + 1 }), false);
  // Already handled.
  assert.equal(selfUndoAllowed({ ...mine, refunded: true }), false);
  assert.equal(selfUndoAllowed({ ...mine, voided: true }), false);
  // Nonsense and anonymous.
  assert.equal(selfUndoAllowed({ ...mine, ageMs: NaN }), false);
  assert.equal(selfUndoAllowed({ ...mine, ageMs: -1 }), false);
  assert.equal(selfUndoAllowed({ ...mine, actorId: null }), false);
  assert.equal(selfUndoAllowed(), false);
  // And it is a seller allowance only: the manager path is unchanged.
  assert.equal(managerAllowed({ role: 'manager' }, 6), true);
  assert.equal(managerAllowed({ role: 'cashier' }, 6), false);
  assert.equal(managerAllowed({ role: 'till' }, 0), true);
});

const storedProduct = {
  id: 'p-1', name: 'Samosa', category: 'Eatery', price: 500, cost: 210,
  stockqty: 40, lowstockthreshold: 5, barcode: 'BAR1', imei: '',
  variants: [{ id: 'v1', label: 'Big', price: 500 }], saleunit: 'piece',
  imageurl: '/uploads/x.png', supplierid: null, isservice: false,
  recipe: {
    yield: 20, targetMarginPct: 60,
    ingredients: [
      { id: 'i1', name: 'Flour', qty: 2, unit: 'kg', unitCost: 3000, wastePct: 5 },
      { id: 'i2', name: 'Oil', qty: 1, unit: 'litre', unitCost: 8000, wastePct: 0 },
    ],
  },
};

test('a seller can carry paid ingredient prices into a recipe and nothing else', () => {
  const incoming = {
    name: 'HACKED', category: 'Custom', price: 1, cost: 0, stockQty: 9999,
    lowStockThreshold: 0, barcode: 'STOLEN', imei: 'IMEI', isService: false,
    recipe: {
      yield: 999, targetMarginPct: 1,
      ingredients: [
        // Only the unit cost is honoured; the name, qty and unit are not theirs.
        { id: 'i1', name: 'Gold dust', qty: 500, unit: 'kg', unitCost: 3100 },
        { id: 'i2', name: 'Oil', qty: 1, unit: 'litre', unitCost: 8000 },
        // An ingredient that is not in the recipe is simply not found.
        { id: 'i3', name: 'Unobtainium', qty: 1, unit: 'kg', unitCost: 1 },
      ],
    },
  };
  // Unconfirmed — i.e. ANY caller that is not the kitchen stating what it is
  // doing — is refused outright. Accepting it and silently dropping the price
  // change would turn a refusal into a lie, and old cached builds do exactly
  // this: they send a full product and get a cheerful 200 back.
  assert.equal(recipeCostOnlyUpdate(storedProduct, incoming).allowed, false);
  assert.equal(recipeCostOnlyUpdate(storedProduct, incoming).reason, 'NOT_CONFIRMED');

  const out = recipeCostOnlyUpdate(storedProduct, incoming, { confirmed: true });
  assert.equal(out.allowed, true);

  // The one thing taken from the payload: what they paid.
  assert.equal(out.body.recipe.ingredients[0].unitCost, 3100);
  assert.equal(out.body.recipe.ingredients[1].unitCost, 8000);
  assert.equal(out.body.recipe.ingredients.length, 2, 'no new ingredients may be added');
  // Everything structural stays as stored.
  assert.equal(out.body.recipe.ingredients[0].name, 'Flour');
  assert.equal(out.body.recipe.ingredients[0].qty, 2);
  assert.equal(out.body.recipe.yield, 20);
  assert.equal(out.body.recipe.targetMarginPct, 60);

  // And every other field is pinned, whatever the payload claimed.
  assert.equal(out.body.name, 'Samosa');
  assert.equal(out.body.category, 'Eatery');
  assert.equal(out.body.price, 500);
  assert.equal(out.body.cost, 210);
  assert.equal(out.body.stockQty, 40);
  assert.equal(out.body.lowStockThreshold, 5);
  assert.equal(out.body.barcode, 'BAR1');
  assert.equal(out.body.imei, '');
  assert.deepEqual(out.body.variants, storedProduct.variants);
  assert.equal(out.body.saleUnit, 'piece');
  assert.equal(out.body.imageUrl, '/uploads/x.png');
  assert.equal(out.body.supplierId, null);
  assert.equal(out.body.isService, false);
});

test('recipe-cost carry-forward refuses when there is nothing a seller may do', () => {
  const C = { confirmed: true };
  // No recipe at all.
  assert.equal(recipeCostOnlyUpdate({ ...storedProduct, recipe: null }, { recipe: { ingredients: [{ id: 'x', unitCost: 1 }] } }, C).allowed, false);
  // No priced ingredient in the payload.
  assert.equal(recipeCostOnlyUpdate(storedProduct, { recipe: { ingredients: [{ id: 'i1', name: 'Flour' }] } }, C).allowed, false);
  // No recipe in the payload.
  assert.equal(recipeCostOnlyUpdate(storedProduct, { price: 1 }, C).allowed, false);
  // Negative or non-numeric prices are not costs.
  assert.equal(recipeCostOnlyUpdate(storedProduct, { recipe: { ingredients: [{ id: 'i1', unitCost: -5 }] } }, C).allowed, false);
  assert.equal(recipeCostOnlyUpdate(storedProduct, { recipe: { ingredients: [{ id: 'i1', unitCost: 'free' }] } }, C).allowed, false);
  // A recipe stored as a JSON string (the column is text) still works.
  const asText = { ...storedProduct, recipe: JSON.stringify(storedProduct.recipe) };
  assert.equal(recipeCostOnlyUpdate(asText, { recipe: { ingredients: [{ id: 'i1', unitCost: 2999 }] } }, C).allowed, true);
});

test('the till float setting is one key and one shape', () => {
  assert.equal(isTillOwnedSettingsPayload({ eodCapital: { Eatery: 50000, Drinks: 0 } }), true);
  assert.equal(isTillOwnedSettingsPayload({ eodCapital: {} }), true);
  assert.equal(isTillOwnedSettingsPayload({ eodCapital: { Eatery: null } }), true);

  // Anything else about the shop's settings is not reachable this way.
  assert.equal(isTillOwnedSettingsPayload({ eodCapital: {}, price: 1 }), false);
  assert.equal(isTillOwnedSettingsPayload({ eodCapital: {}, categories: ['a'] }), false);
  assert.equal(isTillOwnedSettingsPayload({ categories: ['a'] }), false);
  assert.equal(isTillOwnedSettingsPayload({ discountPinAbove: 0 }), false);
  // Bad shapes.
  assert.equal(isTillOwnedSettingsPayload({ eodCapital: [] }), false);
  assert.equal(isTillOwnedSettingsPayload({ eodCapital: '50000' }), false);
  assert.equal(isTillOwnedSettingsPayload({ eodCapital: { Eatery: -1 } }), false);
  assert.equal(isTillOwnedSettingsPayload({ eodCapital: { Eatery: 'lots' } }), false);
  assert.equal(isTillOwnedSettingsPayload({}), false);
  assert.equal(isTillOwnedSettingsPayload(null), false);
});

test('a new spend category is allowed, a typo is not', () => {
  const allowed = ['Stock Purchase', 'Utilities', 'Transport', 'Rent'];
  // Genuinely new: Fuel is not a typo of anything on the list.
  assert.equal(nearMissCategory(allowed, 'Fuel'), null);
  assert.equal(nearMissCategory(allowed, 'Airtime'), null);
  // Typos and case are caught rather than creating a second permanent category.
  assert.equal(nearMissCategory(allowed, 'Utilites'), 'Utilities');
  assert.equal(nearMissCategory(allowed, 'utility'), 'Utilities');
  assert.equal(nearMissCategory(allowed, 'TRANSPOR'), 'Transport');
  assert.equal(nearMissCategory(allowed, 'Stock Purchase'), 'Stock Purchase');
  // Punctuation and spacing differences are the same name.
  assert.equal(nearMissCategory(allowed, 'stock  purchase'), 'Stock Purchase');
  // Empty or meaningless input never matches.
  assert.equal(nearMissCategory(allowed, ''), null);
  assert.equal(nearMissCategory(allowed, '??'), null);
  assert.equal(nearMissCategory([], 'Fuel'), null);
});
