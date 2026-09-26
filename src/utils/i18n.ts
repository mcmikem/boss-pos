// Sell-screen translations. English is the source of truth; Luganda covers
// the strings a cashier reads mid-sale and on the everyday pages (sell,
// expenses, money, reports, close day). Settings sheets and admin stay
// English by design — owners already operate there in English. Other
// languages fall back to English key-by-key so a half-done translation never
// blanks the UI.

export type SellLang = 'english' | 'luganda' | 'swahili';

export type SellKey =
  | 'sell' | 'stock' | 'spend' | 'reports' | 'salesTab' | 'closeDay'
  | 'searchItems' | 'searchAll' | 'all'
  | 'payment' | 'cash' | 'credit' | 'customerName' | 'customerNameEx'
  | 'discount' | 'roundTo100' | 'clear'
  | 'cashReceived' | 'amount' | 'exact' | 'change' | 'stillNeed'
  | 'subtotal' | 'total' | 'completeSale'
  | 'confirmSale' | 'items' | 'itemsLabel' | 'cancel' | 'confirm' | 'saving'
  | 'backToProducts' | 'checkout' | 'closeBtn' | 'off'
  | 'money' | 'more' | 'settings' | 'save' | 'delete' | 'sure' | 'keep' | 'done' | 'back'
  | 'expenses' | 'logExpense' | 'totalSpent' | 'topExpense' | 'history' | 'tapRowDetails'
  | 'todaysSummary' | 'youKept' | 'youLost' | 'closeDayCta'
  | 'addProduct' | 'outOfStock'
  | 'drawerMath' | 'soldToday' | 'collectedToday' | 'movedOut' | 'capital'
  | 'opening' | 'unexplained' | 'balancedMsg' | 'outstanding' | 'losses' | 'moneyOut'
  | 'saveCredit' | 'recordPayment' | 'logLoss'
  | 'madeK' | 'soldK' | 'lostK' | 'carriedK' | 'itemK' | 'checkK'
  | 'shouldBe' | 'countedDrawer' | 'extraK' | 'shortK' | 'inDrawers'
  | 'floatK' | 'ownerK' | 'bankK' | 'remainingK' | 'expiredK' | 'closeBalance'
  | 'addCreditK' | 'dateK' | 'itemTakenK' | 'qtyK' | 'unitPriceK';

const EN: Record<SellKey, string> = {
  sell: 'Sell',
  stock: 'Stock',
  spend: 'Spend',
  reports: 'Reports',
  salesTab: 'Sales',
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
  money: 'Money',
  more: 'More',
  settings: 'Settings',
  save: 'Save',
  delete: 'Delete',
  sure: 'Sure?',
  keep: 'Keep',
  done: 'Done',
  back: 'Back',
  expenses: 'Expenses',
  logExpense: 'Log expense',
  totalSpent: 'Total spent',
  topExpense: 'Top expense',
  history: 'History',
  tapRowDetails: 'Tap a row for details',
  todaysSummary: "Today's Summary",
  youKept: 'You kept',
  youLost: 'You lost',
  closeDayCta: 'Close the day',
  addProduct: 'Add product',
  outOfStock: 'Out of stock',
  drawerMath: 'Drawer math',
  soldToday: 'Sold today',
  collectedToday: 'Collected today',
  movedOut: 'Moved out',
  capital: 'Capital',
  opening: 'Opening',
  unexplained: 'Still unexplained',
  balancedMsg: 'Every shilling accounted for.',
  outstanding: 'Outstanding',
  losses: 'Losses',
  moneyOut: 'Money out',
  saveCredit: 'Save credit',
  recordPayment: 'Record payment',
  logLoss: 'Log loss',
  madeK: 'Made',
  soldK: 'Sold',
  lostK: 'Lost',
  carriedK: 'Carried',
  itemK: 'Item',
  checkK: 'Check',
  shouldBe: 'Should be',
  countedDrawer: 'Counted in drawer',
  extraK: 'extra',
  shortK: 'short',
  inDrawers: 'In drawers',
  floatK: 'Float',
  ownerK: 'Owner',
  bankK: 'Bank',
  remainingK: 'Remaining',
  expiredK: 'Expired',
  closeBalance: 'Daily Balance & Close-Out',
  addCreditK: 'Add credit',
  dateK: 'Date',
  itemTakenK: 'Item taken',
  qtyK: 'Number taken',
  unitPriceK: 'Unit price',
};

// Everyday Luganda as spoken in shops (loanwords kept where shops genuinely
// use the English word — Disikaunti, Sitoko, Lipooti, Banka, Float).
const LU: Record<SellKey, string> = {
  sell: 'Tunda',
  stock: 'Sitoko',
  spend: 'Saasaanya',
  reports: 'Lipooti',
  salesTab: 'Sales',
  closeDay: 'Ggalawo',
  searchItems: 'Noonya ebintu...',
  searchAll: 'Noonya amannya, ekika, oba baakoodi...',
  all: 'Byonna',
  payment: 'Okusasula',
  cash: 'Kesi',
  credit: 'Deni',
  customerName: 'Erinnya lya kasitoma',
  customerNameEx: 'e.g. John Mukasa',
  discount: 'Disikaunti',
  roundTo100: 'Ku 100',
  clear: 'Jjamu',
  cashReceived: 'Ssente:',
  amount: 'Omuwendo',
  exact: 'Entuufu',
  change: 'Ezakudda:',
  stillNeed: 'Ekyasigadde:',
  subtotal: 'Omugatte ogusooka',
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
  money: 'Ssente',
  more: 'Ebirala',
  settings: 'Ensengeka',
  save: 'Tereka',
  delete: 'Ggyawo',
  sure: 'Kakasa?',
  keep: 'Lekawo',
  done: 'Kiwedde',
  back: 'Ddayo',
  expenses: 'Ensaasaanya',
  logExpense: 'Wandiika ensaasaanya',
  totalSpent: 'Osaasanyizza byona',
  topExpense: 'Ekisinga okusaasaanya',
  history: 'Ebyayita',
  tapRowDetails: 'Nyiga olunyiriri okulaba',
  todaysSummary: 'Ebya leero',
  youKept: 'Osigazza',
  youLost: 'Ofiiriddwa',
  closeDayCta: 'Ggalawo leero',
  addProduct: 'Yongera ekintu',
  outOfStock: 'Kiweddewo',
  drawerMath: 'Ebya duloowa',
  soldToday: 'Otunze leero',
  collectedToday: 'Ebiyingidde leero',
  movedOut: 'Ebifulumidde',
  capital: 'Kapito',
  opening: 'Entandikwa',
  unexplained: 'Ezitannyonnyolwa',
  balancedMsg: 'Buli ssente etegekeddwa.',
  outstanding: 'Amabanja',
  losses: 'Okufiirwa',
  moneyOut: 'Ssente ezafuluma',
  saveCredit: 'Tereka edeni',
  recordPayment: 'Wandiika okusasula',
  logLoss: 'Wandiika okufiirwa',
  madeK: 'Ezakolebwa',
  soldK: 'Ezatundiddwa',
  lostK: 'Ezaabuze',
  carriedK: 'Ezitwaliddwa',
  itemK: 'Ekintu',
  checkK: 'Kebera',
  shouldBe: 'Zirina okuba',
  countedDrawer: 'Ebibaliddwa mu duloowa',
  extraK: 'ekisukkiridde',
  shortK: 'ekibulako',
  inDrawers: 'Mu duloowa',
  floatK: 'Float',
  ownerK: 'Nannyini',
  bankK: 'Banka',
  remainingK: 'Ebikyaliko',
  expiredK: 'Ebivuddeko',
  closeBalance: 'Bbalansi ya leero',
  addCreditK: "Yongera edeni",
  dateK: 'Olunaku',
  itemTakenK: 'Ekintu ekyatutte',
  qtyK: 'Obungi',
  unitPriceK: 'Omutengo',
};

export function normalizeLang(v: unknown): SellLang {
  if (v === 'luganda' || v === 'swahili') return v;
  return 'english';
}

// t('luganda', 'total') -> 'Omugatte'. Unknown language or key falls back
// to English so the till never renders a blank label. (Swahili was dropped:
// it is barely used in Ugandan shops, so it only cluttered the selector.)
export function t(lang: unknown, key: SellKey): string {
  if (normalizeLang(lang) === 'luganda') return LU[key] || EN[key];
  return EN[key];
}
