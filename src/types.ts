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
  productId?: string;
  unitCostUnit?: string;
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
  stockUnit?: string;
  price: number;
  stockQty: number;
  lowStockThreshold: number;
  supplierId?: string;
  imageUrl?: string; // small SVG data URI or emoji
  isService?: boolean;
  saleUnit?: string; // per-unit pricing label, e.g. "page", "copy", "meter" -> "500 / page"
  imei?: string;
  barcode?: string;
  expiryDate?: string; // YYYY-MM-DD of the nearest-expiring batch; drives expiry alerts
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
  clientWriteId?: string;
  staffId?: string;
  staffName?: string;
  branch?: string;
  paymentMethod?: string;
  reference?: string;
  note?: string;
  collectedAt?: string;
  collectorId?: string;
  collectorName?: string;
  collectorRole?: string;
  targetType?: 'sale' | 'book';
}

export interface CreditLedger {
  id: string;
  saleId: string;
  customerName: string;
  amount: number;
  createdAt: string;
  paidAmount: number;
}

export interface SplitTender {
  method: 'Cash' | 'MTN MoMo' | 'Airtel Money';
  amount: number;
}

export type StockShortageReason = 'UNKNOWN_PRODUCT' | 'INSUFFICIENT_STOCK';

// Per-line detail the server returns with 400/409 sale rejections, so the till
// can name the exact products that blocked the sale instead of "try again".
export interface StockShortage {
  productId: string;
  name?: string;
  requestedQty: number;
  availableQty: number;
  shortfall: number;
  reason: StockShortageReason;
}

export type StocktakeLineStatus = 'saved' | 'conflict' | 'failed' | 'missing';

export interface StocktakeLineResult {
  id: string;
  status: StocktakeLineStatus;
  code?: string;
  error?: string;
  stockQty?: number;
  previousQty?: number;
  delta?: number;
  expiryDate?: string | null;
  updatedAt?: string;
  product?: Product;
}

export interface StocktakeBulkResult {
  results: StocktakeLineResult[];
  saved: number;
  conflicts: number;
  failed: number;
  applied: number;
  total: number;
  actor?: { id?: string | null; name?: string };
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
  lineDiscount?: number; // UGX knocked off this line (per-line haggle); lineTotal is net
}

export interface Sale {
  id: string;
  clientWriteId?: string;
  orderNumber: string;
  timestamp: string;
  items: SaleItem[];
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: 'Cash' | 'MTN MoMo' | 'Airtel Money' | 'Credit / Book' | 'Split';
  splitTenders?: SplitTender[]; // cash-like legs when paymentMethod is Split
  customerName?: string;
  discount?: number;
  notes?: string;
  staffName?: string;
  branch?: string;
  refunded?: boolean;
  refundedAt?: string;
  // EFRIS fiscalisation (server-filled; see api/efris.js)
  efrisStatus?: 'none' | 'pending' | 'issued' | 'failed';
  efrisInvoiceNo?: string;
  efrisFdn?: string;
  efrisVerify?: string;
  efrisQr?: string;
  efrisError?: string;
  efrisAt?: string;
}

export type SaleSaveStatus = 'saved' | 'queued' | 'failed';

export interface SaleSaveResult {
  status: SaleSaveStatus;
  sale: Sale;
  error?: string;
}

export interface ExpenseItem {
  name: string;
  amount: number;
}

export interface Expense extends ExpenseApprovalFields {
  id: string;
  timestamp: string;
  description: string;
  amount: number;
  category: string;
  // Line items: exactly what was bought at what price, so the receipt shows
  // the breakdown (Flour 30,000 · Oil 15,000) instead of one grouped total.
  // Legacy rows omit this — the description + total still stand on their own.
  items?: ExpenseItem[];
  // Accountability: where the money came from + who recorded it. Legacy rows
  // omit these — assumed drawer-paid (safe default for theft detection).
  source?: 'drawer' | 'cash' | 'momo' | 'owner' | 'bank';
  staffName?: string;
  branch?: string;
  clientWriteId?: string;
  note?: string;
  linkedProductId?: string;
  linkedProductName?: string;
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
  staffId?: string;
  staffName?: string;
  actorId?: string;
  actorName?: string;
  actorRole?: string;
  branch?: string;
  paymentMethod?: string;
  reference?: string;
  updatedAt?: string;
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
  expiryDate?: string | null; // expiry carried from the product being written off
  available?: number | null; // stock left on the shelf after the write-off
}

export interface MomoTransfer {
  id: string;
  category: string;
  amount: number;
  comment: string;
  createdAt: string;
  to?: 'float' | 'cash' | 'owner' | 'manager' | 'bank';
  sentBy?: string;
  staffId?: string;
  actorId?: string;
  actorName?: string;
  actorRole?: string;
  branch?: string;
  direction?: 'in' | 'out';
  provider?: string;
  reference?: string;
  status?: SettlementStatus;
  settledAt?: string;
  reconciledAt?: string;
  reconciledBy?: string;
  reconciledByName?: string;
  // Who was handed the money, and whether they confirmed receiving it.
  recipientId?: string;
  recipientName?: string;
  recipientRole?: 'owner' | 'manager' | null;
  receiptStatus?: HandoverReceiptStatus;
  receiptRequestedAt?: string;
  receivedAt?: string;
  receivedBy?: string;
  receivedByName?: string;
  receiptNote?: string;
}

export type HandoverReceiptStatus = 'not_required' | 'requested' | 'received';

export interface Supplier {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
}

export interface SupplierPrice {
  id: string;
  supplierId: string;
  productId: string;
  price: number;
  updatedAt: string;
  purchaseQty?: number;
  purchaseUnit?: string;
  normalizedUnit?: string;
}

export type PurchaseOrderStatus = 'draft' | 'ordered' | 'partially_received' | 'received' | 'cancelled';

export interface PurchaseOrderLine {
  id: string;
  purchaseOrderId: string;
  productId: string;
  productName: string;
  quantityOrdered: number;
  quantityReceived: number;
  quantityOutstanding: number;
  unitCost: number;
  lineTotal: number;
  expiryDate?: string | null;
  batchNumber?: string | null;
  createdAt?: string;
}

export interface PurchaseOrder {
  id: string;
  orderNumber: string;
  supplierId: string;
  supplierName: string;
  status: PurchaseOrderStatus;
  expectedDate?: string | null;
  notes: string;
  branch: string;
  staffId?: string;
  staffName: string;
  actorId?: string;
  actorName: string;
  actorRole: string;
  clientWriteId?: string;
  lineCount: number;
  totalQuantity: number;
  totalCost: number;
  quantityReceived: number;
  fullyReceived: boolean;
  createdAt: string;
  updatedAt: string;
  lines: PurchaseOrderLine[];
  receipts?: GoodsReceipt[];
  duplicate?: boolean;
}

export interface GoodsReceiptLine {
  id: string;
  goodsReceiptId: string;
  purchaseOrderLineId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitCost: number;
  amount: number;
  expiryDate?: string | null;
  batchNumber?: string | null;
  createdAt?: string;
}

export type ReceiptRejectionCode = 'UNKNOWN_LINE' | 'DUPLICATE_LINE' | 'OVER_RECEIPT' | 'INVALID_EXPIRY' | 'NOT_POSTED';

export interface ReceiptRejection {
  purchaseOrderLineId: string | null;
  productId: string | null;
  code: ReceiptRejectionCode;
  requestedQty: number;
  remainingQty: number;
  shortBy?: number;
  error?: string;
}

export interface GoodsReceipt {
  id: string;
  purchaseOrderId: string;
  receivedAt: string;
  receivedBy?: string;
  receivedByName: string;
  branch: string;
  note: string;
  status: string;
  expenseId?: string;
  actorId?: string;
  actorName: string;
  actorRole: string;
  clientWriteId?: string;
  lineCount: number;
  totalQuantity: number;
  totalCost: number;
  createdAt: string;
  lines: GoodsReceiptLine[];
}

export interface GoodsReceiptResult {
  duplicate: boolean;
  receipt: GoodsReceipt;
  order?: PurchaseOrder;
  expenseId?: string | null;
  skipped?: ReceiptRejection[];
}

export type StaffRole = 'manager' | 'cashier';
export interface StaffMember {
  id: string;
  name: string;
  role: StaffRole;
  active: boolean;
}

export interface TailoringMaterial {
  name: string;
  qty?: number;
  cost: number; // what this line cost whoever provided it
  providedBy: 'tailor' | 'customer'; // customer brought their own fabric = tailor pays 0
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
  materialCost: number; // legacy lump sum (tailor-paid); kept for old orders
  materials?: TailoringMaterial[]; // itemised lines; tailor lines add to materialCost
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

// Contractor quotation: a priced cart snapshot that is NOT a sale. Synced to
// the server (with a localStorage cache for offline) — quotes are drafts
// until converted back into the cart.
export interface Quote {
  id: string;
  customerName: string;
  customerPhone: string;
  items: SaleItem[];
  discount: number;
  total: number;
  createdAt: string;
  clientWriteId?: string;
}

// Salon / barbershop appointment book: who is coming, when, for what, and
// what is already paid. Informational like tailoring deposits — the till
// still rings the actual sale at the chair.
export interface Booking {
  id: string;
  customerName: string;
  customerPhone: string;
  service: string;
  staffName?: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  durationMin?: number; // service length; overlap math, default 30
  price: number;
  deposit: number;
  status: 'booked' | 'done' | 'cancelled';
  notes: string;
  createdAt: string;
  clientWriteId?: string;
}

// Workshop / electronics repair intake: item in, fault, price, deposit, and a
// received → in_progress → ready → collected flow. Same deposit pattern as
// tailoring orders, without garment-specific fields.
export interface RepairJob {
  id: string;
  customerName: string;
  customerPhone: string;
  itemLabel: string;
  issue: string;
  price: number;
  deposit: number;
  partsCost: number;
  status: 'received' | 'in_progress' | 'ready' | 'collected';
  expectedDate: string;
  completedDate?: string;
  notes: string;
  createdAt: string;
  clientWriteId?: string;
}

export interface AppTheme {
  id: string;
  name: string;
  brand: string;
  medium: string;
  light: string;
}

export interface EfrisConfig {
  enabled: boolean;
  mode: 'off' | 'sandbox' | 'provider';
  tin: string;
  deviceNo: string;
  branchCode: string;
  vatRate: number;
  pricesIncludeVat: boolean;
  autoIssue: boolean;
  goodsPrefix: string;
  providerBase: string;
}

export interface StoreSettings {
  shopName: string;
  themeId: string;
  vibe: string;
  defaultPaymentMethod: 'Cash' | 'MTN MoMo' | 'Airtel Money' | 'Credit / Book' | 'Split';
  dailyGoalNum: number;
  shopType?: 'general' | 'eatery' | 'phone' | 'tailor';
  language?: 'english' | 'luganda' | 'swahili';
  usdRate?: number;
  categories?: string[];
  expenseCategories?: string[];
  hasPin?: boolean;
  showTailoring?: boolean;
  showDesign?: boolean;
  showBookings?: boolean;
  showRepairs?: boolean;
  momoFeePct?: number; // MTN/Airtel cut auto-booked as expense per MoMo sale
  loyaltyEveryN?: number; // regulars reward: every Nth visit earns loyaltyPct off
  loyaltyPct?: number; // percent off the reward visit (1-50)
  discountPinAbove?: number; // discounts above this UGX need a manager PIN at charge time (0/empty = never)
  commissionPct?: number; // seller commission % of own sales, shown in Reports ranking
  dailyGoalRevenue?: number; // revenue target for the goal bar (0/empty = count goal only)
  receiptFooter?: string; // slogan/returns line printed under every receipt
  ownerPhone?: string; // WhatsApp number for the daily close summary
  ownerName?: string; // display name for the person who owns the business
  // Closing cadence: how long before closeTime the till starts reminding the
  // cashier, and how loudly. Owners set the pace for their own business.
  closeReminderLeadMin?: number; // 0/blank = never remind (15/30/45/60 typical)
  closeReminderSound?: boolean;
  closeSummaryAuto?: boolean; // send the close summary to the owner automatically
  sheetsUrl?: string;
  efris?: EfrisConfig;
  branches?: string[];
  eodCapital?: Record<string, number>;
  openTime?: string; // shop opens "08:00" (24h HH:MM) — close-out flags wait for close
  closeTime?: string; // shop closes "21:00" — unaccounted-cash flags fire after this
  closedDays?: number[]; // 0=Sun..6=Sat days the shop never opens (no close flags)
  blindClose?: boolean; // cashiers close out without seeing totals (manager gets WhatsApp)
  cashierTabs?: Array<'inventory' | 'analytics' | 'registers'>; // extra doors managers open for cashiers (Close day on by default)
  closeNotifyOwner?: boolean; // prompt a WhatsApp close summary to the owner after closing
  largeText?: boolean; // accessibility: bigger type + targets (Settings → Display)
  lockMinutes?: number; // idle auto-lock delay (10/30/60); solo sellers can relax it
  features?: Record<string, boolean>; // Till control master switches (all default ON)
  lastSheetOk?: boolean;
  lastSheetAt?: string;
  lastSheetError?: string;
}

export interface CloseSummary {
  id: string;
  businessDate: string;
  branch: string;
  recipientId?: string;
  recipientName: string;
  recipientRole: 'owner' | 'manager';
  channel: 'in_app' | 'whatsapp';
  deliveryStatus: 'pending' | 'read' | 'voided';
  headline: string;
  body: string;
  totals: Record<string, number>;
  sentBy?: string;
  sentByName: string;
  deliveredAt?: string;
  readAt?: string;
  sharedVia: string;
  createdAt: string;
}

export type ExpenseApprovalStatus = 'submitted' | 'approved' | 'rejected';

export interface ExpenseApprovalFields {
  approvalStatus?: ExpenseApprovalStatus | 'pending';
  submittedAt?: string;
  submittedBy?: string;
  submittedByName?: string;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  rejectionReason?: string;
  receiptReference?: string;
  receiptEvidence?: string;
  receiptType?: 'image' | 'pdf' | 'other';
}

export interface CloseSessionTotals {
  cash: number;
  momo: number;
  airtel: number;
  credit: number;
  bank: number;
  other: number;
}

export interface CloseSession {
  id: string;
  businessDate: string;
  branch: string;
  status: 'open' | 'closed';
  openedAt: string;
  openedBy?: string;
  openedByName: string;
  openingCash: number;
  expectedCash?: number;
  countedCash?: number;
  expectedTotal?: number;
  countedTotal?: number;
  varianceTotal?: number;
  difference?: number;
  variance?: number;
  expectedTotals?: CloseSessionTotals;
  countedTotals?: CloseSessionTotals;
  varianceTotals?: CloseSessionTotals;
  paymentBreakdown?: Array<{ method: string; amount: number }>;
  closedAt?: string;
  closedBy?: string;
  closedByName?: string;
  reopenedAt?: string;
  reopenedBy?: string;
  reopenedByName?: string;
  clientWriteId?: string;
  note?: string;
}

export interface ShiftHandover {
  id: string;
  fromStaffId?: string;
  fromStaffName: string;
  toStaffId: string;
  toStaffName: string;
  branch: string;
  openingCash: number;
  closingCash: number;
  expectedCash: number;
  countedCash: number;
  variance: number;
  handedOverAt: string;
  note?: string;
  clientWriteId?: string;
}

export type SettlementKind = 'momo' | 'bank';
export type SettlementDirection = 'in' | 'out';
export type SettlementStatus = 'pending' | 'settled' | 'reconciled' | 'voided';

export interface SettlementMovement {
  id: string;
  kind: SettlementKind;
  direction: SettlementDirection;
  amount: number;
  provider: string;
  account: string;
  reference: string;
  note?: string;
  status: SettlementStatus;
  branch: string;
  staffId?: string;
  staffName: string;
  actorId?: string;
  actorName: string;
  actorRole: string;
  settledAt?: string;
  reconciledAt?: string;
  reconciledBy?: string;
  reconciledByName?: string;
  voidedAt?: string;
  clientWriteId?: string;
  createdAt: string;
}

export interface CreditAgingRow {
  id: string;
  customerName: string;
  kind: 'sale' | 'book';
  total: number;
  paid: number;
  outstanding: number;
  ageDays: number;
  bucket: '0-30' | '31-60' | '61-90' | '90+';
  createdAt: string;
  branch: string;
  staffId?: string;
  staffName: string;
}

export interface CreditAgingReport {
  asOf: string;
  rows: CreditAgingRow[];
  buckets: Record<CreditAgingRow['bucket'], number>;
  totalOutstanding: number;
}

