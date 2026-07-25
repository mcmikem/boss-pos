import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  LayoutGrid, ShoppingCart, Package, TrendingUp, Menu, Globe, Settings, X, Palette
} from 'lucide-react';
import { Product, Sale, Expense, Supplier, SaleItem, AppTheme, StoreSettings } from './types';
import { productApi, supplierApi, saleApi, expenseApi, settingsApi } from './api';

import Dashboard from './components/Dashboard';
import Sales from './components/Sales';
import Inventory from './components/Inventory';
import Analytics from './components/Analytics';
import Toast from './components/Toast';

export const THEMES: AppTheme[] = [
  { id: 'gold', name: 'Kampala Gold', brand: '#ffcc00', medium: '#f1c100', light: '#ffedc3' },
  { id: 'emerald', name: 'Nile Emerald', brand: '#10b981', medium: '#059669', light: '#a7f3d0' },
  { id: 'sapphire', name: 'Victoria Sapphire', brand: '#3b82f6', medium: '#2563eb', light: '#bfdbfe' },
  { id: 'ruby', name: 'Sunset Ruby', brand: '#f43f5e', medium: '#e11d48', light: '#fecdd3' },
  { id: 'amber', name: 'Equator Amber', brand: '#f97316', medium: '#ea580c', light: '#ffedd5' },
];

const DEFAULT_SETTINGS: StoreSettings = {
  shopName: 'IMAC Enterprises',
  themeId: 'gold',
  vibe: 'General Store',
  defaultPaymentMethod: 'Cash',
  dailyGoalNum: 10,
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'sales' | 'inventory' | 'analytics'>('sales');
  const [currency, setCurrency] = useState<'UGX' | 'USD'>('UGX');
  const [showSuppliers, setShowSuppliers] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const [settings, setSettings] = useState<StoreSettings>(DEFAULT_SETTINGS);
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [cart, setCart] = useState<SaleItem[]>([]);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'success' | 'error' | 'info'>('success');

  const triggerToast = (msg: string, type: 'success' | 'error' | 'info') => {
    setToastMessage(msg);
    setToastType(type);
  };

  useEffect(() => {
    Promise.all([
      settingsApi.get().then(setSettings).catch(() => {}),
      productApi.list().then(setProducts).catch(() => {}),
      supplierApi.list().then(setSuppliers).catch(() => {}),
      saleApi.list().then(setSales).catch(() => {}),
      expenseApi.list().then(setExpenses).catch(() => {}),
    ]).then(() => setLoading(false));
  }, []);

  useEffect(() => {
    settingsApi.update(settings).catch(() => {});
  }, [settings]);

  useEffect(() => {
    localStorage.setItem('boss_pos_cart', JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    if (loading) return;
    const cached = localStorage.getItem('boss_pos_cart');
    if (cached) {
      try { setCart(JSON.parse(cached)); } catch {}
    }
  }, [loading]);

  const formatCurrency = (ugxVal: number) => {
    if (currency === 'USD') {
      const usdVal = ugxVal / 3700;
      return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'USD',
        minimumFractionDigits: 2, maximumFractionDigits: 2
      }).format(usdVal);
    } else {
      return new Intl.NumberFormat('en-UG', {
        style: 'currency', currency: 'UGX',
        minimumFractionDigits: 0, maximumFractionDigits: 0
      }).format(ugxVal);
    }
  };

  const handleAddProduct = async (newProd: Product) => {
    setProducts(prev => [newProd, ...prev]);
    try { await productApi.create(newProd); } catch { triggerToast('Failed to save product', 'error'); }
  };

  const handleUpdateProduct = async (updatedProd: Product) => {
    setProducts(prev => prev.map(p => p.id === updatedProd.id ? updatedProd : p));
    try { await productApi.update(updatedProd); } catch { triggerToast('Failed to update product', 'error'); }
  };

  const handleDeleteProduct = async (productId: string) => {
    setProducts(prev => prev.filter(p => p.id !== productId));
    try { await productApi.remove(productId); } catch { triggerToast('Failed to delete product', 'error'); }
  };

  const handleAddSale = async (newSale: Sale) => {
    setSales(prev => [newSale, ...prev]);
    setProducts(prevProducts => {
      return prevProducts.map(prod => {
        const soldItem = newSale.items.find(item => item.productId === prod.id);
        if (soldItem && !prod.isService) {
          return { ...prod, stockQty: Math.max(0, prod.stockQty - soldItem.qty) };
        }
        return prod;
      });
    });
    try { await saleApi.create(newSale); } catch { triggerToast('Failed to save sale', 'error'); }
  };

  const handleRefundSale = async (saleId: string) => {
    const saleToRefund = sales.find(s => s.id === saleId);
    if (!saleToRefund) return;
    setSales(prev => prev.filter(s => s.id !== saleId));
    setProducts(prevProducts => {
      return prevProducts.map(prod => {
        const soldItem = saleToRefund.items.find(item => item.productId === prod.id);
        if (soldItem && !prod.isService) {
          return { ...prod, stockQty: prod.stockQty + soldItem.qty };
        }
        return prod;
      });
    });
    try { await saleApi.remove(saleId); } catch { triggerToast('Failed to refund sale', 'error'); }
    triggerToast(`${saleToRefund.orderNumber} refunded. Stock restored.`, 'info');
  };

  const handleAddExpense = async (newExpense: Expense) => {
    setExpenses(prev => [newExpense, ...prev]);
    try { await expenseApi.create(newExpense); } catch { triggerToast('Failed to save expense', 'error'); }
  };

  const handleAddSupplier = async (newSup: Supplier) => {
    setSuppliers(prev => [...prev, newSup]);
    try { await supplierApi.create(newSup); } catch { triggerToast('Failed to save supplier', 'error'); }
  };

  const handleUpdateSupplier = async (updatedSup: Supplier) => {
    setSuppliers(prev => prev.map(s => s.id === updatedSup.id ? updatedSup : s));
    try { await supplierApi.update(updatedSup); } catch { triggerToast('Failed to update supplier', 'error'); }
  };

  const handleDeleteSupplier = async (supplierId: string) => {
    setSuppliers(prev => prev.filter(s => s.id !== supplierId));
    setProducts(prev => prev.map(p => p.supplierId === supplierId ? { ...p, supplierId: undefined } : p));
    try { await supplierApi.remove(supplierId); } catch { triggerToast('Failed to delete supplier', 'error'); }
  };

  const handleRepeatLastSale = () => {
    if (sales.length === 0) return;
    const lastSale = sales[0];
    const itemsToLoad: SaleItem[] = lastSale.items.map(item => {
      const liveProduct = products.find(p => p.id === item.productId);
      const availableStock = liveProduct ? liveProduct.stockQty : 999;
      const finalQty = Math.min(item.qty, availableStock);
      return { ...item, qty: finalQty, lineTotal: finalQty * item.unitPrice };
    }).filter(item => item.qty > 0);
    if (itemsToLoad.length === 0) {
      triggerToast('Could not repeat last sale - all items are currently out of stock!', 'error');
      return;
    }
    setCart(itemsToLoad);
    setActiveTab('sales');
    triggerToast(`Loaded items from previous ${lastSale.orderNumber}`, 'success');
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <Dashboard 
            sales={sales} expenses={expenses} products={products}
            formatCurrency={formatCurrency} onNavigate={setActiveTab}
            onRepeatLastSale={handleRepeatLastSale} onRefundSale={handleRefundSale}
            settings={settings} onUpdateSettings={setSettings}
          />
        );
      case 'sales':
        return (
          <Sales 
            products={products} sales={sales} onAddSale={handleAddSale}
            formatCurrency={formatCurrency} cart={cart} setCart={setCart}
            triggerToast={triggerToast} settings={settings} onUpdateSettings={setSettings}
          />
        );
      case 'inventory':
        return (
          <Inventory 
            products={products} suppliers={suppliers}
            onAddProduct={handleAddProduct} onUpdateProduct={handleUpdateProduct}
            onDeleteProduct={handleDeleteProduct}
            formatCurrency={formatCurrency} triggerToast={triggerToast}
          />
        );
      case 'analytics':
        return (
          <Analytics 
            sales={sales} expenses={expenses} products={products}
            suppliers={suppliers} onAddExpense={handleAddExpense}
            onAddSupplier={handleAddSupplier} onUpdateSupplier={handleUpdateSupplier}
            onDeleteSupplier={handleDeleteSupplier}
            formatCurrency={formatCurrency} triggerToast={triggerToast}
            showSuppliers={showSuppliers} setShowSuppliers={setShowSuppliers}
          />
        );
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0A0A0A]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-gold-brand/20 border-t-gold-brand rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="flex flex-col min-h-screen pb-24 text-zinc-100 bg-[#0A0A0A] relative"
      style={{
        '--color-gold-brand': settings.themeId ? THEMES.find(t => t.id === settings.themeId)?.brand || '#ffcc00' : '#ffcc00',
        '--color-gold-medium': settings.themeId ? THEMES.find(t => t.id === settings.themeId)?.medium || '#f1c100' : '#f1c100',
        '--color-gold-light': settings.themeId ? THEMES.find(t => t.id === settings.themeId)?.light || '#ffedc3' : '#ffedc3',
      } as React.CSSProperties}
    >
      <header className="bg-[#141414] border-b border-white/5 sticky top-0 z-50 flex justify-between items-center px-4 py-3 h-16 w-full">
        <div className="flex items-center gap-3">
          <Menu className="w-5 h-5 text-gold-brand cursor-pointer hover:opacity-80 transition-opacity" />
          <h1 className="text-sm sm:text-base md:text-lg font-black text-gold-brand uppercase tracking-tighter font-display truncate max-w-[150px] sm:max-w-none">
            {settings.shopName}
          </h1>
          <span className="hidden sm:inline-block text-[8px] bg-gold-brand/10 text-gold-brand font-extrabold px-2 py-0.5 rounded-full uppercase tracking-widest font-sans">
            {settings.vibe}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-[#0A0A0A] border border-white/5 rounded-xl px-3 py-2 shrink-0 min-h-[40px]">
            <Globe className="w-4 h-4 text-zinc-500" />
            <select value={currency} onChange={(e) => setCurrency(e.target.value as any)}
              className="bg-transparent text-xs font-black text-gold-brand border-none focus:outline-none focus:ring-0 cursor-pointer uppercase tracking-wider" id="currency-selector">
              <option value="UGX" className="bg-[#141414]">UGX</option>
              <option value="USD" className="bg-[#141414]">USD</option>
            </select>
          </div>
          <button onClick={() => setIsSettingsOpen(true)} className="p-2 bg-[#0A0A0A] border border-white/5 hover:border-gold-brand/40 text-zinc-400 hover:text-gold-brand rounded-xl transition-all cursor-pointer shrink-0" title="Settings" id="settings-gear-btn">
            <Settings className="w-4 h-4" />
          </button>
          <div className="w-10 h-10 rounded-full border border-gold-brand overflow-hidden shrink-0 shadow-[0_0_10px_rgba(255,204,0,0.2)] flex items-center justify-center bg-gold-brand/10 text-gold-brand text-xs font-black">
            <span className="uppercase">IM</span>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 pt-4 max-w-7xl mx-auto w-full">
        {renderContent()}
      </main>

      <nav className="fixed bottom-0 inset-x-0 w-full z-40 flex justify-around items-center h-16 bg-[#141414]/95 backdrop-blur-md border-t border-white/5">
        <button onClick={() => setActiveTab('sales')} className={`flex flex-col items-center justify-center flex-1 h-full py-1 transition-all active:scale-95 ${activeTab === 'sales' ? 'text-gold-brand font-black' : 'text-zinc-500 hover:text-zinc-300'}`} id="sales-nav-btn">
          <div className="relative">
            <ShoppingCart className="w-5 h-5 mb-1" />
            {cart.length > 0 && (
              <span className="absolute -top-1.5 -right-2 bg-gold-brand text-black text-[8px] font-black w-4 h-4 rounded-full flex items-center justify-center border border-[#0F0F0F]">
                {cart.reduce((sum, item) => sum + item.qty, 0)}
              </span>
            )}
          </div>
          <span className="text-xs font-bold uppercase tracking-wider">Sell</span>
        </button>
        <button onClick={() => { setActiveTab('dashboard'); setShowSuppliers(false); }} className={`flex flex-col items-center justify-center flex-1 h-full py-1 transition-all active:scale-95 ${activeTab === 'dashboard' ? 'text-gold-brand font-black' : 'text-zinc-500 hover:text-zinc-300'}`} id="dashboard-nav-btn">
          <LayoutGrid className="w-5 h-5 mb-1" />
          <span className="text-xs font-bold uppercase tracking-wider">Today</span>
        </button>
        <button onClick={() => setActiveTab('inventory')} className={`flex flex-col items-center justify-center flex-1 h-full py-1 transition-all active:scale-95 ${activeTab === 'inventory' ? 'text-gold-brand font-black' : 'text-zinc-500 hover:text-zinc-300'}`} id="inventory-nav-btn">
          <Package className="w-5 h-5 mb-1" />
          <span className="text-xs font-bold uppercase tracking-wider">Stock</span>
        </button>
        <button onClick={() => { setActiveTab('analytics'); setShowSuppliers(false); }} className={`flex flex-col items-center justify-center flex-1 h-full py-1 transition-all active:scale-95 ${activeTab === 'analytics' ? 'text-gold-brand font-black' : 'text-zinc-500 hover:text-zinc-300'}`} id="analytics-nav-btn">
          <TrendingUp className="w-5 h-5 mb-1" />
          <span className="text-xs font-bold uppercase tracking-wider">Reports</span>
        </button>
      </nav>

      {toastMessage && <Toast message={toastMessage} type={toastType} onClose={() => setToastMessage(null)} />}

      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-md p-6 shadow-2xl relative overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="absolute -right-20 -top-20 w-48 h-48 rounded-full bg-gold-brand/5 blur-3xl pointer-events-none"></div>
            <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-gold-brand" />
                <h3 className="text-sm font-black text-white uppercase tracking-wider font-display">Settings</h3>
              </div>
              <button onClick={() => setIsSettingsOpen(false)} className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Shop Name</label>
                <input type="text" value={settings.shopName} onChange={(e) => setSettings(prev => ({ ...prev, shopName: e.target.value || 'IMAC Enterprises' }))}
                  className="w-full h-12 bg-[#0A0A0A] border border-white/5 text-sm px-4 rounded-xl text-white font-bold focus:border-gold-brand outline-none" placeholder="e.g. IMAC Phone Shop" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Shop Type</label>
                <select value={settings.vibe} onChange={(e) => setSettings(prev => ({ ...prev, vibe: e.target.value }))}
                  className="w-full h-12 bg-[#0A0A0A] border border-white/5 text-sm px-3 rounded-xl text-white font-bold focus:border-gold-brand outline-none">
                  <option value="Phone & Accessories">Phone & Accessories</option>
                  <option value="Eatery & Food">Eatery & Food</option>
                  <option value="Bespoke Tailoring">Bespoke Tailoring</option>
                  <option value="General Store">General Store</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1">
                  <Palette className="w-3.5 h-3.5 text-gold-brand" /> Color Theme
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {THEMES.map(t => (
                    <button key={t.id} onClick={() => setSettings(prev => ({ ...prev, themeId: t.id }))}
                      className={`px-2.5 py-2 rounded-xl border text-[10px] font-black uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer ${settings.themeId === t.id ? 'bg-white/5 text-white border-gold-brand' : 'bg-transparent text-zinc-500 border-white/5 hover:text-zinc-300'}`}
                      style={{ borderColor: settings.themeId === t.id ? t.brand : 'transparent' }}>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t.brand }}></span>
                      <span className="truncate">{t.name}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Default Payment</label>
                <div className="grid grid-cols-4 gap-1">
                  {(['Cash', 'MTN MoMo', 'Airtel Money', 'Credit / Book'] as const).map(m => (
                    <button key={m} onClick={() => setSettings(prev => ({ ...prev, defaultPaymentMethod: m }))}
                      className={`py-2 rounded-lg text-[8px] font-bold border transition-all cursor-pointer ${settings.defaultPaymentMethod === m ? 'border-gold-brand bg-gold-brand/10 text-white font-extrabold' : 'bg-[#0A0A0A] border-transparent text-zinc-500 hover:text-zinc-300'}`}>
                      {m === 'Credit / Book' ? 'Credit' : m === 'MTN MoMo' ? 'MTN' : m === 'Airtel Money' ? 'Airtel' : m}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between items-baseline">
                  <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Daily Goal</label>
                  <span className="text-xs font-black text-gold-brand">{settings.dailyGoalNum} Sales</span>
                </div>
                <input type="range" min="5" max="30" value={settings.dailyGoalNum}
                  onChange={(e) => setSettings(prev => ({ ...prev, dailyGoalNum: parseInt(e.target.value) }))}
                  className="w-full accent-gold-brand cursor-pointer h-1.5 bg-[#0A0A0A] rounded-lg appearance-none mt-2" />
              </div>
            </div>
            <button onClick={() => { setIsSettingsOpen(false); triggerToast("Settings saved!", "success"); }}
              className="w-full mt-6 h-11 bg-gold-brand text-black font-black uppercase tracking-widest rounded-2xl text-xs hover:opacity-90 active:scale-98 transition-all font-display">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
