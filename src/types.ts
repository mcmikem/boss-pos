export interface ProductVariant {
  id: string;
  label: string;
  price: number;
  cost?: number;
}

export interface RecipeIngredient {
  id: string;
  name: string;
  qty: number;
  unit: string;
  unitCost: number;
  wastePct: number;
}

export interface Recipe {
  ingredients: RecipeIngredient[];
  yield: number;
  overhead: number;
  targetMarginPct: number;
}

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
  saleUnit?: string; // per-unit pricing label, e.g. "page", "copy", "meter" -> "500 / page"
  imei?: string;
  barcode?: string;
  variants?: ProductVariant[]; // sellable units/prices for one dish (e.g. samosa single/couple/big)
  recipe?: Recipe; // ingredient cost breakdown for a dish; COGS is derived from this
  updatedAt?: string; // server conflict-detection timestamp
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
  variantId?: string;
  variantLabel?: string;
  saleUnit?: string; // snapshot of the product's per-unit label at sale time
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
  refunded?: boolean;
  refundedAt?: string;
}

export interface Expense {
  id: string;
  timestamp: string;
  description: string;
  amount: number;
  category: string;
}

export interface CreditEat {
  id: string;
  customerName: string;
  date: string;
  item: string;
  category: string;
  qty: number;
  unitPrice: number;
  total: number;
  paidAmount: number;
  paid: boolean;
}

export interface ProductionRegister {
  id: string;
  date: string;
  item: string;
  category: string;
  productId?: string;
  qty: number;
  costEach: number;
  total: number;
}

export interface WastageLog {
  id: string;
  date: string;
  item: string;
  category: string;
  productId?: string;
  qty: number;
  costEach: number;
  lossAmount: number;
  reason: 'remaining' | 'expired';
}

export interface MomoTransfer {
  id: string;
  category: string;
  amount: number;
  comment: string;
  createdAt: string;
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

export interface DesignOrder {
  id: string;
  customerName: string;
  customerPhone: string;
  orderDate: string;
  expectedDate: string;
  completedDate?: string;
  orderType: 'logo' | 'flyer' | 'banner' | 'sticker' | 'cards' | 'print' | 'branding' | 'other';
  designBrief: string;
  qty: number;
  size: string;
  materialCost: number;
  laborCost: number;
  transportCost: number;
  unitPrice: number;
  totalAmount: number;
  depositPaid: number;
  targetMarginPct: number;
  status: 'pending' | 'in_progress' | 'review' | 'completed' | 'delivered';
  notes: string;
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
  usdRate?: number;
  categories?: string[];
  expenseCategories?: string[];
  hasPin?: boolean;
}

