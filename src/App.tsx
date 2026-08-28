import { useState, useEffect, lazy, Suspense, useRef, useMemo, useCallback } from 'react';
import { 
  ShoppingCart, Package, TrendingUp, Menu, Settings, X, Palette, Wallet, Download, Scissors, RefreshCw
} from 'lucide-react';
import { Product, Sale, Expense, Supplier, SaleItem, AppTheme, StoreSettings, CreditPayment, CreditEat, ProductionRegister, WastageLog, MomoTransfer } from './types';
import { productApi, supplierApi, saleApi, expenseApi, settingsApi, sheetsApi, creditPaymentApi, creditEatApi, productionRegisterApi, wastageLogApi, momoTransferApi, authVerify, authStatus, authSetPin, authMigratePin, flushOutbox, outboxCount, peekOutbox, clearOutbox, exportApi, restoreApi, getAuthToken, readCached, bootApi, primeCache, revokeAllSessions, backupsApi, auditApi, reconcileApi, ApiError, type BootData, type AuditEntry } from './api';
import { enrichProductsWithIcons } from './data/icons';
import { saveProducts, loadProducts, clearProductsCache } from './utils/cache';
import { UGX_TO_USD_RATE } from './data/constants';
import { verifyPinAgainstHash } from './utils/crypto';
import { downloadBlob } from './utils/download';
import { printDailyClose } from './utils/dailyClose';
import { initSentry } from './utils/sentry';
import { logPriceChange } from './utils/priceHistory';

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
  shopName: 'My Shop',
  themeId: 'gold',
  vibe: 'General Store',
  defaultPaymentMethod: 'Cash',
  dailyGoalNum: 10,
  usdRate: UGX_TO_USD_RATE,
  showTailoring: false,
  showDesign: false,
  sheetsUrl: '',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'sales' | 'inventory' | 'analytics' | 'expenses' | 'registers'>('sales');
  const [showSuppliers, setShowSuppliers] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authState, setAuthState] = useState<'booting' | 'locked' | 'ready'>('booting');

  const [settings, setSettings] = useState<StoreSettings>(DEFAULT_SETTINGS);
  const [staffName, setStaffName] = useState<string>(() => localStorage.getItem('boss_pos_staff') || '');
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
  const [auditFilter, setAuditFilter] = useState('');
  const [updatingApp, setUpdatingApp] = useState(false);
  const [sheetStatus, setSheetStatus] = useState<{ configured: boolean; lastError: string | null; lastOkAt: string | null } | null>(null);
  const [outboxPreview, setOutboxPreview] = useState<{ path: string; method: string; age: string }[]>([]);
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [reconcileResult, setReconcileResult] = useState<{ salesChecked: number; totalMismatches: number; negativeStock: { id: string; name: string; qty: number }[] } | null>(null);

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

  useEffect(() => { initSentry(); }, []);
  // Boot: try open-mode auth, migrate an existing client PIN, then load data.
  // Offline-first: old Androids report navigator.onLine=true on dead WiFi, so we
  // NEVER trust it to decide the offline path. If this device has been used
  // before (cached data exists) and isn't a locked till, render instantly from
  // cache and refresh in the background instead of blocking on the network.
  useEffect(() => {
    (async () => {
      let serverHasPin: boolean | null = null;
      let shopName = '';

      const cachedSettings = readCached<StoreSettings>('/api/settings');
      if (cachedSettings?.shopName) setSettings(prev => ({ ...prev, shopName: cachedSettings.shopName }));

      // Fast path: we already know a PIN is set on the server from a previous
      // unlock. Show the lock screen immediately (offline included) instead of
      // burning 1-2 network round-trips that can hang on dead WiFi.
      if (localStorage.getItem('boss_pos_has_pin') === 'true') {
        setAuthState('locked');
        return;
      }

      const cachedProducts = loadProducts();
      const hasCachedData = !!cachedProducts || !!readCached<BootData>('/api/boot');
      const token = getAuthToken();

      // Offline-first: previously-used device that isn't a locked till opens
      // straight from cache. No round-trip ever blocks the screen, so offline
      // boots are instant even when the network lies.
      if (hasCachedData && (token || localStorage.getItem('boss_pos_has_pin') === 'false')) {
        setAuthState('ready');
        fetchAllData().catch(() => {});
        return;
      }

      // First run / unknown PIN state: must ask the server (bounded by
      // fetchTimeout, so this can't hang forever).
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
        // Offline / flaky network: don't trust navigator.onLine here. A till
        // that has cached data (and isn't PIN-locked) opens from cache; a
        // genuinely locked till still waits for the PIN screen.
        const storedHasPin = localStorage.getItem('boss_pos_has_pin') === 'true';
        const canBootOffline = !storedHasPin && (getAuthToken() || hasCachedData || !!loadProducts());
        if (canBootOffline) {
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

  // Live browser-tab/app title follows the shop name from settings. The static
  // index.html title is just the build-time brand; this keeps it accurate for
  // fleet shops and unchanged for IMAC (same value).
  useEffect(() => {
    const name = settings.shopName || 'POS';
    document.title = name;
    const meta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (meta) meta.setAttribute('content', name);
  }, [settings.shopName]);

  // Multi-till visibility: silently re-boot every 3 minutes so changes made on
  // a second till show up without a manual reload. Skipped while offline and
  // never overlapped. Keeps the "Synced Xm ago" pill honest too.
  useEffect(() => {
    if (authState !== 'ready') return;
    let busy = false;
    const syncNow = async () => {
      if (!navigator.onLine || busy) return;
      busy = true;
      try {
        // Flush any queued offline writes first so they land before we pull.
        const pending = outboxCount();
        if (pending > 0) {
          const n = await flushOutbox();
          if (n > 0) triggerToast(`Synced ${n} offline change(s)`, 'success');
        }
        const d = await bootApi.get();
        applyBootData(d);
        setPendingCount(outboxCount());
      } catch {} finally {
        busy = false;
      }
    };
    const iv = setInterval(syncNow, 30 * 1000);
    const onVis = () => {
      if (document.visibilityState === 'visible') syncNow();
    };
    const onFocus = () => syncNow();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
    };
  }, [authState, applyBootData]);

  // SSE instant sync — other tills push 'change' via /api/events broadcast
  useEffect(() => {
    if (authState !== 'ready') return;
    const token = getAuthToken();
    if (!token || typeof EventSource === 'undefined') return;
    let es: EventSource | null = null;
    let closed = false;
    const connect = () => {
      if (closed) return;
      try {
        es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
        es.onmessage = () => {
          // Debounce burst writes (multiple SSE in quick succession)
          setTimeout(async () => {
            try {
              const d = await bootApi.get();
              applyBootData(d);
            } catch {}
          }, 300);
        };
        es.onerror = () => {
          try { es?.close(); } catch {}
          // Reconnect after 5s (Vercel closes after 25s anyway)
          setTimeout(() => { if (!closed) connect(); }, 5000);
        };
      } catch {
        // Fallback stays on 30s poll above
      }
    };
    connect();
    return () => { closed = true; try { es?.close(); } catch {} };
  }, [authState, applyBootData]);

  // PWA install prompt capture
  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  // Refresh the offline-pending badge + "Synced" pill every 30s.
  useEffect(() => {
    const iv = setInterval(() => setPendingCount(outboxCount()), 30_000);
    // Keep badge honest after any flush that mutates the queue
    const onStorage = () => setPendingCount(outboxCount());
    window.addEventListener('boss-pos-outbox-updated', onStorage);
    return () => {
      clearInterval(iv);
      window.removeEventListener('boss-pos-outbox-updated', onStorage);
    };
  }, []);

  // Low-stock / negative-stock alerts
  const lowNotifiedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (authState !== 'ready' || products.length === 0) return;
    const neg = products.filter(p => !p.isService && p.stockQty < 0);
    if (neg.length > 0) {
      triggerToast(`${neg.length} items have NEGATIVE stock — tap to reconcile`, 'error');
      // Auto-clamp negative stock locally until server reconcile runs
      // (server POST /api/reconcile?fix=1 does authoritative clamp)
    }
    if (typeof Notification === 'undefined') return;
    const low = products.filter(p => !p.isService && p.stockQty <= (p.lowStockThreshold || 5) && p.stockQty >= 0);
    if (low.length === 0) { lowNotifiedRef.current.clear(); return; }
    const newlyLow = low.filter(p => !lowNotifiedRef.current.has(p.id));
    if (newlyLow.length === 0) return;
    newlyLow.forEach(p => lowNotifiedRef.current.add(p.id));
    const fire = () => {
      if (Notification.permission === 'granted') {
        low.slice(0, 3).forEach(p => {
          try { new Notification(`Low stock: ${p.name}`, { body: `${p.stockQty} left (threshold ${p.lowStockThreshold || 5})`, icon: '/pwa-192x192.png' }); } catch {}
        });
        if (low.length > 3) triggerToast(`${low.length} items low on stock — check Inventory`, 'error');
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(perm => {
          if (perm === 'granted') fire();
        });
      } else {
        if (newlyLow.length > 0) triggerToast(`${newlyLow.length} items low on stock`, 'error');
      }
    };
    if (document.visibilityState === 'visible') fire();
  }, [products, authState]);

  // Outbox inspector data for Settings
  useEffect(() => {
    if (!isSettingsOpen) return;
    const load = async () => {
      try {
        const list = peekOutbox();
        const fmt = (queuedAt: number) => {
          const m = Math.round((Date.now() - queuedAt)/60000);
          return m < 1 ? 'now' : m < 60 ? `${m}m` : `${Math.round(m/60)}h`;
        };
        setOutboxPreview(list.slice(0, 8).map(e => ({ path: e.path, method: e.method, age: fmt(e.queuedAt) })));
      } catch {}
    };
    load();
    const h = () => load();
    window.addEventListener('boss-pos-outbox-updated', h);
    return () => window.removeEventListener('boss-pos-outbox-updated', h);
  }, [isSettingsOpen, pendingCount]);

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
  const onSyncDropped = (e: Event) => {
    const n = (e as CustomEvent).detail || 1;
    triggerToast(`${n} offline change(s) couldn't be saved (e.g. sold out) — cleared from queue. Check stock.`, 'error');
    fetchAllData();
    setPendingCount(outboxCount());
  };
  useEffect(() => {
    window.addEventListener('boss-pos-sync-dropped', onSyncDropped);
    return () => window.removeEventListener('boss-pos-sync-dropped', onSyncDropped);
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
        const hadToken = !!getAuthToken();
        const n = await flushOutbox();
        const stillHasToken = !!getAuthToken();
        if (n > 0) {
          triggerToast(`Synced ${n} offline change(s)`, 'success');
          fetchAllData();
        } else if (outboxCount() > 0 && hadToken && stillHasToken) {
          // Non-auth failure at this point is either network (offline event would have fired)
          // or permanent drop. Don't spam "Re-unlock" — silent retry + badge is enough.
          // User can Force sync in Settings for details.
        }
        setPendingCount(outboxCount());
      } catch {
        // Swallow — transient, will retry on next interval
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
        // Auth failures lock via boss-pos-auth-revoked; network failures are silent;
        // permanent drops are reported via boss-pos-sync-dropped.
        if (n > 0) {
          triggerToast(`Synced ${n} offline change(s)`, 'success');
          fetchAllData();
        }
        setPendingCount(outboxCount());
      } catch {}
    })();
  }, [authState]);

  // Persist settings (skip the very first render so we never clobber server
  // values with defaults before the real settings finish loading). Debounced so
  // typing in the shop-name field doesn't fire a PUT (DB write + cache clear)
  // on every keystroke. Also diff so boot-pull doesn't echo back the same
  // payload and create a constant PUT loop (the source of "constantly failed
  // to save settings").
  const lastSentSettingsRef = useRef<string>('');
  useEffect(() => {
    if (!readyRef.current) return;
    const ALLOWED = new Set([
      'shopName','themeId','vibe','defaultPaymentMethod','dailyGoalNum','shopType','language','usdRate',
      'categories','expenseCategories','showTailoring','showDesign','sheetsUrl','eodCapital',
    ]);
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(settings as unknown as Record<string, unknown>)) {
      if (k === 'hasPin' || k === 'clientWriteId' || k === 'deviceId') continue;
      if (!ALLOWED.has(k)) continue;
      filtered[k] = v;
    }
    const serialized = JSON.stringify(filtered);
    if (serialized === lastSentSettingsRef.current) return;
    // Don't echo the just-booted value back immediately — wait for a user edit
    if (lastSentSettingsRef.current === '' ) {
      lastSentSettingsRef.current = serialized;
      return;
    }
    const t = setTimeout(() => {
      lastSentSettingsRef.current = serialized;
      settingsApi.update(filtered as unknown as StoreSettings).catch((err) => {
        const msg = err instanceof ApiError ? err.message : String(err?.message || err);
        // 401 means token expired — prompt re-login, don't spam toast
        if (err instanceof ApiError && err.status === 401) {
          triggerToast('Session expired — re-enter PIN to save settings', 'error');
        } else {
          triggerToast(`Failed to save settings: ${msg.slice(0, 80)}`, 'error');
        }
      });
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

  // Cashier attribution: the asking only happens ONCE per device. The name is
  // saved in localStorage, so each phone remembers its seller between logins.
  useEffect(() => {
    localStorage.setItem('boss_pos_staff', staffName || '');
  }, [staffName]);

  const staffPromptedRef = useRef(false);
  useEffect(() => {
    if (authState !== 'ready' || staffName || staffPromptedRef.current) return;
    staffPromptedRef.current = true;
    if (localStorage.getItem('boss_pos_staff_prompted') === '1') return;
    setTimeout(() => {
      const name = window.prompt('Who is selling? (cashier name — asked once for this phone)');
      if (name && name.trim()) setStaffName(name.trim());
      localStorage.setItem('boss_pos_staff_prompted', '1');
    }, 700);
  }, [authState, staffName]);

  useEffect(() => {
    localStorage.setItem('boss_pos_cart', JSON.stringify(cart));  }, [cart]);

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
    const cachedSettings = readCached<StoreSettings>('/api/settings');
    if (cachedSettings?.shopName) setSettings(prev => ({ ...prev, shopName: cachedSettings.shopName }));
    // Online: always try server first so we mint a fresh token (fixes 7-day TTL
    // and revoke-all invalid token → every sale 401 → immediate re-lock loop).
    // Only fall back to local hash if server is unreachable.
    if (navigator.onLine) {
      try {
        const data = await authVerify(pin);
        localStorage.setItem('boss_pos_has_pin', String(data.hasPin));
        setAuthState('ready');
        fetchAllData().catch(() => {});
        return;
      } catch (err) {
        // Network failure — fall through to local hash fallback so sales still work offline.
        const msg = String((err as Error)?.message || '');
        const isNetwork = /Network timeout|fetch failed|Failed to fetch/i.test(msg);
        if (!isNetwork) {
          // Wrong PIN or server rejected — don't fall back to stale local hash.
          throw err;
        }
      }
    }
    // Offline or server unreachable: verify against local hash.
    const local = localStorage.getItem('boss_pos_pin');
    if (local && !local.startsWith('fb_') && await verifyPinAgainstHash(pin, local)) {
      setAuthState('ready');
      fetchAllData().catch(() => {});
      // If we unlocked offline, try to mint token in background once back online.
      if (navigator.onLine) authVerify(pin).catch(() => {});
      return;
    }
    // No local hash or mismatch — try server one last time (will throw Wrong PIN).
    const data = await authVerify(pin);
    localStorage.setItem('boss_pos_has_pin', String(data.hasPin));
    setAuthState('ready');
    fetchAllData().catch(() => {});
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
      const slug = (settings.shopName || 'pos').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const ok = downloadBlob(blob, `${slug}-backup-${new Date().toISOString().slice(0, 10)}.json`);
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
    sheetsApi.status().then(setSheetStatus).catch(() => setSheetStatus(null));
  }, [isSettingsOpen]);

  const handleTestSheets = async () => {
    if (!settings.sheetsUrl || !/^https:\/\//.test(settings.sheetsUrl)) {
      triggerToast('Paste your web-app URL first', 'error');
      return;
    }
    try {
      await sheetsApi.test();
      sheetsApi.status().then(setSheetStatus).catch(() => {});
      triggerToast('Connected! Test row sent to your sheet', 'success');
    } catch (err) {
      const message = (err as { message?: string })?.message || 'Connection failed';
      triggerToast(message.replace(/^Error:\s*/i, ''), 'error');
    }
  };

  // Force the installed PWA to check for a newer build and restart into it.
  // Eases stale service-worker caches — the #1 cause of "the button still
  // doesn't work" on phones that installed the app weeks ago.
  const handleCheckUpdate = async () => {
    if (!('serviceWorker' in navigator)) {
      triggerToast('Update not supported here — open the website in your browser', 'info');
      return;
    }
    setUpdatingApp(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        triggerToast('Not installed as an app — just open the website', 'info');
        return;
      }
      await reg.update();
      const pending = reg.installing || reg.waiting;
      if (pending) {
        triggerToast('Update found — restarting the app…', 'success');
        setTimeout(() => window.location.reload(), 1500);
      } else {
        const build = typeof __BUILD_COMMIT__ === 'string' && __BUILD_COMMIT__ !== 'dev' ? __BUILD_COMMIT__.slice(0, 7) : 'dev';
        triggerToast(`Already the newest build (${build})`, 'success');
      }
    } catch {
      triggerToast('Update check failed — are you online?', 'error');
    } finally {
      setUpdatingApp(false);
    }
  };

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
    return new Intl.NumberFormat('en-UG', {
      style: 'currency', currency: 'UGX',
      minimumFractionDigits: 0, maximumFractionDigits: 0
    }).format(ugxVal);
  };

  const handleAddProduct = async (newProd: Product) => {
    const stamped = { ...newProd, updatedAt: new Date().toISOString() };
    const prodWithIcon = enrichProductsWithIcons([stamped])[0];
    setProducts(prev => [prodWithIcon, ...prev]);
    try {
      const saved = await productApi.create(stamped);
      if (saved?.updatedAt) {
        setProducts(prev => prev.map(p => p.id === saved.id ? { ...p, updatedAt: saved.updatedAt } : p));
      }
    } catch {
      setProducts(prev => prev.filter(p => p.id !== prodWithIcon.id));
      triggerToast('Failed to save product — not added', 'error');
    }
  };

  // Custom items added at the till are saved into their chosen category so the
  // shop's library fills up and staff never re-type the same item every day.
  // Matching name+category is reused (no duplicates); services keep no stock.
  const handleSaveCustomProduct = async (custom: Product) => {
    const existing = products.find(p => p.name.trim().toLowerCase() === custom.name.trim().toLowerCase() && p.category === custom.category);
    if (existing) {
      triggerToast(`Saved in ${custom.category || 'category'} — tap it from the list next time`, 'info');
      return;
    }
    const stamped = {
      ...custom,
      id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      isService: true,
      updatedAt: new Date().toISOString(),
    };
    const prodWithIcon = enrichProductsWithIcons([stamped])[0];
    setProducts(prev => [prodWithIcon, ...prev]);
    try {
      const saved = await productApi.create(stamped);
      if (saved?.updatedAt) {
        setProducts(prev => prev.map(p => p.id === saved.id ? { ...p, updatedAt: saved.updatedAt } : p));
      }
    } catch {
      setProducts(prev => prev.filter(p => p.id !== prodWithIcon.id));
      triggerToast('Could not save item to the library right now', 'info');
    }
  };

  const handleUpdateProduct = async (updatedProd: Product) => {
    const prev = products.find(p => p.id === updatedProd.id);
    if (prev && prev.price !== updatedProd.price) logPriceChange(prev.id, prev.name, prev.price, updatedProd.price);
    const stamped = { ...updatedProd, updatedAt: new Date().toISOString() };
    setProducts(list => list.map(p => p.id === stamped.id ? stamped : p));
    try {
      const saved = await productApi.update(stamped);
      if (saved?.updatedAt) {
        setProducts(list => list.map(p => p.id === saved.id ? { ...p, updatedAt: saved.updatedAt } : p));
      }
    } catch (err) {
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
    try { await saleApi.create(newSale); } catch (err) {
      // Real server failure (not offline — offline writes are queued and would
      // have returned optimistic success). Roll the sale and its stock effect
      // back so the UI never shows an unsaved sale.
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
      if (err instanceof ApiError && err.code === 'INSUFFICIENT_STOCK') {
        triggerToast('Not enough stock — another till just sold the last one. Stock refreshed, try again.', 'error');
        fetchAllData();
      } else if (err instanceof ApiError && err.status === 401) {
        triggerToast('Not logged in — re-enter PIN and retry.', 'error');
      } else if (err instanceof ApiError && err.message) {
        triggerToast(err.message.slice(0, 120), 'error');
      } else {
        triggerToast('Failed to save sale — not recorded. Refresh stock and retry.', 'error');
      }
    }
  };

  // Ask for the PIN before destructive actions (refund / delete a sale). If no
  // PIN is set yet, skip the prompt.
  const requirePin = async (message: string): Promise<boolean> => {
    if (!settings.hasPin) return true;
    const hash = localStorage.getItem('boss_pos_pin');
    if (!hash || hash.startsWith('fb_')) return true; // can't verify offline — trust this device
    const pin = window.prompt(message);
    if (!pin) return false;
    if (await verifyPinAgainstHash(pin, hash)) return true;
    triggerToast('Wrong PIN — action cancelled', 'error');
    return false;
  };

  // Permanently delete a wrong order: PIN + confirm, stock goes back in.
  const handleVoidSale = async (saleId: string) => {
    const sale = sales.find(s => s.id === saleId);
    if (!sale || sale.refunded) return;
    if (!(await requirePin(`Enter PIN to delete ${sale.orderNumber}:`))) return;
    if (!confirm(`Delete ${sale.orderNumber} (${formatCurrency(sale.total)})? Stock goes back in.`)) return;
    setSales(prev => prev.filter(s => s.id !== saleId));
    setProducts(prev => prev.map(p => {
      const it = sale.items.find(i => i.productId === p.id);
      return it && !p.isService ? { ...p, stockQty: p.stockQty + it.qty } : p;
    }));
    try { await saleApi.remove(saleId); } catch {
      setSales(prev => [sale, ...prev].sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
      setProducts(prev => prev.map(p => {
        const it = sale.items.find(i => i.productId === p.id);
        return it && !p.isService ? { ...p, stockQty: Math.max(0, p.stockQty - it.qty) } : p;
      }));
      triggerToast('Failed to delete sale — order restored', 'error');
      return;
    }
    triggerToast(`${sale.orderNumber} deleted`, 'info');
  };

  const handleRefundSale = async (saleId: string) => {
    const saleToRefund = sales.find(s => s.id === saleId);
    if (!saleToRefund || saleToRefund.refunded) return;
    if (!(await requirePin(`Enter PIN to refund ${saleToRefund.orderNumber}:`))) return;
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
            staffName={staffName} setStaffName={setStaffName}
            onSaveCustomProduct={handleSaveCustomProduct}
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
            staffName={staffName || undefined}
            eodCapital={settings.eodCapital}
            onSetEodCapital={(cat, value) => setSettings(prev => ({ ...prev, eodCapital: { ...(prev.eodCapital || {}), [cat]: value } }))}
            formatCurrency={formatCurrency} triggerToast={triggerToast}
            onBack={() => setActiveTab('analytics')}
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
            onVoidSale={handleVoidSale}
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
          {installPrompt && (
            <button onClick={async () => {
              try { (installPrompt as unknown as { prompt: () => void }).prompt(); } catch {}
              setInstallPrompt(null);
            }} className="hidden sm:flex h-8 px-3 bg-gold-brand text-black font-black text-[10px] rounded-lg uppercase tracking-wider hover:opacity-90">
              Install
            </button>
          )}
          <button onClick={() => setIsSettingsOpen(true)} className="p-2 bg-[#0A0A0A] border border-white/5 hover:border-gold-brand/40 text-zinc-400 hover:text-gold-brand rounded-xl transition-all cursor-pointer shrink-0" title="Settings" id="settings-gear-btn">
            <Settings className="w-4 h-4" />
          </button>
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
        <button onClick={() => setActiveTab('inventory')} className={`flex flex-col items-center justify-center flex-1 h-full py-1 transition-all active:scale-95 ${activeTab === 'inventory' ? 'text-gold-brand font-black' : 'text-zinc-500 hover:text-zinc-300'}`} id="inventory-nav-btn">
          <Package className="w-5 h-5 mb-1" />
          <span className="text-xs font-bold uppercase tracking-wider">Stock</span>
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
            <button onClick={handleCheckUpdate} disabled={updatingApp}
              className="w-full h-10 mb-4 bg-gold-brand/10 border border-gold-brand/30 text-gold-brand rounded-xl text-xs font-black uppercase tracking-wider hover:bg-gold-brand/20 transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60">
              <RefreshCw className={`w-4 h-4 ${updatingApp ? 'animate-spin' : ''}`} /> {updatingApp ? 'Checking…' : 'Update app to newest version'}
            </button>
            <div className="space-y-4 flex-1 overflow-y-auto pr-1">
              <div className="space-y-1">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Shop Name</label>
                <input type="text" value={settings.shopName} onChange={(e) => setSettings(prev => ({ ...prev, shopName: e.target.value || 'My Shop' }))}
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
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Extra Modules</label>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setSettings(prev => ({ ...prev, showTailoring: !prev.showTailoring }))}
                    className={`py-3 rounded-xl border text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2 ${settings.showTailoring ? 'border-gold-brand bg-gold-brand/10 text-white' : 'bg-[#0A0A0A] border-transparent text-zinc-500 hover:text-zinc-300'}`}>
                    <Scissors className="w-3.5 h-3.5" /> Tailoring
                  </button>
                  <button onClick={() => setSettings(prev => ({ ...prev, showDesign: !prev.showDesign }))}
                    className={`py-3 rounded-xl border text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2 ${settings.showDesign ? 'border-gold-brand bg-gold-brand/10 text-white' : 'bg-[#0A0A0A] border-transparent text-zinc-500 hover:text-zinc-300'}`}>
                    <Palette className="w-3.5 h-3.5" /> Design & Print
                  </button>
                </div>
                <p className="text-[10px] text-zinc-600">Turn on the order screens you actually use. Hidden until enabled.</p>
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
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Who is selling</label>
                <input type="text" value={staffName} placeholder="Cashier / seller name"
                  onChange={(e) => setStaffName(e.target.value)}
                  className="w-full h-12 bg-[#0A0A0A] border border-white/5 text-sm px-4 rounded-xl text-white font-bold focus:border-gold-brand outline-none" />
                <p className="text-[10px] text-zinc-600">Every sale is stamped with this name so Reports can show sales by seller.</p>
              </div>
              <div className="border-t border-white/5 pt-3 space-y-2">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1">
                  <Download className="w-3.5 h-3.5 text-emerald-400" /> Google Sheets
                </label>
                <input type="url" value={settings.sheetsUrl || ''} placeholder="Paste web-app URL (https://script.google.com/macros/s/...)"
                  onChange={(e) => setSettings(prev => ({ ...prev, sheetsUrl: e.target.value }))}
                  className="w-full h-12 bg-[#0A0A0A] border border-white/5 text-sm px-4 rounded-xl text-white font-bold focus:border-emerald-500 outline-none" />
                <button onClick={handleTestSheets}
                  className="w-full h-10 bg-emerald-950/30 border border-emerald-800/40 text-emerald-400 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-emerald-950/50 transition-all cursor-pointer">
                  Test Connection
                </button>
                {sheetStatus && (
                  <div className={`rounded-xl px-3 py-2 text-[10px] font-bold border ${sheetStatus.lastError ? 'border-rose-800/40 bg-rose-950/20 text-rose-300' : 'border-emerald-800/40 bg-emerald-950/20 text-emerald-300'}`}>
                    {sheetStatus.lastError ? (
                      <>Last sale/expense did NOT reach the sheet — {sheetStatus.lastError}</>
                    ) : sheetStatus.lastOkAt ? (
                      <>Sheet synced OK — last successful send {new Date(sheetStatus.lastOkAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</>
                    ) : (
                      <>Not connected yet — paste your URL and tap Test Connection.</>
                    )}
                  </div>
                )}
                <p className="text-[10px] text-zinc-600 leading-relaxed">Every sale and expense is added to the sheet automatically. To set up: create a Google Sheet → Extensions → Apps Script → paste the script from the repo (scripts/appsscript-sheet.gs) → Deploy → Web app → paste the <span className="text-zinc-400">/exec</span> URL here.</p>
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
                <div className="flex gap-2">
                  <button onClick={async () => {
                    const before = outboxCount();
                    const n = await flushOutbox();
                    setPendingCount(outboxCount());
                    if (n > 0) triggerToast(`Force-synced ${n} change(s)`, 'success');
                    else if (outboxCount() > 0) {
                      const sample = peekOutbox().slice(0,3).map(e=>e.path).join(', ');
                      triggerToast(`Still ${outboxCount()}/${before} queued (${sample || 'retry'}) — re-enter PIN if needed`, 'error');
                    } else triggerToast(before>0 ? 'Queue now empty' : 'Nothing pending', 'info');
                    if (n>0) fetchAllData();
                  }}
                    className="flex-1 h-10 bg-emerald-950/30 border border-emerald-800/40 text-emerald-400 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-emerald-950/50 transition-all cursor-pointer">
                    Force sync now
                  </button>
                  <button onClick={async () => {
                    if (!confirm(`Clear ALL ${outboxCount()} unsynced changes? This discards offline edits that failed to reach the server.`)) return;
                    clearOutbox();
                    setPendingCount(0);
                    triggerToast('Queue cleared — refresh to pull latest', 'info');
                  }}
                    className="flex-1 h-10 bg-rose-950/30 border border-rose-800/40 text-rose-400 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-rose-950/50 transition-all cursor-pointer">
                    Clear queue
                  </button>
                </div>
                {pendingCount > 0 && outboxPreview.length > 0 && (
                  <div className="rounded-xl border border-amber-800/30 bg-amber-950/20 overflow-hidden">
                    <div className="px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-amber-300 border-b border-amber-800/20">Queue — {pendingCount} pending</div>
                    <div className="divide-y divide-white/5 max-h-32 overflow-y-auto">
                      {outboxPreview.map((e, i) => (
                        <div key={i} className="flex items-center justify-between px-3 py-1.5 text-[10px] font-bold">
                          <span className="text-zinc-300 truncate pr-2">{e.method} {e.path}</span>
                          <span className="text-zinc-500 shrink-0">{e.age} ago</span>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => {
                      const list = peekOutbox();
                      if (!list.length) return;
                      const kept = list.slice(1);
                      try { localStorage.setItem('boss_pos_outbox', JSON.stringify(kept)); } catch {}
                      try { window.dispatchEvent(new Event('boss-pos-outbox-updated')); } catch {}
                      setPendingCount(kept.length);
                      triggerToast('Dropped oldest queued change', 'info');
                    }} className="w-full h-7 text-[9px] font-black uppercase tracking-wider text-amber-400 hover:bg-amber-950/40">Drop oldest</button>
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={async () => {
                    try {
                      const r = await reconcileApi.check();
                      setReconcileResult(r);
                      if (r.totalMismatches===0 && r.negativeStock.length===0 && r.dupOrderNumbers.length===0) triggerToast(`Reconcile OK: ${r.salesChecked} sales checked`, 'success');
                      else triggerToast(`Found ${r.totalMismatches} total mismatches, ${r.negativeStock.length} negative stock`, 'error');
                    } catch { triggerToast('Reconcile check failed', 'error'); }
                  }} className="flex-1 h-10 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider hover:border-gold-brand/40">Check gaps</button>
                  <button onClick={async () => {
                    if (!confirm('Fix totals & clamp negative stock? This writes to server.')) return;
                    try {
                      const r = await reconcileApi.fix();
                      setReconcileResult({ salesChecked: r.salesChecked, totalMismatches: r.totalMismatches, negativeStock: r.negativeStock });
                      triggerToast(`Fixed ${r.totalFixes} totals, ${r.negativeFixed} stock`, 'success');
                      fetchAllData();
                    } catch { triggerToast('Reconcile fix failed', 'error'); }
                  }} className="flex-1 h-10 bg-emerald-950/30 border border-emerald-800/40 text-emerald-400 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-emerald-950/50">Fix gaps</button>
                </div>
                {reconcileResult && (
                  <div className="rounded-xl border border-white/5 bg-[#0A0A0A] p-3 text-[10px] font-bold">
                    <div className="text-zinc-300">{reconcileResult.salesChecked} sales checked — {reconcileResult.totalMismatches} total mismatches</div>
                    {reconcileResult.negativeStock.length > 0 && <div className="text-rose-300">{reconcileResult.negativeStock.slice(0,3).map(s=>`${s.name} (${s.qty})`).join(', ')}</div>}
                    {reconcileResult.negativeStock.length===0 && reconcileResult.totalMismatches===0 && <div className="text-emerald-300">No gaps</div>}
                  </div>
                )}
                <button onClick={() => printDailyClose(new Date().toISOString().slice(0,10), sales, expenses, products)}
                  className="w-full h-10 bg-gold-brand/10 border border-gold-brand/30 text-gold-brand rounded-xl text-xs font-black uppercase tracking-wider hover:bg-gold-brand/20">
                  Print Daily Close (PDF)
                </button>
                <button onClick={async () => {
                  try {
                    const b = await backupsApi.data();
                    const curProds = products.length;
                    const backupProds = (b.data as unknown as { products?: unknown[] })?.products?.length ?? 0;
                    const curSales = sales.length;
                    const backupSales = (b.data as unknown as { sales?: unknown[] })?.sales?.length ?? 0;
                    triggerToast(`Backup diff — Products: ${curProds} now vs ${backupProds} backup, Sales: ${curSales} vs ${backupSales}`, 'info');
                  } catch { triggerToast('Backup diff failed', 'error'); }
                }} className="w-full h-10 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider hover:border-gold-brand/40">Compare with last backup</button>
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
                  <div className="space-y-2">
                    <input type="text" value={auditFilter} onChange={e=>setAuditFilter(e.target.value)} placeholder="Filter by action or detail..." className="w-full h-9 bg-[#0A0A0A] border border-white/5 text-xs px-3 rounded-xl text-white placeholder-zinc-600 focus:border-gold-brand outline-none" />
                    <div className="space-y-1.5 max-h-56 overflow-y-auto">
                      {auditEntries.filter(e=> !auditFilter || e.action.toLowerCase().includes(auditFilter.toLowerCase()) || e.detail.toLowerCase().includes(auditFilter.toLowerCase())).map(entry => (
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
                      {auditEntries.filter(e=> !auditFilter || e.action.toLowerCase().includes(auditFilter.toLowerCase()) || e.detail.toLowerCase().includes(auditFilter.toLowerCase())).length === 0 && (
                        <p className="text-[10px] text-zinc-600 font-bold uppercase text-center py-2">No matching activity</p>
                      )}
                    </div>
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
