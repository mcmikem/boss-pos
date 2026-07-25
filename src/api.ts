import { Product, Supplier, Sale, Expense, StoreSettings } from './types';

const BASE = '';

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const productApi = {
  list: () => api<Product[]>('/api/products'),
  create: (p: Product) => api<Product>('/api/products', { method: 'POST', body: JSON.stringify(p) }),
  update: (p: Product) => api<Product>(`/api/products/${p.id}`, { method: 'PUT', body: JSON.stringify(p) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/products/${id}`, { method: 'DELETE' }),
};

export const supplierApi = {
  list: () => api<Supplier[]>('/api/suppliers'),
  create: (s: Supplier) => api<Supplier>('/api/suppliers', { method: 'POST', body: JSON.stringify(s) }),
  update: (s: Supplier) => api<Supplier>(`/api/suppliers/${s.id}`, { method: 'PUT', body: JSON.stringify(s) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/suppliers/${id}`, { method: 'DELETE' }),
};

export const saleApi = {
  list: () => api<Sale[]>('/api/sales'),
  create: (s: Sale) => api<Sale>('/api/sales', { method: 'POST', body: JSON.stringify(s) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/sales/${id}`, { method: 'DELETE' }),
};

export const expenseApi = {
  list: () => api<Expense[]>('/api/expenses'),
  create: (e: Expense) => api<Expense>('/api/expenses', { method: 'POST', body: JSON.stringify(e) }),
  remove: (id: string) => api<{ success: boolean }>(`/api/expenses/${id}`, { method: 'DELETE' }),
};

export const settingsApi = {
  get: () => api<StoreSettings>('/api/settings'),
  update: (s: StoreSettings) => api<{ success: boolean }>('/api/settings', { method: 'PUT', body: JSON.stringify(s) }),
};
