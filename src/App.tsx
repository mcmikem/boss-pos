import { useState, useEffect, lazy, Suspense, useRef, useMemo, useCallback } from 'react';
import { 
  ShoppingCart, Package, TrendingUp, Menu, Globe, Settings, X, Palette, Zap, Wallet, Download, LayoutGrid
} from 'lucide-react';
import { Product, Sale, Expense, Supplier, SaleItem, AppTheme, StoreSettings, CreditPayment, CreditEat, ProductionRegister, WastageLog, MomoTransfer } from './types';
import { productApi, supplierApi, saleApi, expenseApi, settingsApi, creditPaymentApi, creditEatApi, productionRegisterApi, wastageLogApi, momoTransferApi, authVerify, authStatus, authSetPin, authMigratePin, flushOutbox, outboxCount, exportApi, restoreApi, getAuthToken, bootApi, primeCache, revokeAllSessions, backupsApi, auditApi, ApiError, type BootData, type AuditEntry } from './api';
import { enrichProductsWithIcons } from './data/icons';
import { saveProducts, loadProducts, clearProductsCache } from './utils/cache';
import { UGX_TO_USD_RATE } from './data/constants';
import { verifyPinAgainstHash } from './utils/crypto';
import { downloadBlob } from './utils/download';

import ErrorBoundary from './components/ErrorBoundary';
import Sales from './components/Sales';
import Toast from './components/Toast';
import PinGate from './components/PinGate';
import SyncProductsButton from './components/SyncProductsButton';
const Inventory = lazy(() => import('./components/Inventory'));
const Analytics = lazy(() => import('./components/Analytics'));
const Expenses = lazy(() => import('./components/Expenses'));
const CategoryRegister = lazy(() => import('./components/CategoryRegister'));

const THEMES_LIST: AppTheme[] = [
  { id: 'gold', name: 'Kampala Gold', brand: '#ffcc00', medium: '#f1c100', light: '#ffedc3' },
  { id: 'emerald', name: 'Nile Emerald', brand: '#10b981', medium: '#059669', light: '#a7f3d0' },
  { id: 'sapphire', name: 'Victoria Sapphire', brand: '#3b82f6', medium: '#2563eb', light: '#bfdbfe' },
  { id: 'ruby', name: 'Sunset Ruby', brand: '#f43f5e', medium: '#e11d48', light: '#fecdd3' },
  { id: 'amber', name: 'Equator Amber', brand: '#f97316', medium: '#ea580c', light: '#ffedd5' },
];

const THEME_MAP = new Map(THEMES_LIST.map(t => [t.id, t]));

const DEFAULT_CATEGORIES = ['Electronics', 'Eatery', 'Stationery', 'Printing', 'Tailoring', 'Library', 'Sports', 'Graphics'];
const DEFAULT_EXPENSE_CATEGORIES = ['Stock Purchase', 'Utilities', 'Labor', 'Rent', 'Transport', 'Supplies'];

const IDLE_LOCK_MS = 10 * 60 * 1000; // re-lock after 10 minutes of inactivity

const DEFAULT_SETTINGS: StoreSettings = {
  shopName: 'IMAC Enterprises',
  themeId: 'gold',
  vibe: 'General Store',
  defaultPaymentMethod: 'Cash',
  dailyGoalNum: 10,
  usdRate: UGX_TO_USD_RATE,
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'sales' | 'inventory' | 'analytics' | 'expenses' | 'registers'>('sales');
  const [currency, setCurrency] = useState<'UGX' | 'USD'>('UGX');
  const [showSuppliers, setShowSuppliers] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authState, setAuthState] = useState<'booting' | 'locked' | 'ready'>('booting');

  const [settings, setSettings] = useState<StoreSettings>(DEFAULT_SETTINGS);
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [creditPayments, setCreditPayments] = useState<CreditPayment[]>([]);
  const [creditEats, setCreditEats] = useState<CreditEat[]>([]);
  const [productionRegisters, setProductionRegisters] = useState<ProductionRegister[]>([]);
  const [wastageLogs, setWastageLogs] = useState<WastageLog[]>([]);
  const [momoTransfers, setMomoTransfers] = useState<MomoTransfer[]>([]);
  const [categories, setCategories] = useState<string[]>(() => {
    const saved = localStorage.getItem('boss_pos_categories');
    return saved ? JSON.parse(saved) : DEFAULT_CATEGORIES;
  });
  const [expenseCategories, setExpenseCategories] = useState<string[]>(() => {
    const saved = localStorage.getItem('boss_pos_expense_categories');
    return saved ? JSON.parse(saved) : DEFAULT_EXPENSE_CATEGORIES;
  });
  const [cart, setCart] = useState<SaleItem[]>([]);

  const [isQuickSale, setIsQuickSale] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'success' | 'error' | 'info'>('success');
  const [apiError, setApiError] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [showAudit, setShowAudit] = useState(false);

  const readyRef = useRef(false);

  const triggerToast = (msg: string, type: 'success' | 'error' | 'info') => {
    setToastMessage(msg);
    setToastType(type);
  };

  const formatSyncedAgo = (ts: number) => {
    const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (secs < 60) return 'just now';
    const mins = Math.round(secs / 60);
    return mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
  };

  // Shared boot-apply: lands a /api/boot payload into local state + caches. Used
  // by the initial load AND the silent 3-minute background refresh (multi-till).
  const applyBootData = useCallback((d: BootData) => {
    setSettings(d.settings);
    if (d.settings.categories && Array.isArray(d.settings.categories) && d.settings.categories.length > 0) setCategories(d.settings.categories);
    if (d.settings.expenseCategories && Array.isArray(d.settings.expenseCategories) && d.settings.expenseCategories.length > 0) setExpenseCategories(d.settings.expenseCategories);
    const enriched = enrichProductsWithIcons(d.products);
    setProducts(enriched);
    saveProducts(enriched);
    setSuppliers(d.suppliers);
    setSales(d.sales);
    setExpenses(d.expenses);
    setCreditPayments(d.creditPayments);
    setCreditEats(d.creditEats);
    setProductionRegisters(d.productionRegisters);
    setWastageLogs(d.wastageLogs);
    setMomoTransfers(d.momoTransfers);
    // Warm per-endpoint caches so later reads (and offline reloads) hit cache.
    primeCache('/api/products', d.products);
    primeCache('/api/suppliers', d.suppliers);
    primeCache('/api/sales', d.sales);
    primeCache('/api/expenses', d.expenses);
    primeCache('/api/credit-payments', d.creditPayments);
    primeCache('/api/credit-eats', d.creditEats);
    primeCache('/api/production-register', d.productionRegisters);
    primeCache('/api/wastage-log', d.wastageLogs);
    primeCache('/api/momo-transfers', d.momoTransfers);
    primeCache('/api/settings', d.settings);
    setLastSyncedAt(Date.now());
  }, []);

  const fetchAllData = async () => {
    const cached = loadProducts();
    if (cached) {
      setProducts(enrichProductsWithIcons(cached));
      setLoading(false);
    }

    // 3G-friendly: one /api/boot round-trip. Fall back to individual endpoints
    // only if the batched call fails (older API or cold server).
    try {
      applyBootData(await bootApi.get());
      setLoading(false);
      return;
    } catch {}

    const failed: string[] = [];
    const fail = (name: string) => () => { failed.push(name); };
    await Promise.all([
      settingsApi.get().then((s) => {
        setSettings(s);
        if (s.categories && Array.isArray(s.categories) && s.categories.length > 0) setCategories(s.categories);
        if (s.expenseCategories && Array.isArray(s.expenseCategories) && s.expenseCategories.length > 0) setExpenseCategories(s.expenseCategories);
      }).catch(fail('settings')),
      productApi.list().then(p => {
        const enriched = enrichProductsWithIcons(p);
        setProducts(enriched);
        saveProducts(enriched);
      }).catch(fail('products')),
      supplierApi.list().then(setSuppliers).catch(fail('suppliers')),
      saleApi.list().then(setSales).catch(fail('sales')),
      expenseApi.list().then(setExpenses).catch(fail('expenses')),
      creditPaymentApi.list().then(setCreditPayments).catch(fail('credit')),
      creditEatApi.list().then(setCreditEats).catch(fail('credit eats')),
      productionRegisterApi.list().then(setProductionRegisters).catch(fail('production')),
      wastageLogApi.list().then(setWastageLogs).catch(fail('wastage')),
      momoTransferApi.list().then(setMomoTransfers).catch(fail('momo transfers')),
    ]);
    setLoading(false);
    if (failed.length >= 6) {
      setApiError(true);
    } else if (failed.length > 0) {
      triggerToast(`Failed to load: ${failed.join(', ')}. Check connection.`, 'error');
    }
  };

  // Boot: try open-mode auth, migrate an existing client PIN, then load data.
  useEffect(() => {
    (async () => {
      let serverHasPin: boolean | null = null;
      let shopName = '';
      try {
        const status = await authStatus();
        serverHasPin = status.hasPin;
        shopName = status.shopName || '';
      } catch {}

      // Server explicitly has no PIN -> truly open mode. Never show the lock
      // screen (otherwise any PIN "works", which is confusing).
      if (serverHasPin === false) {
        localStorage.setItem('boss_pos_has_pin', 'false');
        try { await authVerify(''); } catch {}
        await fetchAllData();
        setAuthState('ready');
        return;
      }
      if (serverHasPin === true) localStorage.setItem('boss_pos_has_pin', 'true');

      try {
        const data = await authVerify('');
        localStorage.setItem('boss_pos_has_pin', String(data.hasPin));
        if (!data.hasPin) {
          const localPin = localStorage.getItem('boss_pos_pin');
          if (localPin && !localPin.startsWith('fb_')) {
            try {
              await authMigratePin(localPin);
              localStorage.removeItem('boss_pos_pin');
              localStorage.setItem('boss_pos_has_pin', 'true');
            } catch {}
          }
        }
        await fetchAllData();
        setAuthState('ready');
      } catch {
        const storedHasPin = localStorage.getItem('boss_pos_has_pin') === 'true';
        const token = getAuthToken();
        if (!navigator.onLine && (token || !storedHasPin)) {
          await fetchAllData();
          setAuthState('ready');
        } else {
          if (shopName) setSettings(prev => ({ ...prev, shopName }));
          setAuthState('locked');
        }
      }
    })();
  }, []);

  useEffect(() => {
    readyRef.current = authState === 'ready';
  }, [authState]);

  // Multi-till visibility: silently re-boot every 3 minutes so changes made on
  // a second till show up without a manual reload. Skipped while offline and
  // never overlapped. Keeps the "Synced Xm ago" pill honest too.
  useEffect(() => {
    if (authState !== 'ready') return;
    let busy = false;
    const iv = setInterval(async () => {
      if (!navigator.onLine || busy) return;
      busy = true;
      try {
        const d = await bootApi.get();
        applyBootData(d);
        setPendingCount(outboxCount());
      } catch {} finally {
        busy = false;
      }
    }, 3 * 60 * 1000);
    return () => clearInterval(iv);
  }, [authState, applyBootData]);

  // Refresh the offline-pending badge + "Synced" pill every 30s.
  useEffect(() => {
    const iv = setInterval(() => setPendingCount(outboxCount()), 30_000);
    return () => clearInterval(iv);
  }, []);

  // A replay lost the race against another device (server 409 CONFLICT).
  const onSyncConflict = (e: Event) => {
    const n = (e as CustomEvent).detail || 1;
    triggerToast(`Another device saved a newer version — ${n} offline change(s) were skipped to avoid overwriting it.`, 'error');
    fetchAllData();
  };
  useEffect(() => {
    window.addEventListener('boss-pos-sync-conflict', onSyncConflict);
    return () => window.removeEventListener('boss-pos-sync-conflict', onSyncConflict);
  }, []);

  // "Log out all devices" (or an expired token) just got enforced server-side:
  // drop the session and re-lock the till.
  useEffect(() => {
    const onRevoked = () => {
      setAuthState('locked');
      triggerToast('Logged out on all devices — re-enter your PIN to continue.', 'info');
    };
    window.addEventListener('boss-pos-auth-revoked', onRevoked);
    return () => window.removeEventListener('boss-pos-auth-revoked', onRevoked);
  }, []);

  useEffect(() => {
    if (products.length > 0) saveProducts(products);
  }, [products]);

  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      try {
        const n = await flushOutbox();
        if (n > 0) {
          triggerToast(`Synced ${n} offline change(s)`, 'success');
          fetchAllData();
        } else if (outboxCount() > 0) {
          triggerToast('Some offline changes could not sync. Re-unlock to refresh your login, then retry.', 'error');
        }
      } catch {
        triggerToast('Failed to sync offline changes', 'error');
      }
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Flush pending offline writes on every unlock/boot too. The browser
  // `online` event is unreliable on old Android, so queued writes may
  // otherwise sit in the outbox until the next online event fires.
  useEffect(() => {
    if (authState !== 'ready') return;
    (async () => {
      try {
        const n = await flushOutbox();
        if (n > 0) {
          triggerToast(`Synced ${n} offline change(s)`, 'success');
          fetchAllData();
        } else if (outboxCount() > 0) {
          triggerToast('Some offline changes could not sync. Re-unlock to refresh your login, then retry.', 'error');
        }
      } catch {}
    })();
  }, [authState]);

  // Persist settings (skip the very first render so we never clobber server
  // values with defaults before the real settings finish loading). Debounced so
  // typing in the shop-name field doesn't fire a PUT (DB write + cache clear)
  // on every keystroke.
  useEffect(() => {
    if (!readyRef.current) return;
    const { hasPin: _hp, ...toSend } = settings;
    const t = setTimeout(() => {
      settingsApi.update(toSend).catch(() => triggerToast('Failed to save settings', 'error'));
    }, 600);
    return () => clearTimeout(t);
  }, [settings]);

  useEffect(() => {
    localStorage.setItem('boss_pos_categories', JSON.stringify(categories));
    if (readyRef.current) setSettings(prev => ({ ...prev, categories }));
  }, [categories]);

  useEffect(() => {
    localStorage.setItem('boss_pos_expense_categories', JSON.stringify(expenseCategories));
    if (readyRef.current) setSettings(prev => ({ ...prev, expenseCategories }));
  }, [expenseCategories]);

  useEffect(() => {
    localStorage.setItem('boss_pos_cart', JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    if (loading) return;
    const cached = localStorage.getItem('boss_pos_cart');
    if (cached) {
      try {
        const restored: SaleItem[] = JSON.parse(cached);
        const validated = restored.map(item => {
          const live = products.find(p => p.id === item.productId);
          if (live && live.price !== item.unitPrice) {
            return { ...item, unitPrice: live.price, lineTotal: item.qty * live.price };
          }
          return item;
        });
        setCart(validated);
        const changed = restored.some((item, i) => item.unitPrice !== validated[i]?.unitPrice);
        if (changed) {
          triggerToast('Cart prices updated to match current product pricing', 'info');
        }
      } catch {}
    }
  }, [loading, products]);

  // Idle re-lock
  useEffect(() => {
    if (authState !== 'ready') return;
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    const events = ['pointerdown', 'keydown', 'touchstart', 'mousemove', 'scroll'];
    events.forEach(e => window.addEventListener(e, bump, { passive: true }));
    const iv = setInterval(() => {
      if (Date.now() - last > IDLE_LOCK_MS) {
        // Keep the auth token: clearing it would make the outbox replay without
        // auth after an offline re-unlock, and the server would drop those
        // queued sales (data loss). The lock screen is still enforced via
        // authState; the token only expires on the server after 7 days.
        setAuthState('locked');
        triggerToast('Locked after inactivity', 'info');
      }
    }, 30000);
    return () => {
      events.forEach(e => window.removeEventListener(e, bump));
      clearInterval(iv);
    };
  }, [authState]);

  const handleUnlock = async (pin: string) => {
    try {
      const data = await authVerify(pin);
      localStorage.setItem('boss_pos_has_pin', String(data.hasPin));
      await fetchAllData();
      setAuthState('ready');
    } catch (err) {
      // Offline / flaky network (navigator.onLine is unreliable on some Androids,
      // so we can't gate on it): fall back to the locally-stored hash so sales
      // can still run. Only possible once this device has unlocked online before
      // (authVerify caches the hash to boss_pos_pin).
      const local = localStorage.getItem('boss_pos_pin');
      if (local && !local.startsWith('fb_')) {
        if (await verifyPinAgainstHash(pin, local)) {
          setAuthState('ready');
          return;
        }
      }
      throw err;
    }
  };

  const handleSetPin = async (pin: string) => {
    const res = await authSetPin(pin);
    if (pin) localStorage.setItem('boss_pos_pin', res.hash);
    else localStorage.removeItem('boss_pos_pin');
    localStorage.setItem('boss_pos_has_pin', String(res.hasPin));
    triggerToast(pin ? 'PIN set successfully' : 'PIN removed', 'success');
  };

  const handleExportData = async () => {
    try {
      const data = await exportApi.download();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const ok = downloadBlob(blob, `imac-pos-backup-${new Date().toISOString().slice(0, 10)}.json`);
      triggerToast(ok ? 'Backup downloaded' : 'Download failed on this device', ok ? 'success' : 'error');
    } catch {
      triggerToast('Failed to export data', 'error');
    }
  };

  const restoreInputRef = useRef<HTMLInputElement>(null);

  const handleRevokeAll = async () => {
    if (!confirm('Log out on ALL devices (including this one)? You will need the PIN to log back in.')) return;
    try {
      await revokeAllSessions();
      try { window.dispatchEvent(new Event('boss-pos-auth-revoked')); } catch {}
    } catch {
      triggerToast('Failed to log out other devices', 'error');
    }
  };

  const handleRunBackupNow = async () => {
    try {
      const res = await backupsApi.run();
      if (res.success) {
        setLastBackupAt(new Date().toISOString());
        triggerToast('Backup saved to server', 'success');
      } else {
        triggerToast('Backup could not run right now', 'error');
      }
    } catch {
      triggerToast('Backup failed', 'error');
    }
  };

  // When the settings sheet opens, show the last automatic server-backup time
  // and the recent activity log.
  useEffect(() => {
    if (!isSettingsOpen) return;
    backupsApi.latest().then((b) => setLastBackupAt(b.createdAt)).catch(() => {});
    auditApi.list(30).then((entries) => setAuditEntries(entries)).catch(() => {});
  }, [isSettingsOpen]);

  const handleRestoreData = async (file: File | undefined) => {
    if (!file) return;
    if (!confirm(`Restore from ${file.name}? This replaces matching records with the backup. Continue?`)) return;
    try {
      const parsed = JSON.parse(await file.text());
      const res = await restoreApi.restore(parsed);
      const n = res.restored || {};
      const total = Object.values(n).reduce((a, b) => a + (b || 0), 0);
      triggerToast(`Restored ${total} record(s). Reloading data…`, 'success');
      await fetchAllData();
    } catch {
      triggerToast('Restore failed — is this a valid backup file?', 'error');
    }
  };

  const formatCurrency = (ugxVal: number) => {
    if (currency === 'USD') {
      const usdVal = ugxVal / (settings.usdRate || UGX_TO_USD_RATE);
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
    const stamped = { ...newProd, updatedAt: new Date().toISOString() };
    const prodWithIcon = enrichProductsWithIcons([stamped])[0];
    setProducts(prev => [prodWithIcon, ...prev]);
    try { await productApi.create(stamped); } catch {
      setProducts(prev => prev.filter(p => p.id !== prodWithIcon.id));
      triggerToast('Failed to save product — not added', 'error');
    }
  };

  const handleUpdateProduct = async (updatedProd: Product) => {
    const prev = products.find(p => p.id === updatedProd.id);
    const stamped = { ...updatedProd, updatedAt: new Date().toISOString() };
    setProducts(list => list.map(p => p.id === stamped.id ? stamped : p));
    try { await productApi.update(stamped); } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        // Another device saved a newer version. Pull the server copy so the
        // winner's row wins cleanly instead of silently keeping stale data.
        triggerToast('This product was updated on another device — loading the latest version. Your edit was not saved.', 'error');
        setProducts(list => list.filter(p => p.id !== stamped.id));
        fetchAllData();
        return;
      }
      if (prev) setProducts(list => list.map(p => p.id === stamped.id ? prev : p));
      triggerToast('Failed to update product — changes reverted', 'error');
    }
  };

  const handleDeleteProduct = async (productId: string) => {
    const prev = products.find(p => p.id === productId);
    setProducts(prev => prev.filter(p => p.id !== productId));
    try { await productApi.remove(productId); } catch {
      if (prev) setProducts(list => [prev, ...list]);
      triggerToast('Failed to delete product', 'error');
    }
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
    try { await saleApi.create(newSale); } catch {
      // Real server failure (not offline — offline writes are queued). Roll the
      // sale and its stock effect back so the UI never shows an unsaved sale.
      setSales(prev => prev.filter(s => s.id !== newSale.id));
      setProducts(prevProducts => {
        return prevProducts.map(prod => {
          const soldItem = newSale.items.find(item => item.productId === prod.id);
          if (soldItem && !prod.isService) {
            return { ...prod, stockQty: prod.stockQty + soldItem.qty };
          }
          return prod;
        });
      });
      triggerToast('Failed to save sale — not recorded. Refresh stock and retry.', 'error');
    }
  };

  const handleRefundSale = async (saleId: string) => {
    const saleToRefund = sales.find(s => s.id === saleId);
    if (!saleToRefund || saleToRefund.refunded) return;
    setSales(prev => prev.map(s => s.id === saleId ? { ...s, refunded: true, refundedAt: new Date().toISOString() } : s));
    setProducts(prevProducts => {
      return prevProducts.map(prod => {
        const soldItem = saleToRefund.items.find(item => item.productId === prod.id);
        if (soldItem && !prod.isService) {
          return { ...prod, stockQty: prod.stockQty + soldItem.qty };
        }
        return prod;
      });
    });
    try { await saleApi.refund(saleId); } catch {
      setSales(prev => prev.map(s => s.id === saleId ? { ...s, refunded: false, refundedAt: undefined } : s));
      setProducts(prevProducts => {
        return prevProducts.map(prod => {
          const soldItem = saleToRefund.items.find(item => item.productId === prod.id);
          if (soldItem && !prod.isService) {
            return { ...prod, stockQty: prod.stockQty - soldItem.qty };
          }
          return prod;
        });
      });
      triggerToast('Failed to refund sale — stock unchanged', 'error');
      return;
    }
    triggerToast(`${saleToRefund.orderNumber} refunded. Stock restored.`, 'info');
  };

  const handleAddExpense = async (newExpense: Expense) => {
    setExpenses(prev => [newExpense, ...prev]);
    try { await expenseApi.create(newExpense); } catch {
      setExpenses(prev => prev.filter(e => e.id !== newExpense.id));
      triggerToast('Failed to save expense — not added', 'error');
    }
  };

  const handleDeleteExpense = async (expenseId: string) => {
    const prev = expenses.find(e => e.id === expenseId);
    setExpenses(prev => prev.filter(e => e.id !== expenseId));
    try { await expenseApi.remove(expenseId); } catch {
      if (prev) setExpenses(list => [prev, ...list]);
      triggerToast('Failed to delete expense', 'error');
    }
  };

  const handleAddExpenseCategory = (name: string) => {
    setExpenseCategories(prev => prev.includes(name) ? prev : [...prev, name]);
  };

  const handleUpdateExpenseCategory = (oldName: string, newName: string) => {
    setExpenseCategories(prev => prev.map(c => c === oldName ? newName : c));
    setExpenses(prev => prev.map(e => e.category === oldName ? { ...e, category: newName } : e));
  };

  const handleDeleteExpenseCategory = (name: string) => {
    setExpenseCategories(prev => {
      const filtered = prev.filter(c => c !== name);
      return filtered.includes('Miscellaneous') ? filtered : [...filtered, 'Miscellaneous'];
    });
    setExpenses(prev => prev.map(e => e.category === name ? { ...e, category: 'Miscellaneous' } : e));
  };

  const handleAddSupplier = async (newSup: Supplier) => {
    setSuppliers(prev => [...prev, newSup]);
    try { await supplierApi.create(newSup); } catch {
      setSuppliers(prev => prev.filter(s => s.id !== newSup.id));
      triggerToast('Failed to save supplier — not added', 'error');
    }
  };

  const handleUpdateSupplier = async (updatedSup: Supplier) => {
    const prev = suppliers.find(s => s.id === updatedSup.id);
    setSuppliers(prev => prev.map(s => s.id === updatedSup.id ? updatedSup : s));
    try { await supplierApi.update(updatedSup); } catch {
      if (prev) setSuppliers(list => list.map(s => s.id === updatedSup.id ? prev : s));
      triggerToast('Failed to update supplier — changes reverted', 'error');
    }
  };

  const handleDeleteSupplier = async (supplierId: string) => {
    const prev = suppliers.find(s => s.id === supplierId);
    const prevProducts = products;
    setSuppliers(prev => prev.filter(s => s.id !== supplierId));
    setProducts(prev => prev.map(p => p.supplierId === supplierId ? { ...p, supplierId: undefined } : p));
    try { await supplierApi.remove(supplierId); } catch {
      if (prev) setSuppliers(list => [...list, prev]);
      setProducts(prevProducts);
      triggerToast('Failed to delete supplier', 'error');
    }
  };

  const handleAddCategory = (name: string) => {
    setCategories(prev => prev.includes(name) ? prev : [...prev, name]);
  };

  const handleUpdateCategory = (oldName: string, newName: string) => {
    setCategories(prev => prev.map(c => c === oldName ? newName : c));
    setProducts(prev => prev.map(p => p.category === oldName ? { ...p, category: newName } : p));
  };

  const handleDeleteCategory = (name: string) => {
    setProducts(prev => prev.map(p => p.category === name ? { ...p, category: 'Uncategorized' } : p));
    setCategories(prev => {
      const filtered = prev.filter(c => c !== name);
      return filtered.includes('Uncategorized') ? filtered : [...filtered, 'Uncategorized'];
    });
  };

  const handlePayCredit = async (saleId: string, amount: number) => {
    const payment: CreditPayment = {
      id: `cp-${Date.now()}`,
      saleId,
      amount,
      createdAt: new Date().toISOString(),
    };
    setCreditPayments(prev => [payment, ...prev]);
    try {
      await creditPaymentApi.create(payment);
    } catch {
      setCreditPayments(prev => prev.filter(p => p.id !== payment.id));
      triggerToast('Failed to sync payment to server', 'error');
    }
  };

  const handleAddCreditEat = async (newEat: CreditEat) => {
    setCreditEats(prev => [newEat, ...prev]);
    try { await creditEatApi.create(newEat); } catch {
      setCreditEats(prev => prev.filter(c => c.id !== newEat.id));
      triggerToast('Failed to save credit entry — not added', 'error');
    }
  };

  const handlePayCreditEat = async (id: string, amount: number) => {
    const prev = creditEats.find(c => c.id === id);
    const next = { ...(prev as CreditEat), paidAmount: (prev?.paidAmount || 0) + amount, paid: (prev?.paidAmount || 0) + amount >= (prev?.total || 0) };
    setCreditEats(cs => cs.map(c => c.id === id ? next : c));
    try { await creditEatApi.pay(id, amount); } catch {
      if (prev) setCreditEats(cs => cs.map(c => c.id === id ? prev : c));
      triggerToast('Failed to sync payment to server', 'error');
    }
  };

  const handleAddProduction = async (p: ProductionRegister) => {
    setProductionRegisters(prev => [p, ...prev]);
    try { await productionRegisterApi.create(p); } catch {
      setProductionRegisters(prev => prev.filter(x => x.id !== p.id));
      triggerToast('Failed to save production — not added', 'error');
    }
  };

  const handleDeleteProduction = async (id: string) => {
    const prev = productionRegisters.find(p => p.id === id);
    setProductionRegisters(prev => prev.filter(p => p.id !== id));
    try { await productionRegisterApi.remove(id); } catch {
      if (prev) setProductionRegisters(list => [prev, ...list]);
      triggerToast('Failed to delete production', 'error');
    }
  };

  const handleAddWastage = async (w: WastageLog) => {
    setWastageLogs(prev => [w, ...prev]);
    try { await wastageLogApi.create(w); } catch {
      setWastageLogs(prev => prev.filter(x => x.id !== w.id));
      triggerToast('Failed to save loss — not added', 'error');
    }
  };

  const handleDeleteWastage = async (id: string) => {
    const prev = wastageLogs.find(w => w.id === id);
    setWastageLogs(prev => prev.filter(w => w.id !== id));
    try { await wastageLogApi.remove(id); } catch {
      if (prev) setWastageLogs(list => [prev, ...list]);
      triggerToast('Failed to delete loss', 'error');
    }
  };

  const handleAddMomoTransfer = async (t: MomoTransfer) => {
    setMomoTransfers(prev => [t, ...prev]);
    try { await momoTransferApi.create(t); } catch {
      setMomoTransfers(prev => prev.filter(x => x.id !== t.id));
      triggerToast('Failed to save transfer — not added', 'error');
    }
  };

  const handleDeleteMomoTransfer = async (id: string) => {
    const prev = momoTransfers.find(t => t.id === id);
    setMomoTransfers(prev => prev.filter(t => t.id !== id));
    try { await momoTransferApi.remove(id); } catch {
      if (prev) setMomoTransfers(list => [prev, ...list]);
      triggerToast('Failed to delete transfer', 'error');
    }
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

  const registersSegments = useMemo(() => {
    const cats = new Set<string>();
    products.forEach(p => { if (p.category) cats.add(p.category); });
    cats.add('Eatery');
    return Array.from(cats).sort();
  }, [products]);

  const renderContent = () => {
    switch (activeTab) {
      case 'sales':
        return (
          <ErrorBoundary key="sales">
          <Sales 
            products={products} onAddSale={handleAddSale}
            onUpdateProduct={handleUpdateProduct}
            formatCurrency={formatCurrency} cart={cart} setCart={setCart}
            triggerToast={triggerToast} settings={settings}
            onAddExpense={handleAddExpense} expenseCategories={expenseCategories}
            isQuickSale={isQuickSale} setIsQuickSale={setIsQuickSale}
            categories={categories}
          />
          </ErrorBoundary>
        );
      case 'inventory':
        return (
          <ErrorBoundary key="inventory">
          <Suspense fallback={<div className="flex items-center justify-center min-h-[50vh]"><div className="w-8 h-8 border-2 border-gold-brand border-t-transparent rounded-full animate-spin" /></div>}>
          <Inventory 
            products={products} suppliers={suppliers}
            categories={categories}
            onAddProduct={handleAddProduct} onUpdateProduct={handleUpdateProduct}
            onDeleteProduct={handleDeleteProduct}
            onAddCategory={handleAddCategory}
            onUpdateCategory={handleUpdateCategory}
            onDeleteCategory={handleDeleteCategory}
            formatCurrency={formatCurrency} triggerToast={triggerToast}
          />
          </Suspense>
          </ErrorBoundary>
        );
      case 'expenses':
        return (
          <ErrorBoundary key="expenses">
          <Suspense fallback={<div className="flex items-center justify-center min-h-[50vh]"><div className="w-8 h-8 border-2 border-gold-brand border-t-transparent rounded-full animate-spin" /></div>}>
          <Expenses 
            expenses={expenses} expenseCategories={expenseCategories}
            products={products}
            onAddExpense={handleAddExpense} onDeleteExpense={handleDeleteExpense}
            onAddExpenseCategory={handleAddExpenseCategory}
            onUpdateExpenseCategory={handleUpdateExpenseCategory}
            onDeleteExpenseCategory={handleDeleteExpenseCategory}
            formatCurrency={formatCurrency} triggerToast={triggerToast}
          />
          </Suspense>
          </ErrorBoundary>
        );
      case 'registers':
        return (
          <ErrorBoundary key="registers">
          <Suspense fallback={<div className="flex items-center justify-center min-h-[50vh]"><div className="w-8 h-8 border-2 border-gold-brand border-t-transparent rounded-full animate-spin" /></div>}>
          <CategoryRegister
            segments={registersSegments}
            products={products}
            sales={sales}
            creditEats={creditEats}
            productionRegisters={productionRegisters}
            wastageLogs={wastageLogs}
            momoTransfers={momoTransfers}
            onAddCreditEat={handleAddCreditEat}
            onPayCreditEat={handlePayCreditEat}
            onAddProduction={handleAddProduction}
            onDeleteProduction={handleDeleteProduction}
            onAddWastage={handleAddWastage}
            onDeleteWastage={handleDeleteWastage}
            onAddMomoTransfer={handleAddMomoTransfer}
            onDeleteMomoTransfer={handleDeleteMomoTransfer}
            formatCurrency={formatCurrency} triggerToast={triggerToast}
          />
          </Suspense>
          </ErrorBoundary>
        );
      case 'analytics':
        return (
          <ErrorBoundary key="analytics">
          <Suspense fallback={<div className="flex items-center justify-center min-h-[50vh]"><div className="w-8 h-8 border-2 border-gold-brand border-t-transparent rounded-full animate-spin" /></div>}>
          <Analytics 
            sales={sales} expenses={expenses} products={products}
            suppliers={suppliers}
            creditPayments={creditPayments}
            expenseCategories={expenseCategories}
            onAddExpense={handleAddExpense}
            onDeleteExpense={handleDeleteExpense}
            onAddExpenseCategory={handleAddExpenseCategory}
            onUpdateExpenseCategory={handleUpdateExpenseCategory}
            onDeleteExpenseCategory={handleDeleteExpenseCategory}
            onAddSupplier={handleAddSupplier} onUpdateSupplier={handleUpdateSupplier}
            onDeleteSupplier={handleDeleteSupplier}
            onPayCredit={handlePayCredit}
            formatCurrency={formatCurrency} triggerToast={triggerToast}
            showSuppliers={showSuppliers} setShowSuppliers={setShowSuppliers}
            onNavigate={(tab) => setActiveTab(tab)}
            onRepeatLastSale={handleRepeatLastSale} onRefundSale={handleRefundSale}
            settings={settings}
          />
          </Suspense>
          </ErrorBoundary>
        );
    }
  };

  const handleRetry = () => window.location.reload();

  if (authState === 'locked') {
    return <PinGate onUnlock={handleUnlock} shopName={settings.shopName} />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0A0A0A]">
        <div className="text-center">
          {apiError ? (
            <>
              <div className="w-16 h-16 rounded-full bg-rose-950/30 border border-rose-500/30 flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">!</span>
              </div>
              <p className="text-sm font-black text-rose-400 uppercase tracking-widest mb-2">Connection Error</p>
              <p className="text-xs text-zinc-500 mb-4 max-w-xs">Could not reach the server. Check your connection and try again.</p>
              <button onClick={handleRetry}
                className="px-6 h-11 bg-gold-brand text-black font-black uppercase tracking-widest text-xs rounded-xl hover:opacity-90 transition-all">
                Retry
              </button>
            </>
          ) : (
            <>
              <div className="w-12 h-12 border-4 border-gold-brand/20 border-t-gold-brand rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Loading...</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div 
      className="flex flex-col min-h-screen pb-24 text-zinc-100 bg-[#0A0A0A] relative"
      style={{
        '--color-gold-brand': THEME_MAP.get(settings.themeId)?.brand ?? '#ffcc00',
        '--color-gold-medium': THEME_MAP.get(settings.themeId)?.medium ?? '#f1c100',
        '--color-gold-light': THEME_MAP.get(settings.themeId)?.light ?? '#ffedc3',
      } as Record<string, string>}
    >
      <header className="bg-[#141414] border-b border-white/5 sticky top-0 z-50 flex justify-between items-center px-4 py-3 h-16 w-full">
        <div className="flex items-center gap-3">
          <Menu className="w-5 h-5 text-gold-brand cursor-pointer hover:opacity-80 transition-opacity" />
          <h1 className="text-sm sm:text-base md:text-lg font-black text-gold-brand uppercase tracking-tighter font-display truncate max-w-[150px] sm:max-w-none">
            {settings.shopName}
          </h1>
          {!isOnline && (
            <span className="text-[8px] bg-rose-950/40 text-rose-400 font-extrabold px-2 py-0.5 rounded-full uppercase tracking-widest font-sans border border-rose-500/30 animate-pulse">
              Offline
            </span>
          )}
          <span className="hidden sm:inline-block text-[8px] bg-gold-brand/10 text-gold-brand font-extrabold px-2 py-0.5 rounded-full uppercase tracking-widest font-sans">
            {settings.vibe}
          </span>
          {pendingCount > 0 ? (
            <span className="text-[8px] bg-amber-950/40 text-amber-400 font-extrabold px-2 py-0.5 rounded-full uppercase tracking-widest font-sans border border-amber-500/30" title={`${pendingCount} unsynced change(s)`}>
              {pendingCount} unsynced
            </span>
          ) : lastSyncedAt ? (
            <span className="hidden md:inline-block text-[8px] bg-emerald-950/40 text-emerald-400 font-extrabold px-2 py-0.5 rounded-full uppercase tracking-widest font-sans border border-emerald-500/30" title="Latest server sync time">
              Synced {formatSyncedAgo(lastSyncedAt)}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-[#0A0A0A] border border-white/5 rounded-xl px-3 py-2 shrink-0 min-h-[40px]">
            <Globe className="w-4 h-4 text-zinc-500" />
            <select value={currency} onChange={(e) => setCurrency(e.target.value as 'UGX' | 'USD')}
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

      <nav className="fixed bottom-0 inset-x-0 w-full z-50 flex justify-around items-center h-16 bg-[#141414] border-t border-white/5 shadow-[0_-4px_20px_rgba(0,0,0,0.5)]">
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
        <button onClick={() => { setIsQuickSale(true); }}
          className="flex flex-col items-center justify-center flex-1 h-full py-1 text-gold-brand transition-all active:scale-95"
          title="Quick Sale">
          <div className="w-10 h-10 rounded-xl bg-gold-brand text-black flex items-center justify-center shadow-[0_0_12px_rgba(255,204,0,0.3)]">
            <Zap className="w-5 h-5" />
          </div>
        </button>
        <button onClick={() => setActiveTab('inventory')} className={`flex flex-col items-center justify-center flex-1 h-full py-1 transition-all active:scale-95 ${activeTab === 'inventory' ? 'text-gold-brand font-black' : 'text-zinc-500 hover:text-zinc-300'}`} id="inventory-nav-btn">
          <Package className="w-5 h-5 mb-1" />
          <span className="text-xs font-bold uppercase tracking-wider">Stock</span>
        </button>
        <button onClick={() => { setActiveTab('registers'); }} className={`flex flex-col items-center justify-center flex-1 h-full py-1 transition-all active:scale-95 ${activeTab === 'registers' ? 'text-gold-brand font-black' : 'text-zinc-500 hover:text-zinc-300'}`} id="registers-nav-btn">
          <LayoutGrid className="w-5 h-5 mb-1" />
          <span className="text-xs font-bold uppercase tracking-wider">Registers</span>
        </button>
        <button onClick={() => { setActiveTab('expenses'); }} className={`flex flex-col items-center justify-center flex-1 h-full py-1 transition-all active:scale-95 ${activeTab === 'expenses' ? 'text-gold-brand font-black' : 'text-zinc-500 hover:text-zinc-300'}`} id="expenses-nav-btn">
          <Wallet className="w-5 h-5 mb-1" />
          <span className="text-xs font-bold uppercase tracking-wider">Spend</span>
        </button>
        <button onClick={() => { setActiveTab('analytics'); setShowSuppliers(false); }} className={`flex flex-col items-center justify-center flex-1 h-full py-1 transition-all active:scale-95 ${activeTab === 'analytics' ? 'text-gold-brand font-black' : 'text-zinc-500 hover:text-zinc-300'}`} id="analytics-nav-btn">
          <TrendingUp className="w-5 h-5 mb-1" />
          <span className="text-xs font-bold uppercase tracking-wider">Reports</span>
        </button>
      </nav>

      {toastMessage && <Toast message={toastMessage} type={toastType} onClose={() => setToastMessage(null)} />}

      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-md p-6 shadow-2xl relative overflow-hidden animate-in fade-in zoom-in-95 duration-200 max-h-[92vh] flex flex-col">
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
            <div className="space-y-4 flex-1 overflow-y-auto pr-1">
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
                  {THEMES_LIST.map(t => (
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
              <div className="space-y-1">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider">USD Exchange Rate (UGX per $)</label>
                <input type="number" min="1" value={settings.usdRate || UGX_TO_USD_RATE}
                  onChange={(e) => setSettings(prev => ({ ...prev, usdRate: Math.max(1, parseFloat(e.target.value) || UGX_TO_USD_RATE) }))}
                  className="w-full h-11 bg-[#0A0A0A] border border-white/5 text-sm px-4 rounded-xl text-white font-bold focus:border-gold-brand outline-none" />
              </div>
              <div className="border-t border-white/5 pt-3 space-y-2">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Security</label>
                <div className="flex gap-2">
                  <button onClick={async () => {
                    const newPin = prompt(settings.hasPin ? 'Enter new 4-digit PIN:' : 'Set a 4-digit PIN:');
                    if (newPin && /^\d{4}$/.test(newPin)) { try { await handleSetPin(newPin); } catch { triggerToast('Failed to save PIN', 'error'); } }
                    else if (newPin) { triggerToast('PIN must be 4 digits', 'error'); }
                  }}
                    className="flex-1 h-10 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider hover:border-gold-brand/40 transition-all cursor-pointer">
                    {settings.hasPin ? 'Change PIN' : 'Set PIN'}
                  </button>
                  {settings.hasPin && (
                    <button onClick={async () => { if (confirm('Remove PIN security?')) { try { await handleSetPin(''); } catch { triggerToast('Failed to remove PIN', 'error'); } } }}
                      className="h-10 px-3 bg-rose-950/20 border border-rose-800/30 text-rose-400 rounded-xl text-[10px] font-bold uppercase tracking-wider hover:bg-rose-950/40 transition-all cursor-pointer">
                      Remove
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-zinc-600">App locks automatically after 10 minutes idle. PIN is required on load.</p>
                <button onClick={handleRevokeAll}
                  className="w-full h-10 bg-rose-950/20 border border-rose-800/30 text-rose-400 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-rose-950/40 transition-all cursor-pointer">
                  Log out all devices
                </button>
                <p className="text-[10px] text-zinc-600">Use if a till is lost/stolen or shared. Ends the session everywhere instantly.</p>
              </div>
              <div className="border-t border-white/5 pt-3 space-y-2">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Data</label>
                <div className="flex items-center justify-between text-[10px] text-zinc-500 font-bold">
                  <span>Server backup</span>
                  <span>{lastBackupAt ? `Last: ${new Date(lastBackupAt).toLocaleString()}` : 'Checking…'}</span>
                </div>
                <button onClick={handleRunBackupNow}
                  className="w-full h-10 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider hover:border-gold-brand/40 transition-all cursor-pointer">
                  Back up to server now
                </button>
                <button onClick={handleExportData}
                  className="w-full h-10 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider hover:border-gold-brand/40 transition-all cursor-pointer flex items-center justify-center gap-2">
                  <Download className="w-4 h-4" /> Download Backup
                </button>
                <button onClick={() => restoreInputRef.current?.click()}
                  className="w-full h-10 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider hover:border-gold-brand/40 transition-all cursor-pointer flex items-center justify-center gap-2">
                  <Download className="w-4 h-4 rotate-180" /> Restore from Backup
                </button>
                <input
                  ref={restoreInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {
                    handleRestoreData(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <p className="text-[10px] text-zinc-600">Restoring merges over existing records. Create a fresh backup first.</p>
              </div>
              <SyncProductsButton triggerToast={triggerToast} onSynced={() => {
                clearProductsCache();
                const apiCacheKey = `boss_api_cache_/api/products`;
                localStorage.removeItem(apiCacheKey);
                const keys = JSON.parse(localStorage.getItem('boss_api_cache_keys') || '[]');
                const filtered = keys.filter((k: string) => k !== apiCacheKey);
                localStorage.setItem('boss_api_cache_keys', JSON.stringify(filtered));
                fetch('/api/products').then(r => r.json()).then((p: Product[]) => {
                  const enriched = enrichProductsWithIcons(p);
                  setProducts(enriched);
                  saveProducts(enriched);
                });
              }} />
              <div className="border-t border-white/5 pt-3 space-y-2">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Activity Log</label>
                <button onClick={() => setShowAudit(v => !v)}
                  className="w-full h-10 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider hover:border-gold-brand/40 transition-all cursor-pointer">
                  {showAudit ? 'Hide' : 'View'} recent activity ({auditEntries.length})
                </button>
                {showAudit && (
                  <div className="space-y-1.5 max-h-56 overflow-y-auto">
                    {auditEntries.map(entry => (
                      <div key={entry.id} className="flex items-start justify-between gap-2 bg-[#0A0A0A] border border-white/5 rounded-xl px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-[10px] font-black text-gold-brand uppercase tracking-wider truncate">{entry.action}</p>
                          <p className="text-[9px] text-zinc-500 font-bold truncate">{entry.detail}</p>
                        </div>
                        <span className="text-[9px] text-zinc-600 font-bold shrink-0">
                          {new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    ))}
                    {auditEntries.length === 0 && (
                      <p className="text-[10px] text-zinc-600 font-bold uppercase text-center py-2">No activity recorded yet.</p>
                    )}
                  </div>
                )}
              </div>
            </div>
            <button onClick={() => { setIsSettingsOpen(false); triggerToast("Settings saved!", "success"); }}
              className="w-full mt-6 h-11 bg-gold-brand text-black font-black uppercase tracking-widest rounded-2xl text-xs hover:opacity-90 active:scale-98 transition-all font-display">
              Done
            </button>
            <p className="text-center text-[9px] text-zinc-600 font-bold uppercase tracking-widest mt-2">
              Build {typeof __BUILD_COMMIT__ === 'string' && __BUILD_COMMIT__ !== 'dev' ? __BUILD_COMMIT__.slice(0, 7) : 'dev'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
