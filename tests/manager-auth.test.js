import { describe, it } from 'node:test';
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
