import { useState, useMemo, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { 
  Search, 
  Plus, 
  Minus, 
  Trash2, 
  ShoppingCart, 
  Check, 
  Tag,
  Coins,
  Smartphone,
  UserCheck,
  X,
  Zap,
  Percent,
  User,
  Barcode,
  Wallet,
  ChefHat,
  ArrowRightLeft,
  BookOpen
} from 'lucide-react';
import { Product, Sale, SaleItem, Expense, StoreSettings, CashTransfer } from '../types';
import BarcodeScanner from './BarcodeScanner';
import KeyboardShortcuts from './KeyboardShortcuts';

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
  products,
  onAddSale,
  formatCurrency,
  cart,
  setCart,
  triggerToast,
  settings,
  onAddExpense,
  expenseCategories = ['Stock Purchase', 'Utilities', 'Labor', 'Rent', 'Transport', 'Supplies'],
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

  const [customItemName, setCustomItemName] = useState<string>('');
  const [customItemPrice, setCustomItemPrice] = useState<string>('');
  const [customItemCategory, setCustomItemCategory] = useState<string>('Custom');
  const [customCashReceived, setCustomCashReceived] = useState<string>('');
  const [discountType, setDiscountType] = useState<'fixed' | 'percent'>('fixed');
  
  const [isScannerOpen, setIsScannerOpen] = useState<boolean>(false);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState<boolean>(false);
  const [showConfirmSale, setShowConfirmSale] = useState<boolean>(false);
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);

  const [showQuickExpense, setShowQuickExpense] = useState(false);
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseAmt, setExpenseAmt] = useState('');
  const [expenseCat, setExpenseCat] = useState(expenseCategories[0] || 'Stock Purchase');
  const [expenseBatchMode, setExpenseBatchMode] = useState(false);
  const [expenseBatchProductId, setExpenseBatchProductId] = useState('');
  const [expenseBatchUnits, setExpenseBatchUnits] = useState('');

  const [showFoodCost, setShowFoodCost] = useState(false);

  const [showTransfers, setShowTransfers] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryQtys, setLibraryQtys] = useState<Record<string, number>>({});
  const [transferFrom, setTransferFrom] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [transferAmt, setTransferAmt] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [transfers, setTransfers] = useState<CashTransfer[]>(() => {
    try {
      const saved = localStorage.getItem('boss_pos_cash_transfers');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

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
          productId: product.id,
          productName: product.name,
          qty: 1,
          unitPrice: product.price,
          unitCost: product.cost,
          lineTotal: product.price
        }];
      }
    });
  };

  const handleCustomAdd = () => {
    const priceNum = parseFloat(customItemPrice);
    if (isNaN(priceNum) || priceNum <= 0) {
      triggerToast('Enter a valid price', 'error');
      return;
    }
    const name = customItemName.trim() || 'Custom Item';
    const fakeProduct: Product = {
      id: `custom-${Date.now()}`,
      name: name,
      category: customItemCategory || 'Custom',
      cost: Math.round(priceNum * 0.5),
      price: priceNum,
      stockQty: 9999,
      lowStockThreshold: 0
    };
    handleAddToCart(fakeProduct);
    setCustomItemName('');
    setCustomItemPrice('');
  };

  const handleCompleteSaleRef = useRef<() => void | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        setIsScannerOpen(true);
      }
      if (e.key === 'F2') {
        e.preventDefault();
        handleCompleteSaleRef.current?.();
      }
      if (e.ctrlKey && e.key === '/') {
        e.preventDefault();
        setShowKeyboardHelp(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleBarcodeScanned = (barcode: string) => {
    // Try to find product by barcode or IMEI
    const product = products.find(p => 
      p.barcode === barcode || p.imei === barcode || p.id === `prod-${barcode}`
    );
    
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
    setCart(prev => {
      return prev.map(item => {
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
      }).filter(Boolean) as SaleItem[];
    });
  };

  const handleDirectQtyChange = (productId: string, val: number) => {
    const product = products.find(p => p.id === productId);
    if (val <= 0) {
      handleRemoveItem(productId);
      setEditingItemId(null);
      return;
    }
    
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
    setCart(prev => prev.filter(item => item.productId !== productId));
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
    if (cart.length === 0) {
      triggerToast('Cart is empty!', 'error');
      return;
    }

    const cashPaidNum = parseFloat(customCashReceived);
    let changeMsg = '';
    if (paymentMethod === 'Cash' && !isNaN(cashPaidNum) && cashPaidNum >= total) {
      const changeVal = cashPaidNum - total;
      changeMsg = ` Change: ${formatCurrency(changeVal)}`;
    }

    const orderNumber = getNextOrderNumber();
    const newSale: Sale = {
      id: `sale-${Date.now()}`,
      orderNumber,
      timestamp: new Date().toISOString(),
      items: [...cart],
      subtotal: total,
      tax,
      total,
      paymentMethod,
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

  useEffect(() => {
    localStorage.setItem('boss_pos_cash_transfers', JSON.stringify(transfers));
  }, [transfers]);

  const handleRecordTransfer = () => {
    if (!transferFrom || !transferTo) {
      triggerToast('Select both drawers', 'error');
      return;
    }
    if (transferFrom === transferTo) {
      triggerToast('Cannot transfer to same drawer', 'error');
      return;
    }
    const amtNum = parseFloat(transferAmt) || 0;
    if (amtNum <= 0) {
      triggerToast('Enter a valid amount', 'error');
      return;
    }
    const newTransfer: CashTransfer = {
      id: `ct-${Date.now()}`,
      fromCategory: transferFrom,
      toCategory: transferTo,
      amount: amtNum,
      reason: transferReason.trim() || 'Change / borrow',
      createdAt: new Date().toISOString(),
      settledAt: null,
    };
    setTransfers(prev => [newTransfer, ...prev]);
    triggerToast(`Recorded: ${formatCurrency(amtNum)} from ${transferFrom} → ${transferTo}`, 'info');
    setTransferAmt('');
    setTransferReason('');
  };

  const handleSettleTransfer = (id: string) => {
    setTransfers(prev => prev.map(t => t.id === id ? { ...t, settledAt: new Date().toISOString() } : t));
    triggerToast('Marked as settled', 'success');
  };

  const handleQuickExpense = () => {
    if (!expenseDesc.trim() && !expenseBatchMode) {
      triggerToast('Enter a description', 'error');
      return;
    }
    const amtNum = parseFloat(expenseAmt) || 0;
    if (amtNum <= 0) {
      triggerToast('Amount must be positive', 'error');
      return;
    }
    const newExpense: Expense = {
      id: `exp-${Date.now()}`,
      timestamp: new Date().toISOString(),
      description: expenseBatchMode ? `Batch: ${products.find(p => p.id === expenseBatchProductId)?.name || 'Stock'}` : expenseDesc,
      amount: amtNum,
      category: expenseCat,
    };
    onAddExpense?.(newExpense);

    if (expenseBatchMode && expenseBatchProductId) {
      const unitsNum = parseInt(expenseBatchUnits, 10) || 0;
      if (unitsNum > 0) {
        const costPerUnit = Math.round(amtNum / unitsNum);
        const product = products.find(p => p.id === expenseBatchProductId);
        if (product) {
          triggerToast(`Batch: ${unitsNum} units × ${costPerUnit.toLocaleString()} UGX each`, 'success');
          if (costPerUnit >= product.price) {
            triggerToast(`WARNING: Cost (${formatCurrency(costPerUnit)}) >= Price (${formatCurrency(product.price)}) — you're losing money!`, 'error');
          } else {
            const profitPct = Math.round(((product.price - costPerUnit) / product.price) * 100);
            triggerToast(`Profit margin: ${profitPct}% per unit`, 'success');
          }
        }
      }
    }

    triggerToast(`Expense logged: ${formatCurrency(amtNum)}`, 'success');
    setExpenseDesc('');
    setExpenseAmt('');
    setExpenseBatchMode(false);
    setExpenseBatchProductId('');
    setExpenseBatchUnits('');
    setShowQuickExpense(false);
  };

  const categories = Object.keys(CATEGORY_VISUALS);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 relative lg:h-[calc(100vh-140px)] lg:overflow-hidden pb-2" id="sales-tab-content">
      
      {/* LEFT COLUMN */}
      <div className="lg:col-span-8 flex flex-col h-full lg:overflow-hidden space-y-3">
        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <input 
              type="text" 
              placeholder="Search items..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#141414] border border-white/5 text-gold-light focus:border-gold-brand focus:ring-1 focus:ring-gold-brand h-12 pl-11 pr-4 rounded-xl text-sm transition-all outline-none"
              id="search-inventory-input"
            />
            <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
          </div>
          <button
            onClick={() => setIsCustomChargeOpen(true)}
            className="shrink-0 h-12 px-4 bg-gold-brand/10 hover:bg-gold-brand/20 border border-gold-brand/30 text-gold-brand font-black rounded-xl text-xs uppercase tracking-wider transition-all active:scale-95"
            id="open-custom-charge-btn"
          >
            + Custom
          </button>
        </div>

        {/* Categories */}
        <div className="relative -mx-4 px-4 sm:mx-0 sm:px-0">
          <div className="absolute right-0 top-0 bottom-2 w-8 bg-gradient-to-l from-[#0A0A0A] to-transparent pointer-events-none z-10 sm:hidden"></div>
        <section className="flex gap-2 overflow-x-auto pb-1.5 scrollbar-none">
              <button
                onClick={() => setSelectedCategory('All')}
                className={`flex items-center gap-1.5 py-3 px-5 rounded-xl transition-all border whitespace-nowrap cursor-pointer active:scale-95 shrink-0 min-h-[48px] ${
                  selectedCategory === 'All'
                    ? 'bg-gold-brand border-gold-brand text-black shadow-[0_0_12px_rgba(255,204,0,0.25)] font-black' 
                    : 'bg-[#141414]/50 border-white/5 hover:border-white/10 text-zinc-400 font-bold'
                }`}
              >
                <span className="text-sm uppercase tracking-wider font-black">All</span>
              </button>
              {categories.map(cat => {
                const isActive = selectedCategory === cat;
                const catInfo = CATEGORY_VISUALS[cat] || { gradient: 'from-zinc-800', emoji: '📦', glow: 'rgba(0,0,0,0.1)' };
                return (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`flex items-center gap-1.5 py-3 px-5 rounded-xl transition-all border whitespace-nowrap cursor-pointer active:scale-95 shrink-0 min-h-[48px] ${
                      isActive 
                        ? 'bg-gold-brand border-gold-brand text-black shadow-[0_0_12px_rgba(255,204,0,0.25)] font-black' 
                        : 'bg-[#141414]/50 border-white/5 hover:border-white/10 text-zinc-400 font-bold'
                    }`}
                  >
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
                  {filteredProducts.map(product => {
                    const isLowStock = product.stockQty <= product.lowStockThreshold && !product.isService;
                    const isOutOfStock = product.stockQty <= 0 && !product.isService;
                    const cartItem = cart.find(item => item.productId === product.id);
                    const catVis = CATEGORY_VISUALS[product.category] || { gradient: 'from-zinc-800/80 via-zinc-700/50 to-slate-900/90', emoji: '📦', glow: 'rgba(0,0,0,0.1)' };

                    return (
                      <div 
                        key={product.id}
                        onClick={() => !isOutOfStock && handleAddToCart(product)}
                        className={`bg-[#141414] border rounded-2xl overflow-hidden cursor-pointer active:scale-[0.97] transition-all flex flex-col ${
                          isOutOfStock 
                            ? 'opacity-40 border-dashed border-rose-800/40' 
                            : cartItem
                            ? 'border-gold-brand shadow-[0_0_15px_rgba(255,204,0,0.12)]'
                            : 'border-white/5 hover:border-gold-brand/30'
                        }`}
                      >
                        <div className="relative aspect-[4/3] bg-gradient-to-br" style={{ backgroundImage: `linear-gradient(to bottom right, ${catVis.gradient.replace(/from-|via-|to-|\/.*/g, '').trim()})` }}>
                          {product.imageUrl ? (
                            <img referrerPolicy="no-referrer" src={product.imageUrl} alt={product.name}
                              className="w-full h-full object-cover"
                              onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />
                          ) : (
                            <div className={`w-full h-full bg-gradient-to-br ${catVis.gradient} flex items-center justify-center`}>
                              <span className="text-5xl sm:text-6xl opacity-80 drop-shadow-lg">{catVis.emoji}</span>
                            </div>
                          )}
                          {isOutOfStock ? (
                            <div className="absolute top-2 right-2 bg-rose-950/90 backdrop-blur-sm text-rose-300 text-[10px] font-black px-2.5 py-1 rounded-lg border border-rose-800/50 uppercase tracking-wider">SOLD OUT</div>
                          ) : isLowStock ? (
                            <div className="absolute top-2 right-2 bg-amber-950/90 backdrop-blur-sm text-amber-300 text-[10px] font-black px-2.5 py-1 rounded-lg border border-amber-800/50 uppercase tracking-wider animate-pulse">LOW ({product.stockQty})</div>
                          ) : (
                            !product.isService && (
                              <div className="absolute top-2 right-2 bg-black/50 backdrop-blur-sm text-zinc-300 text-[10px] font-bold px-2.5 py-1 rounded-lg border border-white/10 uppercase tracking-wider">{product.stockQty}</div>
                            )
                          )}
                        </div>

                        <div className="p-3 flex flex-col gap-1.5 flex-1 min-h-0">
                          <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wide line-clamp-2 leading-tight min-h-[2.5em]">
                            {product.name}
                          </h3>
                          <div className="flex items-center justify-between mt-auto gap-1">
                            <div>
                              <p className="text-xs font-black text-gold-brand font-display leading-tight">{formatCurrency(product.price)}</p>
                              {product.cost > 0 && (
                                <p className="text-[10px] text-zinc-600 font-bold uppercase mt-0.5">Cost: {formatCurrency(product.cost)}</p>
                              )}
                            </div>
                            {cartItem ? (
                              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                <button onClick={() => handleAdjustQty(product.id, -1)} className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-lg font-bold flex items-center justify-center transition-all active:scale-90">-</button>
                                <span className="text-sm font-black text-white px-1 min-w-[20px] text-center font-mono">{cartItem.qty}</span>
                                <button onClick={() => handleAdjustQty(product.id, 1)} className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-gold-brand hover:bg-gold-medium text-black text-lg font-black flex items-center justify-center transition-all active:scale-90">+</button>
                              </div>
                            ) : (
                              <button 
                                disabled={isOutOfStock}
                                onClick={(e) => { e.stopPropagation(); handleAddToCart(product); }}
                                className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center transition-all active:scale-90 bg-zinc-800 hover:bg-gold-brand text-zinc-400 hover:text-black"
                              >
                                <Plus className="w-5 h-5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  
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
              <button onClick={() => setShowClearConfirm(true)} className="text-xs text-zinc-500 hover:text-rose-400 uppercase font-bold flex items-center gap-1.5 transition-colors">
                <Trash2 className="w-4 h-4" /> Clear
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto pr-1 space-y-3 scrollbar">
            {cart.map((item) => {
              const isEditing = editingItemId === item.productId;
              return (
                <div key={item.productId} className="bg-[#0A0A0A] border border-white/5 p-4 rounded-2xl flex flex-col justify-between gap-3">
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-sm font-bold text-white uppercase tracking-wide truncate max-w-[180px]" title={item.productName}>{item.productName}</span>
                    <p className="text-sm font-black text-gold-brand font-display shrink-0">{formatCurrency(item.lineTotal)}</p>
                  </div>

                  <div className="flex justify-between items-center">
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="number" autoFocus value={editingQtyValue}
                          onChange={(e) => setEditingQtyValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleDirectQtyChange(item.productId, parseInt(editingQtyValue, 10) || 0);
                            else if (e.key === 'Escape') setEditingItemId(null);
                          }}
                          className="w-16 bg-zinc-900 border border-gold-brand text-gold-light rounded text-center text-sm h-9 p-1 focus:outline-none"
                        />
                        <button onClick={() => handleDirectQtyChange(item.productId, parseInt(editingQtyValue, 10) || 0)} className="p-2 bg-gold-brand text-black rounded text-sm hover:opacity-90"><Check className="w-4 h-4" /></button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditingItemId(item.productId); setEditingQtyValue(String(item.qty)); }} className="text-xs font-bold text-zinc-400 bg-zinc-900 hover:text-gold-brand hover:bg-zinc-800 px-3 py-1 rounded-lg cursor-pointer transition-all">
                        Qty: <span className="text-gold-light underline font-black">{item.qty}</span>
                      </button>
                    )}

                    <div className="flex items-center gap-1.5">
                      <button onClick={() => handleAdjustQty(item.productId, -1)} className="w-9 h-9 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg flex items-center justify-center transition-all"><Minus className="w-4 h-4" /></button>
                      <button onClick={() => handleAdjustQty(item.productId, 1)} className="w-9 h-9 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg flex items-center justify-center transition-all"><Plus className="w-4 h-4" /></button>
                      <button onClick={() => handleRemoveItem(item.productId)} className="w-9 h-9 bg-rose-950/20 hover:bg-rose-950 hover:text-rose-400 text-rose-500 rounded-lg flex items-center justify-center transition-all"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                </div>
              );
            })}

            {cart.length === 0 && (
              <div className="h-full flex flex-col justify-center items-center text-center py-6 px-2 space-y-4">
                <div className="w-12 h-12 rounded-full bg-zinc-900 border border-white/5 flex items-center justify-center text-zinc-500">
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
                  { name: 'Credit / Book', label: 'Credit', icon: <UserCheck className="w-4 h-4 text-blue-400" /> }
                ].map(opt => (
                  <button
                    key={opt.name}
                    onClick={() => { setPaymentMethod(opt.name as any); setCustomCashReceived(''); }}
                    className={`flex flex-col items-center justify-center py-3 px-0.5 rounded-xl border text-sm font-bold uppercase transition-all cursor-pointer min-h-[56px] ${
                      paymentMethod === opt.name ? 'border-gold-brand bg-gold-brand/15 text-white font-black' : 'border-white/5 bg-[#0A0A0A] text-zinc-500 hover:border-white/10 hover:text-zinc-400'
                    }`}
                  >
                    <div className="mb-1 shrink-0">{opt.icon}</div>
                    <span className="truncate w-full text-center text-xs">{opt.label}</span>
                  </button>
                ))}
              </div>

              {/* Credit customer name */}
              {paymentMethod === 'Credit / Book' && (
                <div className="bg-[#0A0A0A] border border-white/5 p-3 rounded-2xl space-y-2 mt-2">
                  <label className="text-xs text-zinc-400 font-bold uppercase flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5" /> Customer Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. John Mukasa"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full bg-[#141414] border border-white/5 text-gold-brand font-bold rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-brand h-10"
                  />
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
                      className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-all ${discountType === 'fixed' ? 'bg-gold-brand text-black' : 'text-zinc-500 hover:text-zinc-300'}`}>UGX</button>
                    <button onClick={() => setDiscountType('percent')}
                      className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-all ${discountType === 'percent' ? 'bg-gold-brand text-black' : 'text-zinc-500 hover:text-zinc-300'}`}>%</button>
                  </div>
                </div>
                <input
                  type="number" min="0"
                  placeholder={discountType === 'percent' ? '0%' : '0'}
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  className="w-full bg-[#141414] border border-white/5 text-gold-brand font-bold rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-brand h-10"
                />
                {discountType === 'percent' && discount && (
                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                    {formatCurrency(discountNum)} off
                  </p>
                )}
              </div>

              {/* Cash tendered */}
              {paymentMethod === 'Cash' && (
                <div className="bg-[#0A0A0A] border border-white/5 p-3 rounded-2xl space-y-2 mt-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-zinc-400 font-bold uppercase">Cash Received:</span>
                    <input type="number" placeholder="Amount" value={customCashReceived} onChange={(e) => setCustomCashReceived(e.target.value)}
                      className="w-28 bg-[#141414] border border-white/5 text-gold-brand font-black text-right rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-brand h-10" />
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
                          className={`px-3 py-1.5 text-xs font-black rounded-lg border transition-all min-h-[36px] ${
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

            <button
              onClick={() => setShowConfirmSale(true)}
              disabled={isDisabled}
              className={`w-full h-14 rounded-2xl text-sm font-black uppercase tracking-widest transition-all active:scale-95 ${
                !isDisabled
                  ? 'bg-gold-brand text-black hover:bg-gold-medium shadow-[0_4px_15px_rgba(255,204,0,0.25)]' 
                  : 'bg-zinc-800 text-zinc-600 cursor-not-allowed opacity-50'
              }`}
            >
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
          <button 
            onClick={() => setIsMobileCartOpen(true)}
            className="fixed bottom-20 right-4 z-40 bg-gold-brand text-black font-black flex items-center justify-center gap-2 px-5 py-4 rounded-2xl shadow-2xl border-2 border-black/20 active:scale-95 transition-all min-h-[52px]"
          >
            <ShoppingCart className="w-5 h-5" />
            <span className="text-sm uppercase font-display font-black">Cart ({cart.reduce((sum, item) => sum + item.qty, 0)}) • {formatCurrency(total)}</span>
          </button>
        )}

        {isMobileCartOpen && (
          <div onClick={() => setIsMobileCartOpen(false)} className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40"></div>
        )}

        <div className={`fixed bottom-0 inset-x-0 bg-zinc-950 border-t border-zinc-800 rounded-t-3xl p-5 z-50 transform transition-transform duration-300 max-h-[85vh] overflow-y-auto flex flex-col ${
          isMobileCartOpen ? 'translate-y-0' : 'translate-y-full'
        }`}>
          <div className="flex justify-between items-center pb-4 border-b border-zinc-800 mb-4">
            <h3 className="text-sm font-black text-white uppercase tracking-wider font-display flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-gold-brand" /> Checkout
            </h3>
            <button onClick={() => setIsMobileCartOpen(false)} className="text-xs text-zinc-400 font-bold uppercase hover:text-white">Close</button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 min-h-[150px] max-h-[40vh]">
            {cart.map(item => (
              <div key={item.productId} className="bg-zinc-900 border border-zinc-800 p-3 rounded-xl flex items-center justify-between gap-2 min-h-[64px]">
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-bold text-white uppercase truncate max-w-[160px]" title={item.productName}>{item.productName}</h4>
                  <p className="text-xs text-gold-brand font-black mt-0.5">{formatCurrency(item.lineTotal)}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => handleAdjustQty(item.productId, -1)} className="w-11 h-11 bg-zinc-950 hover:bg-zinc-800 text-zinc-400 rounded-xl flex items-center justify-center text-lg font-bold">-</button>
                  <span className="text-sm font-black text-white min-w-[24px] text-center">{item.qty}</span>
                  <button onClick={() => handleAdjustQty(item.productId, 1)} className="w-11 h-11 bg-zinc-950 hover:bg-zinc-800 text-zinc-400 rounded-xl flex items-center justify-center text-lg font-bold">+</button>
                  <button onClick={() => handleRemoveItem(item.productId)} className="w-11 h-11 bg-rose-950/20 hover:bg-rose-950/40 text-rose-400 rounded-xl flex items-center justify-center text-lg font-bold">x</button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-3 border-t border-zinc-800 space-y-1.5">
            <p className="text-xs text-zinc-400 font-bold uppercase">Payment:</p>
            <div className="grid grid-cols-4 gap-1.5">
              {['Cash', 'MTN MoMo', 'Airtel Money', 'Credit / Book'].map(name => (
                <button key={name} onClick={() => { setPaymentMethod(name as any); setCustomCashReceived(''); }}
                  className={`py-3 rounded-xl text-xs border font-black uppercase transition-all min-h-[44px] ${
                    paymentMethod === name ? 'border-gold-brand bg-gold-brand/10 text-white' : 'border-zinc-900 text-zinc-500'
                  }`}>
                  {name === 'Credit / Book' ? 'Credit' : name === 'MTN MoMo' ? 'MTN' : name === 'Airtel Money' ? 'Airtel' : name}
                </button>
              ))}
            </div>

            {paymentMethod === 'Credit / Book' && (
              <input type="text" placeholder="Customer name" value={customerName} onChange={(e) => setCustomerName(e.target.value)}
                className="w-full bg-[#0A0A0A] border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs outline-none" />
            )}

            {paymentMethod === 'Cash' && (
              <div className="bg-[#141414] border border-white/5 p-4 rounded-2xl space-y-3 mt-2">
                <input type="number" placeholder="Cash Received" value={customCashReceived} onChange={(e) => setCustomCashReceived(e.target.value)}
                  className="w-full bg-[#0A0A0A] border border-white/5 text-gold-brand font-black text-right rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-brand h-10" />
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
            <button onClick={() => setShowConfirmSale(true)}
              disabled={isDisabled}
              className={`w-full h-14 rounded-2xl text-sm font-black uppercase tracking-widest transition-all active:scale-95 ${
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

      {/* Custom Charge Modal */}
      {isCustomChargeOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4">
              <h3 className="text-sm font-black text-white uppercase tracking-wider font-display">+ Custom Item</h3>
              <button onClick={() => setIsCustomChargeOpen(false)} className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <input type="text" placeholder="Item name (e.g. Phone Repair, Cable)" value={customItemName} onChange={(e) => setCustomItemName(e.target.value)}
                className="w-full bg-[#0A0A0A] border border-white/5 text-gold-light focus:border-gold-brand h-12 px-4 rounded-xl text-sm outline-none" />
              <input type="number" placeholder="Price (UGX)" value={customItemPrice} onChange={(e) => setCustomItemPrice(e.target.value)}
                className="w-full bg-[#0A0A0A] border border-white/5 text-gold-brand font-bold focus:border-gold-brand h-12 px-4 rounded-xl text-sm outline-none" />
              <div>
                <label className="block text-xs text-zinc-500 font-bold uppercase mb-1">Category</label>
                <select value={customItemCategory} onChange={(e) => setCustomItemCategory(e.target.value)}
                  className="w-full bg-[#0A0A0A] border border-white/5 text-zinc-300 rounded-xl h-12 px-3 text-xs focus:border-gold-brand outline-none font-bold">
                  <option value="Custom">Uncategorized</option>
                  {categories.filter(c => c !== 'Custom').map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="text-xs text-zinc-500 font-bold uppercase tracking-wider mr-1 w-full">Quick Prices:</span>
                {[500, 1000, 2000, 5000, 10000, 20000, 50000, 100000].map(amt => (
                  <button key={amt} type="button" onClick={() => setCustomItemPrice(String(amt))}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                      customItemPrice === String(amt) ? 'bg-gold-brand text-black border-gold-brand' : 'bg-[#0A0A0A] text-zinc-400 border-white/5'
                    }`}>
                    {amt >= 1000 ? `${(amt/1000).toFixed(0)}K` : amt}
                  </button>
                ))}
              </div>
              <button onClick={handleCustomAdd} className="w-full h-12 bg-gold-brand text-black font-black uppercase text-sm tracking-widest rounded-xl mt-2">+ Add to Cart</button>
            </div>
          </div>
        </div>
      )}

      {/* Barcode Scanner */}
      <BarcodeScanner isOpen={isScannerOpen} onScan={handleBarcodeScanned} onClose={() => setIsScannerOpen(false)} />

      {/* Keyboard Shortcuts Help */}
      <KeyboardShortcuts isOpen={showKeyboardHelp} onClose={() => setShowKeyboardHelp(false)} />

      {/* Quick Sale Modal */}
      {isQuickSale && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-sm z-50 flex flex-col">
          <div className="flex items-center gap-3 p-4 border-b border-white/5">
            <div className="relative flex-1">
              <input type="text" placeholder="Search products..." value={quickSearchQuery} autoFocus
                onChange={(e) => setQuickSearchQuery(e.target.value)}
                className="w-full bg-zinc-900 border border-gold-brand/40 text-white h-12 pl-11 pr-4 rounded-xl text-sm outline-none focus:border-gold-brand" />
              <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-gold-brand" />
            </div>
            <button onClick={() => { setIsQuickSale(false); setQuickSearchQuery(''); }}
              className="h-12 px-4 bg-gold-brand text-black font-black text-xs rounded-xl uppercase tracking-wider">Close</button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="space-y-1">
              {(() => {
                const matched = quickSearchQuery
                  ? products.filter(p => p.name.toLowerCase().includes(quickSearchQuery.toLowerCase()))
                  : products;
                const sliced = matched.slice(0, 20);
                return sliced.length > 0 ? sliced.map(product => {
                  const inCart = cart.find(c => c.productId === product.id);
                  const isOut = product.stockQty <= 0 && !product.isService;
                  return (
                    <button key={product.id} onClick={() => !isOut && handleAddToCart(product)}
                      className={`w-full flex items-center justify-between bg-zinc-900 border border-zinc-800 hover:border-gold-brand/40 p-4 rounded-xl transition-all text-left ${
                        isOut ? 'opacity-30' : ''
                      } ${inCart ? 'border-gold-brand/40 bg-gold-brand/5' : ''}`}>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-white uppercase truncate">{product.name}</p>
                        <p className="text-[10px] text-zinc-500 font-bold mt-0.5 uppercase">
                          {product.category} • {formatCurrency(product.price)}
                          {!product.isService && ` • Stock: ${product.stockQty}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-3">
                        {inCart && <span className="text-xs font-black text-gold-brand">x{inCart.qty}</span>}
                        <div className="w-9 h-9 bg-gold-brand text-black rounded-xl flex items-center justify-center font-black text-lg">+</div>
                      </div>
                    </button>
                  );
                }) : (
                  <div className="p-6 text-center">
                    <p className="text-xs text-zinc-500 font-bold uppercase">{quickSearchQuery ? `No products match "${quickSearchQuery}"` : 'No products available'}</p>
                  </div>
                );
              })()}
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
                      <button onClick={() => handleAdjustQty(item.productId, -1)} className="w-9 h-9 bg-zinc-800 text-zinc-400 rounded-lg flex items-center justify-center font-bold">-</button>
                      <span className="text-sm font-black text-white min-w-[20px] text-center">{item.qty}</span>
                      <button onClick={() => handleAdjustQty(item.productId, 1)} className="w-9 h-9 bg-zinc-800 text-zinc-400 rounded-lg flex items-center justify-center font-bold">+</button>
                      <button onClick={() => handleRemoveItem(item.productId)} className="w-9 h-9 bg-rose-950/20 text-rose-400 rounded-lg flex items-center justify-center font-bold">x</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {['Cash', 'MTN MoMo', 'Airtel Money', 'Credit / Book'].map(name => (
                  <button key={name} onClick={() => setPaymentMethod(name as any)}
                    className={`py-2.5 rounded-xl text-xs border font-black uppercase transition-all ${
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
              <button onClick={() => setShowConfirmSale(true)}
                disabled={cart.length === 0}
                className="w-full h-12 bg-gold-brand text-black font-black uppercase tracking-widest text-sm rounded-xl">
                Complete Sale
              </button>
            </div>
          )}
        </div>
      )}

      {/* Floating Action Buttons */}
      <div className="fixed bottom-24 left-4 z-30 flex flex-col gap-2">
        <button onClick={() => { setIsQuickSale(true); setQuickSearchQuery(''); }}
          className="h-14 w-14 bg-gold-brand text-black rounded-2xl shadow-2xl flex items-center justify-center active:scale-95 transition-all border border-white/10 shadow-[0_4px_20px_rgba(255,204,0,0.3)]"
          title="Quick Sale">
          <Zap className="w-7 h-7" />
        </button>
        <button onClick={() => setIsScannerOpen(true)}
          className="h-12 px-4 bg-[#141414] border border-white/10 hover:border-gold-brand text-gold-brand rounded-xl flex items-center gap-2 font-bold text-xs uppercase tracking-wider transition-all active:scale-95 shadow-lg"
          title="Open barcode scanner (F1)">
          <Barcode className="w-4 h-4" /> Scan
        </button>
        <button onClick={() => setShowQuickExpense(true)}
          className="h-12 px-4 bg-[#141414] border border-white/10 hover:border-emerald-500 text-emerald-400 rounded-xl flex items-center gap-2 font-bold text-xs uppercase tracking-wider transition-all active:scale-95 shadow-lg"
          title="Quick expense">
          <Wallet className="w-4 h-4" /> Expense
        </button>
        <button onClick={() => setShowFoodCost(true)}
          className="h-12 px-4 bg-[#141414] border border-white/10 hover:border-amber-500 text-amber-400 rounded-xl flex items-center gap-2 font-bold text-xs uppercase tracking-wider transition-all active:scale-95 shadow-lg"
          title="Food cost & profit analyzer">
          <ChefHat className="w-4 h-4" /> Profit
        </button>
        <button onClick={() => setShowTransfers(true)}
          className="h-12 px-4 bg-[#141414] border border-white/10 hover:border-sky-500 text-sky-400 rounded-xl flex items-center gap-2 font-bold text-xs uppercase tracking-wider transition-all active:scale-95 shadow-lg"
          title="Track cash transfers between drawers">
          <ArrowRightLeft className="w-4 h-4" /> Transfer
        </button>
        <button onClick={() => setShowLibrary(true)}
          className="h-12 px-4 bg-[#141414] border border-white/10 hover:border-violet-500 text-violet-400 rounded-xl flex items-center gap-2 font-bold text-xs uppercase tracking-wider transition-all active:scale-95 shadow-lg"
          title="Library - movies, music, software">
          <BookOpen className="w-4 h-4" /> Library
        </button>
      </div>

      {/* Confirm Sale Modal */}
      {showConfirmSale && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-sm p-6 shadow-2xl">
            <h3 className="text-sm font-black text-white uppercase tracking-wider text-center mb-2">Confirm Sale</h3>
            <div className="bg-[#0A0A0A] border border-white/5 rounded-xl p-4 space-y-2 mb-4">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Items</span>
                <span className="font-bold text-white">{cart.reduce((s, i) => s + i.qty, 0)} items</span>
              </div>
              {discountNum > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-400">Discount</span>
                  <span className="font-bold text-emerald-400">{formatCurrency(discountNum)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm pt-2 border-t border-white/5">
                <span className="font-black text-white uppercase">Total</span>
                <span className="font-black text-gold-brand">{formatCurrency(total)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Payment</span>
                <span className="font-bold text-white">{paymentMethod}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowConfirmSale(false)}
                className="flex-1 h-11 border border-zinc-800 text-zinc-400 font-bold text-xs rounded-xl uppercase tracking-wider">Cancel</button>
              <button onClick={() => {
                setShowConfirmSale(false);
                handleCompleteSale();
              }}
                className="flex-1 h-11 bg-gold-brand text-black font-black text-xs rounded-xl uppercase tracking-widest">Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* Library Modal */}
      {showLibrary && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-md max-h-[85vh] overflow-y-auto p-6 shadow-2xl">
            <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-violet-400" />
                <h3 className="text-sm font-black text-white uppercase tracking-wider font-display">Library Services</h3>
              </div>
              <button onClick={() => setShowLibrary(false)} className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors"><X className="w-5 h-5" /></button>
            </div>

            <p className="text-xs text-zinc-500 mb-4 font-bold uppercase tracking-wider">Select how many of each:</p>

            <div className="space-y-3">
              {products.filter(p => p.category === 'Library').length > 0 ? (
                products.filter(p => p.category === 'Library').map(product => {
                  const qty = libraryQtys[product.id] || 0;
                  return (
                    <div key={product.id} className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4">
                      <div className="flex justify-between items-center mb-3">
                        <div>
                          <h4 className="text-sm font-bold text-white uppercase">{product.name}</h4>
                          <p className="text-xs text-gold-brand font-black mt-0.5">{formatCurrency(product.price)} each</p>
                        </div>
                        {qty > 0 && (
                          <span className="text-sm font-black text-gold-brand">{formatCurrency(qty * product.price)}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 bg-zinc-950 rounded-xl p-1">
                          {[1, 2, 3, 5, 10].map(n => (
                            <button key={n} onClick={() => setLibraryQtys(prev => ({ ...prev, [product.id]: prev[product.id] === n ? 0 : n }))}
                              className={`min-w-[36px] h-9 rounded-lg text-xs font-bold transition-all ${qty === n ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}>
                              {n}
                            </button>
                          ))}
                        </div>
                        <button onClick={() => {
                          const input = prompt('How many?', String(qty || 1));
                          const num = parseInt(input || '0', 10);
                          if (num > 0) setLibraryQtys(prev => ({ ...prev, [product.id]: num }));
                        }}
                          className="h-9 px-3 rounded-lg bg-zinc-800 text-zinc-400 hover:text-white text-xs font-bold transition-all">
                          +
                        </button>
                        {qty > 0 && (
                          <button onClick={() => setLibraryQtys(prev => ({ ...prev, [product.id]: 0 }))}
                            className="h-9 px-2 rounded-lg text-rose-400 hover:bg-rose-950/30 text-xs font-bold transition-all">
                            x
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-8">
                  <BookOpen className="w-10 h-10 text-zinc-600 mx-auto mb-2" />
                  <p className="text-xs text-zinc-500 font-bold uppercase">No Library products found</p>
                  <p className="text-[10px] text-zinc-600 mt-1">Add Library-category products in Stock first</p>
                </div>
              )}
            </div>

            <div className="mt-6 pt-4 border-t border-white/5 space-y-3">
              {(() => {
                const grandTotal = Object.entries(libraryQtys).reduce((sum, [id, qty]) => {
                  const p = products.find(p => p.id === id);
                  return sum + (p ? qty * p.price : 0);
                }, 0);
                const totalItems = Object.values(libraryQtys).reduce((s, v) => s + v, 0);
                return (
                  <>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-zinc-400 font-bold uppercase">Total Items</span>
                      <span className="text-sm font-black text-white">{totalItems}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-zinc-400 font-bold uppercase">Grand Total</span>
                      <span className="text-xl font-black text-gold-brand">{formatCurrency(grandTotal)}</span>
                    </div>
                    <button onClick={() => {
                      let added = 0;
                      Object.entries(libraryQtys).forEach(([id, qty]) => {
                        if (qty <= 0) return;
                        const product = products.find(p => p.id === id);
                        if (!product) return;
                        setCart(prev => {
                          const existing = prev.find(item => item.productId === id);
                          if (existing) {
                            return prev.map(item =>
                              item.productId === id
                                ? { ...item, qty: item.qty + qty, lineTotal: (item.qty + qty) * item.unitPrice }
                                : item
                            );
                          }
                          return [...prev, {
                            productId: id,
                            productName: product.name,
                            qty,
                            unitPrice: product.price,
                            unitCost: product.cost,
                            lineTotal: qty * product.price,
                          }];
                        });
                        added += qty;
                      });
                      if (added > 0) {
                        setLibraryQtys({});
                        setShowLibrary(false);
                        triggerToast(`Added ${added} library items to cart`, 'success');
                      } else {
                        triggerToast('Select at least one item', 'error');
                      }
                    }}
                      disabled={totalItems === 0}
                      className={`w-full h-12 rounded-2xl text-sm font-black uppercase tracking-widest transition-all active:scale-95 ${
                        totalItems > 0
                          ? 'bg-violet-600 text-white hover:bg-violet-500 shadow-lg'
                          : 'bg-zinc-800 text-zinc-600 cursor-not-allowed opacity-50'
                      }`}>
                      Add {totalItems > 0 ? `${totalItems} items to cart` : 'to cart'}
                    </button>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Cash Transfer Modal */}
      {showTransfers && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 shadow-2xl">
            <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-sky-400" />
                <h3 className="text-sm font-black text-white uppercase tracking-wider font-display">Cash Transfers</h3>
              </div>
              <button onClick={() => setShowTransfers(false)} className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-3 mb-6">
              <p className="text-xs text-zinc-500 font-bold uppercase tracking-wider">Record a transfer</p>
              <p className="text-[10px] text-zinc-600">Borrowed change from another drawer? Log it here so you remember to pay it back.</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">From (lender)</label>
                  <select value={transferFrom} onChange={(e) => setTransferFrom(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl h-10 px-2 text-xs outline-none font-bold">
                    <option value="">Select drawer...</option>
                    {categories.filter(c => c !== transferTo).map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">To (borrower)</label>
                  <select value={transferTo} onChange={(e) => setTransferTo(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl h-10 px-2 text-xs outline-none font-bold">
                    <option value="">Select drawer...</option>
                    {categories.filter(c => c !== transferFrom).map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">Amount</label>
                <input type="number" placeholder="e.g. 600" value={transferAmt}
                  onChange={(e) => setTransferAmt(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-gold-brand font-black rounded-xl h-11 px-3 text-sm outline-none focus:border-sky-500" />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[500, 1000, 2000, 5000, 10000, 20000].map(amt => (
                    <button key={amt} onClick={() => setTransferAmt(String(amt))}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${transferAmt === String(amt) ? 'bg-sky-600 text-black border-sky-500' : 'bg-zinc-900 text-zinc-400 border-zinc-800'}`}>
                      {amt >= 1000 ? `${(amt/1000).toFixed(0)}K` : amt}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">Reason</label>
                <input type="text" placeholder="e.g. Change for customer" value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs outline-none focus:border-sky-500" />
              </div>
              <button onClick={handleRecordTransfer}
                className="w-full h-11 bg-sky-600 hover:bg-sky-500 text-white font-black uppercase tracking-widest text-xs rounded-xl transition-all active:scale-95 shadow-lg flex items-center justify-center gap-2">
                <ArrowRightLeft className="w-4 h-4" /> Record Transfer
              </button>
            </div>

            <div className="border-t border-white/5 pt-4 space-y-3">
              <div className="flex justify-between items-center">
                <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Outstanding Transfers</p>
                <span className="text-xs font-black text-sky-400">
                  {formatCurrency(transfers.filter(t => !t.settledAt).reduce((s, t) => s + t.amount, 0))}
                </span>
              </div>
              {transfers.filter(t => !t.settledAt).length === 0 ? (
                <p className="text-xs text-zinc-500 text-center py-4 font-bold uppercase tracking-wider">All settled — no outstanding transfers</p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {/* Group by owing category */}
                  {(() => {
                    const grouped: Record<string, CashTransfer[]> = {};
                    transfers.filter(t => !t.settledAt).forEach(t => {
                      if (!grouped[t.toCategory]) grouped[t.toCategory] = [];
                      grouped[t.toCategory].push(t);
                    });
                    return Object.entries(grouped).map(([cat, items]) => {
                      const totalOwed = items.reduce((s, t) => s + t.amount, 0);
                      return (
                        <div key={cat}>
                          <div className="flex justify-between items-center px-1 py-1.5">
                            <span className="text-xs font-black text-white uppercase">{cat} owes</span>
                            <span className="text-xs font-black text-rose-400">{formatCurrency(totalOwed)}</span>
                          </div>
                          {items.map(t => (
                            <div key={t.id} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3 flex items-center justify-between ml-3 mb-1.5">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold text-sky-400">{formatCurrency(t.amount)}</span>
                                  <span className="text-[10px] text-zinc-500">from {t.fromCategory}</span>
                                </div>
                                <p className="text-[10px] text-zinc-500 mt-0.5 truncate">
                                  {t.reason} • {new Date(t.createdAt).toLocaleDateString()}
                                </p>
                              </div>
                              <button onClick={() => handleSettleTransfer(t.id)}
                                className="ml-2 px-3 py-1.5 bg-emerald-600/20 text-emerald-400 border border-emerald-600/30 rounded-lg text-[10px] font-bold hover:bg-emerald-600/30 active:scale-95 transition-all shrink-0">
                                Settle
                              </button>
                            </div>
                          ))}
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
              {transfers.filter(t => t.settledAt).length > 0 && (
                <details className="border-t border-white/5 pt-3">
                  <summary className="text-[10px] text-zinc-600 font-bold uppercase tracking-wider cursor-pointer hover:text-zinc-400">
                    Settled ({transfers.filter(t => t.settledAt).length})
                  </summary>
                  <div className="space-y-1.5 mt-2">
                    {transfers.filter(t => t.settledAt).slice(0, 10).map(t => (
                      <div key={t.id} className="flex justify-between items-center text-[10px] text-zinc-600 px-1">
                        <span>{formatCurrency(t.amount)} {t.fromCategory}→{t.toCategory}</span>
                        <span className="text-emerald-600">Settled</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Quick Expense Modal */}
      {showQuickExpense && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4">
              <h3 className="text-sm font-black text-white uppercase tracking-wider font-display flex items-center gap-2">
                <Wallet className="w-4 h-4 text-emerald-400" /> Quick Expense
              </h3>
              <button onClick={() => { setShowQuickExpense(false); setExpenseBatchMode(false); }} className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              {!expenseBatchMode ? (
                <>
                  <div>
                    <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">What for?</label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {['Stock Purchase', 'Transport', 'Utilities', 'Labor', 'Supplies', 'Rent'].map(s => (
                        <button key={s} onClick={() => setExpenseDesc(s)}
                          className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${expenseDesc === s ? 'bg-emerald-600 text-black border-emerald-500' : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-600'}`}>
                          {s}
                        </button>
                      ))}
                      <button onClick={() => setExpenseDesc('')}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${expenseDesc && !['Stock Purchase', 'Transport', 'Utilities', 'Labor', 'Supplies', 'Rent'].includes(expenseDesc) ? 'bg-emerald-600 text-black border-emerald-500' : 'bg-zinc-900 text-zinc-400 border-zinc-800'}`}>
                        Other
                      </button>
                    </div>
                    <input type="text" placeholder="Custom description..." value={expenseDesc}
                      onChange={(e) => setExpenseDesc(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-emerald-500 outline-none" />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">Category</label>
                    <select value={expenseCat} onChange={(e) => setExpenseCat(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl h-10 px-2 text-xs outline-none font-bold">
                      {expenseCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <div className="bg-amber-950/20 border border-amber-500/20 rounded-xl p-3">
                    <label className="text-xs text-amber-400 font-bold uppercase mb-1.5 block">Batch Costing — Eatery Items</label>
                    <p className="text-[10px] text-zinc-500 mb-2">Log ingredient cost for a batch and see if you're making profit.</p>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">Product Made</label>
                    <select value={expenseBatchProductId} onChange={(e) => setExpenseBatchProductId(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 text-gold-brand rounded-xl h-10 px-2 text-xs outline-none font-bold">
                      <option value="">Select product...</option>
                      {products.filter(p => p.category === 'Eatery' || p.category === 'Custom').map(p => (
                        <option key={p.id} value={p.id}>{p.name} — Sell: {formatCurrency(p.price)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">Total Ingredient Cost</label>
                      <input type="number" placeholder="e.g. 30000" value={expenseAmt}
                        onChange={(e) => setExpenseAmt(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs outline-none focus:border-emerald-500" />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">Units Produced</label>
                      <input type="number" placeholder="e.g. 100" value={expenseBatchUnits}
                        onChange={(e) => setExpenseBatchUnits(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs outline-none focus:border-emerald-500" />
                    </div>
                  </div>
                  {expenseBatchProductId && parseFloat(expenseAmt) > 0 && parseInt(expenseBatchUnits) > 0 && (
                    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2">
                      {(() => {
                        const totalCost = parseFloat(expenseAmt);
                        const units = parseInt(expenseBatchUnits);
                        const perUnit = Math.round(totalCost / units);
                        const product = products.find(p => p.id === expenseBatchProductId);
                        const sellPrice = product?.price || 0;
                        const profitPerUnit = sellPrice - perUnit;
                        const marginPct = sellPrice > 0 ? Math.round((profitPerUnit / sellPrice) * 100) : 0;
                        return (
                          <>
                            <div className="flex justify-between text-xs">
                              <span className="text-zinc-400">Cost per unit</span>
                              <span className="font-bold text-white">{formatCurrency(perUnit)}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-zinc-400">Selling price</span>
                              <span className="font-bold text-gold-brand">{formatCurrency(sellPrice)}</span>
                            </div>
                            <div className="border-t border-zinc-800 pt-2 flex justify-between text-xs">
                              <span className="text-zinc-400">Profit per unit</span>
                              <span className={`font-black ${profitPerUnit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {profitPerUnit >= 0 ? '+' : ''}{formatCurrency(profitPerUnit)}
                              </span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-zinc-400">Margin</span>
                              <span className={`font-black ${marginPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {profitPerUnit >= 0 ? '+' : ''}{marginPct}%
                              </span>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">Amount (UGX)</label>
                <input type="number" placeholder="0" value={expenseAmt} onChange={(e) => setExpenseAmt(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-gold-brand font-black text-right rounded-xl h-12 px-4 text-sm outline-none focus:border-emerald-500" />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[2000, 5000, 10000, 20000, 50000, 100000].map(amt => (
                    <button key={amt} onClick={() => setExpenseAmt(String(amt))}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${expenseAmt === String(amt) ? 'bg-emerald-600 text-black border-emerald-500' : 'bg-zinc-900 text-zinc-400 border-zinc-800'}`}>
                      {amt >= 1000 ? `${(amt/1000).toFixed(0)}K` : amt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                {!expenseBatchMode && (
                  <button onClick={() => setExpenseBatchMode(true)}
                    className="text-[10px] text-amber-400 font-bold uppercase tracking-wider hover:underline flex items-center gap-1">
                    <ChefHat className="w-3 h-3" /> Batch costing for eatery?
                  </button>
                )}
              </div>

              <button onClick={handleQuickExpense}
                className="w-full h-12 bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest text-sm rounded-xl transition-all active:scale-95 shadow-lg flex items-center justify-center gap-2">
                <Wallet className="w-4 h-4" /> Log Expense
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Food Cost & Profit Analyzer Modal */}
      {showFoodCost && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6 shadow-2xl">
            <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4">
              <div className="flex items-center gap-2">
                <ChefHat className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-black text-white uppercase tracking-wider font-display">Profit Analyzer</h3>
              </div>
              <button onClick={() => setShowFoodCost(false)} className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-zinc-500 font-bold uppercase tracking-wider">Per-Product Profitability</p>
              {products.filter(p => p.category === 'Eatery').sort((a, b) => {
                const marginA = a.price > 0 ? ((a.price - a.cost) / a.price) * 100 : -Infinity;
                const marginB = b.price > 0 ? ((b.price - b.cost) / b.price) * 100 : -Infinity;
                return marginA - marginB;
              }).map(product => {
                const profitPerUnit = product.price - product.cost;
                const marginPct = product.price > 0 ? (profitPerUnit / product.price) * 100 : 0;
                const isLoss = profitPerUnit <= 0;
                const totalSold = cart.filter(c => c.productId === product.id).reduce((s, c) => s + c.qty, 0);

                return (
                  <div key={product.id} className={`bg-zinc-900/50 border rounded-2xl p-4 ${isLoss ? 'border-rose-500/30 bg-rose-950/10' : 'border-zinc-800'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${isLoss ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}`}></span>
                        <h4 className="text-sm font-bold text-white uppercase">{product.name}</h4>
                        <span className="text-[10px] text-zinc-500">{product.category}</span>
                      </div>
                      {totalSold > 0 && (
                        <span className="text-[10px] text-gold-brand font-bold">{totalSold} in cart</span>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-3">
                      <div>
                        <p className="text-[10px] text-zinc-500 uppercase font-bold">Cost</p>
                        <p className="text-xs font-black text-zinc-300">{formatCurrency(product.cost)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-500 uppercase font-bold">Price</p>
                        <p className="text-xs font-black text-gold-brand">{formatCurrency(product.price)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-500 uppercase font-bold">Profit</p>
                        <p className={`text-xs font-black ${isLoss ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {isLoss ? '-' : '+'}{formatCurrency(Math.abs(profitPerUnit))}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-500 uppercase font-bold">Margin</p>
                        <p className={`text-xs font-black ${isLoss ? 'text-rose-400' : marginPct < 20 ? 'text-amber-400' : 'text-emerald-400'}`}>
                          {marginPct.toFixed(0)}%
                        </p>
                      </div>
                    </div>
                    {isLoss && (
                      <p className="text-[10px] text-rose-400 font-bold mt-2 uppercase tracking-wider">Selling at a loss! Increase price or reduce ingredient cost.</p>
                    )}
                    {marginPct > 0 && marginPct < 20 && (
                      <p className="text-[10px] text-amber-400 font-bold mt-2 uppercase tracking-wider">Low margin — consider raising price or reducing costs.</p>
                    )}
                  </div>
                );
              })}
              {products.filter(p => p.category === 'Eatery').length === 0 && (
                <div className="text-center py-8">
                  <ChefHat className="w-10 h-10 text-zinc-600 mx-auto mb-2" />
                  <p className="text-xs text-zinc-500 font-bold uppercase">No eatery products found</p>
                  <p className="text-[10px] text-zinc-600 mt-1">Add products with category "Eatery" in Stock to see profit analysis</p>
                </div>
              )}
            </div>

            <div className="mt-6 pt-4 border-t border-white/5">
              <p className="text-[10px] text-zinc-600 leading-relaxed">
                <strong className="text-zinc-400">Tip:</strong> Use the <span className="text-emerald-400">Expense → Batch Costing</span> tool to log ingredient purchases and calculate per-unit costs.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Clear Cart Confirmation */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-sm p-6 shadow-2xl">
            <h3 className="text-sm font-black text-white uppercase tracking-wider text-center mb-2">Clear Cart?</h3>
            <p className="text-xs text-zinc-400 text-center mb-4">This will remove all {cart.reduce((s, i) => s + i.qty, 0)} items from the cart.</p>
            <div className="flex gap-2">
              <button onClick={() => setShowClearConfirm(false)}
                className="flex-1 h-11 border border-zinc-800 text-zinc-400 font-bold text-xs rounded-xl uppercase tracking-wider">Cancel</button>
              <button onClick={() => { setCart([]); setShowClearConfirm(false); }}
                className="flex-1 h-11 bg-rose-600 text-white font-black text-xs rounded-xl uppercase tracking-widest">Clear</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}