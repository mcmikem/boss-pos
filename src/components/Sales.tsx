import { useState, useMemo, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { 
  Search, Plus, Minus, Trash2, ShoppingCart, Check, Tag,
  Coins, Smartphone, UserCheck, X, Zap, Percent, User,
  Barcode, Wallet, ChefHat, ArrowRightLeft, BookOpen
} from 'lucide-react';
import { Product, Sale, SaleItem, Expense, StoreSettings, CashTransfer } from '../types';
import ProductCard from './ProductCard';
import BarcodeScanner from './BarcodeScanner';
import KeyboardShortcuts from './KeyboardShortcuts';
import CustomChargeModal from './CustomChargeModal';
import ConfirmSaleModal from './ConfirmSaleModal';
import CashTransferModal from './CashTransferModal';
import QuickExpenseModal from './QuickExpenseModal';
import ProfitAnalyzerModal from './ProfitAnalyzerModal';
import LibraryModal from './LibraryModal';

interface SalesProps {
  products: Product[];
  onAddSale: (sale: Sale) => void;
  formatCurrency: (val: number) => string;
  cart: SaleItem[];
  setCart: Dispatch<SetStateAction<SaleItem[]>>;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  settings?: StoreSettings;
  onAddExpense?: (expense: Expense) => void;
  expenseCategories?: string[];
}

const getNextOrderNumber = () => {
  const key = 'boss_pos_order_counter';
  const current = parseInt(localStorage.getItem(key) || '8492', 10);
  const next = current + 1;
  localStorage.setItem(key, String(next));
  return `Order #${next}`;
};

const CATEGORY_VISUALS: Record<string, { gradient: string; emoji: string; glow: string }> = {
  'Electronics': { gradient: 'from-violet-900/80 via-indigo-800/50 to-slate-900/90', emoji: '📱', glow: 'rgba(139,92,246,0.15)' },
  'Eatery': { gradient: 'from-amber-800/80 via-orange-700/50 to-stone-900/90', emoji: '🍕', glow: 'rgba(245,158,11,0.15)' },
  'Stationery': { gradient: 'from-emerald-800/80 via-teal-700/50 to-slate-900/90', emoji: '📝', glow: 'rgba(16,185,129,0.15)' },
  'Printing': { gradient: 'from-purple-800/80 via-fuchsia-700/50 to-slate-900/90', emoji: '🖨️', glow: 'rgba(168,85,247,0.15)' },
  'Tailoring': { gradient: 'from-pink-800/80 via-rose-700/50 to-stone-900/90', emoji: '✂️', glow: 'rgba(244,63,94,0.15)' },
  'Library': { gradient: 'from-stone-800/80 via-zinc-700/50 to-slate-900/90', emoji: '📚', glow: 'rgba(120,113,108,0.15)' },
  'Sports': { gradient: 'from-orange-800/80 via-amber-700/50 to-stone-900/90', emoji: '⚽', glow: 'rgba(251,146,60,0.15)' },
  'Graphics': { gradient: 'from-cyan-800/80 via-sky-700/50 to-slate-900/90', emoji: '🎨', glow: 'rgba(6,182,212,0.15)' },
};

export default function Sales({
  products, onAddSale, formatCurrency, cart, setCart, triggerToast, settings, onAddExpense, expenseCategories = ['Stock Purchase', 'Utilities', 'Labor', 'Rent', 'Transport', 'Supplies'],
}: SalesProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
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
  const [isQuickSale, setIsQuickSale] = useState<boolean>(false);
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
  const [showLibrary, setShowLibrary] = useState(false);
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

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
    setCart(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (existing) {
        const nextQty = existing.qty + 1;
        if (nextQty > product.stockQty && !product.isService) {
          triggerToast(`Cannot exceed remaining stock (${product.stockQty})!`, 'error');
          return prev;
        }
        return prev.map(item => 
          item.productId === product.id
            ? { ...item, qty: nextQty, lineTotal: nextQty * item.unitPrice }
            : item
        );
      } else {
        return [...prev, {
          productId: product.id, productName: product.name, qty: 1,
          unitPrice: product.price, unitCost: product.cost, lineTotal: product.price,
        }];
      }
    });
  };

  const handleCompleteSaleRef = useRef<() => void | null>(null);

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

  const handleAdjustQty = (productId: string, delta: number) => {
    const product = products.find(p => p.id === productId);
    setCart(prev => prev.map(item => {
      if (item.productId === productId) {
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

  const handleDirectQtyChange = (productId: string, val: number) => {
    const product = products.find(p => p.id === productId);
    if (val <= 0) { handleRemoveItem(productId); setEditingItemId(null); return; }
    if (product && val > product.stockQty && !product.isService) {
      triggerToast(`Only ${product.stockQty} remaining in stock!`, 'error');
      val = product.stockQty;
    }
    setCart(prev => prev.map(item =>
      item.productId === productId
        ? { ...item, qty: val, lineTotal: val * item.unitPrice }
        : item
    ));
    setEditingItemId(null);
  };

  const handleRemoveItem = (productId: string) => {
    const item = cart.find(i => i.productId === productId);
    if (item && item.qty > 1 && !removeConfirmId) {
      setRemoveConfirmId(productId);
      return;
    }
    setCart(prev => prev.filter(item => item.productId !== productId));
    setRemoveConfirmId(null);
  };

  const subtotal = cart.reduce((acc, item) => acc + item.lineTotal, 0);
  const discountNum = discountType === 'percent'
    ? Math.min(parseFloat(discount) || 0, 100) / 100 * subtotal
    : Math.max(0, parseFloat(discount) || 0);
  const total = Math.max(0, subtotal - discountNum);
  const isDisabled = cart.length === 0 || (paymentMethod === 'Cash' && customCashReceived !== '' && parseFloat(customCashReceived) < total);
  const disabledReason = cart.length === 0
    ? 'Cart is empty'
    : (paymentMethod === 'Cash' && customCashReceived !== '' && parseFloat(customCashReceived) < total)
    ? `Need ${formatCurrency(total - parseFloat(customCashReceived))} more`
    : '';
  const tax = 0;

  const handleCompleteSale = () => {
    if (cart.length === 0) { triggerToast('Cart is empty!', 'error'); return; }
    const cashPaidNum = parseFloat(customCashReceived);
    let changeMsg = '';
    if (paymentMethod === 'Cash' && !isNaN(cashPaidNum) && cashPaidNum >= total) {
      changeMsg = ` Change: ${formatCurrency(cashPaidNum - total)}`;
    }
    const orderNumber = getNextOrderNumber();
    const newSale: Sale = {
      id: `sale-${Date.now()}`, orderNumber, timestamp: new Date().toISOString(),
      items: [...cart], subtotal: total, tax, total, paymentMethod,
      customerName: customerName.trim() || undefined,
      discount: discountNum > 0 ? discountNum : undefined,
    };
    onAddSale(newSale);
    setCart([]);
    setCustomCashReceived('');
    setDiscount('');
    setCustomerName('');
    setIsMobileCartOpen(false);
    triggerToast(`${orderNumber} done!${changeMsg}`, 'success');
  };
  handleCompleteSaleRef.current = handleCompleteSale;

  const categories = Object.keys(CATEGORY_VISUALS);

  const renderCartItem = (item: SaleItem) => {
    const isEditing = editingItemId === item.productId;
    const isRemoveConfirm = removeConfirmId === item.productId;
    return (
      <div key={item.productId} className="bg-[#0A0A0A] border border-white/5 p-4 rounded-2xl flex flex-col justify-between gap-3">
        <div className="flex justify-between items-start gap-2">
          <span className="text-sm font-bold text-white uppercase tracking-wide truncate max-w-[180px]" title={item.productName}>{item.productName}</span>
          <p className="text-sm font-black text-gold-brand font-display shrink-0">{formatCurrency(item.lineTotal)}</p>
        </div>
        <div className="flex justify-between items-center">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <input type="number" autoFocus value={editingQtyValue}
                onChange={(e) => setEditingQtyValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleDirectQtyChange(item.productId, parseInt(editingQtyValue, 10) || 0);
                  if (e.key === 'Escape') setEditingItemId(null);
                }}
                className="w-16 bg-zinc-900 border border-gold-brand text-gold-light rounded text-center text-sm h-11 p-1 focus:outline-none" />
              <button onClick={() => handleDirectQtyChange(item.productId, parseInt(editingQtyValue, 10) || 0)}
                className="p-2 bg-gold-brand text-black rounded text-sm hover:opacity-90 cursor-pointer touch-target"><Check className="w-4 h-4" /></button>
            </div>
          ) : (
            <button onClick={() => { setEditingItemId(item.productId); setEditingQtyValue(String(item.qty)); }}
              className="text-xs font-bold text-zinc-400 bg-zinc-900 hover:text-gold-brand hover:bg-zinc-800 px-3 py-1.5 rounded-lg cursor-pointer transition-all touch-target">
              Qty: <span className="text-gold-light underline font-black">{item.qty}</span>
            </button>
          )}
          <div className="flex items-center gap-1.5">
            <button onClick={() => handleAdjustQty(item.productId, -1)}
              className="touch-target bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg flex items-center justify-center transition-all cursor-pointer"><Minus className="w-4 h-4" /></button>
            <button onClick={() => handleAdjustQty(item.productId, 1)}
              className="touch-target bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg flex items-center justify-center transition-all cursor-pointer"><Plus className="w-4 h-4" /></button>
            {isRemoveConfirm ? (
              <div className="flex items-center gap-1">
                <button onClick={() => handleRemoveItem(item.productId)}
                  className="touch-target bg-rose-600 text-white rounded-lg flex items-center justify-center text-xs font-black cursor-pointer">Yes</button>
                <button onClick={() => setRemoveConfirmId(null)}
                  className="touch-target bg-zinc-800 text-zinc-400 rounded-lg flex items-center justify-center text-xs font-bold cursor-pointer">No</button>
              </div>
            ) : (
              <button onClick={() => handleRemoveItem(item.productId)}
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
              className="w-full bg-[#141414] border border-white/5 text-gold-light focus:border-gold-brand focus:ring-1 focus:ring-gold-brand h-12 pl-11 pr-4 rounded-xl text-sm transition-all outline-none"
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
            <button onClick={() => setSelectedCategory('All')}
              className={`flex items-center gap-1.5 py-3 px-5 rounded-xl transition-all border whitespace-nowrap cursor-pointer active:scale-95 shrink-0 min-h-[48px] ${
                selectedCategory === 'All'
                  ? 'bg-gold-brand border-gold-brand text-black shadow-[0_0_12px_rgba(255,204,0,0.25)] font-black'
                  : 'bg-[#141414]/50 border-white/5 hover:border-white/10 text-zinc-400 font-bold'
              }`}>
              <span className="text-sm uppercase tracking-wider font-black">All</span>
            </button>
            {categories.map(cat => {
              const isActive = selectedCategory === cat;
              const catInfo = CATEGORY_VISUALS[cat] || { gradient: 'from-zinc-800', emoji: '📦', glow: 'rgba(0,0,0,0.1)' };
              return (
                <button key={cat} onClick={() => setSelectedCategory(cat)}
                  className={`flex items-center gap-1.5 py-3 px-5 rounded-xl transition-all border whitespace-nowrap cursor-pointer active:scale-95 shrink-0 min-h-[48px] ${
                    isActive
                      ? 'bg-gold-brand border-gold-brand text-black shadow-[0_0_12px_rgba(255,204,0,0.25)] font-black'
                      : 'bg-[#141414]/50 border-white/5 hover:border-white/10 text-zinc-400 font-bold'
                  }`}>
                  <span className="shrink-0 text-sm">{catInfo.emoji}</span>
                  <span className="text-sm uppercase tracking-wider">{cat}</span>
                </button>
              );
            })}
          </section>
        </div>

        {/* Products */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-4 pb-2 scrollbar-thin" id="catalog-scroll-container">
          <section className="space-y-2">
            <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-widest font-display">
              {selectedCategory === 'All' ? 'All Products' : selectedCategory}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {filteredProducts.map(product => (
                <ProductCard
                  key={product.id}
                  product={product}
                  cart={cart}
                  formatCurrency={formatCurrency}
                  onAddToCart={handleAddToCart}
                  onAdjustQty={handleAdjustQty}
                />
              ))}
              {filteredProducts.length === 0 && (
                <div className="col-span-full py-16 text-center boss-card rounded-xl">
                  <Tag className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
                  <p className="text-sm text-zinc-400 font-bold uppercase tracking-wider">No products found</p>
                </div>
              )}
            </div>
          </section>
        </div>
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
        <div className={`fixed bottom-0 inset-x-0 bg-zinc-950 border-t border-zinc-800 rounded-t-3xl p-5 z-50 transform transition-transform duration-300 max-h-[85vh] overflow-y-auto flex flex-col ${
          isMobileCartOpen ? 'translate-y-0' : 'translate-y-full'
        }`}>
          <div className="flex justify-between items-center pb-4 border-b border-zinc-800 mb-4">
            <h3 className="text-sm font-black text-white uppercase tracking-wider font-display flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-gold-brand" /> Checkout
            </h3>
            <button onClick={() => setIsMobileCartOpen(false)} className="text-xs text-zinc-400 font-bold uppercase hover:text-white cursor-pointer touch-target">Close</button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 min-h-[150px] max-h-[40vh]">
            {cart.map(item => (
              <div key={item.productId} className="bg-zinc-900 border border-zinc-800 p-3 rounded-xl flex items-center justify-between gap-2 min-h-[64px]">
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-bold text-white uppercase truncate max-w-[160px]" title={item.productName}>{item.productName}</h4>
                  <p className="text-xs text-gold-brand font-black mt-0.5">{formatCurrency(item.lineTotal)}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => handleAdjustQty(item.productId, -1)}
                    className="touch-target bg-zinc-950 hover:bg-zinc-800 text-zinc-400 rounded-xl flex items-center justify-center text-lg font-bold cursor-pointer">-</button>
                  <span className="text-sm font-black text-white min-w-[24px] text-center">{item.qty}</span>
                  <button onClick={() => handleAdjustQty(item.productId, 1)}
                    className="touch-target bg-zinc-950 hover:bg-zinc-800 text-zinc-400 rounded-xl flex items-center justify-center text-lg font-bold cursor-pointer">+</button>
                  <button onClick={() => handleRemoveItem(item.productId)}
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
                className="w-full bg-zinc-900 border border-gold-brand/40 text-white h-12 pl-11 pr-4 rounded-xl text-sm outline-none focus:border-gold-brand" />
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
                  <div key={item.productId} className="flex items-center justify-between bg-zinc-900 border border-zinc-800 p-3 rounded-xl">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-white uppercase truncate">{item.productName}</p>
                      <p className="text-xs font-black text-gold-brand">{formatCurrency(item.lineTotal)}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <button onClick={() => handleAdjustQty(item.productId, -1)}
                        className="touch-target bg-zinc-800 text-zinc-400 rounded-lg flex items-center justify-center font-bold cursor-pointer">-</button>
                      <span className="text-sm font-black text-white min-w-[20px] text-center">{item.qty}</span>
                      <button onClick={() => handleAdjustQty(item.productId, 1)}
                        className="touch-target bg-zinc-800 text-zinc-400 rounded-lg flex items-center justify-center font-bold cursor-pointer">+</button>
                      <button onClick={() => handleRemoveItem(item.productId)}
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
      <ConfirmSaleModal
        isOpen={showConfirmSale}
        onClose={() => setShowConfirmSale(false)}
        onConfirm={handleCompleteSale}
        cart={cart}
        total={total}
        discountNum={discountNum}
        paymentMethod={paymentMethod}
        formatCurrency={formatCurrency}
      />

      <LibraryModal
        isOpen={showLibrary}
        onClose={() => setShowLibrary(false)}
        products={products}
        cart={cart}
        setCart={setCart}
        formatCurrency={formatCurrency}
        triggerToast={triggerToast}
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

      {/* Floating Action Buttons */}
      <div className="fixed bottom-24 left-4 z-30 flex flex-col gap-2">
        <button onClick={() => { setIsQuickSale(true); setQuickSearchQuery(''); }}
          className="h-14 w-14 bg-gold-brand text-black rounded-2xl shadow-2xl flex items-center justify-center active:scale-95 transition-all border border-white/10 shadow-[0_4px_20px_rgba(255,204,0,0.3)] cursor-pointer"
          title="Quick Sale">
          <Zap className="w-7 h-7" />
        </button>
        <button onClick={() => setIsScannerOpen(true)}
          className="touch-target px-4 bg-[#141414] border border-white/10 hover:border-gold-brand text-gold-brand rounded-xl flex items-center gap-2 font-bold text-xs uppercase tracking-wider transition-all active:scale-95 shadow-lg cursor-pointer"
          title="Open barcode scanner (F1)">
          <Barcode className="w-4 h-4" /> Scan
        </button>
        <button onClick={() => setShowQuickExpense(true)}
          className="touch-target px-4 bg-[#141414] border border-white/10 hover:border-emerald-500 text-emerald-400 rounded-xl flex items-center gap-2 font-bold text-xs uppercase tracking-wider transition-all active:scale-95 shadow-lg cursor-pointer"
          title="Quick expense">
          <Wallet className="w-4 h-4" /> Expense
        </button>
        <button onClick={() => setShowFoodCost(true)}
          className="touch-target px-4 bg-[#141414] border border-white/10 hover:border-amber-500 text-amber-400 rounded-xl flex items-center gap-2 font-bold text-xs uppercase tracking-wider transition-all active:scale-95 shadow-lg cursor-pointer"
          title="Food cost & profit analyzer">
          <ChefHat className="w-4 h-4" /> Profit
        </button>
        <button onClick={() => setShowTransfers(true)}
          className="touch-target px-4 bg-[#141414] border border-white/10 hover:border-sky-500 text-sky-400 rounded-xl flex items-center gap-2 font-bold text-xs uppercase tracking-wider transition-all active:scale-95 shadow-lg cursor-pointer"
          title="Track cash transfers between drawers">
          <ArrowRightLeft className="w-4 h-4" /> Transfer
        </button>
        <button onClick={() => setShowLibrary(true)}
          className="touch-target px-4 bg-[#141414] border border-white/10 hover:border-violet-500 text-violet-400 rounded-xl flex items-center gap-2 font-bold text-xs uppercase tracking-wider transition-all active:scale-95 shadow-lg cursor-pointer"
          title="Library - movies, music, software">
          <BookOpen className="w-4 h-4" /> Library
        </button>
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
