import { useState, useMemo, useEffect, useRef, lazy, Suspense, type Dispatch, type SetStateAction } from 'react';
import { 
  Search, Plus, Minus, Trash2, ShoppingCart, Check, Tag,
  Coins, Smartphone, UserCheck, Percent, User,
  Barcode, Wallet, ChefHat, ArrowRightLeft, Scissors, X, Palette, Zap, RotateCcw,
  CalendarCheck, Wrench, FileText, Star
} from 'lucide-react';
import { Product, Sale, SaleItem, Expense, Quote, StoreSettings, ProductionRegister, WastageLog } from '../types';
import { nextOrderNumber } from '../api';
import ProductCard from './ProductCard';
import BarcodeScanner from './BarcodeScanner';
import KeyboardShortcuts from './KeyboardShortcuts';
import CustomChargeModal from './CustomChargeModal';
import ServiceQtyModal from './ServiceQtyModal';
import ConfirmSaleModal from './ConfirmSaleModal';
import type { TriggerToast } from './Toast';
import CashTransferModal from './CashTransferModal';
import QuickExpenseModal from './QuickExpenseModal';
import ProfitAnalyzerModal from './ProfitAnalyzerModal';
import Fuse from 'fuse.js';
import { unitLabel, parseQty } from '../utils/units';
import { t } from '../utils/i18n';
import { isOn } from '../utils/features';
import { findMissingProduction } from '../utils/cashflow';
import { localDayKey, todayLocalKey } from '../utils/dates';
import { expiryStatus } from '../utils/dates';
import { pushNotice, dayKeyOf } from '../utils/notifications';
import { loadParked, parkCart, unparkCart, parkedTotal, parkedCount, type ParkedCart } from '../utils/parked';
import { CATEGORY_VISUALS, DEFAULT_CATEGORY_VISUAL } from '../data/categoryVisuals';
// Heavy sub-managers are lazy-loaded so the initial sell screen (and the main
// bundle) stays small — important on the slow connections this app targets.
const TailoringOrders = lazy(() => import('./TailoringOrders'));
const DesignOrders = lazy(() => import('./DesignOrders'));
const EateryPricing = lazy(() => import('./EateryPricing'));
const MorningProduction = lazy(() => import('./MorningProduction'));
const Bookings = lazy(() => import('./Bookings'));
const RepairJobs = lazy(() => import('./RepairJobs'));
const Quotes = lazy(() => import('./Quotes'));
const subManagerFallback = (
  <div className="flex items-center justify-center py-16">
    <div className="w-8 h-8 border-2 border-gold-brand border-t-transparent rounded-full animate-spin" />
  </div>
);

// Short vibration + beep when a charge completes so the cashier knows it went
// through without re-reading the screen. Works on Chrome 49+.
function playChargeFeedback() {
  try {
    if (navigator.vibrate) navigator.vibrate(60);
  } catch { /* ignore */ }
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const beep = (freq: number, at: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.2, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.12);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 0.13);
    };
    beep(880, 0);
    beep(1174, 0.14);
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* audio blocked; vibration already fired */ }
}

interface SalesProps {
  products: Product[];
  onAddSale: (sale: Sale) => void;
  onUpdateProduct: (p: Product) => void;
  formatCurrency: (val: number) => string;
  cart: SaleItem[];
  setCart: Dispatch<SetStateAction<SaleItem[]>>;
  triggerToast: TriggerToast;
  settings?: StoreSettings;
  onAddExpense?: (expense: Expense) => void;
  expenseCategories?: string[];
  isQuickSale: boolean;
  setIsQuickSale: Dispatch<SetStateAction<boolean>>;
  categories: string[];
  staffName?: string;
  setStaffName: (name: string) => void;
  onSaveCustomProduct?: (p: Product) => void;
  onUndoSale?: (saleId: string) => void;
  staffConfigured?: boolean;
  onOpenStaffSwitcher?: () => void;
  tillBranch?: string;
  productionRegisters?: ProductionRegister[];
  onAddProduction?: (p: ProductionRegister) => void;
  onDeleteProduction?: (id: string) => void;
  salesHistory?: Sale[];
  wastageLogs?: WastageLog[];
  onGoToStock?: () => void;
  simple?: boolean;
}

const localOrderNumber = () => {
  const key = 'boss_pos_order_counter';
  const current = parseInt(localStorage.getItem(key) || '8492', 10);
  const next = current + 1;
  localStorage.setItem(key, String(next));
  // Offline temp number — server renumbers to canonical Order # on sync (api/index.js:1050)
  return `Temp #${next}`;
};

// Search synonyms (#9): Luganda/English doubles + common misspellings map
// to the catalog name before Fuse runs, so "kikaati" finds chapati.
const SEARCH_SYNONYMS: Record<string, string> = {
  chappati: 'chapati',
  chapatti: 'chapati',
  kikaati: 'chapati',
  kikati: 'chapati',
  rollex: 'rolex',
  sambusa: 'samosa',
  samusa: 'samosa',
};
const applySynonyms = (q: string) => q.split(' ').map(w => SEARCH_SYNONYMS[w] || w).join(' ');

// Demo stock (#2): practice catalog for brand-new tills. Never persisted —
// demo checkouts are simulated, so trying can't pollute real reports.
const DEMO_PRODUCTS: Product[] = [
  { id: 'demo-chapati', name: 'Chapati', category: 'Eatery', cost: 250, price: 500, stockQty: 50, lowStockThreshold: 10 },
  { id: 'demo-rolex', name: 'Rolex', category: 'Eatery', cost: 1200, price: 2000, stockQty: 30, lowStockThreshold: 5 },
  { id: 'demo-soda', name: 'Soda', category: 'Drinks', cost: 900, price: 1500, stockQty: 40, lowStockThreshold: 8 },
  { id: 'demo-samosa', name: 'Samosa', category: 'Eatery', cost: 550, price: 1000, stockQty: 25, lowStockThreshold: 5 },
];

export default function Sales({
  products, onAddSale, onUpdateProduct, formatCurrency, cart, setCart, triggerToast, settings, onAddExpense, expenseCategories = ['Stock Purchase', 'Utilities', 'Labor', 'Rent', 'Transport', 'Supplies'], isQuickSale, setIsQuickSale,   categories, staffName, setStaffName, onSaveCustomProduct, onUndoSale, staffConfigured, onOpenStaffSwitcher, tillBranch, productionRegisters = [], onAddProduction, onDeleteProduction, salesHistory = [], wastageLogs = [], onGoToStock, simple = false,
}: SalesProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  // Fast sellers: user-pinned products in a rush-hour strip (one tap to add).
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('boss_pos_pinned') || '[]'); } catch { return []; }
  });
  const togglePin = (id: string) => setPinnedIds(prev => {
    const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
    try { localStorage.setItem('boss_pos_pinned', JSON.stringify(next)); } catch {}
    return next;
  });
  const pinnedProducts = useMemo(
    () => pinnedIds.map(id => products.find(p => p.id === id)).filter((p): p is Product => !!p),
    [pinnedIds, products]
  );
  // Trade tools appear when their category actually stocks products — no
  // manual Settings toggle hunt required (toggle still forces them on).
  const hasTailoringStock = useMemo(() => products.some(p => p.category === 'Tailoring'), [products]);
  const hasDesignStock = useMemo(() => products.some(p => p.category === 'Graphics' || p.category === 'Printing'), [products]);
  // Till-control master switches (Settings → Till control). All default ON.
  const featsOn = (k: 'fastSellers' | 'quickCash' | 'autoTools') => isOn(settings?.features, k);
  // Suspended carts: park a half-built sale, recall it later. Till-local only.
  const [parked, setParked] = useState<ParkedCart[]>(() => {
    try { return loadParked(); } catch { return []; }
  });
  const parkCurrent = () => {
    if (cart.length === 0) return;
    const name = window.prompt('Park this sale under which name?', customerName || '');
    if (name === null) return;
    setParked(parkCart({ name: name.trim() || `Customer ${parked.length + 1}`, items: cart, paymentMethod, customerName }));
    setCart([]);
    triggerToast('Sale parked — recall it from the cart', 'success');
  };
  const recallParked = (id: string) => {
    const entry = parked.find(p => p.id === id);
    if (!entry) return;
    if (cart.length > 0 && !window.confirm(`Replace the current cart with ${entry.name}'s parked sale?`)) return;
    setCart(entry.items);
    if (entry.paymentMethod) setPaymentMethod(entry.paymentMethod as never);
    setCustomerName(entry.customerName || '');
    setParked(unparkCart(id));
    triggerToast(`Recalled ${entry.name}'s sale`, 'info');
  };
  const renderParkedRows = () => parked.length > 0 ? (
    <div className="space-y-1.5">
      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Parked ({parked.length})</p>
      {parked.map(p => (
        <div key={p.id} className="flex items-center gap-2 bg-[#0A0A0A] border border-white/5 rounded-xl px-3 py-2">
          <button onClick={() => recallParked(p.id)} className="flex-1 min-w-0 text-left cursor-pointer">
            <span className="block text-xs font-black text-white truncate">{p.name}</span>
            <span className="block text-[10px] text-zinc-500 font-bold">{parkedCount(p)} items • {formatCurrency(parkedTotal(p))}</span>
          </button>
          <button onClick={() => setParked(unparkCart(p.id))} aria-label={`Drop parked sale ${p.name}`}
            className="shrink-0 text-zinc-600 hover:text-rose-400 font-bold text-lg leading-none px-1 cursor-pointer">×</button>
        </div>
      ))}
    </div>
  ) : null;
  const [showTailoringOrders, setShowTailoringOrders] = useState<boolean>(false);
  const [showDesignOrders, setShowDesignOrders] = useState<boolean>(false);
  const [showBookings, setShowBookings] = useState<boolean>(false);
  const [showRepairs, setShowRepairs] = useState<boolean>(false);
  const [showEateryPricing, setShowEateryPricing] = useState<boolean>(false);
  const [showProduction, setShowProduction] = useState<boolean>(false);
  const [variantProduct, setVariantProduct] = useState<Product | null>(null);
  const [serviceQtyProduct, setServiceQtyProduct] = useState<Product | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  // Guided first sale (#1) + demo mode (#2): first-timers get 3 steps and
  // optional practice stock. Demo sales are blocked in handleCompleteSale.
  const [demoMode, setDemoMode] = useState(false);
  const [guideDismissed, setGuideDismissed] = useState(() => {
    try { return localStorage.getItem('boss_pos_firstsale_guide') === '1'; } catch { return false; }
  });
  const dismissGuide = () => {
    try { localStorage.setItem('boss_pos_firstsale_guide', '1'); } catch {}
    setGuideDismissed(true);
  };
  const catalog = demoMode ? DEMO_PRODUCTS : products;
  // Street mode: roadside-stall selling — each tap on a plain product sells
  // one unit for cash instantly (no cart, no confirm, no receipt). Products
  // with variants or per-unit pricing still open their picker.
  const [streetMode, setStreetMode] = useState<boolean>(() => {
    try { return localStorage.getItem('boss_pos_street_mode') === '1'; } catch { return false; }
  });
  const [streetCount, setStreetCount] = useState(0);
  const [streetTotal, setStreetTotal] = useState(0);
  // Contractor quotations live on this till only (localStorage): priced cart
  // snapshots that are not sales until converted back into the cart.
  const [showQuotes, setShowQuotes] = useState(false);
  const [quotes, setQuotes] = useState<Quote[]>(() => {
    try { return JSON.parse(localStorage.getItem('boss_pos_quotes') || '[]'); } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem('boss_pos_quotes', JSON.stringify(quotes)); } catch {}
  }, [quotes]);
  // Till language for the sell screen (Luganda mid-sale, English elsewhere).
  const lang = settings?.language;
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'MTN MoMo' | 'Airtel Money' | 'Credit / Book'>(() => {
    if (settings?.defaultPaymentMethod === 'MTN MoMo') return 'MTN MoMo';
    if (settings?.defaultPaymentMethod === 'Airtel Money') return 'Airtel Money';
    if (settings?.defaultPaymentMethod === 'Credit / Book') return 'Credit / Book';
    return 'Cash';
  });
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingQtyValue, setEditingQtyValue] = useState<string>('');
  const [isMobileCartOpen, setIsMobileCartOpen] = useState<boolean>(false);
  const [isCustomChargeOpen, setIsCustomChargeOpen] = useState<boolean>(false);
  const [quickSearchQuery, setQuickSearchQuery] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('');
  const [showSellerEditor, setShowSellerEditor] = useState(false);
  const [sellerDraft, setSellerDraft] = useState('');
  const [discount, setDiscount] = useState<string>('');
  const [customCashReceived, setCustomCashReceived] = useState<string>('');
  const [discountType, setDiscountType] = useState<'fixed' | 'percent'>('fixed');
  const [isScannerOpen, setIsScannerOpen] = useState<boolean>(false);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState<boolean>(false);
  const [showConfirmSale, setShowConfirmSale] = useState<boolean>(false);
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);
  const [showQuickExpense, setShowQuickExpense] = useState(false);
  const [showFoodCost, setShowFoodCost] = useState(false);
  const [showTransfers, setShowTransfers] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);
  // Undo window for the just-completed sale: 10s to tap Undo, then it lapses
  // (a manager can still refund from Reports).
  const [undoSaleId, setUndoSaleId] = useState<string | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);
  const [lastSaleItems, setLastSaleItems] = useState<SaleItem[] | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('boss_pos_last_sale');
      if (raw) setLastSaleItems(JSON.parse(raw) as SaleItem[]);
    } catch { /* ignore */ }
  }, []);
  const [visibleCount, setVisibleCount] = useState(30);
  const PAGE_SIZE = 30;

  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    setVisibleCount(30);
  }, [selectedCategory, searchQuery]);

  const byCategory = useMemo(() => catalog.filter(p => selectedCategory === 'All' || p.category === selectedCategory), [catalog, selectedCategory]);
  // Forgiving search (#9): typo-tolerant (threshold 0.5, location-free) so
  // "chaptai", "ROLAX" or extra spaces still find chapati / rolex.
  const fuse = useMemo(() => new Fuse(byCategory, {
    keys: [
      { name: 'name', weight: 0.6 },
      { name: 'category', weight: 0.2 },
      { name: 'barcode', weight: 0.1 },
      { name: 'imei', weight: 0.1 },
    ],
    threshold: 0.5,
    ignoreLocation: true,
    distance: 80,
    includeScore: true,
  }), [byCategory]);
  const normQuery = (q: string) => applySynonyms(q.trim().toLowerCase().replace(/\s+/g, ' '));
  const wordMatch = (p: Product, q: string) => {
    const words = q.split(' ').filter(Boolean);
    if (words.length === 0) return true;
    const hay = `${p.name} ${p.category} ${p.barcode || ''} ${p.imei || ''}`.toLowerCase();
    return words.every(w => hay.includes(w));
  };
  const filteredProducts = useMemo(() => {
    const q = normQuery(searchQuery);
    if (!q) return byCategory;
    const res = fuse.search(normQuery(searchQuery));
    if (res.length === 0) {
      return byCategory.filter(p => wordMatch(p, q));
    }
    return res.map(r => r.item);
  }, [byCategory, fuse, searchQuery]);

  const handleAddToCart = (product: Product) => {
    if (product.stockQty <= 0 && !product.isService) {
      // No dead ends (#20): an out-of-stock tap offers the custom-item path
      // so the cashier can still serve the customer.
      triggerToast(`${product.name} is out of stock!`, 'error', {
        label: 'Sell custom',
        onClick: () => setIsCustomChargeOpen(true),
      });
      return;
    }
    // Expiry guard: never sell expired stock; warn when expiring soon.
    try {
      const tier = expiryStatus(product.expiryDate);
      if (tier === 'expired') {
        triggerToast(`${product.name} is EXPIRED — remove it, do not sell`, 'error');
        try {
          pushNotice('expiry', `Blocked expired sale: ${product.name}`, 'Cashier tried to sell expired stock. Remove or write it off as a loss.', `exp-block:${product.id}:${dayKeyOf()}`);
        } catch {}
        return;
      }
      if (tier === 'soon' && !product.isService) {
        triggerToast(`${product.name} expires soon — sell it first (FIFO)`, 'info');
      }
    } catch {}
    if (streetMode && (!product.variants || product.variants.length === 0) && !product.saleUnit) {
      streetSell(product);
      return;
    }
    if (product.variants && product.variants.length > 0) {
      setVariantProduct(product);
      return;
    }
    if (product.saleUnit) {
      setServiceQtyProduct(product);
      return;
    }
    addCartLine(product.id, undefined, undefined, product.name, 1, product.price, product.cost, product.stockQty, !!product.isService, product.saleUnit);
    // Plain taps had zero feedback: on phones the cart lives behind the gold
    // FAB, so without this toast an add looked like nothing happened.
    triggerToast(`Added: ${product.name}`, 'success');
  };

  const addCartLine = (productId: string, variantId: string | undefined, variantLabel: string | undefined, productName: string, qty: number, unitPrice: number, unitCost: number, stockQty: number, isService: boolean, saleUnit?: string) => {
    setCart(prev => {
      const key = `${productId}::${variantId || ''}`;
      const existing = prev.find(i => `${i.productId}::${i.variantId || ''}` === key);
      if (existing) {
        const nextQty = existing.qty + qty;
        if (nextQty > stockQty && !isService) {
          triggerToast(`Cannot exceed remaining stock (${stockQty})!`, 'error');
          return prev;
        }
        return prev.map(item =>
          `${item.productId}::${item.variantId || ''}` === key
            ? { ...item, qty: nextQty, lineTotal: nextQty * unitPrice }
            : item
        );
      }
      return [...prev, {
        productId, variantId: variantId || undefined, variantLabel: variantLabel || undefined,
        productName: variantLabel ? `${productName} — ${variantLabel}` : productName,
        qty, unitPrice, unitCost, lineTotal: unitPrice * qty, saleUnit,
      } as SaleItem];
    });
  };

  const handleVariantAdd = (variant: { id: string; label: string; price: number; cost?: number }) => {
    if (!variantProduct) return;
    addCartLine(variantProduct.id, variant.id, variant.label, variantProduct.name, 1, variant.price, variant.cost ?? variantProduct.cost, variantProduct.stockQty, !!variantProduct.isService, variantProduct.saleUnit);
    triggerToast(`${variantProduct.name} (${variant.label}) added`, 'success');
    setVariantProduct(null);
  };

  const handleServiceQtyAdd = (qty: number) => {
    if (!serviceQtyProduct) return;
    const p = serviceQtyProduct;
    addCartLine(p.id, undefined, undefined, p.name, qty, p.price, p.cost, p.stockQty, true, p.saleUnit);
    triggerToast(`${p.name} (${unitLabel(qty, p.saleUnit)}) added`, 'success');
    setServiceQtyProduct(null);
  };

  const handleCompleteSaleRef = useRef<(() => boolean | void | Promise<boolean | void>) | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') { e.preventDefault(); setIsScannerOpen(true); }
      if (e.key === 'F2') { e.preventDefault(); handleCompleteSaleRef.current?.(); }
      if (e.ctrlKey && e.key === '/') { e.preventDefault(); setShowKeyboardHelp(true); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleBarcodeScanned = (barcode: string) => {
    const product = catalog.find(p => p.barcode === barcode || p.imei === barcode || p.id === `prod-${barcode}`);
    if (product) {
      handleAddToCart(product);
      triggerToast(`Added: ${product.name}`, 'success');
      setIsScannerOpen(false);
    } else {
      triggerToast(`Product not found (${barcode})`, 'error', {
        label: 'Custom item',
        onClick: () => setIsCustomChargeOpen(true),
      });
    }
  };

  const handleAdjustQty = (productId: string, variantId: string | undefined, delta: number) => {
    const product = products.find(p => p.id === productId);
    const key = `${productId}::${variantId || ''}`;
    setCart(prev => prev.map(item => {
      if (`${item.productId}::${item.variantId || ''}` === key) {
        const nextQty = Math.round((item.qty + delta) * 1000) / 1000;
        if (nextQty <= 0) return null;
        if (product && nextQty > product.stockQty && !product.isService) {
          triggerToast(`Cannot exceed remaining stock (${product.stockQty})!`, 'error');
          return item;
        }
        return { ...item, qty: nextQty, lineTotal: nextQty * item.unitPrice };
      }
      return item;
    }).filter(Boolean) as SaleItem[]);
    setRemoveConfirmId(null);
  };

  // Direct qty edit (tap the qty pill → type → Enter). Takes the RAW string so
  // a typo or empty field can never nuke the line: only an explicit "0"
  // removes it, anything else unparseable just closes the editor and keeps
  // the old qty. Fractions (2.5 kg) round to 3 decimals via parseQty.
  const handleDirectQtyChange = (productId: string, variantId: string | undefined, raw: string) => {
    const key = `${productId}::${variantId || ''}`;
    const trimmed = raw.trim();
    if (trimmed === '') { setEditingItemId(null); return; }
    const val = parseQty(trimmed);
    if (val <= 0) {
      if (/^0+(\.0+)?$/.test(trimmed)) handleRemoveItem(productId, variantId);
      else triggerToast('Enter a valid quantity (e.g. 2 or 2.5)', 'error');
      setEditingItemId(null);
      return;
    }
    const product = products.find(p => p.id === productId);
    if (product && val > product.stockQty && !product.isService) {
      triggerToast(`Only ${product.stockQty} remaining in stock!`, 'error');
      setEditingItemId(null);
      return;
    }
    setCart(prev => prev.map(item =>
      `${item.productId}::${item.variantId || ''}` === key
        ? { ...item, qty: val, lineTotal: val * item.unitPrice }
        : item
    ));
    setEditingItemId(null);
  };

  const handleRemoveItem = (productId: string, variantId: string | undefined) => {
    const key = `${productId}::${variantId || ''}`;
    const item = cart.find(i => `${i.productId}::${i.variantId || ''}` === key);
    if (item && item.qty > 1 && removeConfirmId !== key) {
      setRemoveConfirmId(key);
      return;
    }
    setCart(prev => prev.filter(item => `${item.productId}::${item.variantId || ''}` !== key));
    setRemoveConfirmId(null);
  };

  const subtotal = cart.reduce((acc, item) => acc + item.lineTotal, 0);
  const discountNum = discountType === 'percent'
    ? Math.min(parseFloat(discount) || 0, 100) / 100 * subtotal
    : Math.min(Math.max(0, parseFloat(discount) || 0), subtotal);
  const total = Math.max(0, subtotal - discountNum);
  // Credit without a name is money given to nobody — block it everywhere
  // (buttons + F2 + confirm modal) until the collector is named.
  const creditNameless = paymentMethod === 'Credit / Book' && customerName.trim() === '';
  const isDisabled = cart.length === 0 || creditNameless || (paymentMethod === 'Cash' && customCashReceived !== '' && parseFloat(customCashReceived) < total);
  const disabledReason = cart.length === 0
    ? 'Cart is empty'
    : creditNameless
    ? 'Add the customer name — credit needs someone to collect from'
    : (paymentMethod === 'Cash' && customCashReceived !== '' && parseFloat(customCashReceived) < total)
    ? `Need ${formatCurrency(total - parseFloat(customCashReceived))} more`
    : '';
  const tax = 0;

  // Money strip (#16): today's takings at a glance — cash, phone money,
  // credit out. Computed from real history only, never demo stock.
  const todayKey = todayLocalKey();
  const todayLive = useMemo(
    () => (salesHistory || []).filter(s => {
      try { return localDayKey(s.timestamp) === todayKey; } catch { return false; }
    }),
    [salesHistory, todayKey],
  );
  const stripCash = todayLive.filter(s => !s.refunded && s.paymentMethod === 'Cash').reduce((a, s) => a + s.total, 0);
  const stripMomo = todayLive.filter(s => !s.refunded && (s.paymentMethod === 'MTN MoMo' || s.paymentMethod === 'Airtel Money')).reduce((a, s) => a + s.total, 0);
  const stripCredit = todayLive.filter(s => !s.refunded && s.paymentMethod === 'Credit / Book').reduce((a, s) => a + s.total, 0);
  const showGuide = !guideDismissed && !demoMode && (salesHistory || []).length === 0;

  const handleCompleteSale = async () => {
    // Playable demo (#2): run the full checkout thrill, but save nothing —
    // the cart just clears with a success note instead of a real sale.
    if (demoMode) {
      if (cart.length === 0) { triggerToast('Cart is empty!', 'error'); return false; }
      setCart([]);
      setCustomCashReceived('');
      setDiscount('');
      setCustomerName('');
      setIsMobileCartOpen(false);
      playChargeFeedback();
      triggerToast('Demo sale done — not saved. Exit demo to sell for real.', 'success');
      return true;
    }
    if (isCompleting) return false;
    if (cart.length === 0) { triggerToast('Cart is empty!', 'error'); return false; }
    // F2 / QuickSale bypass the disabled buttons, so the name gate lives here too.
    if (paymentMethod === 'Credit / Book' && customerName.trim() === '') {
      triggerToast('Add the customer name first — credit needs someone to collect from', 'error');
      return false;
    }

    // Re-validate stock against the live catalog. The cart can go stale across
    // tab switches or stock edits, so never sell more than is actually there.
    const oversold: string[] = [];
    const clampedItems = cart.map(item => {
      const live = products.find(p => p.id === item.productId);
      if (live?.isService) return item;
      const available = live ? live.stockQty : item.qty;
      if (item.qty > available) {
        oversold.push(`${item.productName} (need ${item.qty}, have ${available})`);
        return { ...item, qty: Math.max(0, available), lineTotal: Math.max(0, available) * item.unitPrice };
      }
      return item;
    });
    const itemsToSell = clampedItems.filter(i => i.qty > 0);
    const saleSubtotal = itemsToSell.reduce((acc, item) => acc + item.lineTotal, 0);
    const saleDiscount = discountType === 'percent'
      ? Math.min(parseFloat(discount) || 0, 100) / 100 * saleSubtotal
      : Math.min(Math.max(0, parseFloat(discount) || 0), saleSubtotal);
    const saleTotal = Math.max(0, saleSubtotal - saleDiscount);
    if (oversold.length > 0) {
      setCart(clampedItems);
      if (itemsToSell.length === 0) {
        triggerToast(`Out of stock: ${oversold.join(', ')}`, 'error');
        return false;
      }
      triggerToast(`Stock shortage — selling available only: ${oversold.join(', ')}`, 'error');
    }

    // Smart guard: can't sell morning-make items (e.g. chapatis) that were
    // never logged as made today. Ask for clarity instead of silently
    // allowing invented sales — the classic theft hole.
    try {
      const missing = findMissingProduction(
        itemsToSell.map(i => ({ productId: i.productId, productName: i.productName, qty: i.qty })),
        products,
        productionRegisters,
        [],
        todayLocalKey(),
        ['Eatery'],
      );
      if (missing.length > 0) {
        const names = missing.map(m => `${m.productName} ×${m.qtySold}`).join(', ');
        const ok = window.confirm(
          `No production logged today for: ${names}.\n\nWhere did these come from — yesterday's leftover or an unlogged batch?\n\nOK = sell anyway (flagged for the boss) • Cancel = go log production first.`,
        );
        if (!ok) {
          triggerToast('Sale paused — log Morning Production first', 'info');
          return false;
        }
        try {
          pushNotice(
            'no-production',
            `Sold without production: ${names}`,
            `Seller ${staffName || 'unknown'} sold ${names} with zero batch logged today. Confirm leftover or log the batch.`,
            `noprod:${todayLocalKey()}:${missing.map(m => m.productId).join(',').slice(0, 80)}`,
          );
        } catch {}
      }
    } catch {}

    setIsCompleting(true);
    const cashPaidNum = parseFloat(customCashReceived);
    // Underpaid-Cash guard: desktop/mobile buttons disable short-pay, but
    // QuickSale + F2 bypassed them. Block here so no path can sell at a loss.
    if (paymentMethod === 'Cash' && customCashReceived !== '' && !isNaN(cashPaidNum) && cashPaidNum < saleTotal) {
      setIsCompleting(false);
      triggerToast(`Short by ${formatCurrency(saleTotal - cashPaidNum)} — collect full cash first`, 'error');
      return false;
    }
    let changeMsg = '';
    if (paymentMethod === 'Cash' && !isNaN(cashPaidNum) && cashPaidNum >= saleTotal) {
      changeMsg = ` Change: ${formatCurrency(cashPaidNum - saleTotal)}`;
    }
    let orderNumber = await nextOrderNumber();
    if (!orderNumber) orderNumber = localOrderNumber();
    const newSale: Sale = {
      id: `sale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, orderNumber, timestamp: new Date().toISOString(),
      items: itemsToSell, subtotal: saleSubtotal, tax, total: saleTotal, paymentMethod,
      customerName: customerName.trim() || undefined,
      discount: saleDiscount > 0 ? saleDiscount : undefined,
      staffName: staffName?.trim() || undefined,
      branch: tillBranch || undefined,
    };
    onAddSale(newSale);
    try {
      localStorage.setItem('boss_pos_last_sale', JSON.stringify(itemsToSell));
      setLastSaleItems(itemsToSell);
    } catch { /* ignore */ }
    setCart([]);
    setCustomCashReceived('');
    setDiscount('');
    setCustomerName('');
    setIsMobileCartOpen(false);
    setIsCompleting(false);
    playChargeFeedback();
    triggerToast(`${orderNumber} done!${changeMsg}`, 'success');
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoSaleId(newSale.id);
    undoTimer.current = setTimeout(() => setUndoSaleId(null), 10_000);
    return true;
  };
  handleCompleteSaleRef.current = handleCompleteSale;

  // Save the current cart as a contractor quotation (not a sale). Converting
  // brings the items back into the cart to ring the real sale later.
  const saveQuote = () => {
    if (cart.length === 0) { triggerToast('Cart is empty — nothing to quote', 'error'); return; }
    const q: Quote = {
      id: `q-${Date.now()}`,
      customerName: customerName.trim(),
      customerPhone: '',
      items: cart.map(i => ({ ...i })),
      discount: discountNum,
      total,
      createdAt: new Date().toISOString(),
    };
    setQuotes(prev => [q, ...prev]);
    triggerToast('Quote saved — convert it when they agree', 'success');
  };

  const convertQuote = (q: Quote) => {
    setCart(q.items.map(i => ({ ...i })));
    setCustomerName(q.customerName);
    setDiscountType('fixed');
    setDiscount(q.discount > 0 ? String(q.discount) : '');
    setShowQuotes(false);
    triggerToast('Quote loaded — charge to complete the sale', 'success');
  };

  // One-tap cash sale for street mode. Mirrors the core of handleCompleteSale
  // minus cart/discount/confirm/receipt — speed is the whole point.
  const streetSell = async (product: Product) => {
    // Demo guard: street taps must never write real sales either.
    if (demoMode) {
      setStreetCount(c => c + 1);
      setStreetTotal(t => t + product.price);
      playChargeFeedback();
      triggerToast(`Demo: ${product.name} "sold" — not saved`, 'success');
      return;
    }
    try {
      if (expiryStatus(product.expiryDate) === 'expired') {
        triggerToast(`${product.name} is EXPIRED — do not sell`, 'error');
        return;
      }
    } catch {}
    const item: SaleItem = {
      productId: product.id, productName: product.name, qty: 1,
      unitPrice: product.price, unitCost: product.cost, lineTotal: product.price,
    };
    let orderNumber = await nextOrderNumber();
    if (!orderNumber) orderNumber = localOrderNumber();
    const newSale: Sale = {
      id: `sale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, orderNumber, timestamp: new Date().toISOString(),
      items: [item], subtotal: product.price, tax: 0, total: product.price, paymentMethod: 'Cash',
      staffName: staffName?.trim() || undefined,
      branch: tillBranch || undefined,
    };
    onAddSale(newSale);
    setStreetCount(c => c + 1);
    setStreetTotal(t => t + product.price);
    playChargeFeedback();
    triggerToast(`${product.name} sold • ${formatCurrency(product.price)}`, 'success');
  };

  const repeatLastSale = () => {
    if (!lastSaleItems || lastSaleItems.length === 0) return;
    const live = lastSaleItems.filter(item => {
      const p = catalog.find(x => x.id === item.productId);
      return !!p && (p.isService || p.stockQty >= item.qty);
    });
    if (live.length === 0) { triggerToast('Last sale items are out of stock now', 'error'); return; }
    setCart(live);
    if (live.length < lastSaleItems.length) triggerToast('Some items out of stock — added what is available', 'info');
  };

  const renderCartItem = (item: SaleItem) => {
    const lineKey = `${item.productId}::${item.variantId || ''}`;
    const isEditing = editingItemId === lineKey;
    const isRemoveConfirm = removeConfirmId === lineKey;
    return (
      <div key={lineKey} className="bg-[#0A0A0A] border border-white/5 p-4 rounded-2xl flex flex-col justify-between gap-3">
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0">
            <span className="text-sm font-semibold text-zinc-100 truncate max-w-[180px] block leading-snug" title={item.productName}>{item.productName}</span>
            {item.variantLabel && <span className="text-[11px] text-zinc-500 font-medium block truncate">{item.variantLabel}</span>}
          </div>
          <p className="text-sm font-bold text-gold-brand font-display shrink-0">{formatCurrency(item.lineTotal)}</p>
        </div>
        <div className="flex justify-between items-center">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <input type="number" step="any" min="0" autoFocus value={editingQtyValue}
                onChange={(e) => setEditingQtyValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleDirectQtyChange(item.productId, item.variantId, editingQtyValue);
                  if (e.key === 'Escape') setEditingItemId(null);
                }}
                className="w-16 bg-zinc-900 border border-gold-brand text-gold-light rounded text-center text-sm h-11 p-1 focus:outline-none" />
              <button onClick={() => handleDirectQtyChange(item.productId, item.variantId, editingQtyValue)}
                aria-label={`Set quantity for ${item.productName}`}
                className="p-2 bg-gold-brand text-black rounded text-sm hover:opacity-90 cursor-pointer touch-target"><Check className="w-4 h-4" /></button>
            </div>
          ) : (
            // Mistake 14: unit lives INSIDE qty selector, not in product title.
            <button onClick={() => { setEditingItemId(lineKey); setEditingQtyValue(String(item.qty)); }}
              aria-label={`Edit quantity of ${item.productName}, currently ${item.saleUnit ? unitLabel(item.qty, item.saleUnit) : item.qty}`}
              className="text-xs font-semibold text-zinc-300 bg-zinc-900 hover:text-gold-brand hover:bg-zinc-800 px-3 py-1.5 rounded-lg cursor-pointer transition-all touch-target tabular-nums">
              {item.saleUnit ? unitLabel(item.qty, item.saleUnit) : `${item.qty} × ${formatCurrency(item.unitPrice)}`}
            </button>
          )}
          <div className="flex items-center gap-1.5">
            <button onClick={() => handleAdjustQty(item.productId, item.variantId, -1)}
              aria-label={`Decrease quantity of ${item.productName}`}
              className="touch-target bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg flex items-center justify-center transition-all cursor-pointer"><Minus className="w-4 h-4" /></button>
            <button onClick={() => handleAdjustQty(item.productId, item.variantId, 1)}
              aria-label={`Increase quantity of ${item.productName}`}
              className="touch-target bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg flex items-center justify-center transition-all cursor-pointer"><Plus className="w-4 h-4" /></button>
            {isRemoveConfirm ? (
              <div className="flex items-center gap-1">
                <button onClick={() => handleRemoveItem(item.productId, item.variantId)}
                  aria-label={`Confirm remove ${item.productName} from cart`}
                  className="touch-target bg-rose-600 text-white rounded-lg flex items-center justify-center text-xs font-black cursor-pointer">Yes</button>
                <button onClick={() => setRemoveConfirmId(null)}
                  aria-label={`Keep ${item.productName} in cart`}
                  className="touch-target bg-zinc-800 text-zinc-400 rounded-lg flex items-center justify-center text-xs font-bold cursor-pointer">No</button>
              </div>
            ) : (
              <button onClick={() => handleRemoveItem(item.productId, item.variantId)}
                aria-label={`Remove ${item.productName} from cart`}
                className="touch-target bg-rose-950/20 hover:bg-rose-950 hover:text-rose-400 text-rose-500 rounded-lg flex items-center justify-center transition-all cursor-pointer"><Trash2 className="w-4 h-4" /></button>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Compact cart row for the mobile sheet + QuickSale footer. Same guarantees
  // as the desktop row: first tap on remove arms a Yes/No confirm (so a
  // qty>1 line can't be wiped by a stray tap), and the qty pill opens an
  // inline editor that accepts fractions (2.5 kg) via handleDirectQtyChange.
  const renderCompactCartRow = (item: SaleItem, onDark: boolean) => {
    const lineKey = `${item.productId}::${item.variantId || ''}`;
    const isEditing = editingItemId === lineKey;
    const isRemoveConfirm = removeConfirmId === lineKey;
    const qtyText = item.saleUnit ? unitLabel(item.qty, item.saleUnit) : String(item.qty);
    return (
      <div key={lineKey} className={`${onDark ? 'bg-[#141414]' : 'bg-[#0A0A0A]'} border border-white/5 p-3 rounded-xl flex items-center justify-between gap-2 min-h-[64px]`}>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-zinc-100 truncate max-w-[160px] leading-snug" title={item.productName}>{item.productName}</h4>
          {item.variantLabel && <p className="text-[11px] text-zinc-500 font-medium truncate">{item.variantLabel}</p>}
          <p className="text-xs text-gold-brand font-bold mt-0.5 tabular-nums">{formatCurrency(item.lineTotal)}</p>
        </div>
        {isEditing ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <input type="number" step="any" min="0" autoFocus value={editingQtyValue}
              onChange={(e) => setEditingQtyValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleDirectQtyChange(item.productId, item.variantId, editingQtyValue);
                if (e.key === 'Escape') setEditingItemId(null);
              }}
              aria-label={`Quantity for ${item.productName}`}
              className="w-16 bg-zinc-900 border border-gold-brand text-gold-light rounded-lg text-center text-sm h-11 p-1 focus:outline-none tabular-nums" />
            <button onClick={() => handleDirectQtyChange(item.productId, item.variantId, editingQtyValue)}
              aria-label={`Set quantity for ${item.productName}`}
              className="touch-target bg-gold-brand text-black rounded-xl flex items-center justify-center cursor-pointer"><Check className="w-4 h-4" /></button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => handleAdjustQty(item.productId, item.variantId, -1)}
              aria-label={`Decrease quantity of ${item.productName}`}
              className="touch-target bg-zinc-900 hover:bg-zinc-800 text-zinc-400 rounded-xl flex items-center justify-center text-lg font-bold cursor-pointer">-</button>
            <button onClick={() => { setEditingItemId(lineKey); setEditingQtyValue(String(item.qty)); }}
              aria-label={`Edit quantity of ${item.productName}, currently ${qtyText}`}
              title="Tap to type an exact quantity (fractions allowed)"
              className="text-sm font-bold text-white min-w-[44px] min-h-[44px] px-1 text-center tabular-nums rounded-xl hover:bg-zinc-900 cursor-pointer">{qtyText}</button>
            <button onClick={() => handleAdjustQty(item.productId, item.variantId, 1)}
              aria-label={`Increase quantity of ${item.productName}`}
              className="touch-target bg-zinc-900 hover:bg-zinc-800 text-zinc-400 rounded-xl flex items-center justify-center text-lg font-bold cursor-pointer">+</button>
            {isRemoveConfirm ? (
              <>
                <button onClick={() => handleRemoveItem(item.productId, item.variantId)}
                  aria-label={`Confirm remove ${item.productName} from cart`}
                  className="touch-target bg-rose-600 text-white rounded-xl flex items-center justify-center text-xs font-black cursor-pointer px-2">Yes</button>
                <button onClick={() => setRemoveConfirmId(null)}
                  aria-label={`Keep ${item.productName} in cart`}
                  className="touch-target bg-zinc-800 text-zinc-400 rounded-xl flex items-center justify-center text-xs font-bold cursor-pointer px-2">No</button>
              </>
            ) : (
              <button onClick={() => handleRemoveItem(item.productId, item.variantId)}
                aria-label={`Remove ${item.productName} from cart`}
                className="touch-target bg-rose-950/20 hover:bg-rose-950/40 text-rose-400 rounded-xl flex items-center justify-center text-lg font-bold cursor-pointer">x</button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 relative min-w-0 overflow-x-hidden lg:h-[calc(100vh-140px)] lg:overflow-hidden pb-2" id="sales-tab-content">
      
      {/* LEFT COLUMN */}
      <div className="lg:col-span-8 flex flex-col h-full min-h-0 lg:overflow-hidden space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative basis-full min-w-0 sm:basis-auto sm:flex-1">
            <input
              ref={searchRef}
              type="text"
              placeholder={t(lang, 'searchItems')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#141414] border border-white/5 text-gold-light focus:border-gold-brand focus:ring-1 focus:ring-gold-brand h-12 pl-11 pr-4 rounded-xl !text-base transition-all outline-none"
              id="search-inventory-input"
            />
            <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
          </div>
          <button onClick={() => {
            // Staff logins replace free-text seller names with PIN-checked switching.
            if (staffConfigured && onOpenStaffSwitcher) { onOpenStaffSwitcher(); return; }
            setSellerDraft(staffName || ''); setShowSellerEditor(true);
          }}
              className="shrink-0 h-12 w-12 px-0 sm:w-auto sm:px-3 bg-[#141414] border border-white/5 hover:border-gold-brand/40 text-zinc-300 font-black rounded-xl text-xs uppercase tracking-wider transition-all active:scale-95 cursor-pointer touch-target"
              title="Who is selling — each sale is stamped with this name"
              aria-label="Set seller"
              id="seller-chip">
            {staffName ? (
              <span className="flex items-center gap-1.5"><User className="w-4 h-4 text-gold-brand" /><span className="hidden sm:inline">{staffName}</span></span>
            ) : (
              <span className="flex items-center justify-center gap-1.5"><User className="w-4 h-4 text-zinc-500" /><span className="hidden sm:inline text-zinc-500">Seller</span></span>
            )}
          </button>
          <button onClick={() => setIsCustomChargeOpen(true)}
            className="shrink-0 h-12 px-3 sm:px-4 bg-gold-brand/10 hover:bg-gold-brand/20 border border-gold-brand/30 text-gold-brand font-black rounded-xl text-xs uppercase tracking-wider transition-all active:scale-95 cursor-pointer touch-target"
            id="open-custom-charge-btn">
            + Custom
          </button>
          {/* Spent everywhere (#18): log spending without leaving Sell. */}
          <button onClick={() => setShowQuickExpense(true)}
            className="shrink-0 h-12 px-3 sm:px-4 bg-[#141414] border border-white/5 hover:border-rose-500/40 text-zinc-300 font-black rounded-xl text-xs uppercase tracking-wider transition-all active:scale-95 cursor-pointer touch-target flex items-center gap-1.5"
            id="open-quick-expense-btn" title="Log money spent (stock, transport…)">
            <Wallet className="w-4 h-4" /> Spent
          </button>
          <button onClick={() => { setIsQuickSale(true); setQuickSearchQuery(''); }}
            className="shrink-0 h-12 px-3 sm:px-4 bg-gold-brand text-black font-black rounded-xl text-xs uppercase tracking-wider transition-all active:scale-95 cursor-pointer touch-target flex items-center gap-1.5"
            id="open-quick-sale-btn">
            <Zap className="w-4 h-4" /> Quick Sale
          </button>
          <button onClick={() => setStreetMode(v => { const n = !v; try { localStorage.setItem('boss_pos_street_mode', n ? '1' : '0'); } catch {} return n; })}
            title="Street mode: each tap sells one item for cash instantly — for stalls and rush counters"
            className={`shrink-0 h-12 px-3 sm:px-4 font-black rounded-xl text-xs uppercase tracking-wider transition-all active:scale-95 cursor-pointer touch-target flex items-center gap-1.5 border ${streetMode ? 'bg-emerald-400 text-black border-emerald-400' : 'bg-[#141414] border-white/5 text-zinc-300 hover:border-emerald-400/40'}`}
            id="street-mode-btn">
            <Zap className="w-4 h-4" /> Street
          </button>
          <button onClick={() => setShowQuotes(true)}
            className="shrink-0 h-12 px-3 sm:px-4 bg-[#141414] border border-white/5 hover:border-gold-brand/40 text-zinc-300 font-black rounded-xl text-xs uppercase tracking-wider transition-all active:scale-95 cursor-pointer touch-target flex items-center gap-1.5"
            id="open-quotes-btn">
            <FileText className="w-4 h-4" /> Quotes{quotes.length > 0 ? ` (${quotes.length})` : ''}
          </button>
        </div>

        {streetMode && (
          <div className="flex items-center justify-between gap-2 bg-emerald-950/30 border border-emerald-800/40 rounded-xl px-4 h-12">
            <p className="text-xs font-black text-emerald-300 uppercase tracking-wider">
              Street mode · {streetCount} sold · {formatCurrency(streetTotal)}
            </p>
            <button onClick={() => { setStreetCount(0); setStreetTotal(0); }}
              className="text-[11px] font-black text-emerald-400/70 hover:text-emerald-300 uppercase cursor-pointer">
              Reset
            </button>
          </div>
        )}

        {undoSaleId && onUndoSale && (
          <div className="flex items-center justify-between gap-2 bg-emerald-950/30 border border-emerald-800/40 rounded-xl px-4 h-12" role="status">
            <p className="text-xs font-black text-emerald-300 uppercase tracking-wider truncate">Sale done — Undo?</p>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => { const id = undoSaleId; if (undoTimer.current) clearTimeout(undoTimer.current); setUndoSaleId(null); if (id) onUndoSale(id); }}
                className="h-9 px-4 bg-emerald-500 text-black font-black text-[11px] rounded-lg uppercase tracking-wider cursor-pointer active:scale-95">Undo</button>
              <button onClick={() => { if (undoTimer.current) clearTimeout(undoTimer.current); setUndoSaleId(null); }}
                className="h-9 px-3 text-emerald-300/70 hover:text-emerald-200 font-bold text-[11px] uppercase tracking-wider cursor-pointer">Keep</button>
            </div>
          </div>
        )}

        {demoMode && (
          <div className="flex items-center justify-between gap-2 bg-sky-950/30 border border-sky-800/40 rounded-xl px-4 min-h-[3rem] py-2" role="status">
            <p className="text-xs font-black text-sky-300 uppercase tracking-wider leading-snug">
              Demo stock — practice freely, sales are blocked
            </p>
            <button onClick={() => setDemoMode(false)}
              className="h-9 px-4 bg-sky-500 text-black font-black text-[11px] rounded-lg uppercase tracking-wider cursor-pointer active:scale-95 shrink-0">
              Exit demo
            </button>
          </div>
        )}

        {/* Guided first sale (#1): 3 steps for a brand-new cashier. */}
        {showGuide && (
          <div className="boss-card p-4 border border-gold-brand/30" role="status" aria-label="How to make your first sale">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-black text-white uppercase tracking-widest">First sale in 3 taps</p>
              <button onClick={dismissGuide} aria-label="Dismiss first-sale guide"
                className="text-zinc-500 hover:text-white font-black px-1 cursor-pointer">×</button>
            </div>
            <ol className="mt-2 space-y-1 text-xs font-bold text-zinc-300">
              <li>1 · {products.length === 0 ? 'Add stock in the Stock tab — or try demo below' : 'Add an item below'}</li>
              <li>2 · Open the cart</li>
              <li>3 · Complete the sale</li>
            </ol>
            {products.length === 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                <button onClick={() => setDemoMode(true)}
                  className="h-10 px-4 bg-gold-brand text-black font-black uppercase tracking-wider rounded-xl text-[11px] hover:opacity-90 active:scale-95 cursor-pointer">
                  Try with demo stock
                </button>
                <p className="text-[11px] text-zinc-500 font-bold self-center">No items yet? Add real stock in the Stock tab.</p>
              </div>
            )}
          </div>
        )}

        {/* Money strip (#16): today's takings, always one glance away. */}
        {todayLive.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none" aria-label="Today's takings">
            <span className="shrink-0 inline-flex items-center h-9 px-3 rounded-xl bg-emerald-950/40 border border-emerald-800/30 text-[11px] font-black uppercase tracking-wider text-emerald-300 tabular-nums">
              Cash {formatCurrency(stripCash)}
            </span>
            <span className="shrink-0 inline-flex items-center h-9 px-3 rounded-xl bg-yellow-950/40 border border-yellow-800/30 text-[11px] font-black uppercase tracking-wider text-yellow-300 tabular-nums">
              Phone {formatCurrency(stripMomo)}
            </span>
            <span className="shrink-0 inline-flex items-center h-9 px-3 rounded-xl bg-blue-950/40 border border-blue-800/30 text-[11px] font-black uppercase tracking-wider text-blue-300 tabular-nums">
              Credit {formatCurrency(stripCredit)}
            </span>
          </div>
        )}

        {cart.length === 0 && lastSaleItems && lastSaleItems.length > 0 && (
          <button onClick={repeatLastSale}
            className="flex items-center gap-1.5 text-xs font-bold text-zinc-400 hover:text-gold-brand bg-[#141414]/60 border border-white/5 hover:border-gold-brand/40 rounded-xl px-3 h-9 transition-all cursor-pointer touch-target uppercase tracking-wider">
            <RotateCcw className="w-3.5 h-3.5" /> Repeat last sale
          </button>
        )}

        {/* Fast sellers strip — rush-hour one-tap selling */}
        {featsOn('fastSellers') && pinnedProducts.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none" aria-label="Fast sellers">
            {pinnedProducts.map(p => (
              <button key={p.id} onClick={() => handleAddToCart(p)}
                className="flex items-center gap-1.5 pl-2.5 pr-3 py-2.5 rounded-xl bg-gold-brand/10 border border-gold-brand/40 text-gold-light text-xs font-black whitespace-nowrap active:scale-95 transition-all cursor-pointer shrink-0 min-h-[44px]">
                <Star className="w-3.5 h-3.5 fill-gold-brand text-gold-brand" />
                {p.name} • {formatCurrency(p.price)}
              </button>
            ))}
          </div>
        )}

        {/* Categories */}
        <div className="relative -mx-4 min-w-0 max-w-[calc(100%+2rem)] overflow-hidden px-4 sm:mx-0 sm:max-w-none sm:px-0">
          <div className="absolute right-0 top-0 bottom-2 w-8 bg-gradient-to-l from-[#0A0A0A] to-transparent pointer-events-none z-10 sm:hidden"></div>
          <section className="flex gap-2 overflow-x-auto pb-1.5 scrollbar-none">
            <button onClick={() => { setSelectedCategory('All'); setShowTailoringOrders(false); setShowDesignOrders(false); setShowEateryPricing(false); setShowProduction(false); setShowBookings(false); setShowRepairs(false); setShowQuotes(false); }}
              className={`flex items-center gap-1.5 py-3 px-5 rounded-xl transition-all border whitespace-nowrap cursor-pointer active:scale-95 shrink-0 min-h-[48px] ${
                selectedCategory === 'All'
                  ? 'bg-gold-brand border-gold-brand text-black shadow-[0_0_12px_rgba(255,204,0,0.25)] font-black'
                  : 'bg-[#141414]/50 border-white/5 hover:border-white/10 text-zinc-400 font-bold'
              }`}>
              <span className="text-sm uppercase tracking-wider font-black">{t(lang, 'all')}</span>
            </button>
              {categories.map(cat => {
                const isActive = selectedCategory === cat;
                const catInfo = CATEGORY_VISUALS[cat] || DEFAULT_CATEGORY_VISUAL;
                const CatIcon = catInfo.icon;
                return (
                  <button key={cat} onClick={() => { setSelectedCategory(cat); setShowTailoringOrders(false); setShowDesignOrders(false); setShowEateryPricing(false); setShowProduction(false); setShowBookings(false); setShowRepairs(false); setShowQuotes(false); }}
                    className={`flex items-center gap-1.5 py-3 px-5 rounded-xl transition-all border whitespace-nowrap cursor-pointer active:scale-95 shrink-0 min-h-[48px] ${
                      isActive
                        ? 'bg-gold-brand border-gold-brand text-black shadow-[0_0_12px_rgba(255,204,0,0.25)] font-black'
                        : 'bg-[#141414]/50 border-white/5 hover:border-white/10 text-zinc-400 font-bold'
                    }`}>
                    <CatIcon className="w-4 h-4 shrink-0" />
                    <span className="text-sm uppercase tracking-wider">{cat}</span>
                  </button>
                );
              })}
          </section>
        </div>

        {selectedCategory === 'Eatery' && !showEateryPricing && !showProduction && (
          <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={() => setShowEateryPricing(true)}
            className="flex items-center justify-center gap-2 py-3 px-2 rounded-xl border border-gold-brand/40 bg-gold-brand/10 text-gold-light font-black text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer touch-target">
            <ChefHat className="w-4 h-4" />
            Pricing & Recipes
          </button>
          {onAddProduction && onDeleteProduction && (
          <button onClick={() => setShowProduction(true)}
            className="flex items-center justify-center gap-2 py-3 px-2 rounded-xl border border-amber-400/40 bg-amber-950/30 text-amber-300 font-black text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer touch-target">
            <ChefHat className="w-4 h-4" />
            Morning Production
          </button>
          )}
          </div>
        )}

        {(settings?.showTailoring || (featsOn('autoTools') && hasTailoringStock)) && selectedCategory === 'Tailoring' && !showTailoringOrders && (
          <button onClick={() => setShowTailoringOrders(true)}
            className="mt-3 w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-amber-400/40 bg-amber-950/30 text-amber-300 font-black text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer touch-target">
            <Scissors className="w-4 h-4" />
            Manage Tailor Orders
          </button>
        )}

        {(settings?.showDesign || (featsOn('autoTools') && hasDesignStock)) && selectedCategory === 'Graphics' && !showDesignOrders && (
          <button onClick={() => setShowDesignOrders(true)}
            className="mt-3 w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-cyan-400/40 bg-cyan-950/30 text-cyan-300 font-black text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer touch-target">
            <Palette className="w-4 h-4" />
            Manage Design & Print Orders
          </button>
        )}

        {settings?.showBookings && !showBookings && (
          <button onClick={() => setShowBookings(true)}
            className="mt-3 w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-emerald-400/40 bg-emerald-950/30 text-emerald-300 font-black text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer touch-target">
            <CalendarCheck className="w-4 h-4" />
            Appointment Book
          </button>
        )}

        {settings?.showRepairs && !showRepairs && (
          <button onClick={() => setShowRepairs(true)}
            className="mt-3 w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-orange-400/40 bg-orange-950/30 text-orange-300 font-black text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer touch-target">
            <Wrench className="w-4 h-4" />
            Repair Job Intake
          </button>
        )}

        {/* Tailor orders view */}
        {showTailoringOrders ? (
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3 pb-2 scrollbar-thin" id="tailoring-scroll-container">
            <button onClick={() => setShowTailoringOrders(false)}
              className="h-10 px-4 bg-[#141414] border border-white/10 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer touch-target">
              <ArrowRightLeft className="w-4 h-4" /> {t(lang, 'backToProducts')}
            </button>
            <Suspense fallback={subManagerFallback}>
              <TailoringOrders triggerToast={triggerToast} />
            </Suspense>
          </div>
        ) : showDesignOrders ? (
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3 pb-2 scrollbar-thin" id="design-scroll-container">
            <button onClick={() => setShowDesignOrders(false)}
              className="h-10 px-4 bg-[#141414] border border-white/10 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer touch-target">
              <ArrowRightLeft className="w-4 h-4" /> {t(lang, 'backToProducts')}
            </button>
            <Suspense fallback={subManagerFallback}>
              <DesignOrders triggerToast={triggerToast} />
            </Suspense>
          </div>
        ) : showEateryPricing ? (
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3 pb-2 scrollbar-thin" id="eatery-pricing-scroll-container">
            <button onClick={() => setShowEateryPricing(false)}
              className="h-10 px-4 bg-[#141414] border border-white/10 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer touch-target">
              <ArrowRightLeft className="w-4 h-4" /> {t(lang, 'backToProducts')}
            </button>
            <Suspense fallback={subManagerFallback}>
              <EateryPricing products={products} onUpdateProduct={onUpdateProduct}
                formatCurrency={formatCurrency} triggerToast={triggerToast} />
            </Suspense>
          </div>
        ) : showProduction && onAddProduction && onDeleteProduction ? (
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3 pb-2 scrollbar-thin" id="morning-production-scroll-container">
            <button onClick={() => setShowProduction(false)}
              className="h-10 px-4 bg-[#141414] border border-white/10 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer touch-target">
              <ArrowRightLeft className="w-4 h-4" /> {t(lang, 'backToProducts')}
            </button>
            <Suspense fallback={subManagerFallback}>
              <MorningProduction products={products} productionRegisters={productionRegisters}
                sales={salesHistory} wastageLogs={wastageLogs}
                onAddProduction={onAddProduction} onDeleteProduction={onDeleteProduction}
                formatCurrency={formatCurrency} triggerToast={triggerToast} />
            </Suspense>
          </div>
        ) : showBookings ? (
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3 pb-2 scrollbar-thin" id="bookings-scroll-container">
            <button onClick={() => setShowBookings(false)}
              className="h-10 px-4 bg-[#141414] border border-white/10 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer touch-target">
              <ArrowRightLeft className="w-4 h-4" /> {t(lang, 'backToProducts')}
            </button>
            <Suspense fallback={subManagerFallback}>
              <Bookings triggerToast={triggerToast} />
            </Suspense>
          </div>
        ) : showRepairs ? (
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3 pb-2 scrollbar-thin" id="repairs-scroll-container">
            <button onClick={() => setShowRepairs(false)}
              className="h-10 px-4 bg-[#141414] border border-white/10 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer touch-target">
              <ArrowRightLeft className="w-4 h-4" /> {t(lang, 'backToProducts')}
            </button>
            <Suspense fallback={subManagerFallback}>
              <RepairJobs triggerToast={triggerToast} />
            </Suspense>
          </div>
        ) : showQuotes ? (
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3 pb-2 scrollbar-thin" id="quotes-scroll-container">
            <button onClick={() => setShowQuotes(false)}
              className="h-10 px-4 bg-[#141414] border border-white/10 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer touch-target">
              <ArrowRightLeft className="w-4 h-4" /> {t(lang, 'backToProducts')}
            </button>
            <Suspense fallback={subManagerFallback}>
              <Quotes quotes={quotes} shopName={settings?.shopName || 'My Shop'}
                formatCurrency={formatCurrency} triggerToast={triggerToast}
                onConvert={convertQuote}
                onDelete={(id) => setQuotes(prev => prev.filter(x => x.id !== id))} />
            </Suspense>
          </div>
        ) : (
        /* Products */
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4 pb-2 scrollbar-thin" id="catalog-scroll-container">
          <section className="space-y-2">
            <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-widest font-display">
              {selectedCategory === 'All' ? 'All Products' : selectedCategory}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {filteredProducts.slice(0, visibleCount).map(product => (
                <ProductCard
                  key={product.id}
                  product={product}
                  cart={cart}
                  formatCurrency={formatCurrency}
                  onAddToCart={handleAddToCart}
                  onAdjustQty={(productId, delta) => handleAdjustQty(productId, undefined, delta)}
                  pinned={pinnedIds.includes(product.id)}
                  onTogglePin={!simple && featsOn('fastSellers') ? togglePin : undefined}
                  simple={simple}
                />
              ))}
              {filteredProducts.length === 0 && (
                <div className="col-span-full py-16 text-center boss-card rounded-xl px-4">
                  <Tag className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
                  <p className="text-sm text-zinc-400 font-bold uppercase tracking-wider">No products found</p>
                  {searchQuery.trim() ? (
                    <button onClick={() => setIsCustomChargeOpen(true)}
                      className="mt-4 h-11 px-5 bg-gold-brand text-black font-black uppercase tracking-wider rounded-xl text-xs hover:opacity-90 active:scale-95 transition-all cursor-pointer">
                      Sell “{searchQuery.trim().slice(0, 24)}” as a custom item
                    </button>
                  ) : (
                    // Empty states that teach (#4): one action button, not just
                    // "no data". In demo mode the catalog is never empty.
                    <div className="mt-2 space-y-2">
                      <p className="text-xs text-zinc-500 font-bold uppercase">Add products in Stock to start selling</p>
                      {onGoToStock && (
                        <button onClick={onGoToStock}
                          className="h-11 px-5 bg-gold-brand text-black font-black uppercase tracking-wider rounded-xl text-xs hover:opacity-90 active:scale-95 transition-all cursor-pointer">
                          + Add your first product
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            {filteredProducts.length > visibleCount && (
              <div className="flex justify-center pt-4">
                <button onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
                  className="px-6 h-11 bg-[#141414] border border-white/10 text-zinc-400 hover:text-gold-brand hover:border-gold-brand/40 rounded-xl text-xs font-bold uppercase tracking-wider transition-all active:scale-95 cursor-pointer touch-target">
                  Load {Math.min(PAGE_SIZE, filteredProducts.length - visibleCount)} more ({filteredProducts.length - visibleCount} remaining)
                </button>
              </div>
            )}
            {visibleCount > PAGE_SIZE && (
              <div className="flex justify-center pt-2">
                <button onClick={() => setVisibleCount(PAGE_SIZE)}
                  className="text-[10px] text-zinc-600 hover:text-zinc-400 font-bold uppercase tracking-wider transition-all cursor-pointer">
                  Show less
                </button>
              </div>
            )}
          </section>
        </div>
        )}
      </div>

      {/* RIGHT COLUMN: CART (Desktop) */}
      <div className="lg:col-span-4 hidden lg:block h-full min-h-0 overflow-hidden">
        <div className="boss-card p-4 flex flex-col h-full min-h-0" id="desktop-cart">
          <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4 shrink-0">
            <div className="flex items-center gap-2 text-gold-brand">
              <ShoppingCart className="w-5 h-5" />
              <h3 className="text-xs font-bold uppercase tracking-widest font-display text-white">
                Sale ({cart.reduce((sum, item) => sum + item.qty, 0)} items)
              </h3>
            </div>
            {cart.length > 0 && (
              <div className="flex items-center gap-1">
              <button onClick={parkCurrent}
                className="text-xs text-zinc-500 hover:text-gold-brand uppercase font-bold flex items-center gap-1.5 transition-colors touch-target cursor-pointer">
                Park
              </button>
              <button onClick={() => setShowClearConfirm(true)}
                className="text-xs text-zinc-500 hover:text-rose-400 uppercase font-bold flex items-center gap-1.5 transition-colors touch-target cursor-pointer">
                <Trash2 className="w-4 h-4" /> Clear
              </button>
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3 scrollbar">
            {renderParkedRows()}
            {cart.map(renderCartItem)}
            {cart.length === 0 && (
              <div className="h-full flex flex-col justify-center items-center text-center py-6 px-2 space-y-4">
                <div className="w-14 h-14 rounded-full bg-zinc-900 border border-white/5 flex items-center justify-center text-zinc-500">
                  <ShoppingCart className="w-5 h-5 text-zinc-400" />
                </div>
                <div>
                  <p className="text-sm text-zinc-400 font-black uppercase tracking-wider">Cart is Empty</p>
                  <p className="text-xs text-zinc-500 mt-1">Tap a product or use Quick Sale</p>
                </div>
              </div>
            )}
          </div>

          {cart.length > 0 && (
            // Capped + internally scrollable: on short PC screens the payment
            // block can never shove the total + Complete Sale button out of
            // the clipped column.
            <div className="mt-4 pt-4 border-t border-white/5 space-y-2 shrink-0 min-h-0 max-h-[42%] overflow-y-auto">
              <p className="text-xs text-zinc-500 font-semibold tracking-[0.08em]">{t(lang, 'payment').toUpperCase()}</p>
              <div className="grid grid-cols-4 gap-1.5">
                {/* Mistake 10 fix: one icon style, one neutral color — active state
                    carries meaning via border/gold, not 4 competing hues. */}
                {[
                  { name: 'Cash', label: 'Cash', icon: <Coins className="w-4 h-4" /> },
                  { name: 'MTN MoMo', label: 'MTN', icon: <Smartphone className="w-4 h-4" /> },
                  { name: 'Airtel Money', label: 'Airtel', icon: <Smartphone className="w-4 h-4" /> },
                  { name: 'Credit / Book', label: t(lang, 'credit'), icon: <UserCheck className="w-4 h-4" /> },
                ].map(opt => (
                  <button key={opt.name} onClick={() => { setPaymentMethod(opt.name as any); setCustomCashReceived(''); }}
                    className={`flex flex-col items-center justify-center py-3 px-0.5 rounded-xl border text-xs font-semibold tracking-wide transition-all cursor-pointer min-h-[56px] touch-target ${
                      paymentMethod === opt.name ? 'border-gold-brand bg-gold-brand/15 text-gold-brand' : 'border-white/5 bg-[#0A0A0A] text-zinc-500 hover:border-white/10 hover:text-zinc-300'
                    }`}>
                    <div className="mb-1 shrink-0">{opt.icon}</div>
                    <span className="truncate w-full text-center">{opt.label}</span>
                  </button>
                ))}
              </div>

              {paymentMethod === 'Credit / Book' && (
                <div className="bg-[#0A0A0A] border border-white/5 p-3 rounded-2xl space-y-2 mt-2">
                  <label className="text-xs text-zinc-400 font-bold uppercase flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5" /> {t(lang, 'customerName')}
                  </label>
                  <input type="text" placeholder={t(lang, 'customerNameEx')} value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full bg-[#141414] border border-white/5 text-gold-brand font-bold rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-brand h-11" />
                </div>
              )}

              {/* Discount field */}
              <div className="bg-[#0A0A0A] border border-white/5 p-3 rounded-2xl space-y-2 mt-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-zinc-400 font-bold uppercase flex items-center gap-1.5">
                    <Percent className="w-3.5 h-3.5" /> {t(lang, 'discount')}
                  </label>
                  <div className="flex bg-[#141414] rounded-lg border border-white/5 overflow-hidden">
                    <button onClick={() => setDiscountType('fixed')}
                      className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer touch-target ${discountType === 'fixed' ? 'bg-gold-brand text-black' : 'text-zinc-500 hover:text-zinc-300'}`}>UGX</button>
                    <button onClick={() => setDiscountType('percent')}
                      className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer touch-target ${discountType === 'percent' ? 'bg-gold-brand text-black' : 'text-zinc-500 hover:text-zinc-300'}`}>%</button>
                  </div>
                </div>
                <input type="number" min="0" placeholder={discountType === 'percent' ? '0%' : '0'} value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  className="w-full bg-[#141414] border border-white/5 text-gold-brand font-bold rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-brand h-11" />
                {discountType === 'percent' && discount && (
                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">{formatCurrency(discountNum)} {t(lang, 'off')}</p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => { const d = Math.max(0, Math.ceil(total / 100) * 100 - total); setDiscountType('fixed'); setDiscount(d > 0 ? String(d) : ''); }}
                    className="px-3 h-8 text-[10px] font-black rounded-lg border transition-all cursor-pointer active:scale-95 bg-[#141414] text-zinc-300 border-white/10 hover:border-gold-brand">
                    {t(lang, 'roundTo100')}
                  </button>
                  {[500, 1000].map(n => (
                    <button key={n} onClick={() => { setDiscountType('fixed'); const cur = discountType === 'fixed' ? (parseFloat(discount) || 0) : 0; setDiscount(String(cur + n)); }}
                      className="px-3 h-8 text-[10px] font-black rounded-lg border transition-all cursor-pointer active:scale-95 bg-[#141414] text-zinc-300 border-white/10 hover:border-gold-brand">
                      −{n.toLocaleString()}
                    </button>
                  ))}
                  <button onClick={() => { setDiscountType('percent'); setDiscount('5'); }}
                    className={`px-3 h-8 text-[10px] font-black rounded-lg border transition-all cursor-pointer active:scale-95 ${discountType === 'percent' && discount === '5' ? 'bg-gold-brand text-black border-gold-brand' : 'bg-[#141414] text-zinc-400 border-white/5'}`}>5%</button>
                  <button onClick={() => { setDiscountType('percent'); setDiscount('10'); }}
                    className={`px-3 h-8 text-[10px] font-black rounded-lg border transition-all cursor-pointer active:scale-95 ${discountType === 'percent' && discount === '10' ? 'bg-gold-brand text-black border-gold-brand' : 'bg-[#141414] text-zinc-400 border-white/5'}`}>10%</button>
                  <button onClick={() => { setDiscountType('fixed'); setDiscount(''); }}
                    className="px-3 h-8 text-[10px] font-black rounded-lg border transition-all cursor-pointer active:scale-95 bg-[#141414] text-zinc-400 border-white/5 hover:text-rose-400">
                    {t(lang, 'clear')}
                  </button>
                </div>
              </div>

              {paymentMethod === 'Cash' && (
                <div className="bg-[#0A0A0A] border border-white/5 p-3 rounded-2xl space-y-2 mt-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-zinc-400 font-bold uppercase">{t(lang, 'cashReceived')}</span>
                    <input type="number" placeholder={t(lang, 'amount')} value={customCashReceived}
                      onChange={(e) => setCustomCashReceived(e.target.value)}
                      className="w-28 bg-[#141414] border border-white/5 text-gold-brand font-black text-right rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-brand h-11" />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(() => {
                      if (total <= 0) return null;
                      const s = new Set<number>();
                      s.add(total);
                      [5000, 10000, 20000, 50000, 100000].forEach(n => { if (n > total) s.add(n); });
                      s.add(Math.ceil(total / 5000) * 5000);
                      return Array.from(s).filter(a => a >= total).sort((a, b) => a - b).slice(0, 4).map(amt => (
                        <button key={amt} onClick={() => setCustomCashReceived(String(amt))}
                          className={`px-3 py-1.5 text-xs font-black rounded-lg border transition-all min-h-[36px] cursor-pointer active:scale-95 ${
                            parseFloat(customCashReceived) === amt ? 'bg-gold-brand text-black border-gold-brand' : 'bg-[#141414] text-zinc-400 border-white/5'
                          }`}>
                           {amt === total ? t(lang, 'exact') : amt.toLocaleString()}
                        </button>
                      ));
                    })()}
                  </div>
                  {customCashReceived && (
                    <div className="pt-1.5 border-t border-white/5 flex justify-between items-center">
                      {parseFloat(customCashReceived) >= total ? (
                        <><span className="text-xs text-emerald-400 font-bold uppercase">{t(lang, 'change')}</span><span className="text-sm font-black text-emerald-400">{formatCurrency(parseFloat(customCashReceived) - total)}</span></>
                      ) : (
                        <><span className="text-xs text-amber-500 font-bold uppercase">{t(lang, 'stillNeed')}</span><span className="text-sm font-black text-amber-500">{formatCurrency(total - parseFloat(customCashReceived))}</span></>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Sticky total (#11): total + Complete never scroll out of reach. */}
          <div className="mt-4 pt-4 border-t border-white/5 space-y-3 shrink-0 sticky bottom-0 bg-[#141414] pb-1">
            {discountNum > 0 && (
              <div className="flex justify-between text-zinc-500 text-sm font-medium">
                <span>{t(lang, 'subtotal')}</span>
                <span className="line-through">{formatCurrency(subtotal)}</span>
              </div>
            )}
            <div className="flex justify-between items-center py-1">
              <span className="text-[13px] font-semibold text-zinc-300 tracking-wide">{t(lang, 'total')}</span>
              <span className="text-2xl font-bold text-gold-brand font-display tabular-nums">{formatCurrency(total)}</span>
            </div>
            {/* Mistake 15 fix: CTA is refined (not shouting ALL-CAPS black) and
                carries the total price — user knows what they pay before tapping. */}
            <button onClick={() => setShowConfirmSale(true)} disabled={isDisabled}
              className={`w-full h-14 rounded-2xl text-[15px] font-bold tracking-wide transition-all active:scale-[0.98] cursor-pointer ${
                !isDisabled
                  ? 'bg-gold-brand text-black hover:bg-gold-medium shadow-[0_4px_15px_rgba(255,204,0,0.25)]'
                  : 'bg-zinc-800 text-zinc-600 cursor-not-allowed opacity-50'
              }`}>
              {cart.length === 0 ? t(lang, 'completeSale') : `${t(lang, 'completeSale')} • ${formatCurrency(total)}`}
            </button>
            {isDisabled && disabledReason && (
              <p className="text-[11px] text-rose-400/90 font-medium text-center -mt-2">{disabledReason}</p>
            )}
            {cart.length > 0 && (
              <button onClick={saveQuote}
                className="w-full h-11 rounded-2xl text-xs font-black uppercase tracking-wider border border-white/10 text-zinc-400 hover:border-gold-brand/50 hover:text-gold-brand transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1.5">
                <FileText className="w-4 h-4" /> Save as quote
              </button>
            )}
          </div>
        </div>
      </div>

      {/* MOBILE CART SHEET */}
      <div className="lg:hidden">
        {cart.length > 0 && !isMobileCartOpen && !isQuickSale && (
          <button onClick={() => setIsMobileCartOpen(true)} id="mobile-cart-fab"
            key={cart.reduce((sum, item) => sum + item.qty, 0)}
            aria-label={`Open cart, ${cart.reduce((sum, item) => sum + item.qty, 0)} items, total ${formatCurrency(total)}`}
            className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-[55] bg-gold-brand text-black font-black flex items-center justify-center gap-2 px-5 py-4 rounded-2xl shadow-2xl border-2 border-black/20 active:scale-95 transition-all min-h-[52px] cursor-pointer animate-fab-pop">
            <ShoppingCart className="w-5 h-5" />
            <span className="text-sm uppercase font-display font-black">Cart ({cart.reduce((sum, item) => sum + item.qty, 0)}) • {formatCurrency(total)}</span>
          </button>
        )}
        {isMobileCartOpen && <div onClick={() => setIsMobileCartOpen(false)} className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60]"></div>}
        <div className={`fixed bottom-0 left-0 right-0 bg-[#141414] border-t border-white/10 rounded-t-3xl p-5 z-[70] max-h-[85vh] overflow-y-auto flex flex-col ${
          isMobileCartOpen ? '' : 'hidden'
        }`}>
          <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4">
            <h3 className="text-sm font-bold text-zinc-100 tracking-wide font-display flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-gold-brand" /> {t(lang, 'checkout')}
            </h3>
            <div className="flex items-center gap-3">
              {cart.length > 0 && (
                <button onClick={parkCurrent} className="text-xs text-zinc-400 font-semibold hover:text-gold-brand cursor-pointer touch-target">Park</button>
              )}
              <button onClick={() => setIsMobileCartOpen(false)} className="text-xs text-zinc-400 font-semibold hover:text-white cursor-pointer touch-target">{t(lang, 'closeBtn')}</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 min-h-[150px] max-h-[40vh]">
            {renderParkedRows()}
            {cart.map(item => renderCompactCartRow(item, false))}
          </div>
          <div className="mt-4 pt-3 border-t border-white/5 space-y-1.5">
            <p className="text-xs text-zinc-500 font-semibold tracking-[0.08em]">{t(lang, 'payment').toUpperCase()}</p>
            <div className="grid grid-cols-4 gap-1.5">
              {['Cash', 'MTN MoMo', 'Airtel Money', 'Credit / Book'].map(name => (
                <button key={name} onClick={() => { setPaymentMethod(name as any); setCustomCashReceived(''); }}
                  className={`py-3 rounded-xl text-xs border font-semibold tracking-wide transition-all min-h-[48px] cursor-pointer active:scale-95 ${
                    paymentMethod === name ? 'border-gold-brand bg-gold-brand/10 text-gold-brand' : 'border-white/5 bg-[#0A0A0A] text-zinc-500'
                  }`}>
                  {name === 'Credit / Book' ? t(lang, 'credit') : name === 'MTN MoMo' ? 'MTN' : name === 'Airtel Money' ? 'Airtel' : name}
                </button>
              ))}
            </div>
            {paymentMethod === 'Credit / Book' && (
              <input type="text" placeholder={t(lang, 'customerName')} value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full bg-[#0A0A0A] border border-white/5 text-gold-light rounded-xl h-11 px-3 text-sm outline-none focus:border-gold-brand" />
            )}
            {paymentMethod === 'Cash' && (
              <div className="bg-[#0A0A0A] border border-white/5 p-4 rounded-2xl space-y-3 mt-2">
                <input type="number" placeholder={t(lang, 'cashReceived')} value={customCashReceived}
                  onChange={(e) => setCustomCashReceived(e.target.value)}
                  className="w-full bg-[#141414] border border-white/5 text-gold-brand font-bold text-right rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-brand h-11 tabular-nums" />
                {featsOn('quickCash') && (
                <div className="flex flex-wrap gap-2">
                  {(() => {
                    if (total <= 0) return null;
                    const s = new Set<number>();
                    s.add(total);
                    [5000, 10000, 20000, 50000, 100000].forEach(n => { if (n > total) s.add(n); });
                    s.add(Math.ceil(total / 5000) * 5000);
                    return Array.from(s).filter(a => a >= total).sort((a, b) => a - b).slice(0, 4).map(amt => (
                      // Big tender buttons: thumbs hit these mid-rush, so they
                      // fill the row instead of huddling as small chips.
                      <button key={amt} onClick={() => setCustomCashReceived(String(amt))}
                        aria-label={amt === total ? 'Exact amount' : `Customer gave ${amt.toLocaleString()}`}
                        className={`flex-1 min-w-[72px] px-4 min-h-[52px] text-sm font-black rounded-xl border transition-all cursor-pointer active:scale-95 tabular-nums ${
                          parseFloat(customCashReceived) === amt ? 'bg-gold-brand text-black border-gold-brand' : 'bg-[#141414] text-zinc-400 border-white/5'
                        }`}>
                        {amt === total ? t(lang, 'exact') : amt.toLocaleString()}
                      </button>
                    ));
                  })()}
                </div>
                )}
                {customCashReceived && (
                  <div className="flex justify-between items-center">
                      {parseFloat(customCashReceived) >= total ? (
                        <><span className="text-xs text-emerald-400 font-semibold">{t(lang, 'change')}</span><span className="text-base font-bold text-emerald-400 tabular-nums">{formatCurrency(parseFloat(customCashReceived) - total)}</span></>
                      ) : (
                        <><span className="text-xs text-amber-400 font-semibold">{t(lang, 'stillNeed')}</span><span className="text-base font-bold text-amber-400 tabular-nums">{formatCurrency(total - parseFloat(customCashReceived))}</span></>
                      )}
                  </div>
                )}
              </div>
            )}
          </div>
          {/* Improvement 2: sticky bottom action — total + CTA stay visible while
              the sheet scrolls, so the cashier can act the moment they decide. */}
          <div className="mt-4 pt-4 border-t border-white/5 space-y-3 sticky bottom-0 bg-[#141414] pb-[max(0.25rem,env(safe-area-inset-bottom))]">
            <div className="flex justify-between items-center">
              <span className="text-[13px] font-semibold text-zinc-300">{t(lang, 'total')}</span>
              <span className="text-2xl font-bold text-gold-brand font-display tabular-nums">{formatCurrency(total)}</span>
            </div>
            <button onClick={() => setShowConfirmSale(true)} disabled={isDisabled}
              className={`w-full h-14 rounded-2xl text-[15px] font-bold tracking-wide transition-all active:scale-[0.98] cursor-pointer ${
                !isDisabled
                  ? 'bg-gold-brand text-black shadow-[0_4px_20px_rgba(255,204,0,0.3)]'
                  : 'bg-zinc-800 text-zinc-600 cursor-not-allowed opacity-50'
              }`}>
              {cart.length === 0 ? t(lang, 'completeSale') : `${t(lang, 'completeSale')} • ${formatCurrency(total)}`}
            </button>
            {isDisabled && disabledReason && (
              <p className="text-[11px] text-rose-400/90 font-medium text-center">{disabledReason}</p>
            )}
            {cart.length > 0 && (
              <button onClick={saveQuote}
                className="w-full h-11 rounded-2xl text-xs font-black uppercase tracking-wider border border-white/10 text-zinc-400 hover:border-gold-brand/50 hover:text-gold-brand transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1.5">
                <FileText className="w-4 h-4" /> Save as quote
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showSellerEditor && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[90] flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#141414] border border-white/10 rounded-2xl p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white">Set seller</h3>
              <button onClick={() => setShowSellerEditor(false)} aria-label="Close seller editor" className="touch-target text-zinc-400 hover:text-white text-xl">×</button>
            </div>
            <label htmlFor="seller-name-input" className="block text-xs text-zinc-400 font-semibold mb-2">Name stamped on sales</label>
            <input
              id="seller-name-input"
              autoFocus
              value={sellerDraft}
              onChange={(e) => setSellerDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { setStaffName(sellerDraft.trim()); setShowSellerEditor(false); } }}
              className="w-full h-12 bg-[#0A0A0A] border border-white/10 rounded-xl px-3 text-base text-white outline-none focus:border-gold-brand"
              placeholder="e.g. Amina"
            />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowSellerEditor(false)} className="flex-1 h-11 rounded-xl border border-white/10 text-zinc-300 text-sm font-semibold">Cancel</button>
              <button onClick={() => { setStaffName(sellerDraft.trim()); setShowSellerEditor(false); }} className="flex-1 h-11 rounded-xl bg-gold-brand text-black text-sm font-bold">Save seller</button>
            </div>
          </div>
        </div>
      )}
      <CustomChargeModal
        isOpen={isCustomChargeOpen}
        onClose={() => setIsCustomChargeOpen(false)}
        onAdd={handleAddToCart}
        onSave={onSaveCustomProduct}
        defaultCategory={selectedCategory !== 'All' ? selectedCategory : undefined}
        categories={categories}
        triggerToast={triggerToast}
      />

      <BarcodeScanner isOpen={isScannerOpen} onScan={handleBarcodeScanned} onClose={() => setIsScannerOpen(false)} />
      <KeyboardShortcuts isOpen={showKeyboardHelp} onClose={() => setShowKeyboardHelp(false)} />

      {/* Quick Sale Modal */}
      {isQuickSale && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-sm z-50 flex flex-col">
          <div className="flex items-center gap-3 p-4 border-b border-white/5">
            <div className="relative flex-1">
              <input type="text" placeholder={t(lang, 'searchAll')} value={quickSearchQuery} autoFocus
                onChange={(e) => setQuickSearchQuery(e.target.value)}
                className="w-full bg-zinc-900 border border-gold-brand/40 text-white h-12 pl-11 pr-4 rounded-xl !text-base outline-none focus:border-gold-brand" />
              <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-gold-brand" />
            </div>
            <button onClick={() => { setIsQuickSale(false); setQuickSearchQuery(''); }}
              className="h-12 px-4 bg-gold-brand text-black font-black text-xs rounded-xl uppercase tracking-wider cursor-pointer">Close</button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="space-y-1">
              {(() => {
                let matched: Product[] = catalog;
                if (quickSearchQuery.trim()) {
                  const qn = normQuery(quickSearchQuery);
                  const fuse = new Fuse(catalog, {
                    keys: ['name', 'category', 'barcode', 'imei'],
                    threshold: 0.5,
                    ignoreLocation: true,
                    distance: 80,
                  });
                  const r = fuse.search(normQuery(quickSearchQuery));
                  matched = r.length ? r.map(x => x.item) : catalog.filter(p => wordMatch(p, qn));
                }
                return matched.slice(0, 20).map(product => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    compact
                    cart={cart}
                    formatCurrency={formatCurrency}
                    onAddToCart={handleAddToCart}
                  />
                ));
              })()}
              {(() => {
                const qn = normQuery(quickSearchQuery);
                const count = quickSearchQuery ? (() => {
                  const fuse = new Fuse(catalog, { keys: ['name','category','barcode'], threshold: 0.5, ignoreLocation: true });
                  const r = fuse.search(normQuery(quickSearchQuery));
                  return r.length ? r.length : catalog.filter(p => wordMatch(p, qn)).length;
                })() : 0;
                return count === 0 && quickSearchQuery ? (
                <div className="p-6 text-center">
                  <p className="text-xs text-zinc-500 font-bold uppercase">No products match "{quickSearchQuery}"</p>
                  <button onClick={() => { setIsQuickSale(false); setQuickSearchQuery(''); setIsCustomChargeOpen(true); }}
                    className="mt-3 h-11 px-5 bg-gold-brand text-black font-black uppercase tracking-wider rounded-xl text-xs hover:opacity-90 active:scale-95 transition-all cursor-pointer">
                    Sell it as a custom item
                  </button>
                </div>
                ) : null;
              })()}
            </div>
          </div>
          {cart.length > 0 && (
            <div className="border-t border-white/5 p-4 space-y-3 bg-[#0A0A0A]">
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {cart.map(item => renderCompactCartRow(item, true))}
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {['Cash', 'MTN MoMo', 'Airtel Money', 'Credit / Book'].map(name => (
                  <button key={name} onClick={() => { setPaymentMethod(name as any); setCustomCashReceived(''); }}
                    className={`py-2.5 rounded-xl text-xs border font-semibold tracking-wide transition-all cursor-pointer active:scale-95 min-h-[44px] ${
                      paymentMethod === name ? 'border-gold-brand bg-gold-brand/10 text-gold-brand' : 'border-white/5 text-zinc-500'
                    }`}>
                    {name === 'Credit / Book' ? 'Credit' : name === 'MTN MoMo' ? 'MTN' : name === 'Airtel Money' ? 'Airtel' : name}
                  </button>
                ))}
              </div>
              {paymentMethod === 'Credit / Book' && (
                <input type="text" placeholder={t(lang, 'customerNameEx')} value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  aria-label={t(lang, 'customerName')}
                  className="w-full bg-[#141414] border border-white/5 text-gold-light rounded-xl h-11 px-3 text-sm outline-none focus:border-gold-brand" />
              )}
              {paymentMethod === 'Cash' && (
                <div className="bg-[#141414] border border-white/5 p-3 rounded-2xl space-y-2">
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-xs text-zinc-400 font-bold uppercase">{t(lang, 'cashReceived')}</span>
                    <input type="number" min="0" placeholder={t(lang, 'amount')} value={customCashReceived}
                      onChange={(e) => setCustomCashReceived(e.target.value)}
                      aria-label={t(lang, 'cashReceived')}
                      className="w-28 bg-[#0A0A0A] border border-white/5 text-gold-brand font-black text-right rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-brand h-11 tabular-nums" />
                  </div>
                  {featsOn('quickCash') && (
                    <div className="flex flex-wrap gap-1.5">
                      {(() => {
                        if (total <= 0) return null;
                        const s = new Set<number>();
                        s.add(total);
                        [5000, 10000, 20000, 50000, 100000].forEach(n => { if (n > total) s.add(n); });
                        s.add(Math.ceil(total / 5000) * 5000);
                        return Array.from(s).filter(a => a >= total).sort((a, b) => a - b).slice(0, 4).map(amt => (
                          <button key={amt} onClick={() => setCustomCashReceived(String(amt))}
                            className={`px-3 py-1.5 text-xs font-black rounded-lg border transition-all min-h-[36px] cursor-pointer active:scale-95 ${
                              parseFloat(customCashReceived) === amt ? 'bg-gold-brand text-black border-gold-brand' : 'bg-[#0A0A0A] text-zinc-400 border-white/5'
                            }`}>
                            {amt === total ? t(lang, 'exact') : amt.toLocaleString()}
                          </button>
                        ));
                      })()}
                    </div>
                  )}
                  {customCashReceived && (
                    <div className="pt-1.5 border-t border-white/5 flex justify-between items-center">
                      {parseFloat(customCashReceived) >= total ? (
                        <><span className="text-xs text-emerald-400 font-bold uppercase">{t(lang, 'change')}</span><span className="text-sm font-black text-emerald-400 tabular-nums">{formatCurrency(parseFloat(customCashReceived) - total)}</span></>
                      ) : (
                        <><span className="text-xs text-amber-500 font-bold uppercase">{t(lang, 'stillNeed')}</span><span className="text-sm font-black text-amber-500 tabular-nums">{formatCurrency(total - parseFloat(customCashReceived))}</span></>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-[13px] font-semibold text-zinc-300">Total</span>
                <span className="text-xl font-bold text-gold-brand tabular-nums">{formatCurrency(total)}</span>
              </div>
              <button onClick={() => setShowConfirmSale(true)} disabled={isDisabled}
                title={isDisabled && disabledReason ? disabledReason : undefined}
                className="w-full h-12 bg-gold-brand text-black font-bold tracking-wide text-[15px] rounded-xl cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                {`${t(lang, 'completeSale')} • ${formatCurrency(total)}`}
              </button>
              {isDisabled && disabledReason && (
                <p className="text-[11px] text-rose-400/90 font-medium text-center">{disabledReason}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Other Modals */}
      <ServiceQtyModal
        product={serviceQtyProduct}
        formatCurrency={formatCurrency}
        onAdd={handleServiceQtyAdd}
        onClose={() => setServiceQtyProduct(null)}
      />

      <ConfirmSaleModal
        isOpen={showConfirmSale}
        onClose={() => setShowConfirmSale(false)}
        onConfirm={handleCompleteSale}
        isCompleting={isCompleting}
        cart={cart}
        total={total}
        discountNum={discountNum}
        paymentMethod={paymentMethod}
        formatCurrency={formatCurrency}
        lang={lang}
      />

      <CashTransferModal
        isOpen={showTransfers}
        onClose={() => setShowTransfers(false)}
        formatCurrency={formatCurrency}
        triggerToast={triggerToast}
        categories={categories}
      />

      <QuickExpenseModal
        isOpen={showQuickExpense}
        onClose={() => setShowQuickExpense(false)}
        onAddExpense={onAddExpense || (() => {})}
        products={products}
        expenseCategories={expenseCategories}
        formatCurrency={formatCurrency}
        triggerToast={triggerToast}
        onUpdateProduct={onUpdateProduct}
      />

      <ProfitAnalyzerModal
        isOpen={showFoodCost}
        onClose={() => setShowFoodCost(false)}
        products={products}
        cart={cart}
        formatCurrency={formatCurrency}
      />

      {/* Variant picker */}
      {variantProduct && variantProduct.variants && (
        <div className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-sm flex items-end justify-center" onClick={() => setVariantProduct(null)}>
          <div className="bg-[#141414] w-full max-w-md rounded-t-3xl border border-white/10 p-5 animate-slide-up max-h-[70vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-amber-950/30 border border-amber-800/40 flex items-center justify-center text-amber-400">
                  <ChefHat className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white uppercase tracking-tight font-display">{variantProduct.name}</h3>
                  <p className="text-[10px] text-zinc-500 font-bold uppercase">{variantProduct.category} • choose a size/unit</p>
                </div>
              </div>
              <button onClick={() => setVariantProduct(null)}
                className="p-1.5 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors cursor-pointer touch-target">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2">
              {variantProduct.variants.map(variant => (
                <button key={variant.id} onClick={() => handleVariantAdd(variant)}
                  className="w-full flex items-center justify-between p-4 rounded-2xl bg-zinc-900 border border-zinc-800 hover:border-gold-brand/40 active:scale-[0.98] transition-all cursor-pointer touch-target min-h-[56px]">
                  <span className="text-sm font-bold text-white uppercase tracking-wide">{variant.label}</span>
                  <span className="text-base font-black text-gold-brand font-display">{formatCurrency(variant.price)}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setVariantProduct(null)}
              className="mt-4 w-full h-11 border border-zinc-800 hover:bg-zinc-900 text-zinc-400 font-bold uppercase tracking-wider text-xs rounded-xl cursor-pointer touch-target">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* More tools FAB */}
      {fabOpen && <div className="fixed inset-0 z-30" onClick={() => setFabOpen(false)} />}
      <div className="fixed bottom-24 left-4 z-40">
        <div className="relative">
          <button onClick={() => setFabOpen(prev => !prev)}
            className={`h-12 w-12 rounded-xl border transition-all cursor-pointer flex items-center justify-center active:scale-90 ${
              fabOpen ? 'bg-gold-brand text-black border-gold-brand' : 'bg-[#141414] text-zinc-400 border-white/10 hover:border-gold-brand'
            }`}
            title="More tools">
            <span className={`text-lg font-black transition-transform ${fabOpen ? 'rotate-45' : ''}`}>+</span>
          </button>

          {fabOpen && (
            <div className="absolute bottom-full left-0 mb-2 flex flex-col gap-1.5 min-w-[130px]">
              {[
                { icon: Barcode, label: 'Scan', color: 'hover:border-gold-brand hover:text-gold-brand', onClick: () => { setIsScannerOpen(true); setFabOpen(false); } },
                { icon: Wallet, label: 'Expense', color: 'hover:border-emerald-500 hover:text-emerald-400', onClick: () => { setShowQuickExpense(true); setFabOpen(false); } },
                { icon: ChefHat, label: 'Profit', color: 'hover:border-amber-500 hover:text-amber-400', onClick: () => { setShowFoodCost(true); setFabOpen(false); } },
                { icon: ArrowRightLeft, label: 'Transfer', color: 'hover:border-sky-500 hover:text-sky-400', onClick: () => { setShowTransfers(true); setFabOpen(false); } },
              ].map(btn => {
                const BtnIcon = btn.icon;
                return (
                  <button key={btn.label} onClick={btn.onClick}
                    className={`touch-target px-3 py-2 bg-[#141414] border border-white/10 rounded-xl flex items-center gap-2 text-xs font-bold uppercase tracking-wider transition-all active:scale-95 shadow-lg cursor-pointer ${btn.color}`}>
                    <BtnIcon className="w-4 h-4 shrink-0" />
                    <span>{btn.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Clear Cart Confirmation */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-sm p-6 shadow-2xl">
            <h3 className="text-sm font-black text-white uppercase tracking-wider text-center mb-2">Clear cart?</h3>
            <p className="text-xs text-zinc-400 text-center mb-4">Remove all {cart.reduce((s, i) => s + i.qty, 0)} items? You can add them back, but this can't be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => setShowClearConfirm(false)}
                className="flex-1 h-11 border border-zinc-800 text-zinc-400 font-bold text-xs rounded-xl uppercase tracking-wider cursor-pointer">Cancel</button>
              <button onClick={() => { setCart([]); setShowClearConfirm(false); }}
                className="flex-1 h-11 bg-rose-600 text-white font-black text-xs rounded-xl uppercase tracking-widest cursor-pointer">Clear</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
