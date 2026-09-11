// Sell-screen translations. English is the source of truth; Luganda covers
// the ~30 strings a cashier reads mid-sale (nav, search, cart, charge,
// confirm). Everything else (settings, reports, admin) stays English by
// design — owners already operate there in English. Other languages fall
// back to English key-by-key so a half-done translation never blanks the UI.

export type SellLang = 'english' | 'luganda' | 'swahili';

export type SellKey =
  | 'sell' | 'stock' | 'spend' | 'reports' | 'closeDay'
  | 'searchItems' | 'searchAll' | 'all'
  | 'payment' | 'cash' | 'credit' | 'customerName' | 'customerNameEx'
  | 'discount' | 'roundTo100' | 'clear'
  | 'cashReceived' | 'amount' | 'exact' | 'change' | 'stillNeed'
  | 'subtotal' | 'total' | 'completeSale'
  | 'confirmSale' | 'items' | 'itemsLabel' | 'cancel' | 'confirm' | 'saving'
  | 'backToProducts' | 'checkout' | 'closeBtn' | 'off';

const EN: Record<SellKey, string> = {
  sell: 'Sell',
  stock: 'Stock',
  spend: 'Spend',
  reports: 'Reports',
  closeDay: 'Close',
  searchItems: 'Search items...',
  searchAll: 'Search products by name, category, or barcode...',
  all: 'All',
  payment: 'Payment',
  cash: 'Cash',
  credit: 'Credit',
  customerName: 'Customer Name',
  customerNameEx: 'e.g. John Mukasa',
  discount: 'Discount',
  roundTo100: 'Round to 100',
  clear: 'Clear',
  cashReceived: 'Cash Received:',
  amount: 'Amount',
  exact: 'Exact',
  change: 'Change:',
  stillNeed: 'Still Need:',
  subtotal: 'Subtotal',
  total: 'Total',
  completeSale: 'Complete sale',
  confirmSale: 'Confirm Sale',
  items: 'items',
  itemsLabel: 'Items',
  cancel: 'Cancel',
  confirm: 'Confirm',
  saving: 'Saving...',
  backToProducts: 'Back to products',
  checkout: 'Checkout',
  closeBtn: 'Close',
  off: 'off',
};

// Everyday Luganda as spoken in shops (loanwords kept where shops genuinely
// use the English word — Disikaunti, Cenci, Ripooti, Stoko).
const LU: Record<SellKey, string> = {
  sell: 'Tunda',
  stock: 'Stoko',
  spend: 'Saasaanya',
  reports: 'Ripooti',
  closeDay: 'Ggalawo',
  searchItems: 'Noonya ekintu...',
  searchAll: 'Noonya erinnya, ekika, oba barcodi...',
  all: 'Byonna',
  payment: 'Okusasula',
  cash: 'Cash',
  credit: 'Deni',
  customerName: 'Erinnya lya kasitoma',
  customerNameEx: 'e.g. John Mukasa',
  discount: 'Disikaunti',
  roundTo100: 'Ku 100',
  clear: 'Jjamu',
  cashReceived: 'Ssente:',
  amount: 'Omuwendo',
  exact: 'Sawa',
  change: 'Cenci:',
  stillNeed: 'Ekyasigadde:',
  subtotal: 'Subtotal',
  total: 'Omugatte',
  completeSale: 'Maliriza okutunda',
  confirmSale: 'Kakasa okutunda',
  items: 'ebintu',
  itemsLabel: 'Ebintu',
  cancel: 'Sazaamu',
  confirm: 'Kakasa',
  saving: 'Kutereka...',
  backToProducts: 'Ddayo ku bintu',
  checkout: 'Okusasula',
  closeBtn: 'Ggala',
  off: 'ezikendedde',
};

// Everyday Swahili as spoken in shops across Uganda.
const SW: Record<SellKey, string> = {
  sell: 'Uza',
  stock: 'Stoki',
  spend: 'Tumia',
  reports: 'Ripoti',
  closeDay: 'Funga',
  searchItems: 'Tafuta bidhaa...',
  searchAll: 'Tafuta jina, aina, au barcode...',
  all: 'Zote',
  payment: 'Malipo',
  cash: 'Pesa',
  credit: 'Deni',
  customerName: 'Jina la mteja',
  customerNameEx: 'e.g. John Mukasa',
  discount: 'Punguzo',
  roundTo100: 'Kamilisha 100',
  clear: 'Futa',
  cashReceived: 'Pesa zilizopokelewa:',
  amount: 'Kiasi',
  exact: 'Sawa',
  change: 'Chenji:',
  stillNeed: 'Inayobaki:',
  subtotal: 'Jumla ndogo',
  total: 'Jumla',
  completeSale: 'Maliza mauzo',
  confirmSale: 'Thibitisha mauzo',
  items: 'bidhaa',
  itemsLabel: 'Bidhaa',
  cancel: 'Ghairi',
  confirm: 'Thibitisha',
  saving: 'Inahifadhi...',
  backToProducts: 'Rudi kwa bidhaa',
  checkout: 'Malipo',
  closeBtn: 'Funga',
  off: 'punguzo',
};

export function normalizeLang(v: unknown): SellLang {
  if (v === 'luganda' || v === 'swahili') return v;
  return 'english';
}

// t('luganda', 'total') -> 'Omugatte'. Unknown language or key falls back
// to English so the till never renders a blank label.
export function t(lang: unknown, key: SellKey): string {
  const l = normalizeLang(lang);
  if (l === 'luganda') return LU[key] || EN[key];
  if (l === 'swahili') return SW[key] || EN[key];
  return EN[key];
}
