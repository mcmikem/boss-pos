import { useState, useMemo, useEffect, useRef, lazy, Suspense, type Dispatch, type SetStateAction } from 'react';
import { 
  Search, Plus, Minus, Trash2, ShoppingCart, Check, Tag,
  Coins, Smartphone, UserCheck, Percent, User,
  Barcode, Wallet, ChefHat, ArrowRightLeft, Scissors, X, Palette
} from 'lucide-react';
import { Product, Sale, SaleItem, Expense, StoreSettings } from '../types';
import { nextOrderNumber } from '../api';
import ProductCard from './ProductCard';
import BarcodeScanner from './BarcodeScanner';
import KeyboardShortcuts from './KeyboardShortcuts';
import CustomChargeModal from './CustomChargeModal';
import ServiceQtyModal from './ServiceQtyModal';
import ConfirmSaleModal from './ConfirmSaleModal';
import CashTransferModal from './CashTransferModal';
import QuickExpenseModal from './QuickExpenseModal';
import ProfitAnalyzerModal from './ProfitAnalyzerModal';
import { unitLabel } from '../utils/units';
import { CATEGORY_VISUALS, DEFAULT_CATEGORY_VISUAL } from '../data/categoryVisuals';
// Heavy sub-managers are lazy-loaded so the initial sell screen (and the main
// bundle) stays small — important on the slow connections this app targets.
const TailoringOrders = lazy(() => import('./TailoringOrders'));
const DesignOrders = lazy(() => import('./DesignOrders'));
const EateryPricing = lazy(() => import('./EateryPricing'));
const subManagerFallback = (
  <div className="flex items-center justify-center py-16">
    <div className="w-8 h-8 border-2 border-gold-brand border-t-transparent rounded-full animate-spin" />
  </div>
);

interface SalesProps {
  products: Product[];
  onAddSale: (sale: Sale) => void;
  onUpdateProduct: (p: Product) => void;
  formatCurrency: (val: number) => string;
  cart: SaleItem[];
  setCart: Dispatch<SetStateAction<SaleItem[]>>;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  settings?: StoreSettings;
  onAddExpense?: (expense: Expense) => void;
  expenseCategories?: string[];
  isQuickSale: boolean;
  setIsQuickSale: Dispatch<SetStateAction<boolean>>;
  categories: string[];
}

const localOrderNumber = () => {
  const key = 'boss_pos_order_counter';
  const current = parseInt(localStorage.getItem(key) || '8492', 10);
  const next = current + 1;
  localStorage.setItem(key, String(next));
  return `Order #${next}`;
};

export default function Sales({
  products, onAddSale, onUpdateProduct, formatCurrency, cart, setCart, triggerToast, settings, onAddExpense, expenseCategories = ['Stock Purchase', 'Utilities', 'Labor', 'Rent', 'Transport', 'Supplies'], isQuickSale, setIsQuickSale, categories,
}: SalesProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [showTailoringOrders, setShowTailoringOrders] = useState<boolean>(false);
  const [showDesignOrders, setShowDesignOrders] = useState<boolean>(false);
  const [showEateryPricing, setShowEateryPricing] = useState<boolean>(false);
  const [variantProduct, setVariantProduct] = useState<Product | null>(null);
  const [serviceQtyProduct, setServiceQtyProduct] = useState<Product | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
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
  const [visibleCount, setVisibleCount] = useState(30);
  const PAGE_SIZE = 30;

  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    setVisibleCount(30);
  }, [selectedCategory, searchQuery]);

  const filteredProducts = useMemo(() => {
    return products
      .filter(p => {
        const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
        const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                              p.category.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesCategory && matchesSearch;
      });
  }, [products, selectedCategory, searchQuery]);

  const handleAddToCart = (product: Product) => {
    if (product.stockQty <= 0 && !product.isService) {
      triggerToast(`${product.name} is out of stock!`, 'error');
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

  const handleCompleteSaleRef = useRef<(() => void | Promise<void>) | null>(null);

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
    const product = products.find(p => p.barcode === barcode || p.imei === barcode || p.id === `prod-${barcode}`);
    if (product) {
      handleAddToCart(product);
      triggerToast(`Added: ${product.name}`, 'success');
      setIsScannerOpen(false);
    } else {
      triggerToast(`Product not found (${barcode})`, 'error');
    }
  };

  const handleAdjustQty = (productId: string, variantId: string | undefined, delta: number) => {
    const product = products.find(p => p.id === productId);
    const key = `${productId}::${variantId || ''}`;
    setCart(prev => prev.map(item => {
      if (`${item.productId}::${item.variantId || ''}` === key) {
        const nextQty = item.qty + delta;
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

  const handleDirectQtyChange = (productId: string, variantId: string | undefined, val: number) => {
    const product = products.find(p => p.id === productId);
    const key = `${productId}::${variantId || ''}`;
    if (val <= 0) { handleRemoveItem(productId, variantId); setEditingItemId(null); return; }
    if (product && val > product.stockQty && !product.isService) {
      triggerToast(`Only ${product.stockQty} remaining in stock!`, 'error');
      val = product.stockQty;
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
    if (item && item.qty > 1 && !removeConfirmId) {
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
  const isDisabled = cart.length === 0 || (paymentMethod === 'Cash' && customCashReceived !== '' && parseFloat(customCashReceived) < total);
  const disabledReason = cart.length === 0
    ? 'Cart is empty'
    : (paymentMethod === 'Cash' && customCashReceived !== '' && parseFloat(customCashReceived) < total)
    ? `Need ${formatCurrency(total - parseFloat(customCashReceived))} more`
    : '';
  const tax = 0;

  const handleCompleteSale = async () => {
    if (isCompleting) return;
    if (cart.length === 0) { triggerToast('Cart is empty!', 'error'); return; }

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
        return;
      }
      triggerToast(`Stock shortage — selling available only: ${oversold.join(', ')}`, 'error');
    }

    setIsCompleting(true);
    const cashPaidNum = parseFloat(customCashReceived);
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
    };
    onAddSale(newSale);
    setCart([]);
    setCustomCashReceived('');
    setDiscount('');
    setCustomerName('');
    setIsMobileCartOpen(false);
    setIsCompleting(false);
    triggerToast(`${orderNumber} done!${changeMsg}`, 'success');
  };
  handleCompleteSaleRef.current = handleCompleteSale;

  const renderCartItem = (item: SaleItem) => {
    const lineKey = `${item.productId}::${item.variantId || ''}`;
    const isEditing = editingItemId === lineKey;
    const isRemoveConfirm = removeConfirmId === lineKey;
    return (
      <div key={lineKey} className="bg-[#0A0A0A] border border-white/5 p-4 rounded-2xl flex flex-col justify-between gap-3">
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0">
            <span className="text-sm font-bold text-white uppercase tracking-wide truncate max-w-[180px] block" title={item.productName}>{item.productName}</span>
            {item.variantLabel && <span className="text-[10px] text-zinc-500 uppercase font-bold block">{item.variantLabel}</span>}
          </div>
          <p className="text-sm font-black text-gold-brand font-display shrink-0">{formatCurrency(item.lineTotal)}</p>
        </div>
        <div className="flex justify-between items-center">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <input type="number" autoFocus value={editingQtyValue}
                onChange={(e) => setEditingQtyValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleDirectQtyChange(item.productId, item.variantId, parseInt(editingQtyValue, 10) || 0);
                  if (e.key === 'Escape') setEditingItemId(null);
                }}
                className="w-16 bg-zinc-900 border border-gold-brand text-gold-light rounded text-center text-sm h-11 p-1 focus:outline-none" />
              <button onClick={() => handleDirectQtyChange(item.productId, item.variantId, parseInt(editingQtyValue, 10) || 0)}
                className="p-2 bg-gold-brand text-black rounded text-sm hover:opacity-90 cursor-pointer touch-target"><Check className="w-4 h-4" /></button>
            </div>
          ) : (
            <button onClick={() => { setEditingItemId(lineKey); setEditingQtyValue(String(item.qty)); }}
              className="text-xs font-bold text-zinc-400 bg-zinc-900 hover:text-gold-brand hover:bg-zinc-800 px-3 py-1.5 rounded-lg cursor-pointer transition-all touch-target">
              {item.saleUnit ? <>{unitLabel(item.qty, item.saleUnit)}</> : <>Qty: <span className="text-gold-light underline font-black">{item.qty}</span></>}
            </button>
          )}
          <div className="flex items-center gap-1.5">
            <button onClick={() => handleAdjustQty(item.productId, item.variantId, -1)}
              className="touch-target bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg flex items-center justify-center transition-all cursor-pointer"><Minus className="w-4 h-4" /></button>
            <button onClick={() => handleAdjustQty(item.productId, item.variantId, 1)}
              className="touch-target bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg flex items-center justify-center transition-all cursor-pointer"><Plus className="w-4 h-4" /></button>
            {isRemoveConfirm ? (
              <div className="flex items-center gap-1">
                <button onClick={() => handleRemoveItem(item.productId, item.variantId)}
                  className="touch-target bg-rose-600 text-white rounded-lg flex items-center justify-center text-xs font-black cursor-pointer">Yes</button>
                <button onClick={() => setRemoveConfirmId(null)}
                  className="touch-target bg-zinc-800 text-zinc-400 rounded-lg flex items-center justify-center text-xs font-bold cursor-pointer">No</button>
              </div>
            ) : (
              <button onClick={() => handleRemoveItem(item.productId, item.variantId)}
                className="touch-target bg-rose-950/20 hover:bg-rose-950 hover:text-rose-400 text-rose-500 rounded-lg flex items-center justify-center transition-all cursor-pointer"><Trash2 className="w-4 h-4" /></button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 relative lg:h-[calc(100vh-140px)] lg:overflow-hidden pb-2" id="sales-tab-content">
      
      {/* LEFT COLUMN */}
      <div className="lg:col-span-8 flex flex-col h-full lg:overflow-hidden space-y-3">
        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <input
              ref={searchRef}
              type="text"
              placeholder="Search items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#141414] border border-white/5 text-gold-light focus:border-gold-brand focus:ring-1 focus:ring-gold-brand h-12 pl-11 pr-4 rounded-xl !text-base transition-all outline-none"
              id="search-inventory-input"
            />
            <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
          </div>
          <button onClick={() => setIsCustomChargeOpen(true)}
            className="shrink-0 h-12 px-4 bg-gold-brand/10 hover:bg-gold-brand/20 border border-gold-brand/30 text-gold-brand font-black rounded-xl text-xs uppercase tracking-wider transition-all active:scale-95 cursor-pointer touch-target"
            id="open-custom-charge-btn">
            + Custom
          </button>
        </div>

        {/* Categories */}
        <div className="relative -mx-4 px-4 sm:mx-0 sm:px-0">
          <div className="absolute right-0 top-0 bottom-2 w-8 bg-gradient-to-l from-[#0A0A0A] to-transparent pointer-events-none z-10 sm:hidden"></div>
          <section className="flex gap-2 overflow-x-auto pb-1.5 scrollbar-none">
            <button onClick={() => { setSelectedCategory('All'); setShowTailoringOrders(false); setShowDesignOrders(false); setShowEateryPricing(false); }}
              className={`flex items-center gap-1.5 py-3 px-5 rounded-xl transition-all border whitespace-nowrap cursor-pointer active:scale-95 shrink-0 min-h-[48px] ${
                selectedCategory === 'All'
                  ? 'bg-gold-brand border-gold-brand text-black shadow-[0_0_12px_rgba(255,204,0,0.25)] font-black'
                  : 'bg-[#141414]/50 border-white/5 hover:border-white/10 text-zinc-400 font-bold'
              }`}>
              <span className="text-sm uppercase tracking-wider font-black">All</span>
            </button>
              {categories.map(cat => {
                const isActive = selectedCategory === cat;
                const catInfo = CATEGORY_VISUALS[cat] || DEFAULT_CATEGORY_VISUAL;
                const CatIcon = catInfo.icon;
                return (
                  <button key={cat} onClick={() => { setSelectedCategory(cat); setShowTailoringOrders(false); setShowDesignOrders(false); setShowEateryPricing(false); }}
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

        {selectedCategory === 'Eatery' && !showEateryPricing && (
          <button onClick={() => setShowEateryPricing(true)}
            className="mt-3 w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-gold-brand/40 bg-gold-brand/10 text-gold-light font-black text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer touch-target">
            <ChefHat className="w-4 h-4" />
            Eatery Pricing & Recipes
          </button>
        )}

        {selectedCategory === 'Tailoring' && !showTailoringOrders && (
          <button onClick={() => setShowTailoringOrders(true)}
            className="mt-3 w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-amber-400/40 bg-amber-950/30 text-amber-300 font-black text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer touch-target">
            <Scissors className="w-4 h-4" />
            Manage Tailor Orders
          </button>
        )}

        {selectedCategory === 'Graphics' && !showDesignOrders && (
          <button onClick={() => setShowDesignOrders(true)}
            className="mt-3 w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-cyan-400/40 bg-cyan-950/30 text-cyan-300 font-black text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer touch-target">
            <Palette className="w-4 h-4" />
            Manage Design & Print Orders
          </button>
        )}

        {/* Tailor orders view */}
        {showTailoringOrders ? (
          <div className="flex-1 overflow-y-auto pr-1 space-y-3 pb-2 scrollbar-thin" id="tailoring-scroll-container">
            <button onClick={() => setShowTailoringOrders(false)}
              className="h-10 px-4 bg-[#141414] border border-white/10 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer touch-target">
              <ArrowRightLeft className="w-4 h-4" /> Back to products
            </button>
            <Suspense fallback={subManagerFallback}>
              <TailoringOrders triggerToast={triggerToast} />
            </Suspense>
          </div>
        ) : showDesignOrders ? (
          <div className="flex-1 overflow-y-auto pr-1 space-y-3 pb-2 scrollbar-thin" id="design-scroll-container">
            <button onClick={() => setShowDesignOrders(false)}
              className="h-10 px-4 bg-[#141414] border border-white/10 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer touch-target">
              <ArrowRightLeft className="w-4 h-4" /> Back to products
            </button>
            <Suspense fallback={subManagerFallback}>
              <DesignOrders triggerToast={triggerToast} />
            </Suspense>
          </div>
        ) : showEateryPricing ? (
          <div className="flex-1 overflow-y-auto pr-1 space-y-3 pb-2 scrollbar-thin" id="eatery-pricing-scroll-container">
            <button onClick={() => setShowEateryPricing(false)}
              className="h-10 px-4 bg-[#141414] border border-white/10 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer touch-target">
              <ArrowRightLeft className="w-4 h-4" /> Back to products
            </button>
            <Suspense fallback={subManagerFallback}>
              <EateryPricing products={products} onUpdateProduct={onUpdateProduct}
                formatCurrency={formatCurrency} triggerToast={triggerToast} />
            </Suspense>
          </div>
        ) : (
        /* Products */
        <div className="flex-1 overflow-y-auto pr-1 space-y-4 pb-2 scrollbar-thin" id="catalog-scroll-container">
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
                />
              ))}
              {filteredProducts.length === 0 && (
                <div className="col-span-full py-16 text-center boss-card rounded-xl">
                  <Tag className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
                  <p className="text-sm text-zinc-400 font-bold uppercase tracking-wider">No products found</p>
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
      <div className="lg:col-span-4 hidden lg:block h-full overflow-hidden">
        <div className="boss-card p-4 flex flex-col h-full" id="desktop-cart">
          <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4">
            <div className="flex items-center gap-2 text-gold-brand">
              <ShoppingCart className="w-5 h-5" />
              <h3 className="text-xs font-bold uppercase tracking-widest font-display text-white">
                Sale ({cart.reduce((sum, item) => sum + item.qty, 0)} items)
              </h3>
            </div>
            {cart.length > 0 && (
              <button onClick={() => setShowClearConfirm(true)}
                className="text-xs text-zinc-500 hover:text-rose-400 uppercase font-bold flex items-center gap-1.5 transition-colors touch-target cursor-pointer">
                <Trash2 className="w-4 h-4" /> Clear
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto pr-1 space-y-3 scrollbar">
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
            <div className="mt-4 pt-4 border-t border-zinc-800 space-y-2">
              <p className="text-sm text-zinc-400 font-bold uppercase tracking-wider">Payment:</p>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { name: 'Cash', label: 'Cash', icon: <Coins className="w-4 h-4 text-emerald-400" /> },
                  { name: 'MTN MoMo', label: 'MTN', icon: <Smartphone className="w-4 h-4 text-yellow-400" /> },
                  { name: 'Airtel Money', label: 'Airtel', icon: <Smartphone className="w-4 h-4 text-red-500" /> },
                  { name: 'Credit / Book', label: 'Credit', icon: <UserCheck className="w-4 h-4 text-blue-400" /> },
                ].map(opt => (
                  <button key={opt.name} onClick={() => { setPaymentMethod(opt.name as any); setCustomCashReceived(''); }}
                    className={`flex flex-col items-center justify-center py-3 px-0.5 rounded-xl border text-sm font-bold uppercase transition-all cursor-pointer min-h-[56px] touch-target ${
                      paymentMethod === opt.name ? 'border-gold-brand bg-gold-brand/15 text-white font-black' : 'border-white/5 bg-[#0A0A0A] text-zinc-500 hover:border-white/10 hover:text-zinc-400'
                    }`}>
                    <div className="mb-1 shrink-0">{opt.icon}</div>
                    <span className="truncate w-full text-center text-xs">{opt.label}</span>
                  </button>
                ))}
              </div>

              {paymentMethod === 'Credit / Book' && (
                <div className="bg-[#0A0A0A] border border-white/5 p-3 rounded-2xl space-y-2 mt-2">
                  <label className="text-xs text-zinc-400 font-bold uppercase flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5" /> Customer Name
                  </label>
                  <input type="text" placeholder="e.g. John Mukasa" value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full bg-[#141414] border border-white/5 text-gold-brand font-bold rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-brand h-11" />
                </div>
              )}

              {/* Discount field */}
              <div className="bg-[#0A0A0A] border border-white/5 p-3 rounded-2xl space-y-2 mt-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-zinc-400 font-bold uppercase flex items-center gap-1.5">
                    <Percent className="w-3.5 h-3.5" /> Discount
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
                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">{formatCurrency(discountNum)} off</p>
                )}
              </div>

              {paymentMethod === 'Cash' && (
                <div className="bg-[#0A0A0A] border border-white/5 p-3 rounded-2xl space-y-2 mt-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-zinc-400 font-bold uppercase">Cash Received:</span>
                    <input type="number" placeholder="Amount" value={customCashReceived}
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
                          {amt === total ? 'Exact' : amt.toLocaleString()}
                        </button>
                      ));
                    })()}
                  </div>
                  {customCashReceived && (
                    <div className="pt-1.5 border-t border-white/5 flex justify-between items-center">
                      {parseFloat(customCashReceived) >= total ? (
                        <><span className="text-xs text-emerald-400 font-bold uppercase">Change:</span><span className="text-sm font-black text-emerald-400">{formatCurrency(parseFloat(customCashReceived) - total)}</span></>
                      ) : (
                        <><span className="text-xs text-amber-500 font-bold uppercase">Still Need:</span><span className="text-sm font-black text-amber-500">{formatCurrency(total - parseFloat(customCashReceived))}</span></>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="mt-4 pt-4 border-t border-white/5 space-y-3">
            {discountNum > 0 && (
              <div className="flex justify-between text-zinc-500 text-sm font-bold">
                <span>Subtotal</span>
                <span className="line-through">{formatCurrency(subtotal)}</span>
              </div>
            )}
            <div className="flex justify-between items-center py-2">
              <span className="text-sm font-black text-white uppercase tracking-wider">Total</span>
              <span className="text-2xl font-black text-gold-brand font-display">{formatCurrency(total)}</span>
            </div>
            <button onClick={() => setShowConfirmSale(true)} disabled={isDisabled}
              className={`w-full h-14 rounded-2xl text-sm font-black uppercase tracking-widest transition-all active:scale-95 cursor-pointer ${
                !isDisabled
                  ? 'bg-gold-brand text-black hover:bg-gold-medium shadow-[0_4px_15px_rgba(255,204,0,0.25)]'
                  : 'bg-zinc-800 text-zinc-600 cursor-not-allowed opacity-50'
              }`}>
              Complete Sale
            </button>
            {isDisabled && disabledReason && (
              <p className="text-[10px] text-rose-400 font-bold text-center uppercase tracking-wider -mt-2">{disabledReason}</p>
            )}
          </div>
        </div>
      </div>

      {/* MOBILE CART SHEET */}
      <div className="lg:hidden">
        {cart.length > 0 && !isMobileCartOpen && !isQuickSale && (
          <button onClick={() => setIsMobileCartOpen(true)}
            className="fixed bottom-20 right-4 z-40 bg-gold-brand text-black font-black flex items-center justify-center gap-2 px-5 py-4 rounded-2xl shadow-2xl border-2 border-black/20 active:scale-95 transition-all min-h-[52px] cursor-pointer">
            <ShoppingCart className="w-5 h-5" />
            <span className="text-sm uppercase font-display font-black">Cart ({cart.reduce((sum, item) => sum + item.qty, 0)}) • {formatCurrency(total)}</span>
          </button>
        )}
        {isMobileCartOpen && <div onClick={() => setIsMobileCartOpen(false)} className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40"></div>}
        <div className={`fixed bottom-0 left-0 right-0 bg-zinc-950 border-t border-zinc-800 rounded-t-3xl p-5 z-50 max-h-[85vh] overflow-y-auto flex flex-col ${
          isMobileCartOpen ? '' : 'hidden'
        }`}>
          <div className="flex justify-between items-center pb-4 border-b border-zinc-800 mb-4">
            <h3 className="text-sm font-black text-white uppercase tracking-wider font-display flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-gold-brand" /> Checkout
            </h3>
            <button onClick={() => setIsMobileCartOpen(false)} className="text-xs text-zinc-400 font-bold uppercase hover:text-white cursor-pointer touch-target">Close</button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 min-h-[150px] max-h-[40vh]">
            {cart.map(item => (
              <div key={`${item.productId}::${item.variantId || ''}`} className="bg-zinc-900 border border-zinc-800 p-3 rounded-xl flex items-center justify-between gap-2 min-h-[64px]">
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-bold text-white uppercase truncate max-w-[160px]" title={item.productName}>{item.productName}</h4>
                  {item.variantLabel && <p className="text-[10px] text-zinc-500 uppercase font-bold">{item.variantLabel}</p>}
                  <p className="text-xs text-gold-brand font-black mt-0.5">{formatCurrency(item.lineTotal)}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => handleAdjustQty(item.productId, item.variantId, -1)}
                    className="touch-target bg-zinc-950 hover:bg-zinc-800 text-zinc-400 rounded-xl flex items-center justify-center text-lg font-bold cursor-pointer">-</button>
                  <span className="text-sm font-black text-white min-w-[24px] text-center">{item.saleUnit ? unitLabel(item.qty, item.saleUnit) : item.qty}</span>
                  <button onClick={() => handleAdjustQty(item.productId, item.variantId, 1)}
                    className="touch-target bg-zinc-950 hover:bg-zinc-800 text-zinc-400 rounded-xl flex items-center justify-center text-lg font-bold cursor-pointer">+</button>
                  <button onClick={() => handleRemoveItem(item.productId, item.variantId)}
                    className="touch-target bg-rose-950/20 hover:bg-rose-950/40 text-rose-400 rounded-xl flex items-center justify-center text-lg font-bold cursor-pointer">x</button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-zinc-800 space-y-1.5">
            <p className="text-xs text-zinc-400 font-bold uppercase">Payment:</p>
            <div className="grid grid-cols-4 gap-1.5">
              {['Cash', 'MTN MoMo', 'Airtel Money', 'Credit / Book'].map(name => (
                <button key={name} onClick={() => { setPaymentMethod(name as any); setCustomCashReceived(''); }}
                  className={`py-3 rounded-xl text-xs border font-black uppercase transition-all min-h-[48px] cursor-pointer active:scale-95 ${
                    paymentMethod === name ? 'border-gold-brand bg-gold-brand/10 text-white' : 'border-zinc-900 text-zinc-500'
                  }`}>
                  {name === 'Credit / Book' ? 'Credit' : name === 'MTN MoMo' ? 'MTN' : name === 'Airtel Money' ? 'Airtel' : name}
                </button>
              ))}
            </div>
            {paymentMethod === 'Credit / Book' && (
              <input type="text" placeholder="Customer name" value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full bg-[#0A0A0A] border border-zinc-800 text-gold-light rounded-xl h-11 px-3 text-xs outline-none" />
            )}
            {paymentMethod === 'Cash' && (
              <div className="bg-[#141414] border border-white/5 p-4 rounded-2xl space-y-3 mt-2">
                <input type="number" placeholder="Cash Received" value={customCashReceived}
                  onChange={(e) => setCustomCashReceived(e.target.value)}
                  className="w-full bg-[#0A0A0A] border border-white/5 text-gold-brand font-black text-right rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-brand h-11" />
                {customCashReceived && (
                  <div className="flex justify-between items-center">
                    {parseFloat(customCashReceived) >= total ? (
                      <><span className="text-xs text-emerald-400 font-bold uppercase">Change:</span><span className="text-base font-black text-emerald-400">{formatCurrency(parseFloat(customCashReceived) - total)}</span></>
                    ) : (
                      <><span className="text-xs text-amber-500 font-bold uppercase">Pending:</span><span className="text-base font-black text-amber-500">{formatCurrency(total - parseFloat(customCashReceived))}</span></>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="mt-4 pt-4 border-t-2 border-dashed border-zinc-800 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold text-zinc-400 uppercase">Total</span>
              <span className="text-2xl font-black text-gold-brand font-display">{formatCurrency(total)}</span>
            </div>
            <button onClick={() => setShowConfirmSale(true)} disabled={isDisabled}
              className={`w-full h-14 rounded-2xl text-sm font-black uppercase tracking-widest transition-all active:scale-95 cursor-pointer ${
                !isDisabled
                  ? 'bg-gold-brand text-black shadow-[0_4px_20px_rgba(255,204,0,0.3)]'
                  : 'bg-zinc-800 text-zinc-600 cursor-not-allowed opacity-50'
              }`}>
              Complete Sale
            </button>
            {isDisabled && disabledReason && (
              <p className="text-[10px] text-rose-400 font-bold text-center uppercase tracking-wider">{disabledReason}</p>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      <CustomChargeModal
        isOpen={isCustomChargeOpen}
        onClose={() => setIsCustomChargeOpen(false)}
        onAdd={handleAddToCart}
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
              <input type="text" placeholder="Search products by name, category, or barcode..." value={quickSearchQuery} autoFocus
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
                const searchLower = quickSearchQuery.toLowerCase();
                const matched = quickSearchQuery
                  ? products.filter(p =>
                      p.name.toLowerCase().includes(searchLower) ||
                      p.category.toLowerCase().includes(searchLower) ||
                      (p.barcode && p.barcode.toLowerCase().includes(searchLower))
                    )
                  : products;
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
              {quickSearchQuery && products.filter(p => {
                const q = quickSearchQuery.toLowerCase();
                return p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || (p.barcode && p.barcode.toLowerCase().includes(q));
              }).length === 0 && (
                <div className="p-6 text-center">
                  <p className="text-xs text-zinc-500 font-bold uppercase">No products match "{quickSearchQuery}"</p>
                </div>
              )}
            </div>
          </div>
          {cart.length > 0 && (
            <div className="border-t border-white/5 p-4 space-y-3 bg-zinc-950">
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {cart.map(item => (
                  <div key={`${item.productId}::${item.variantId || ''}`} className="flex items-center justify-between bg-zinc-900 border border-zinc-800 p-3 rounded-xl">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-white uppercase truncate">{item.productName}</p>
                      {item.variantLabel && <p className="text-[10px] text-zinc-500 uppercase font-bold">{item.variantLabel}</p>}
                      <p className="text-xs font-black text-gold-brand">{formatCurrency(item.lineTotal)}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <button onClick={() => handleAdjustQty(item.productId, item.variantId, -1)}
                        className="touch-target bg-zinc-800 text-zinc-400 rounded-lg flex items-center justify-center font-bold cursor-pointer">-</button>
                      <span className="text-sm font-black text-white min-w-[20px] text-center">{item.qty}</span>
                      <button onClick={() => handleAdjustQty(item.productId, item.variantId, 1)}
                        className="touch-target bg-zinc-800 text-zinc-400 rounded-lg flex items-center justify-center font-bold cursor-pointer">+</button>
                      <button onClick={() => handleRemoveItem(item.productId, item.variantId)}
                        className="touch-target bg-rose-950/20 text-rose-400 rounded-lg flex items-center justify-center font-bold cursor-pointer">x</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {['Cash', 'MTN MoMo', 'Airtel Money', 'Credit / Book'].map(name => (
                  <button key={name} onClick={() => setPaymentMethod(name as any)}
                    className={`py-2.5 rounded-xl text-xs border font-black uppercase transition-all cursor-pointer active:scale-95 ${
                      paymentMethod === name ? 'border-gold-brand bg-gold-brand/10 text-white' : 'border-zinc-800 text-zinc-500'
                    }`}>
                    {name === 'Credit / Book' ? 'Credit' : name === 'MTN MoMo' ? 'MTN' : name === 'Airtel Money' ? 'Airtel' : name}
                  </button>
                ))}
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-bold text-zinc-400 uppercase">Total</span>
                <span className="text-xl font-black text-gold-brand">{formatCurrency(total)}</span>
              </div>
              <button onClick={() => setShowConfirmSale(true)} disabled={cart.length === 0}
                className="w-full h-12 bg-gold-brand text-black font-black uppercase tracking-widest text-sm rounded-xl cursor-pointer">
                Complete Sale
              </button>
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
            <h3 className="text-sm font-black text-white uppercase tracking-wider text-center mb-2">Clear Cart?</h3>
            <p className="text-xs text-zinc-400 text-center mb-4">This will remove all {cart.reduce((s, i) => s + i.qty, 0)} items from the cart.</p>
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
