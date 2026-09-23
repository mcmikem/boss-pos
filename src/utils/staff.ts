import type { StaffMember, StaffRole } from '../types';

export type TillTab = 'sales' | 'inventory' | 'analytics' | 'expenses' | 'registers';

const MANAGER_TABS: TillTab[] = ['sales', 'inventory', 'analytics', 'expenses', 'registers'];

// Tab access: with zero staff rows the till behaves exactly as before (all
// tabs open). Once staff exist, managers open everything; cashiers get Sell +
// Expenses plus whichever extra doors the manager ticks in Settings
// (cashierTabs — Close day on by default so evening close-out works).
export function canAccessTab(tab: TillTab, role: StaffRole | null, staffConfigured: boolean, extra?: TillTab[]): boolean {
  if (!staffConfigured) return true;
  if (role === 'manager') return MANAGER_TABS.includes(tab);
  const doors: TillTab[] = ['sales', 'expenses', ...(extra ?? ['registers'])];
  return doors.includes(tab);
}

export function isManagerRole(role: StaffRole | null, staffConfigured: boolean): boolean {
  if (!staffConfigured) return true;
  return role === 'manager';
}

export function activeStaffOf(list: StaffMember[], id: string | null): StaffMember | null {
  if (!id) return null;
  return list.find((s) => s.id === id && s.active) || null;
}
