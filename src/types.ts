export interface Product {
  id: string;
  name: string;
  category: string;
  cost: number;
  price: number;
  stockQty: number;
  lowStockThreshold: number;
  supplierId?: string;
  imageUrl?: string; // small SVG data URI or emoji
  isService?: boolean;
  imei?: string;
  barcode?: string;
}

export interface CashTransfer {
  id: string;
  fromCategory: string;
  toCategory: string;
  amount: number;
  reason: string;
  createdAt: string;
  settledAt: string | null;
}

export interface CreditPayment {
  id: string;
  saleId: string;
  amount: number;
  createdAt: string;
}

export interface CreditLedger {
  id: string;
  saleId: string;
  customerName: string;
  amount: number;
  createdAt: string;
  paidAmount: number;
}

export interface SaleItem {
  productId: string;
  productName: string;
  qty: number;
  unitPrice: number;
  unitCost: number;
  lineTotal: number;
}

export interface Sale {
  id: string;
  orderNumber: string;
  timestamp: string;
  items: SaleItem[];
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: 'Cash' | 'MTN MoMo' | 'Airtel Money' | 'Credit / Book';
  customerName?: string;
  discount?: number;
  notes?: string;
}

export interface Expense {
  id: string;
  timestamp: string;
  description: string;
  amount: number;
  category: string;
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
}

export interface TailoringOrder {
  id: string;
  customerName: string;
  customerPhone: string;
  orderDate: string;
  expectedDate: string;
  completedDate?: string;
  workType: 'repair' | 'custom' | 'sportswear';
  workDescription: string;
  totalAmount: number;
  depositPaid: number;
  materialCost: number;
  status: 'pending' | 'in_progress' | 'completed' | 'delivered';
  notes: string;
  measurements?: string;
  createdAt: string;
}

export interface AppTheme {
  id: string;
  name: string;
  brand: string;
  medium: string;
  light: string;
}

export interface StoreSettings {
  shopName: string;
  themeId: string;
  vibe: string;
  defaultPaymentMethod: 'Cash' | 'MTN MoMo' | 'Airtel Money' | 'Credit / Book';
  dailyGoalNum: number;
  shopType?: 'general' | 'eatery' | 'phone' | 'tailor';
  language?: 'english' | 'luganda' | 'swahili';
}

