import React, { useState, useMemo } from 'react';
import { 
  Search, 
  Plus, 
  Minus, 
  Trash2, 
  ShoppingCart, 
  Utensils, 
  Scissors, 
  Printer, 
  BookOpen, 
  Activity, 
  Palette, 
  Film, 
  Radio, 
  Check, 
  Tag,
  Coins,
  Smartphone,
  UserCheck,
  X,
  Zap,
  Percent,
  User
} from 'lucide-react';
import { Product, Sale, SaleItem, StoreSettings } from '../types';

interface SalesProps {
  products: Product[];
  sales: Sale[];
  onAddSale: (sale: Sale) => void;
  formatCurrency: (val: number) => string;
  cart: SaleItem[];
  setCart: React.Dispatch<React.SetStateAction<SaleItem[]>>;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  settings?: StoreSettings;
  onUpdateSettings?: React.Dispatch<React.SetStateAction<StoreSettings>>;
}

const getNextOrderNumber = () => {
  const key = 'boss_pos_order_counter';
  const current = parseInt(localStorage.getItem(key) || '8492', 10);
  const next = current + 1;
  localStorage.setItem(key, String(next));
  return `Order #${next}`;
};

const CATEGORIES_MAP: Record<string, { icon: React.ReactNode; label: string }> = {
  'Electronics': { icon: <Radio className="w-5 h-5 text-gold-brand" />, label: 'Electronics' },
  'Eatery': { icon: <Utensils className="w-5 h-5 text-gold-brand" />, label: 'Eatery' },
  'Stationery': { icon: <BookOpen className="w-5 h-5 text-gold-brand" />, label: 'Stationery' },
  'Printing': { icon: <Printer className="w-5 h-5 text-gold-brand" />, label: 'Printing' },
  'Tailoring': { icon: <Scissors className="w-5 h-5 text-gold-brand" />, label: 'Tailoring' },
  'Library': { icon: <Film className="w-5 h-5 text-gold-brand" />, label: 'Library' },
  'Sports': { icon: <Activity className="w-5 h-5 text-gold-brand" />, label: 'Sports' },
  'Graphics': { icon: <Palette className="w-5 h-5 text-gold-brand" />, label: 'Graphics' },
};

export default function Sales({
  products,
  sales,
  onAddSale,
  formatCurrency,
  cart,
  setCart,
  triggerToast,
  settings,
  onUpdateSettings
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
  const [customerName, setCustomerName] = useState<string>('');
  const [discount, setDiscount] = useState<string>('');

  const [customItemName, setCustomItemName] = useState<string>('');
  const [customItemPrice, setCustomItemPrice] = useState<string>('');
  const [customCashReceived, setCustomCashReceived] = useState<string>('');

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
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
      category: 'Custom',
      cost: Math.round(priceNum * 0.5),
      price: priceNum,
      stockQty: 9999,
      lowStockThreshold: 0
    };
    handleAddToCart(fakeProduct);
    setCustomItemName('');
    setCustomItemPrice('');
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
  const discountNum = parseFloat(discount) || 0;
  const total = Math.max(0, subtotal - discountNum);
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



  const categories = Object.keys(CATEGORIES_MAP);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 relative lg:h-[calc(100vh-140px)] lg:overflow-hidden pb-2" id="sales-tab-content">
      
      {/* LEFT COLUMN */}
      <div className="lg:col-span-8 flex flex-col h-full lg:overflow-hidden space-y-3">
        
        {/* Mode Toggle + Search Bar */}
        <div className="flex gap-2 items-center">
          <button
            onClick={() => setIsQuickSale(false)}
            className={`shrink-0 h-12 px-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all border ${
              !isQuickSale
                ? 'bg-gold-brand text-black border-gold-brand'
                : 'bg-[#141414] text-zinc-400 border-white/5 hover:border-white/10'
            }`}
          >
            Catalog
          </button>
          <button
            onClick={() => setIsQuickSale(true)}
            className={`shrink-0 h-12 px-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all border flex items-center gap-1.5 ${
              isQuickSale
                ? 'bg-gold-brand text-black border-gold-brand'
                : 'bg-[#141414] text-zinc-400 border-white/5 hover:border-white/10'
            }`}
          >
            <Zap className="w-4 h-4" /> Quick Sale
          </button>
        </div>

        {isQuickSale ? (
          /* QUICK SALE MODE: search products, add to cart fast */
          <div className="flex-1 flex flex-col space-y-3">
            <div className="relative">
              <input
                type="text"
                placeholder="Type product name... (e.g. charger, case, earphones)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="w-full bg-[#141414] border border-gold-brand/40 text-gold-light focus:border-gold-brand h-14 pl-12 pr-4 rounded-xl text-base outline-none"
              />
              <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-gold-brand" />
            </div>

            {/* Search results */}
            {searchQuery && (
              <div className="boss-card p-2 max-h-[200px] overflow-y-auto">
                {filteredProducts.slice(0, 8).map(product => {
                  const inCart = cart.find(c => c.productId === product.id);
                  const isOut = product.stockQty <= 0 && !product.isService;
                  return (
                    <button
                      key={product.id}
                      onClick={() => !isOut && handleAddToCart(product)}
                      disabled={isOut}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all text-left ${
                        isOut ? 'opacity-30 cursor-not-allowed' : 'hover:bg-[#0A0A0A] active:scale-[0.99]'
                      } ${inCart ? 'bg-gold-brand/5 border border-gold-brand/20' : ''}`}
                    >
                      <div>
                        <p className="text-sm font-bold text-white uppercase">{product.name}</p>
                        <p className="text-[10px] text-zinc-500 font-bold uppercase mt-0.5">
                          {product.category} • {formatCurrency(product.price)}
                          {!product.isService && ` • Stock: ${product.stockQty}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {inCart && <span className="text-xs font-black text-gold-brand">x{inCart.qty}</span>}
                        <div className="w-8 h-8 bg-gold-brand text-black rounded-lg flex items-center justify-center font-black text-lg">
                          +
                        </div>
                      </div>
                    </button>
                  );
                })}
                {filteredProducts.length === 0 && (
                  <div className="p-6 text-center">
                    <p className="text-sm text-zinc-500 font-bold uppercase">No products match "{searchQuery}"</p>
                  </div>
                )}
              </div>
            )}

            {/* Quick cart: items added so far */}
            {cart.length > 0 && (
              <div className="boss-card p-3 flex-1 overflow-y-auto space-y-2">
                <div className="flex justify-between items-center pb-2 border-b border-white/5">
                  <p className="text-xs font-black text-gold-brand uppercase tracking-wider">
                    Cart ({cart.reduce((s, i) => s + i.qty, 0)} items)
                  </p>
                  <button onClick={() => setCart([])} className="text-[10px] text-zinc-500 hover:text-rose-400 uppercase font-bold">Clear</button>
                </div>
                {cart.map(item => (
                  <div key={item.productId} className="flex items-center justify-between bg-[#0A0A0A] border border-white/5 p-3 rounded-xl">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-white uppercase truncate">{item.productName}</p>
                      <p className="text-sm font-black text-gold-brand mt-0.5">{formatCurrency(item.lineTotal)}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => handleAdjustQty(item.productId, -1)} className="w-11 h-11 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 rounded-xl flex items-center justify-center text-lg font-bold">-</button>
                      <span className="text-sm font-black text-white px-1 min-w-[24px] text-center">{item.qty}</span>
                      <button onClick={() => handleAdjustQty(item.productId, 1)} className="w-11 h-11 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 rounded-xl flex items-center justify-center text-lg font-bold">+</button>
                      <button onClick={() => handleRemoveItem(item.productId)} className="w-11 h-11 bg-rose-950/20 hover:bg-rose-950/40 text-rose-400 rounded-xl flex items-center justify-center text-lg font-bold">x</button>
                    </div>
                  </div>
                ))}

                <div className="pt-3 border-t border-white/5 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-sm font-bold text-zinc-400 uppercase">Total</span>
                    <span className="text-lg font-black text-gold-brand">{formatCurrency(total)}</span>
                  </div>

                  <div className="grid grid-cols-4 gap-1.5">
                    {['Cash', 'MTN MoMo', 'Airtel Money', 'Credit / Book'].map(name => (
                      <button key={name} onClick={() => setPaymentMethod(name as any)}
                        className={`py-3 rounded-xl text-xs border font-black uppercase transition-all min-h-[44px] ${
                          paymentMethod === name ? 'border-gold-brand bg-gold-brand/10 text-white' : 'border-zinc-800 text-zinc-500 hover:border-zinc-600'
                        }`}>
                        {name === 'Credit / Book' ? 'Credit' : name === 'MTN MoMo' ? 'MTN' : name === 'Airtel Money' ? 'Airtel' : name}
                      </button>
                    ))}
                  </div>

                  <input type="text" placeholder="Customer name (optional)" value={customerName} onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full bg-[#0A0A0A] border border-white/5 text-gold-light rounded-xl h-10 px-3 text-sm outline-none focus:border-gold-brand" />

                  {paymentMethod === 'Cash' && (
                    <div className="bg-[#0A0A0A] border border-white/5 p-3 rounded-xl space-y-2">
                      <input type="number" placeholder="Cash received" value={customCashReceived} onChange={(e) => setCustomCashReceived(e.target.value)}
                        className="w-full bg-[#141414] border border-white/5 text-gold-brand font-black text-right rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-brand h-10" />
                      {customCashReceived && (
                        <div className="flex justify-between items-center">
                          {parseFloat(customCashReceived) >= total ? (
                            <><span className="text-xs text-emerald-400 font-bold uppercase">Change:</span><span className="text-sm font-black text-emerald-400">{formatCurrency(parseFloat(customCashReceived) - total)}</span></>
                          ) : (
                            <><span className="text-xs text-amber-500 font-bold uppercase">Still need:</span><span className="text-sm font-black text-amber-500">{formatCurrency(total - parseFloat(customCashReceived))}</span></>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <button onClick={handleCompleteSale}
                    disabled={cart.length === 0 || (paymentMethod === 'Cash' && customCashReceived !== '' && parseFloat(customCashReceived) < total)}
                    className={`w-full h-14 rounded-2xl text-sm font-black uppercase tracking-widest transition-all active:scale-95 ${
                      cart.length > 0 && !(paymentMethod === 'Cash' && customCashReceived !== '' && parseFloat(customCashReceived) < total)
                        ? 'bg-gold-brand text-black shadow-[0_4px_20px_rgba(255,204,0,0.3)]'
                        : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                    }`}>
                    Complete Sale
                  </button>
                </div>
              </div>
            )}

            {cart.length === 0 && !searchQuery && (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <Zap className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
                  <p className="text-sm text-zinc-500 font-black uppercase tracking-wider">Type item name above</p>
                  <p className="text-xs text-zinc-600 mt-1">Search and tap to add items fast</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* CATALOG MODE (existing flow) */
          <>
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
            <section className="flex gap-2 overflow-x-auto pb-1.5 scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
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
                const catInfo = CATEGORIES_MAP[cat] || { icon: <Tag className="w-5 h-5" />, label: cat };
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
                    <span className="shrink-0">{catInfo.icon}</span>
                    <span className="text-sm uppercase tracking-wider">{catInfo.label}</span>
                  </button>
                );
              })}
            </section>

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

                    return (
                      <div 
                        key={product.id}
                        onClick={() => !isOutOfStock && handleAddToCart(product)}
                        className={`boss-card p-3 flex flex-col justify-between min-h-[160px] cursor-pointer relative overflow-hidden active:scale-[0.98] transition-all ${
                          isOutOfStock 
                            ? 'opacity-40 cursor-not-allowed border-dashed border-rose-800/40' 
                            : cartItem
                            ? 'border-gold-brand bg-gold-brand/10 shadow-[0_0_15px_rgba(255,204,0,0.15)]'
                            : 'hover:border-gold-brand/30'
                        }`}
                      >
                        <div className="flex justify-between items-start gap-1.5">
                          <div className="w-9 h-9 bg-[#0A0A0A] border border-white/5 rounded-lg overflow-hidden shrink-0 flex items-center justify-center">
                            {product.imageUrl ? (
                              <img referrerPolicy="no-referrer" src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-gold-brand text-xs font-bold">{product.category[0]}</span>
                            )}
                          </div>
                          
                          {isOutOfStock ? (
                            <span className="text-xs bg-rose-950 text-rose-300 font-bold px-2 py-1 border border-rose-800/30 rounded-lg uppercase tracking-wider">SOLD OUT</span>
                          ) : isLowStock ? (
                            <span className="text-xs bg-amber-950 text-amber-300 font-bold px-2 py-1 border border-amber-800/30 rounded-lg uppercase tracking-wider animate-pulse">LOW ({product.stockQty})</span>
                          ) : (
                            !product.isService && (
                              <span className="text-xs text-zinc-500 font-bold uppercase tracking-wider">Stock: {product.stockQty}</span>
                            )
                          )}
                        </div>

                        <div className="mt-2">
                          <h3 className="text-sm font-bold text-white uppercase tracking-wide line-clamp-2 leading-snug min-h-[40px]">
                            {product.name}
                          </h3>
                          <div className="flex items-center justify-between mt-1.5">
                            <p className="text-lg font-black text-gold-brand font-display">
                              {formatCurrency(product.price)}
                            </p>
                            {cartItem ? (
                              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                <button onClick={() => handleAdjustQty(product.id, -1)} className="w-11 h-11 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-lg font-bold flex items-center justify-center transition-all active:scale-90">-</button>
                                <span className="text-sm font-black text-white px-1 min-w-[24px] text-center font-mono">{cartItem.qty}</span>
                                <button onClick={() => handleAdjustQty(product.id, 1)} className="w-11 h-11 rounded-xl bg-gold-brand hover:bg-gold-medium text-black text-lg font-black flex items-center justify-center transition-all active:scale-90">+</button>
                              </div>
                            ) : (
                              <button 
                                disabled={isOutOfStock}
                                onClick={(e) => { e.stopPropagation(); handleAddToCart(product); }}
                                className="w-11 h-11 rounded-xl flex items-center justify-center transition-all active:scale-90 bg-zinc-800 hover:bg-gold-brand text-zinc-400 hover:text-black"
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
          </>
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
              <button onClick={() => setCart([])} className="text-xs text-zinc-500 hover:text-rose-400 uppercase font-bold flex items-center gap-1.5 transition-colors">
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
                    <span className="text-sm font-bold text-white uppercase tracking-wide truncate max-w-[180px]">{item.productName}</span>
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
                <label className="text-xs text-zinc-400 font-bold uppercase flex items-center gap-1.5">
                  <Percent className="w-3.5 h-3.5" /> Discount (UGX)
                </label>
                <input
                  type="number"
                  placeholder="0"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  className="w-full bg-[#141414] border border-white/5 text-gold-brand font-bold rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-brand h-10"
                />
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
              onClick={handleCompleteSale}
              disabled={cart.length === 0 || (paymentMethod === 'Cash' && customCashReceived !== '' && parseFloat(customCashReceived) < total)}
              className={`w-full h-14 rounded-2xl text-sm font-black uppercase tracking-widest transition-all active:scale-95 ${
                cart.length > 0 && !(paymentMethod === 'Cash' && customCashReceived !== '' && parseFloat(customCashReceived) < total)
                  ? 'bg-gold-brand text-black hover:bg-gold-medium shadow-[0_4px_15px_rgba(255,204,0,0.25)]' 
                  : 'bg-zinc-800 text-zinc-600 cursor-not-allowed opacity-50'
              }`}
            >
              Complete Sale
            </button>
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
                  <h4 className="text-sm font-bold text-white uppercase truncate max-w-[160px]">{item.productName}</h4>
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
            <button onClick={handleCompleteSale}
              disabled={cart.length === 0 || (paymentMethod === 'Cash' && customCashReceived !== '' && parseFloat(customCashReceived) < total)}
              className={`w-full h-14 rounded-2xl text-sm font-black uppercase tracking-widest transition-all active:scale-95 ${
                cart.length > 0 && !(paymentMethod === 'Cash' && customCashReceived !== '' && parseFloat(customCashReceived) < total)
                  ? 'bg-gold-brand text-black shadow-[0_4px_20px_rgba(255,204,0,0.3)]' 
                  : 'bg-zinc-800 text-zinc-600 cursor-not-allowed opacity-50'
              }`}>
              Complete Sale
            </button>
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
    </div>
  );
}