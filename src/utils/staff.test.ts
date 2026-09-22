import { describe, expect, it } from 'vitest';
import { canAccessTab, isManagerRole, activeStaffOf } from './staff';
import type { StaffMember } from '../types';

const staff: StaffMember[] = [
  { id: 'm1', name: 'Amina', role: 'manager', active: true },
  { id: 'c1', name: 'Musa', role: 'cashier', active: true },
  { id: 'x1', name: 'Ex', role: 'cashier', active: false },
];

describe('staff access', () => {
  it('opens everything when no staff are configured (legacy behavior)', () => {
    expect(canAccessTab('analytics', null, false)).toBe(true);
    expect(canAccessTab('registers', 'cashier', false)).toBe(true);
    expect(isManagerRole(null, false)).toBe(true);
  });
  it('limits cashiers to sales + expenses once configured', () => {
    expect(canAccessTab('sales', 'cashier', true)).toBe(true);
    expect(canAccessTab('expenses', 'cashier', true)).toBe(true);
    expect(canAccessTab('inventory', 'cashier', true)).toBe(false);
    expect(canAccessTab('analytics', 'cashier', true)).toBe(false);
    expect(canAccessTab('registers', 'cashier', true)).toBe(true);
    expect(canAccessTab('registers', 'manager', true)).toBe(true);
    expect(isManagerRole('cashier', true)).toBe(false);
    expect(isManagerRole('manager', true)).toBe(true);
  });
  it('resolves the active seller only among active staff', () => {
    expect(activeStaffOf(staff, 'c1')?.name).toBe('Musa');
    expect(activeStaffOf(staff, 'x1')).toBeNull();
    expect(activeStaffOf(staff, null)).toBeNull();
  });
});
