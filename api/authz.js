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
