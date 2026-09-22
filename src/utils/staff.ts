import type { StaffMember, StaffRole } from '../types';

export type TillTab = 'sales' | 'inventory' | 'analytics' | 'expenses' | 'registers';

const MANAGER_TABS: TillTab[] = ['sales', 'inventory', 'analytics', 'expenses', 'registers'];
// Cashiers close the day too (blind when the shop sets it) — selling +
// expenses + close, never stock/reports/settings.
const CASHIER_TABS: TillTab[] = ['sales', 'expenses', 'registers'];

// Tab access: with zero staff rows the till behaves exactly as before (all
// tabs open). Once staff exist, cashiers are limited to selling + expenses +
// close-out (blind when the shop sets it) — never stock/reports/settings.
export function canAccessTab(tab: TillTab, role: StaffRole | null, staffConfigured: boolean): boolean {
  if (!staffConfigured) return true;
  if (role === 'manager') return MANAGER_TABS.includes(tab);
  return CASHIER_TABS.includes(tab);
}

export function isManagerRole(role: StaffRole | null, staffConfigured: boolean): boolean {
  if (!staffConfigured) return true;
  return role === 'manager';
}

export function activeStaffOf(list: StaffMember[], id: string | null): StaffMember | null {
  if (!id) return null;
  return list.find((s) => s.id === id && s.active) || null;
}
