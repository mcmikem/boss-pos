import { useState, useEffect, Suspense, useRef, useMemo, useCallback } from 'react';
import { lazyRetry } from './utils/lazyRetry';
import FirstSaleTour, { isTourDone } from './components/FirstSaleTour';
import { 
  ShoppingCart, Package, TrendingUp, Settings, X, Palette, Wallet, Download, Scissors, RefreshCw, LayoutGrid, ReceiptText, Moon, Sun, User, CalendarCheck, Wrench, Ellipsis, ChevronRight, Mail
} from 'lucide-react';
import type { ComponentType } from 'react';
import { Store, Users, Database, ChevronDown } from 'lucide-react';
import { Product, Sale, Expense, Supplier, SupplierPrice, StaffMember, SaleItem, AppTheme, StoreSettings, CreditPayment, CreditEat, ProductionRegister, WastageLog, MomoTransfer, EfrisConfig, SaleSaveResult } from './types';
import { productApi, supplierApi, supplierPriceApi, staffApi, saleApi, expenseApi, settingsApi, sheetsApi, efrisApi, creditPaymentApi, creditEatApi, customerApi, productionRegisterApi, wastageLogApi, momoTransferApi,   authVerify, authStatus, authSetPin, authMigratePin, flushOutbox, flushOutboxDetailed, outboxCountAsync, outboxCountsAsync, listOutboxItemsAsync, clearOutboxAsync, dismissOutboxEntryAsync, retryOutboxEntry, exportApi, restoreApi, getAuthToken, readCached, bootApi, primeCache, revokeAllSessions, emitAuthRevoked, backupsApi, auditApi, reconcileApi, supportApi, closeSessionApi, markUnlocked,   handoverApi, closeSummaryApi, productionPlanApi, uploadImage, normalizeExpenses, ApiError, setStaffToken, backupRowTotal, backupTableRows, type BootData, type HandoverSummary, type CloseSummary, type AuditEntry, type OutboxEntry, type OutboxCounts, type OutboxFlushReport, type ReadyReport, type RestorePreflight } from './api';
import { enrichProductsWithIcons } from './data/icons';
import { saveProducts, loadProducts, clearProductsCache } from './utils/cache';
import { checkoutDraftScopeKey, readCheckoutDraftSync, loadActiveCheckoutDraft, saveActiveCheckoutDraft, clearActiveCheckoutDraft, type CheckoutDraftScope } from './utils/checkoutDraft';
import { t } from './utils/i18n';
import { momoFeeFor } from './utils/fees';
import { supplierWhatsAppUrl } from './utils/suppliers';
import { UGX_TO_USD_RATE } from './data/constants';
import { verifyPinAgainstHash } from './utils/crypto';
import { recordLock, readLockLog, clearLockLog, isRapidRelock, type LockEvent } from './utils/locklog';
import { FEATURES, isOn, type FeatureKey } from './utils/features';
import { downloadBlob } from './utils/download';
import { computeKeptItems, scaleKept } from './utils/returns';
import type { CustomerProfile } from './utils/customers';
import { loadCustomers } from './utils/customers';
import { isPastClose, middayStamp } from './utils/dates';
import { readSyncReview, clearSyncReview, buildReconnectReport, type SyncReviewItem } from './utils/syncReview';
import { salesCsv, productsCsv, creditCsv } from './utils/csv';
import { reconcileCartPrices } from './utils/cart';
import { printDailyClose, closeTotals, buildCloseSummary } from './utils/dailyClose';
import { buildCloseSummaryPayload, closeSummaryClientWriteId } from './utils/closeSummary';
import { readClientErrorLog, supportSummary, type ClientErrorRecord } from './utils/sentry';
import { logPriceChange } from './utils/priceHistory';
import { logVoid as logVoidDay } from './utils/cashflow';

import ErrorBoundary from './components/ErrorBoundary';
import Toast, { type ToastAction, type TriggerToast } from './components/Toast';
import { confirmDialog, promptDialog } from './components/Dialog';
import PinGate from './components/PinGate';
import SettingHelp from './components/SettingHelp';
import MorningBrief from './components/MorningBrief';
import NotificationsBell from './components/NotificationsBell';
import { pushNotice, dayKeyOf } from './utils/notifications';
import { AdminDashboard } from './components/AdminDashboard';
import StaffSwitcher from './components/StaffSwitcher';
import { canAccessTab, isManagerRole, activeStaffOf, type TillTab } from './utils/staff';
import SyncProductsButton from './components/SyncProductsButton';
const Inventory = lazyRetry(() => import('./components/Inventory'));
const Analytics = lazyRetry(() => import('./components/Analytics'));
const Expenses = lazyRetry(() => import('./components/Expenses'));
const CategoryRegister = lazyRetry(() => import('./components/CategoryRegister'));
const HandoverPrompt = lazyRetry(() => import('./components/HandoverPrompt'));
const CloseSummaryInbox = lazyRetry(() => import('./components/CloseSummaryInbox'));
const CloseReminderBar = lazyRetry(() => import('./components/CloseReminderBar'));
const Sales = lazyRetry(() => import('./components/Sales'));

const THEMES_LIST: AppTheme[] = [
  { id: 'gold', name: 'Kampala Gold', brand: '#ffcc00', medium: '#f1c100', light: '#ffedc3' },
  { id: 'emerald', name: 'Nile Emerald', brand: '#10b981', medium: '#059669', light: '#a7f3d0' },
  { id: 'sapphire', name: 'Victoria Sapphire', brand: '#3b82f6', medium: '#2563eb', light: '#bfdbfe' },
  { id: 'ruby', name: 'Sunset Ruby', brand: '#f43f5e', medium: '#e11d48', light: '#fecdd3' },
  { id: 'amber', name: 'Equator Amber', brand: '#f97316', medium: '#ea580c', light: '#ffedd5' },
];

const THEME_MAP = new Map(THEMES_LIST.map(t => [t.id, t]));

const DEFAULT_CATEGORIES = ['Electronics', 'Eatery', 'Drinks', 'Stationery', 'Printing', 'Tailoring', 'Library', 'Sports', 'Graphics'];
const DEFAULT_EXPENSE_CATEGORIES = ['Stock Purchase', 'Utilities', 'Labor', 'Rent', 'Transport', 'Supplies'];

// Drinks must survive: tills created before the Drinks catalog have saved
// lists (local + server) without it, and every background boot-pull would
// otherwise wipe a locally-added Drinks chip again. Injects it right after
// Eatery — unless the owner deliberately deleted it (opt-out flag), so a
// manual delete is never fought.
const NO_DRINKS_KEY = 'boss_pos_no_drinks';
function ensureDrinks(list: string[]): string[] {
  if (list.includes('Drinks')) return list;
  try {
    if (localStorage.getItem(NO_DRINKS_KEY) === '1') return list;
  } catch {}
  const next = [...list];
  const at = next.indexOf('Eatery');
  next.splice(at >= 0 ? at + 1 : next.length, 0, 'Drinks');
  return next;
}

const LOCK_OPTIONS = [10, 30, 60];
function lockMinutesOf(s: StoreSettings): number {
  const m = Math.round(Number(s.lockMinutes) || 0);
  return LOCK_OPTIONS.includes(m) ? m : 10;
}

const THEME_KEY = 'boss_pos_theme';

const DEFAULT_SETTINGS: StoreSettings = {
  shopName: 'My Shop',
  themeId: 'gold',
  vibe: 'General Store',
  defaultPaymentMethod: 'Cash',
  dailyGoalNum: 10,
  lockMinutes: 10,
  loyaltyEveryN: 10,
  loyaltyPct: 5,
  usdRate: UGX_TO_USD_RATE,
  showTailoring: false,
  showDesign: false,
  showBookings: false,
  showRepairs: false,
  sheetsUrl: '',
};

// Deleted-sale tombstones: an offline DELETE is queued, but the stale
// /api/boot cache still contains the sale — without this, the "deleted" order
// resurrects on the next boot and looks like delete never worked. Tombstoned
// ids are filtered out of every boot payload until the server confirms.
const DELETED_SALES_KEY = 'boss_pos_deleted_sales';
function readDeletedSales(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_SALES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}
function addDeletedSale(id: string): void {
  try {
    const s = readDeletedSales();
    s.add(id);
    localStorage.setItem(DELETED_SALES_KEY, JSON.stringify([...s].slice(-500)));
  } catch {}
}

// Deleted-expense tombstones: same resurrection problem as sales — an offline
// DELETE is queued, but the next 30s background boot still contains the row,
// so it flickers back until the queue flushes. Tombstoned ids stay hidden.
const DELETED_EXPENSES_KEY = 'boss_pos_deleted_expenses';
function readDeletedExpenses(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_EXPENSES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}
function addDeletedExpense(id: string): void {
  try {
    const s = readDeletedExpenses();
    s.add(id);
    localStorage.setItem(DELETED_EXPENSES_KEY, JSON.stringify([...s].slice(-500)));
  } catch {}
}
function removeDeletedExpense(id: string): void {
  try {
    const s = readDeletedExpenses();
    s.delete(id);
    localStorage.setItem(DELETED_EXPENSES_KEY, JSON.stringify([...s].slice(-500)));
  } catch {}
}

// Settings keys that sync to the server. Serialized for the dirty-check that
// stops background boot-pulls from overwriting unsaved local taps.
const SETTINGS_SYNC_KEYS = new Set([
  'shopName','themeId','vibe','defaultPaymentMethod','dailyGoalNum','dailyGoalRevenue','loyaltyEveryN','loyaltyPct','discountPinAbove','commissionPct','receiptFooter','shopType','language','usdRate','momoFeePct','ownerPhone','communityGroupUrl',
  'categories','expenseCategories','showTailoring','showDesign','showBookings','showRepairs','sheetsUrl','eodCapital','branches','largeText','lockMinutes','features','ownerName','closeReminderLeadMin','closeReminderSound','closeSummaryAuto',
  'openTime','closeTime','closedDays','blindClose','closeNotifyOwner','cashierTabs',
]);
function serializeSettings(s: StoreSettings): string {
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s as unknown as Record<string, unknown>)) {
    if (k === 'hasPin' || k === 'clientWriteId' || k === 'deviceId') continue;
    if (!SETTINGS_SYNC_KEYS.has(k)) continue;
    filtered[k] = v;
  }
  return JSON.stringify(filtered);
}

// Already running as the installed app (not a browser tab)?
function isStandalone(): boolean {
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if ((window.navigator as unknown as { standalone?: boolean }).standalone === true) return true;
  } catch {}
  return false;
}

// iPhones/iPads never fire beforeinstallprompt — install is manual there.
function isIOSDevice(): boolean {
  try {
    const ua = navigator.userAgent || '';
    if (/iphone|ipad|ipod/i.test(ua)) return true;
    if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
  } catch {}
  return false;
}

// Laptop/desktop browsers often never fire beforeinstallprompt (engagement +
// installability criteria), so "no prompt" must show manual steps — never
// a dead row with no Go button.
function isDesktopLike(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(pointer: fine)').matches;
  } catch { return false; }
}

// Inline add-staff form used in Settings (first setup + later adds).
function StaffFirstSetup({ onAdd }: { onAdd: (name: string, role: 'manager' | 'cashier', pin: string) => void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<'manager' | 'cashier'>('cashier');
  const [pin, setPin] = useState('');
  return (
    <div className="flex items-center gap-2">
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name"
        className="flex-1 min-w-0 h-10 bg-[#0A0A0A] border border-white/5 text-sm px-3 rounded-xl text-white font-bold focus:border-gold-brand outline-none" />
      <button onClick={() => setRole(role === 'manager' ? 'cashier' : 'manager')}
        className="h-10 px-2.5 text-[10px] font-black uppercase rounded-xl border border-gold-brand/40 text-gold-brand shrink-0" title="Toggle role">
        {role === 'manager' ? 'MGR' : 'CSH'}
      </button>
      <input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="PIN"
        className="w-16 h-10 bg-[#0A0A0A] border border-white/5 text-sm px-2 rounded-xl text-white font-bold text-center focus:border-gold-brand outline-none" />
      <button onClick={() => {
        if (!name.trim() || pin.length !== 4) return;
        onAdd(name.trim(), role, pin);
        setName(''); setPin('');
      }} disabled={!name.trim() || pin.length !== 4}
        className="h-10 px-3 bg-gold-brand text-black font-black uppercase text-[10px] rounded-xl disabled:opacity-40 shrink-0 cursor-pointer">
        Add
      </button>
    </div>
  );
}

// Settings accordion section: one collapsible card per area so the panel
// reads as doors (Shop, Selling, Staff, Money, Security, Look, Data), not
// eighty inputs. Which door is open sticks per device.
function SettingsSection({ id, icon: Icon, title, hint, open, onToggle, children }: {
  id: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  hint: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="boss-card rounded-2xl border border-white/5 overflow-hidden scroll-mt-2">
      <button onClick={onToggle} aria-expanded={open}
        className="w-full flex items-center gap-2.5 px-4 py-3.5 text-left cursor-pointer active:bg-white/5 transition-colors">
        <Icon className="w-4 h-4 text-gold-brand shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="block text-xs font-black text-white uppercase tracking-widest">{title}</span>
          <span className="block text-[10px] text-zinc-500 font-bold truncate">{hint}</span>
        </span>
        <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4 space-y-3 border-t border-white/5 pt-3">{children}</div>}
    </section>
  );
}

const SETTINGS_SECTIONS = [
  { key: 'shop', label: 'Shop' },
  { key: 'selling', label: 'Selling' },
  { key: 'staff', label: 'Staff' },
  { key: 'staff-doors', label: 'Doors' },
  { key: 'money', label: 'Money' },
  { key: 'security', label: 'PINs' },
  { key: 'look', label: 'Look' },
  { key: 'data', label: 'Data' },
] as const;

// Setup quiz: "what do you sell?" One tap per trade pre-builds the
// workspace (areas + modules) so a tailor never meets a stock form.
function SetupQuiz({ onApply }: {
  onApply: (picked: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [done, setDone] = useState<boolean>(() => {
    try { return localStorage.getItem('boss_pos_quiz_done') === '1'; } catch { return false; }
  });
  if (done) return null;
  const opts = [
    { key: 'shop', label: 'Shelf products', hint: 'Shop goods' },
    { key: 'eatery', label: 'Cooked food', hint: 'Eatery' },
    { key: 'tailoring', label: 'Tailor orders', hint: 'Sewing' },
    { key: 'design', label: 'Design & print', hint: 'Jobs' },
    { key: 'bookings', label: 'Bookings', hint: 'Chairs' },
    { key: 'repairs', label: 'Repairs', hint: 'Bench' },
  ];
  const toggle = (k: string) => setPicked(p => p.includes(k) ? p.filter(x => x !== k) : [...p, k]);
  const apply = () => {
    try { localStorage.setItem('boss_pos_quiz_done', '1'); } catch {}
    setDone(true);
    onApply(picked);
  };
  return (
    <div className="boss-card p-4 rounded-2xl border border-gold-brand/30 mb-4">
      <h3 className="text-xs font-black text-white uppercase tracking-widest font-display">What do you sell?</h3>
      <p className="text-[11px] text-zinc-500 font-bold mt-0.5">Tick everything — the till sets itself up.</p>
      <div className="grid grid-cols-2 gap-2 mt-3">
        {opts.map(o => (
          <button key={o.key} onClick={() => toggle(o.key)} aria-pressed={picked.includes(o.key)}
            className={`p-3 rounded-xl border text-left transition-all active:scale-95 cursor-pointer ${picked.includes(o.key) ? 'border-gold-brand bg-gold-brand/10 text-white' : 'bg-[#0A0A0A] border-white/5 text-zinc-400'}`}>
            <span className="block text-xs font-black uppercase tracking-wider">{o.label}</span>
            <span className="block text-[10px] text-zinc-500 font-bold">{o.hint}</span>
          </button>
        ))}
      </div>
      <button onClick={apply}
        className="mt-3 w-full h-11 bg-gold-brand text-black rounded-xl text-xs font-black uppercase tracking-wider hover:opacity-90 active:scale-[0.99] transition-all cursor-pointer">
        {picked.length === 0 ? 'Skip for now' : `Set up (${picked.length})`}
      </button>
    </div>
  );
}

export default function App() {  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored) return stored === 'dark' ? 'dark' : 'light';
      const prefersDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
      return prefersDark ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  useEffect(() => {
    try {
      if (theme === 'dark') document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
      document.documentElement.classList.toggle('light-theme', theme === 'light');
    } catch {}
  }, [theme]);
  // Charge beep + vibration after each sale (per device). Read live by
  // playChargeFeedback in Sales; this state only re-renders the toggle label.
  const [chargeSound, setChargeSound] = useState<boolean>(() => {
    try { return localStorage.getItem('boss_pos_charge_sound') !== '0'; } catch { return true; }
  });
  // Simple till: attendant mode hides discounts, quotes and parking.
  // Per device (manager flips it on the attendant's phone).
  const [simpleTill, setSimpleTill] = useState<boolean>(() => {
    try { return localStorage.getItem('boss_pos_simple_till') === '1'; } catch { return false; }
  });
  const toggleSimpleTill = () => {
    setSimpleTill(prev => {
      const next = !prev;
      try {
        localStorage.setItem('boss_pos_simple_till', next ? '1' : '0');
        window.dispatchEvent(new Event('boss_pos_simple_till'));
      } catch {}
      return next;
    });
  };
  const toggleChargeSound = () => {
    setChargeSound(prev => {
      const next = !prev;
      try { localStorage.setItem('boss_pos_charge_sound', next ? '1' : '0'); } catch {}
      return next;
    });
  };
  const [activeTab, setActiveTab] = useState<'sales' | 'inventory' | 'analytics' | 'expenses' | 'registers'>('sales');
  const [showSuppliers, setShowSuppliers] = useState(false);
  const [showMore, setShowMore] = useState(false);
  // Simple → Full graduation (#25): beginners get Sell / Money / More until
  // they've made 20 sales. Choice persists; graduating never nags again.
  const [navMode, setNavMode] = useState<'simple' | 'full'>(() => {
    try {
      const stored = localStorage.getItem('boss_pos_nav_mode');
      if (stored === 'simple' || stored === 'full') return stored;
    } catch {}
    return 'simple';
  });
  const [gradDismissed, setGradDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem('boss_pos_nav_graduated') === '1'; } catch { return false; }
  });
  const setNav = (m: 'simple' | 'full') => {
    setNavMode(m);
    try { localStorage.setItem('boss_pos_nav_mode', m); } catch {}
    if (m === 'full') {
      try { localStorage.setItem('boss_pos_nav_graduated', '1'); } catch {}
      setGradDismissed(true);
    }
    setShowMore(false);
  };
  const staySimple = () => {
    try { localStorage.setItem('boss_pos_nav_graduated', '1'); } catch {}
    setGradDismissed(true);
  };
  // Consistent back (#24): Escape closes the More sheet like ✕ / backdrop.
  useEffect(() => {
    if (!showMore) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowMore(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showMore]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // Settings accordion: which door is open sticks per device (default Shop).
  const [settingsSection, setSettingsSection] = useState<string>(() => {
    try { return localStorage.getItem('boss_pos_settings_section') || 'shop'; } catch { return 'shop'; }
  });
  const openSettingsSection = (key: string) => {
    setSettingsSection(key);
    try { localStorage.setItem('boss_pos_settings_section', key); } catch {}
    try {
      requestAnimationFrame(() => document.getElementById(`set-${key}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    } catch {}
  };
  const toggleSettingsSection = (key: string) => {
    const next = settingsSection === key ? '' : key;
    setSettingsSection(next);
    try { localStorage.setItem('boss_pos_settings_section', next); } catch {}
  };
  const [loading, setLoading] = useState(true);
  const [authState, setAuthState] = useState<'booting' | 'locked' | 'ready'>('booting');
  // Why the till keeps asking for PIN: last 10 lock reasons (boot/idle/revoke).
  const [lockLog, setLockLog] = useState<LockEvent[]>(() => {
    try { return readLockLog(); } catch { return []; }
  });
  // First-run setup checklist: hidden forever once dismissed or complete.
  const [setupDismissed, setSetupDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem('boss_pos_setup_done') === '1'; } catch { return false; }
  });
  // One-item carousel: only the current step shows, Next cycles the undone ones.
  const [setupIdx, setSetupIdx] = useState(0);

  const [settings, setSettings] = useState<StoreSettings>(DEFAULT_SETTINGS);
  useEffect(() => {
    try { document.documentElement.classList.toggle('large-text', !!settings.largeText); } catch {}
  }, [settings.largeText]);
  const [staffName, setStaffName] = useState<string>(() => {
    try { return localStorage.getItem('boss_pos_staff') || ''; } catch { return ''; }
  });
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  // Simple → Full derivation must sit AFTER sales state (TDZ otherwise).
  const isSimpleNav = navMode === 'simple';
  const showGraduation = isSimpleNav && !gradDismissed && sales.length >= 20;
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierPrices, setSupplierPrices] = useState<SupplierPrice[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  // This till's branch (per-device, never synced — each phone belongs to one branch).
  const [tillBranch, setTillBranch] = useState<string>(() => {
    try { return localStorage.getItem('boss_pos_branch') || ''; } catch { return ''; }
  });
  useEffect(() => {
    try { localStorage.setItem('boss_pos_branch', tillBranch || ''); } catch {}
  }, [tillBranch]);
  const [activeStaffId, setActiveStaffId] = useState<string | null>(() => {
    try { return localStorage.getItem('boss_pos_staff_id'); } catch { return null; }
  });
  const [showStaffSwitcher, setShowStaffSwitcher] = useState(false);
  const [staffVerifying, setStaffVerifying] = useState(false);
  const [staffVerifyError, setStaffVerifyError] = useState<string | null>(null);
  const draftScope = useMemo<CheckoutDraftScope>(() => ({ branch: tillBranch, tillId: activeStaffId || 'device' }), [tillBranch, activeStaffId]);
  const draftScopeKey = checkoutDraftScopeKey(draftScope);

  // Role gates. Zero staff rows = legacy behavior: everything open, manager
  // PIN prompts as before. Once staff exist, cashiers sell + expenses only.
  const staffConfigured = staffList.length > 0;
  // Money handed to a person that this device's staff member still has to
  // confirm. Drives the full-screen "did you receive this?" prompt.
  const [pendingHandoffs, setPendingHandoffs] = useState<MomoTransfer[]>([]);
  const [handoffSummary, setHandoffSummary] = useState<HandoverSummary | null>(null);
  // Owner/manager evening briefings filed at close. Unread ones pop up once;
  // the inbox stays one tap away in the header for managers.
  const [closeSummaries, setCloseSummaries] = useState<CloseSummary[]>([]);
  const [showSummaryInbox, setShowSummaryInbox] = useState(false);
  const summaryAutoOpened = useRef(false);
  const [seenSummaryIds, setSeenSummaryIds] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('boss_pos_seen_summaries') || '[]');
      return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
    } catch { return []; }
  });
  const markSummariesSeen = useCallback((ids: string[]) => {
    setSeenSummaryIds(prev => {
      const next = [...prev];
      for (const id of ids) if (!next.includes(id)) next.push(id);
      try { localStorage.setItem('boss_pos_seen_summaries', JSON.stringify(next.slice(-200))); } catch {}
      return next.slice(-200);
    });
  }, []);
  const activeStaff = activeStaffOf(staffList, activeStaffId);
  const activeRole = activeStaff?.role || null;
  const [staffLoaded, setStaffLoaded] = useState(false);
  const isManager = staffLoaded ? isManagerRole(activeRole, staffConfigured) : activeRole === 'manager';
  // Manager-chosen cashier doors (Settings → Staff). Sell + Spend always on.
  const cashierDoors = useMemo<TillTab[]>(() => settings.cashierTabs ?? ['registers'], [settings.cashierTabs]);
  const tabOpen = (tab: 'sales' | 'inventory' | 'analytics' | 'expenses' | 'registers'): boolean =>
    canAccessTab(tab, activeRole, staffConfigured, cashierDoors);
  const [creditPayments, setCreditPayments] = useState<CreditPayment[]>([]);
  const [creditEats, setCreditEats] = useState<CreditEat[]>([]);
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [productionRegisters, setProductionRegisters] = useState<ProductionRegister[]>([]);
  const [wastageLogs, setWastageLogs] = useState<WastageLog[]>([]);
  const [momoTransfers, setMomoTransfers] = useState<MomoTransfer[]>([]);
  const [categories, setCategories] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('boss_pos_categories');
      return ensureDrinks(saved ? JSON.parse(saved) : DEFAULT_CATEGORIES);
    } catch { return DEFAULT_CATEGORIES; }
  });
  const [expenseCategories, setExpenseCategories] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('boss_pos_expense_categories');
      return saved ? JSON.parse(saved) : DEFAULT_EXPENSE_CATEGORIES;
    } catch { return DEFAULT_EXPENSE_CATEGORIES; }
  });
  const [cart, setCartState] = useState<SaleItem[]>(() => {
    try { return readCheckoutDraftSync(draftScope)?.cart || []; } catch { return []; }
  });
  const cartRevision = useRef(0);
  const setCart = useCallback((value: SaleItem[] | ((current: SaleItem[]) => SaleItem[])) => {
    cartRevision.current += 1;
    setCartState(current => typeof value === 'function' ? value(current) : value);
  }, []);
  const cartHydrated = useRef(false);
  const [cartDraftReady, setCartDraftReady] = useState(false);

  const [isQuickSale, setIsQuickSale] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'success' | 'error' | 'info'>('success');
  const [toastAction, setToastAction] = useState<ToastAction | undefined>(undefined);
  const [apiError, setApiError] = useState(false);
  const [isOnline, setIsOnline] = useState(() => {
    try { return typeof navigator !== 'undefined' ? navigator.onLine : true; } catch { return true; }
  });
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [outboxCountsState, setOutboxCountsState] = useState<OutboxCounts>({ total: 0, pending: 0, queued: 0, sending: 0, retrying: 0, blockedAuth: 0, synced: 0, failed: 0 });
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [showAudit, setShowAudit] = useState(false);
  const [auditFilter, setAuditFilter] = useState('');
  const [supportReport, setSupportReport] = useState<ReadyReport | null>(null);
  const [clientErrors, setClientErrors] = useState<ClientErrorRecord[]>([]);
  const [updatingApp, setUpdatingApp] = useState(false);
  const [sheetStatus, setSheetStatus] = useState<{ configured: boolean; lastError: string | null; lastOkAt: string | null } | null>(null);
  const [efrisForm, setEfrisForm] = useState<EfrisConfig | null>(null);
  const [efrisToken, setEfrisToken] = useState('');
  const [efrisHasToken, setEfrisHasToken] = useState(false);
  const [efrisSaving, setEfrisSaving] = useState(false);
  const [outboxPreview, setOutboxPreview] = useState<OutboxEntry[]>([]);
  // Offline writes the server refused (conflict / sold out / rejected): kept
  // in plain language so the owner can re-enter what matters.
  const [syncReview, setSyncReview] = useState<SyncReviewItem[]>([]);
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  // Dismissed forever once the user says "not now" — the banner must never nag.
  const [installDismissed, setInstallDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem('boss_pos_install_dismissed') === '1'; } catch { return false; }
  });
  const [reconcileResult, setReconcileResult] = useState<{ salesChecked: number; totalMismatches: number; negativeStock: { id: string; name: string; qty: number }[] } | null>(null);

  const readyRef = useRef(false);

  const triggerToast: TriggerToast = (msg, type, action) => {
    setToastMessage(msg);
    setToastType(type);
    setToastAction(action);
  };

  const refreshOutboxState = useCallback(async () => {
    try {
      const [items, counts] = await Promise.all([listOutboxItemsAsync(), outboxCountsAsync()]);
      setOutboxPreview(items.slice(-20).reverse());
      setOutboxCountsState(counts);
      setPendingCount(counts.pending);
    } catch {}
  }, []);

  const formatSyncedAgo = (ts: number) => {
    const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (secs < 60) return 'just now';
    const mins = Math.round(secs / 60);
    return mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
  };

  // Shared boot-apply: lands a /api/boot payload into local state + caches. Used
  // by the initial load AND the silent 3-minute background refresh (multi-till).
  // Declared above the persist effect so both share lastSentSettingsRef.
  const lastSentSettingsRef = useRef<string>('');
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const applyBootData = useCallback((d: BootData) => {
    // Settings revert guard: if the user tapped theme/language/etc. locally
    // and the PUT hasn't landed yet, a background boot-pull must NOT overwrite
    // the fresh tap with stale server values (the "forces my choice back"
    // glitch). Dirty local settings win; the debounced PUT below saves them.
    let settingsDirty = false;
    try {
      settingsDirty = lastSentSettingsRef.current !== '' &&
        serializeSettings(settingsRef.current) !== lastSentSettingsRef.current;
    } catch { settingsDirty = false; }
    if (!settingsDirty) {
      setSettings(d.settings);
      try { lastSentSettingsRef.current = serializeSettings(d.settings); } catch {}
      if (d.settings.categories && Array.isArray(d.settings.categories) && d.settings.categories.length > 0) setCategories(ensureDrinks(d.settings.categories));
      if (d.settings.expenseCategories && Array.isArray(d.settings.expenseCategories) && d.settings.expenseCategories.length > 0) setExpenseCategories(d.settings.expenseCategories);
    }
    const enriched = enrichProductsWithIcons(d.products);
    setProducts(enriched);
    saveProducts(enriched);
    setSuppliers(d.suppliers);
    setSupplierPrices(d.supplierPrices || []);
    setStaffList(d.staff || []);
    setStaffLoaded(true);
    try {
      const tomb = readDeletedSales();
      setSales((d.sales || []).filter(s => !tomb.has(s.id)));
    } catch {
      setSales(d.sales);
    }
    try {
      const tomb = readDeletedExpenses();
      setExpenses(normalizeExpenses(d.expenses || []).filter(e => !tomb.has(e.id)));
    } catch {
      setExpenses(normalizeExpenses(d.expenses || []));
    }
    setCreditPayments(d.creditPayments);
    setCreditEats(d.creditEats);
    setCustomers(d.customers || []);
    setProductionRegisters(d.productionRegisters);
    setWastageLogs(d.wastageLogs);
    setMomoTransfers(d.momoTransfers);
    // Warm per-endpoint caches so later reads (and offline reloads) hit cache.
    primeCache('/api/products', d.products);
    primeCache('/api/suppliers', d.suppliers);
    primeCache('/api/supplier-prices', d.supplierPrices || []);
    primeCache('/api/staff', d.staff || []);
    primeCache('/api/sales', d.sales);
    primeCache('/api/expenses', d.expenses);
    primeCache('/api/credit-payments', d.creditPayments);
    primeCache('/api/credit-eats', d.creditEats);
    primeCache('/api/customers', d.customers || []);
    primeCache('/api/production-register', d.productionRegisters);
    primeCache('/api/wastage-log', d.wastageLogs);
    primeCache('/api/momo-transfers', d.momoTransfers);
    primeCache('/api/settings', d.settings);
    setLastSyncedAt(Date.now());
  }, []);

  const fetchAllData = async () => {
    const cached = loadProducts();
    if (cached) {
      // Warm boot: paint the cached shelf instantly, then refresh EVERYTHING
      // underneath. Returning here used to leave sales/production empty until
      // the next poll — the "made today 0 on my phone" ghost.
      setProducts(enrichProductsWithIcons(cached));
      setLoading(false);
      try {
        applyBootData(await bootApi.get());
      } catch {
        // Cache stands; the periodic poll retries silently.
      }
      return;
    }

    if (!navigator.onLine) {
      setLoading(false);
      return;
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
        if (s.categories && Array.isArray(s.categories) && s.categories.length > 0) setCategories(ensureDrinks(s.categories));
        if (s.expenseCategories && Array.isArray(s.expenseCategories) && s.expenseCategories.length > 0) setExpenseCategories(s.expenseCategories);
      }).catch(fail('settings')),
      productApi.list().then(p => {
        const enriched = enrichProductsWithIcons(p);
        setProducts(enriched);
        saveProducts(enriched);
      }).catch(fail('products')),
      supplierApi.list().then(setSuppliers).catch(fail('suppliers')),
      supplierPriceApi.list().then(setSupplierPrices).catch(fail('supplier prices')),
      staffApi.list().then(list => { setStaffList(list); setStaffLoaded(true); }).catch(() => { setStaffLoaded(true); fail('staff')(); }),
      saleApi.list().then(list => {
        try {
          const tomb = readDeletedSales();
          setSales(list.filter(s => !tomb.has(s.id)));
        } catch { setSales(list); }
      }).catch(fail('sales')),
      expenseApi.list().then(list => {
        try {
          const tomb = readDeletedExpenses();
          setExpenses(list.filter(e => !tomb.has(e.id)));
        } catch { setExpenses(list); }
      }).catch(fail('expenses')),
      creditPaymentApi.list().then(setCreditPayments).catch(fail('credit')),
      creditEatApi.list().then(setCreditEats).catch(fail('credit eats')),
      customerApi.list().then(setCustomers).catch(fail('customers')),
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
        recordLock('boot:pin-set');
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
          recordLock(serverHasPin === true ? 'boot:pin-set' : 'boot:locked');
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

  // Multi-till visibility: re-boot every 3 minutes so changes made on a
  // second till show up without a manual reload (plus instant refresh on
  // focus/return and SSE push). Skipped while offline and never overlapped.
  // Keeps the "Synced Xm ago" pill honest too. NOTE: this used to fire every
  // 30s with a FULL boot payload — on 3G that choked the till and made every
  // screen sluggish.
  useEffect(() => {
    if (authState !== 'ready') return;
    let busy = false;
    const syncNow = async () => {
      if (!navigator.onLine || busy) return;
      busy = true;
      try {
        // Flush any queued offline writes first so they land before we pull.
        const pending = await outboxCountAsync();
        if (pending > 0) {
          const n = await flushOutbox();
          if (n > 0) triggerToast(`Synced ${n} offline change(s)`, 'success');
        }
        const d = await bootApi.get();
        applyBootData(d);
        await refreshOutboxState();
      } catch {} finally {
        busy = false;
      }
    };
    const iv = setInterval(syncNow, 3 * 60 * 1000);
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
  }, [authState, applyBootData, refreshOutboxState]);

  // SSE instant sync — fetch streaming with Authorization header (no ?token= leak)
  useEffect(() => {
    if (authState !== 'ready') return;
    const token = getAuthToken();
    if (!token) return;
    let closed = false;
    let controller: AbortController | null = null;
    const connect = async () => {
      if (closed) return;
      controller = new AbortController();
      try {
        const res = await fetch('/api/events', {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error('sse failed');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() || '';
          for (const part of parts) {
            if (part.includes('data:')) {
              // Debounce burst
              setTimeout(async () => {
                try { const d = await bootApi.get(); applyBootData(d); } catch {}
              }, 300);
            }
          }
        }
      } catch {
        // Fallback stays on 30s poll above; reconnect after 5s
        if (!closed) setTimeout(connect, 5000);
        return;
      }
      if (!closed) setTimeout(connect, 1000);
    };
    connect();
    return () => { closed = true; try { controller?.abort(); } catch {} };
  }, [authState, applyBootData]);

  // Handovers addressed to this staff member. Re-checked whenever the till
  // boots or the SSE stream reports activity, so a handover raised on another
  // phone surfaces here within seconds.
  const refreshPendingHandoffs = useCallback(async () => {
    if (authState !== 'ready' || !isManager) return;
    if (staffConfigured && !activeStaff) return;
    try {
      const res = await handoverApi.pending();
      setPendingHandoffs(res.rows || []);
    } catch {}
  }, [authState, isManager, staffConfigured, activeStaff]);

  useEffect(() => {
    refreshPendingHandoffs();
  }, [refreshPendingHandoffs, momoTransfers.length]);

  // Running totals for the owner/manager money board.
  const refreshHandoverSummary = useCallback(async () => {
    if (authState !== 'ready' || !isManager) return;
    try {
      setHandoffSummary(await handoverApi.summary());
    } catch {}
  }, [authState, isManager]);

  useEffect(() => {
    refreshHandoverSummary();
  }, [refreshHandoverSummary, momoTransfers.length]);

  const confirmHandoff = useCallback(async (id: string) => {
    try {
      await handoverApi.confirm(id);
      triggerToast('Receipt confirmed — recorded against your name', 'success');
      refreshPendingHandoffs();
      refreshHandoverSummary();
    } catch (err) {
      triggerToast(err instanceof Error ? err.message.slice(0, 110) : 'Could not confirm', 'error');
    }
  }, [refreshPendingHandoffs, refreshHandoverSummary, triggerToast]);

  const refreshCloseSummaries = useCallback(async () => {
    if (authState !== 'ready' || !isManager) return;
    try {
      const res = await closeSummaryApi.inbox();
      setCloseSummaries(res.rows || []);
    } catch {}
  }, [authState, isManager]);

  useEffect(() => {
    refreshCloseSummaries();
  }, [refreshCloseSummaries]);

  const unreadSummaries = closeSummaries.filter(s => !seenSummaryIds.includes(s.id));
  useEffect(() => {
    if (summaryAutoOpened.current) return;
    if (authState !== 'ready' || !isManager || unreadSummaries.length === 0) return;
    summaryAutoOpened.current = true;
    setShowSummaryInbox(true);
  }, [authState, isManager, unreadSummaries.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleReadCloseSummary = useCallback(async (id: string) => {
    markSummariesSeen([id]);
    try {
      const updated = await closeSummaryApi.markRead(id);
      setCloseSummaries(prev => prev.map(s => (s.id === id ? updated : s)));
    } catch {}
  }, [markSummariesSeen]);

  const handleShareCloseSummary = useCallback(async (id: string) => {
    const row = closeSummaries.find(s => s.id === id);
    if (!row) return;
    const url = supplierWhatsAppUrl(settings.ownerPhone, row.body);
    if (!url) {
      triggerToast('Add the owner number in Settings first', 'error');
      return;
    }
    window.open(url, '_blank', 'noopener');
    try { await closeSummaryApi.markShared(id); } catch {}
    refreshCloseSummaries();
  }, [closeSummaries, refreshCloseSummaries, triggerToast, settings.ownerPhone]);

  // PWA install prompt capture (preventDefault keeps it for our own button).
  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  // Fires the stored install prompt and reports back. Returns true when a
  // prompt actually ran (button did something), false when there was nothing
  // to fire (e.g. iPhone, which never provides one).
  const runInstallPrompt = async (): Promise<boolean> => {
    const ev = installPrompt as unknown as { prompt: () => void; userChoice?: Promise<{ outcome: string }> } | null;
    if (!ev || typeof ev.prompt !== 'function') return false;
    try {
      ev.prompt();
      const choice = await ev.userChoice?.catch(() => null);
      if (choice && choice.outcome === 'accepted') {
        triggerToast('Installing — find the app on your home screen', 'success');
      }
    } catch {}
    setInstallPrompt(null);
    return true;
  };

  const dismissInstall = () => {
    try { localStorage.setItem('boss_pos_install_dismissed', '1'); } catch {}
    setInstallDismissed(true);
  };

  // Refresh the offline-pending badge + "Synced" pill every 30s.
  useEffect(() => {
    const iv = setInterval(() => { void refreshOutboxState(); }, 30_000);
    const onStorage = () => { void refreshOutboxState(); };
    void refreshOutboxState();
    window.addEventListener('boss-pos-outbox-updated', onStorage);
    return () => {
      clearInterval(iv);
      window.removeEventListener('boss-pos-outbox-updated', onStorage);
    };
  }, [refreshOutboxState]);

  // Timed alerts via the notification bell (NOT on every PIN unlock).
  // Rule: same product may only notify once per 24h; unlocks never re-fire.
  // Negative stock is critical (force), low stock is batched into ONE notice.
  useEffect(() => {
    if (authState !== 'ready' || products.length === 0) return;
    const day = dayKeyOf();
    const neg = products.filter(p => !p.isService && p.stockQty < 0);
    if (neg.length > 0) {
      pushNotice(
        'negative-stock',
        `${neg.length} item${neg.length !== 1 ? 's' : ''} NEGATIVE stock`,
        `${neg.slice(0, 3).map(p => p.name).join(', ')}${neg.length > 3 ? ` +${neg.length - 3} more` : ''} — tap bell, then Inventory → Check gaps.`,
        `neg:${day}`,
        { force: false, action: { label: 'Check gaps', tab: 'inventory' } },
      );
    }
    const low = products.filter(p => !p.isService && p.stockQty <= (p.lowStockThreshold || 5) && p.stockQty >= 0);
    if (low.length > 0) {
      const first = low.slice(0, 3).map(p => `${p.name} (${p.stockQty})`).join(', ');
      pushNotice(
        'low-stock',
        `${low.length} item${low.length !== 1 ? 's' : ''} low on stock`,
        `${first}${low.length > 3 ? ` +${low.length - 3} more` : ''} — restock from Inventory.`,
        `low:${day}`,
        { action: { label: 'Restock', tab: 'inventory' } },
      );
    }
    // No browser Notification() here on purpose: the bell holds history and
    // never spams. The OS-level popup only fires for critical same-day
    // negative stock when permission is already granted.
    if (neg.length > 0 && typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState === 'visible') {
      try {
        const n = pushNotice('negative-stock', 'Negative stock — reconcile', `${neg.length} items below zero.`, `neg-os:${day}`);
        if (n) new Notification(`Negative stock (${neg.length})`, { body: 'Open the bell → Inventory → Check gaps', icon: '/pwa-192x192.png' });
      } catch {}
    }
  }, [products, authState]);

  // Supplier drift bell (once/day): quote moved ≥20% vs cost.
  useEffect(() => {
    if (authState !== 'ready' || products.length === 0 || supplierPrices.length === 0) return;
    (async () => {
      try {
        const { supplierDrift } = await import('./utils/cashflow');
        const drifts = supplierDrift(products, supplierPrices, 20).slice(0, 3);
        if (!drifts.length) return;
        const day = dayKeyOf();
        const first = drifts[0];
        pushNotice(
          'info',
          `Supplier price moved: ${first.productName} ${first.driftPct > 0 ? '+' : ''}${first.driftPct}%`,
          drifts.map(d => `${d.productName}: cost ${d.cost} vs quote ${d.quote}`).join(' • ').slice(0, 180),
          `supdrift:${day}`,
        );
      } catch {}
    })();
  }, [products, supplierPrices, authState]);

  // Outbox inspector + sync-review data for Settings
  useEffect(() => {
    if (!isSettingsOpen) return;
    const load = async () => {
      try {
        const list = await listOutboxItemsAsync();
        setOutboxPreview(list.slice(-20).reverse());
        const counts = await outboxCountsAsync();
        setOutboxCountsState(counts);
        setPendingCount(counts.pending);
      } catch {}
      try { setSyncReview(readSyncReview()); } catch {}
    };
    load();
    const h = () => load();
    window.addEventListener('boss-pos-outbox-updated', h);
    window.addEventListener('boss-pos-sync-review', h);
    return () => {
      window.removeEventListener('boss-pos-outbox-updated', h);
      window.removeEventListener('boss-pos-sync-review', h);
    };
  }, [isSettingsOpen, pendingCount]);

  // A replay lost the race against another device (server 409 CONFLICT).
  // The refused write is kept in Settings → Needs review — never silent.
  const onSyncConflict = (e: Event) => {
    const n = (e as CustomEvent).detail || 1;
    try { setSyncReview(readSyncReview()); } catch {}
    triggerToast(`Another device saved first — ${n} offline change(s) kept in Settings → Needs review.`, 'error', {
      label: 'Sync now',
      onClick: () => { handleForceSync(); },
    });
    fetchAllData();
  };
  useEffect(() => {
    window.addEventListener('boss-pos-sync-conflict', onSyncConflict);
    return () => window.removeEventListener('boss-pos-sync-conflict', onSyncConflict);
  }, []);
  const onSyncDropped = (e: Event) => {
    const n = (e as CustomEvent).detail || 1;
    try { setSyncReview(readSyncReview()); } catch {}
    triggerToast(`${n} offline change(s) couldn't be saved (e.g. sold out) — kept in Settings → Needs review.`, 'error');
    fetchAllData();
    void refreshOutboxState();
  };
  useEffect(() => {
    window.addEventListener('boss-pos-sync-dropped', onSyncDropped);
    return () => window.removeEventListener('boss-pos-sync-dropped', onSyncDropped);
  }, []);

  // "Log out all devices" (or an expired token) just got enforced server-side:
  // drop the session and re-lock the till. The event detail names the cause
  // (revoke:/api/sales, revoke-all, …) so the next PIN loop is diagnosable.
  useEffect(() => {
    const onRevoked = (e: Event) => {
      const detail = (e as CustomEvent)?.detail as { path?: string; reason?: string } | undefined;
      const reason = detail?.reason
        || (detail?.path ? `revoke:${detail.path}` : 'revoke');
      recordLock(reason);
      setLockLog(readLockLog());
      setAuthState('locked');
      triggerToast('Logged out on all devices — re-enter your PIN to continue.', 'info');
    };
    window.addEventListener('boss-pos-auth-revoked', onRevoked);
    return () => window.removeEventListener('boss-pos-auth-revoked', onRevoked);
  }, []);

  // A dead staff credential must also kill the staff SESSION. Otherwise the
  // top bar keeps showing "Manager" while the wire carries a till token, and
  // every manager call fails with "switch to manager" on a manager's phone.
  useEffect(() => {
    const onStaffRevoked = () => {
      const name = activeStaff?.name || staffName || '';
      setActiveStaffId(null);
      try { localStorage.removeItem('boss_pos_staff_id'); } catch {}
      setShowStaffSwitcher(false);
      triggerToast(
        name ? `Session expired for ${name} — enter the staff PIN again` : 'Staff session expired — enter the staff PIN again',
        'error',
        {
          label: 'Sign in',
          onClick: () => { setStaffVerifyError(null); setShowStaffSwitcher(true); },
        },
      );
    };
    window.addEventListener('boss-pos-staff-revoked', onStaffRevoked);
    return () => window.removeEventListener('boss-pos-staff-revoked', onStaffRevoked);
  }, [activeStaff?.name, staffName]);

  useEffect(() => {
    const onManagerRequired = (event: Event) => {
      const usedStaffToken = (event as CustomEvent<{ usedStaffToken?: boolean }>)?.detail?.usedStaffToken;
      const managerProfile = activeStaff?.role === 'manager';
      triggerToast(
        managerProfile && !usedStaffToken
          ? 'Manager profile, manager credential missing — enter the manager staff PIN again.'
          : 'Manager approval required — switch to a manager account.',
        'error',
        {
          label: managerProfile && !usedStaffToken ? 'Sign in' : 'Switch seller',
          onClick: () => { setStaffVerifyError(null); setShowStaffSwitcher(true); },
        }
      );
    };
    window.addEventListener('boss-pos-manager-required', onManagerRequired);
    return () => window.removeEventListener('boss-pos-manager-required', onManagerRequired);
  }, [activeStaff?.role]);

  useEffect(() => {
    if (products.length > 0) saveProducts(products);
  }, [products]);

  // Reconnect report: after offline stretches the till says what landed,
  // what refreshed, and what needs a human — never silent healing. Built on
  // the shared report builder so numbers stay honest in one place.
  const reportReconnect = (r: OutboxFlushReport) => {
    let refused = 0;
    try {
      const review = readSyncReview();
      refused = review.length;
      setSyncReview(review);
    } catch {}
    const built = buildReconnectReport({
      salesSent: r.salesSent,
      otherSent: Math.max(0, r.sent - r.salesSent),
      needsReview: refused,
      remaining: r.remaining,
      refreshed: r.sent > 0,
    });
    if (built.salesSent === 0 && built.otherSent === 0 && built.needsReview === 0) return;
    const parts: string[] = [];
    if (built.salesSent > 0) parts.push(`${built.salesSent} waiting sale${built.salesSent !== 1 ? 's' : ''} sent`);
    if (built.otherSent > 0) parts.push(`${built.otherSent} other change${built.otherSent !== 1 ? 's' : ''} sent`);
    if (built.refreshed) parts.push('figures refreshed');
    if (built.orderNumbersRefreshed) parts.push('order numbers settled');
    if (built.needsReview > 0) parts.push(`${built.needsReview} need review (Settings → Data)`);
    triggerToast(`Back online — ${parts.join(' • ')}`, built.needsReview > 0 ? 'error' : 'success');
  };

  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      try {
        const hadToken = !!getAuthToken();
        const r = await flushOutboxDetailed();
        const stillHasToken = !!getAuthToken();
        if (r.flushed > 0) {
          reportReconnect(r);
          fetchAllData();
        } else if ((await outboxCountAsync()) > 0 && hadToken && stillHasToken) {
        }
        await refreshOutboxState();
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
  }, [refreshOutboxState]);

  // Flush pending offline writes on every unlock/boot too. The browser
  // `online` event is unreliable on old Android, so queued writes may
  // otherwise sit in the outbox until the next online event fires.
  useEffect(() => {
    if (authState !== 'ready') return;
    (async () => {
      try {
        const r = await flushOutboxDetailed();
        // Auth failures lock via boss-pos-auth-revoked; network failures are silent;
        // permanent drops are reported via boss-pos-sync-dropped.
        if (r.flushed > 0) {
          reportReconnect(r);
          fetchAllData();
        }
        await refreshOutboxState();
      } catch {}
    })();
  }, [authState, refreshOutboxState]);

  // Persist settings (skip the very first render so we never clobber server
  // values with defaults before the real settings finish loading). Debounced so
  // typing in the shop-name field doesn't fire a PUT (DB write + cache clear)
  // on every keystroke. Also diff so boot-pull doesn't echo back the same
  // payload and create a constant PUT loop (the source of "constantly failed
  // to save settings").
  useEffect(() => {
    if (!readyRef.current) return;
    // Cashiers never push settings (a clocked-in cashier only sells).
    if (staffConfigured && activeRole !== 'manager') return;
    const serialized = serializeSettings(settings);
    if (serialized === lastSentSettingsRef.current) return;
    // Don't echo the just-booted value back immediately — wait for a user edit
    if (lastSentSettingsRef.current === '' ) {
      lastSentSettingsRef.current = serialized;
      return;
    }
    const t = setTimeout(() => {
      lastSentSettingsRef.current = serialized;
      settingsApi.update(JSON.parse(serialized) as unknown as StoreSettings).catch((err) => {
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
  }, [settings, staffConfigured, activeRole]);

  useEffect(() => {
    localStorage.setItem('boss_pos_categories', JSON.stringify(categories));
    if (readyRef.current) setSettings(prev => ({ ...prev, categories }));
  }, [categories]);

  // Backstop for lists already in state before ensureDrinks existed: the
  // categories effect above then persists the healed list to the server.
  useEffect(() => {
    setCategories(prev => ensureDrinks(prev));
  }, []);

  useEffect(() => {
    localStorage.setItem('boss_pos_expense_categories', JSON.stringify(expenseCategories));
    if (readyRef.current) setSettings(prev => ({ ...prev, expenseCategories }));
  }, [expenseCategories]);

  // Guided tour: the guide owns its own chapter/step state and watches live
  // signals (cart, sales, tab). Replay always restarts at chapter one —
  // the session key remounts it fresh, independent of sales history.
  const [tourDone, setTourDone] = useState<boolean>(() => isTourDone());
  const [tourSession, setTourSession] = useState(0);
  const tourVisible = !tourDone;
  const replayTour = () => {
    try { localStorage.removeItem('boss_pos_tour_done'); } catch {}
    setTourDone(false);
    setTourSession(s => s + 1);
    setIsSettingsOpen(false);
    setActiveTab('sales');
  };
  // Cashier attribution: the asking only happens ONCE per device. The name is
  // saved in localStorage, so each phone remembers its seller between logins.
  useEffect(() => {
    localStorage.setItem('boss_pos_staff', staffName || '');
  }, [staffName]);

  const staffPromptedRef = useRef(false);
  useEffect(() => {
    if (authState !== 'ready' || staffName || staffPromptedRef.current) return;
    // Staff logins replace the free-text prompt with the PIN-checked switcher.
    if (staffConfigured) return;
    staffPromptedRef.current = true;
    if (localStorage.getItem('boss_pos_staff_prompted') === '1') return;
    setTimeout(() => {
      promptDialog({ title: 'Who is selling?', message: 'Cashier name — asked once for this phone', placeholder: 'e.g. Amina' }).then(name => {
        if (name) setStaffName(name);
        try { localStorage.setItem('boss_pos_staff_prompted', '1'); } catch {}
      });
    }, 700);
  }, [authState, staffName, staffConfigured]);

  // With staff logins, the active seller owns the attribution name.
  useEffect(() => {
    if (activeStaff) setStaffName(activeStaff.name);
  }, [activeStaff?.id]);

  // Cashiers are fenced to their manager-chosen doors, even on deep-link.
  useEffect(() => {
    if (authState === 'ready' && !canAccessTab(activeTab, activeRole, staffConfigured, cashierDoors)) {
      setActiveTab('sales');
      triggerToast('Managers only — ask a manager to switch in', 'error');
    }
  }, [authState, activeTab, activeRole, staffConfigured, cashierDoors]);

  useEffect(() => {
    if (!cartHydrated.current) return;
    const timer = setTimeout(() => {
      const write = cart.length > 0
        ? saveActiveCheckoutDraft({ cart }, draftScope)
        : clearActiveCheckoutDraft(draftScope);
      void write.catch(() => {});
    }, 0);
    return () => clearTimeout(timer);
  }, [cart, draftScope]);

  useEffect(() => {
    let cancelled = false;
    cartHydrated.current = false;
    setCartDraftReady(false);
    const synchronous = readCheckoutDraftSync(draftScope);
    if (synchronous) setCart(synchronous.cart);
    const revision = cartRevision.current;
    void loadActiveCheckoutDraft(draftScope).then((record) => {
      if (cancelled) return;
      if (cartRevision.current === revision) {
        const restored = record?.cart || [];
        const { cart: validated, changed } = reconcileCartPrices(restored, products);
        setCart(validated);
        if (changed) triggerToast('Cart prices updated to match current product pricing', 'info');
      }
      cartHydrated.current = true;
      setCartDraftReady(true);
    }).catch(() => {
      if (cancelled) return;
      if (cartRevision.current === revision) setCart([]);
      cartHydrated.current = true;
      setCartDraftReady(true);
    });
    return () => { cancelled = true; };
  }, [draftScopeKey]);

  useEffect(() => {
    if (!cartDraftReady) return;
    setCart(current => {
      const { cart: validated, changed } = reconcileCartPrices(current, products);
      if (changed) triggerToast('Cart prices updated to match current product pricing', 'info');
      return validated;
    });
  }, [cartDraftReady, products]);

  // Idle re-lock
  useEffect(() => {
    if (authState !== 'ready') return;
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    const events = ['pointerdown', 'keydown', 'touchstart', 'mousemove', 'scroll'];
    events.forEach(e => window.addEventListener(e, bump, { passive: true }));
    const iv = setInterval(() => {
      const limitMs = lockMinutesOf(settingsRef.current) * 60 * 1000;
      if (Date.now() - last > limitMs) {
        // Keep the auth token: clearing it would make the outbox replay without
        // auth after an offline re-unlock, and the server would drop those
        // queued sales (data loss). The lock screen is still enforced via
        // authState; the token only expires on the server after 7 days.
        recordLock('idle');
        setLockLog(readLockLog());
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
    // Fast path FIRST: local hash verifies in ms, even on dead-WiFi phones
    // where navigator.onLine lies "true" and the server round-trip hangs for
    // 30s ("auth failed / takes long to unlock"). Unlock instantly, then mint
    // a fresh token in the background so sales never 401.
    const local = localStorage.getItem('boss_pos_pin');
    if (local && !local.startsWith('fb_')) {
      try {
        if (await verifyPinAgainstHash(pin, local)) {
          markUnlocked();
          setAuthState('ready');
          fetchAllData().catch(() => {});
          // Background re-mint (short timeout so dead WiFi never blocks).
          authVerify(pin, 8000).catch(() => {});
          return;
        }
      } catch {}
      // Local hash exists but did NOT match: it may be stale after a PIN
      // change on another till. Fall through to the server check below —
      // but only throw "wrong PIN" after the server also rejects.
    }
    // Server check with a SHORT timeout for unlock (8s, not 30s). Cold DBs
    // still wake on retry; the till never hangs on the lock screen.
    try {
      const data = await authVerify(pin, 8000);
      localStorage.setItem('boss_pos_has_pin', String(data.hasPin));
      markUnlocked();
      setAuthState('ready');
      fetchAllData().catch(() => {});
      return;
    } catch (err) {
      const msg = String((err as Error)?.message || '');
      const isNetwork = /Network timeout|fetch failed|Failed to fetch|Load failed/i.test(msg);
      if (isNetwork) {
        // Server unreachable and no usable local hash: stay locked but say
        // exactly that (not "wrong PIN").
        throw new Error('No connection — try again when online, or use this till\'s last PIN on its own device.');
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

  // Briefing-tile sync: same force-sync as Settings, minus the inspector detail.
  const handleForceSync = async () => {
    try {
      const n = await flushOutbox();
      const left = await outboxCountAsync();
      await refreshOutboxState();
      setPendingCount(left);
      if (n > 0) {
        triggerToast(`Force-synced ${n} change(s)`, 'success');
        fetchAllData().catch(() => {});
      } else if (left > 0) triggerToast('Still queued — re-enter PIN if needed', 'error');
      else triggerToast('Nothing pending', 'info');
    } catch {
      triggerToast('Sync failed', 'error');
    }
  };

  const handleExportData = async () => {
    try {
      const data = await exportApi.download();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const slug = (settings.shopName || 'pos').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const stamp = String(data.exportedAt || new Date().toISOString()).slice(0, 10);
      const ok = downloadBlob(blob, `${slug}-backup-${stamp}-v${data.formatVersion || 1}.json`);
      const records = backupRowTotal(data);
      triggerToast(
        ok ? `Backup downloaded — ${records} records (PINs and provider tokens excluded)` : 'Download failed on this device',
        ok ? 'success' : 'error',
      );
    } catch (err) {
      triggerToast((err as { message?: string })?.message || 'Failed to export data', 'error');
    }
  };

  const restoreInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const handleRevokeAll = async () => {
    if (!(await confirmDialog({ title: 'Log out everywhere', message: 'Log out on ALL devices (including this one)? You will need the PIN to log back in.', confirmLabel: 'Log out', danger: true }))) return;
    try {
      await revokeAllSessions();
      emitAuthRevoked({ reason: 'revoke-all' });
    } catch {
      triggerToast('Failed to log out other devices', 'error');
    }
  };

  const handleRunBackupNow = async () => {
    try {
      const res = await backupsApi.run();
      if (res?.success && res.backup?.createdAt) {
        setLastBackupAt(res.backup.createdAt);
        triggerToast(`Backup ${res.backup.id} saved · ${new Date(res.backup.createdAt).toLocaleString()} (${res.records ?? 0} records)`, 'success');
      } else {
        triggerToast(res?.error || 'Backup could not run right now — nothing was saved', 'error');
      }
    } catch (err) {
      triggerToast((err as { message?: string })?.message || 'Backup failed', 'error');
    }
  };

  // When the settings sheet opens, show the last automatic server-backup time
  // and the recent activity log.
  useEffect(() => {
    if (!isSettingsOpen) return;
    try { setLockLog(readLockLog()); } catch {}
    backupsApi.latest().then((b) => setLastBackupAt(b.createdAt)).catch(() => {});
    auditApi.list(30).then((entries) => setAuditEntries(entries)).catch(() => {});
    sheetsApi.status().then(setSheetStatus).catch(() => setSheetStatus(null));
    efrisApi.config().then((c) => { setEfrisForm(c.config); setEfrisHasToken(c.hasToken); setEfrisToken(''); }).catch(() => {});
  }, [isSettingsOpen]);

  const refreshSupport = useCallback(async () => {
    try { setClientErrors(readClientErrorLog()); } catch { setClientErrors([]); }
    const probe = await supportApi.ready();
    setSupportReport(probe.report);
  }, []);

  useEffect(() => {
    if (!isSettingsOpen) return;
    void refreshSupport();
  }, [isSettingsOpen, refreshSupport]);

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

  // Update check in two layers. First ask the SERVER what build it runs and
  // compare with this bundle: if the server is newer, the phone is stale and
  // no service-worker poke can fix a deploy that never happened — drop the
  // stale worker and hard-reload into the new build. Only if both agree do we
  // fall back to the classic reg.update() path (mid-deploy edge cases).
  const handleCheckUpdate = async () => {
    setUpdatingApp(true);
    const localBuild = typeof __BUILD_COMMIT__ === 'string' && __BUILD_COMMIT__ ? __BUILD_COMMIT__ : 'dev';
    const localShort = localBuild === 'dev' ? 'dev' : localBuild.slice(0, 7);
    // Dead WiFi hangs a plain fetch for minutes (navigator.onLine lies) — the
    // "checking… nonstop" freeze. Bound everything so the button always lands.
    const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
      Promise.race([p, new Promise<T>((_, rej) => window.setTimeout(() => rej(new Error('timeout')), ms))]);
    try {
      let serverShort: string | null = null;
      try {
        const ctrl = new AbortController();
        const t = window.setTimeout(() => ctrl.abort(), 12000);
        const r = await fetch('/api/version', { cache: 'no-store', signal: ctrl.signal });
        window.clearTimeout(t);
        if (r.ok) serverShort = ((await r.json()).short as string) || null;
      } catch {}
      if (serverShort && localShort !== 'dev' && serverShort !== 'dev' && serverShort !== localShort) {
        triggerToast(`New version on server (${serverShort}) — restarting into it…`, 'success');
        try {
          if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(x => x.unregister()));
          }
        } catch {}
        try { localStorage.removeItem('boss_api_cache_/api/boot'); } catch {}
        setTimeout(() => window.location.reload(), 1200);
        return;
      }
      if (!('serviceWorker' in navigator)) {
        triggerToast(
          serverShort ? `Server ${serverShort} • you ${localShort} — open the website to update`
            : 'Update not supported here — open the website in your browser',
          'info',
        );
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        triggerToast('Not installed as an app — just open the website', 'info');
        return;
      }
      await withTimeout(reg.update(), 15000);
      const pending = reg.installing || reg.waiting;
      if (pending) {
        triggerToast('Update found — restarting the app…', 'success');
        setTimeout(() => window.location.reload(), 1500);
      } else {
        triggerToast(
          serverShort ? `Already newest (you ${localShort} • server ${serverShort})`
            : `Already the newest build (${localShort})`,
          'success',
        );
      }
    } catch {
      triggerToast('Update check failed — are you online?', 'error');
    } finally {
      setUpdatingApp(false);
    }
  };

  const handleRestoreData = async (file: File | undefined) => {
    if (!file) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      triggerToast('That file is not readable JSON — pick the .json backup file', 'error');
      return;
    }
    let pre: RestorePreflight;
    try {
      pre = await restoreApi.preflight(parsed);
    } catch (err) {
      triggerToast((err as { message?: string })?.message || 'Could not check that backup file', 'error');
      return;
    }
    if (!pre?.success) {
      triggerToast('That backup cannot be restored here — nothing was written', 'error');
      return;
    }
    const from = String(pre.exportedAt ? new Date(pre.exportedAt).toLocaleString() : 'an older untimed snapshot');
    const where = pre.shop.matches ? 'this shop' : `another shop (${pre.shop.local.name})`;
    const collisions = pre.collisions.filter(c => c.overwrite > 0);
    const summary = collisions.length
      ? `${collisions.slice(0, 3).map(c => `${c.overwrite} ${c.table}`).join(', ')}${collisions.length > 3 ? '…' : ''}`
      : 'none — everything is new';
    if (!(await confirmDialog({
      title: 'Restore backup',
      message: `${pre.totals.incoming} record(s) from "${pre.shop.incoming?.name || 'unknown shop'}" (taken ${from}) will be merged into ${where}. ${pre.totals.overwrite} existing record(s) will be overwritten: ${summary}. Nothing is deleted, and PINs, tokens, order counters and backup flags stay as they are.${pre.assets.missing ? ` ${pre.assets.missing} product photo(s) are not on this server and will stay missing.` : ''} Continue?`,
      confirmLabel: 'Merge now',
      danger: true,
    }))) return;
    try {
      const res = await restoreApi.restore(parsed);
      const total = Object.values(res.restored || {}).reduce((a, b) => a + (b || 0), 0);
      if (res.partial || (res.errors && res.errors.length)) {
        triggerToast(`Restore partly failed (${res.errors?.map(e => e.table).join(', ')}) — ${total} record(s) landed`, 'error');
      } else {
        triggerToast(`Merged ${total} record(s) (${res.totals.overwrite} overwritten, ${res.totals.insert} new). Reloading data…`, 'success');
      }
      clearProductsCache();
      await fetchAllData();
    } catch (err) {
      triggerToast(`Restore failed: ${(err as { message?: string })?.message || 'server refused the file'}`, 'error');
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

  const inflightSales = useRef(new Map<string, Promise<SaleSaveResult>>());
  const handleAddSale = async (newSale: Sale): Promise<SaleSaveResult> => {
    const inflight = inflightSales.current.get(newSale.id);
    if (inflight) return inflight;
    const run = (async (): Promise<SaleSaveResult> => {
    const alreadyKnown = sales.some(s => s.id === newSale.id);
    const soldQty = (productId: string) => newSale.items
      .filter(item => item.productId === productId)
      .reduce((sum, item) => sum + item.qty, 0);
    if (!alreadyKnown) {
      setSales(prev => [newSale, ...prev]);
      setProducts(prevProducts => prevProducts.map(prod => {
        const qty = soldQty(prod.id);
        if (qty > 0 && !prod.isService) {
          return { ...prod, stockQty: Math.max(0, prod.stockQty - qty) };
        }
        return prod;
      }));
    }
    try {
      const result = await saleApi.createWithStatus(newSale);
      const savedSale = result.data;
      const mergedSale = { ...newSale, ...savedSale, id: newSale.id };
      setSales(prev => prev.some(s => s.id === newSale.id)
        ? prev.map(s => s.id === newSale.id ? mergedSale : s)
        : [mergedSale, ...prev]);
      const fee = momoFeeFor(newSale.total, settings.momoFeePct, newSale.paymentMethod);
      if (fee > 0) {
        if (!expenseCategories.includes('MoMo Fees')) {
          setExpenseCategories(prev => (prev.includes('MoMo Fees') ? prev : [...prev, 'MoMo Fees']));
        }
        handleAddExpense({
          id: `exp-momofee-${newSale.id}`,
          timestamp: new Date().toISOString(),
          description: `MoMo fee · ${newSale.orderNumber}`,
          amount: fee,
          category: 'MoMo Fees',
        });
      }
      return {
        status: result.status,
        sale: { ...newSale, ...savedSale, id: newSale.id },
      };
    } catch (err) {
      if (!alreadyKnown) {
        setSales(prev => prev.filter(s => s.id !== newSale.id));
        setProducts(prevProducts => prevProducts.map(prod => {
          const qty = soldQty(prod.id);
          if (qty > 0 && !prod.isService) {
            return { ...prod, stockQty: prod.stockQty + qty };
          }
          return prod;
        }));
      }
      let message = 'Failed to save sale — not recorded. Refresh stock and retry.';
      if (err instanceof ApiError && err.code === 'INSUFFICIENT_STOCK') {
        message = 'Not enough stock — another till just sold the last one. Stock refreshed, try again.';
        fetchAllData();
      } else if (err instanceof ApiError && err.status === 401) {
        message = 'Not logged in — re-enter PIN and retry.';
      } else if (err instanceof ApiError && err.message) {
        message = err.message.slice(0, 120);
      }
      triggerToast(message, 'error');
      return { status: 'failed', sale: newSale, error: message };
    }
    })();
    inflightSales.current.set(newSale.id, run);
    try {
      return await run;
    } finally {
      inflightSales.current.delete(newSale.id);
    }
  };

  // Ask for the PIN before destructive actions (refund / delete a sale). If no
  // PIN is set yet, skip the prompt. A clocked-in manager passes straight
  // through; everyone else takes the legacy manager-PIN path.
  const requirePin = async (message: string, managerOnly = false): Promise<boolean> => {
    if (staffConfigured && activeStaff?.role === 'manager') return true;
    if (!settings.hasPin) return true;
    const managerPin = localStorage.getItem('boss_pos_manager_pin');
    if (managerOnly && managerPin && /^\d{4}$/.test(managerPin)) {
      const pin = await promptDialog({ title: 'Manager PIN', message, secure: true, inputMode: 'numeric', placeholder: '4-digit PIN', validate: value => /^\d{4}$/.test(value) ? null : 'Enter the 4-digit manager PIN.' });
      if (!pin) return false;
      if (pin === managerPin) return true;
      // Allow main PIN as fallback if manager not set correctly
      const mainHash = localStorage.getItem('boss_pos_pin');
      if (mainHash && !mainHash.startsWith('fb_') && await verifyPinAgainstHash(pin, mainHash)) return true;
      triggerToast('Wrong manager PIN — action cancelled', 'error');
      return false;
    }
    const hash = localStorage.getItem('boss_pos_pin');
    if (!hash || hash.startsWith('fb_')) return true;
    const pin = await promptDialog({ title: 'Till PIN', message, secure: true, inputMode: 'numeric', placeholder: '4-digit PIN', validate: value => /^\d{4}$/.test(value) ? null : 'Enter the 4-digit till PIN.' });
    if (!pin) return false;
    if (await verifyPinAgainstHash(pin, hash)) return true;
    triggerToast('Wrong PIN — action cancelled', 'error');
    return false;
  };

  // Permanently delete a wrong order: manager PIN + confirm, stock goes back in.
  const handleVoidSale = async (saleId: string) => {
    const sale = sales.find(s => s.id === saleId);
    if (!sale) return;
    if (sale.refunded || sale.voided) {
      triggerToast(`Already ${sale.voided ? 'deleted' : 'refunded'} — nothing left to delete`, 'info');
      return;
    }
    if (!(await requirePin(`Enter MANAGER PIN to delete ${sale.orderNumber}:`, true))) return;
    if (!(await confirmDialog({ title: 'Delete sale', message: `Delete ${sale.orderNumber} (${formatCurrency(sale.total)}) for good? The items go back into stock and it disappears from reports.`, confirmLabel: 'Delete', danger: true }))) return;
    // Tombstone FIRST so a stale boot cache can never resurrect it.
    addDeletedSale(saleId);
    try { logVoidDay(saleId); } catch {}
    setSales(prev => prev.filter(s => s.id !== saleId));
    setProducts(prev => prev.map(p => {
      const it = sale.items.find(i => i.productId === p.id);
      return it && !p.isService ? { ...p, stockQty: p.stockQty + it.qty } : p;
    }));
    try { await saleApi.remove(saleId); } catch (err) {
      const code = (err as { code?: string })?.code;
      const status = (err as { status?: number })?.status;
      if (status === 404 || code === 'SALE_NOT_FOUND') {
        // The server never saw this sale (it never synced). There is nothing
        // to delete there — the local removal already stands, tombstone kept.
        triggerToast(`${sale.orderNumber} deleted on this till — it was never on the server`, 'info');
        return;
      }
      // Offline-queued deletes return optimistic success (no throw), so any
      // other throw is a REAL server rejection — restore + lift the tombstone.
      try {
        const s = readDeletedSales();
        s.delete(saleId);
        localStorage.setItem(DELETED_SALES_KEY, JSON.stringify([...s]));
      } catch {}
      setSales(prev => [sale, ...prev].sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
      setProducts(prev => prev.map(p => {
        const it = sale.items.find(i => i.productId === p.id);
        return it && !p.isService ? { ...p, stockQty: Math.max(0, p.stockQty - it.qty) } : p;
      }));
      const reason = code === 'SESSION_CLOSED'
        ? 'that day’s books are closed — reopen the day first'
        : code === 'MANAGER_REQUIRED'
          ? 'only a signed-in manager can delete — enter the manager staff PIN again'
          : (err instanceof Error ? err.message.slice(0, 90) : 'not saved');
      triggerToast(`Failed to delete sale — order restored (${reason})`, 'error');
      return;
    }
    triggerToast(`${sale.orderNumber} deleted`, 'info');
  };

  const handleRefundSale = async (saleId: string, skipPin = false): Promise<boolean> => {
    const saleToRefund = sales.find(s => s.id === saleId);
    if (!saleToRefund) return false;
    if (saleToRefund.refunded || saleToRefund.voided) {
      triggerToast(`Already ${saleToRefund.voided ? 'deleted' : 'refunded'} — nothing left to refund`, 'info');
      return false;
    }
    if (!skipPin && !(await requirePin(`Enter MANAGER PIN to refund ${saleToRefund.orderNumber}:`, true))) return false;
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
    try { await saleApi.refund(saleId); } catch (err) {
      const code = (err as { code?: string })?.code;
      const status = (err as { status?: number })?.status;
      if (status === 404 || code === 'SALE_NOT_FOUND') {
        // Never reached the server, so there is nothing to refund there.
        // Drop it locally (tombstoned) instead of keeping a phantom row.
        addDeletedSale(saleId);
        setSales(prev => prev.filter(s => s.id !== saleId));
        triggerToast(`${saleToRefund.orderNumber} removed on this till — it was never on the server`, 'info');
        return true;
      }
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
      const reason = code === 'SESSION_CLOSED'
        ? 'that day’s books are closed — reopen the day first'
        : code === 'MANAGER_REQUIRED'
          ? 'only a signed-in manager can refund — enter the manager staff PIN again'
          : (err instanceof Error ? err.message.slice(0, 90) : 'not saved');
      triggerToast(`Failed to refund sale — stock unchanged (${reason})`, 'error');
      return false;
    }
    triggerToast(`${saleToRefund.orderNumber} refunded. Stock restored.`, 'info');
    return true;
  };

  // Partial return ("take back 1 of 3"): refund the whole sale, then re-ring
  // the kept lines as a linked balance sale. Reports stay exact because
  // refunded rows are excluded everywhere, and both halves stay in history.
  // Scale discounts + split legs by the kept ratio so the math still ties.
  const handleReturnItems = async (saleId: string, returns: { productId: string; variantId?: string; qty: number }[]) => {
    const sale = sales.find(s => s.id === saleId);
    if (!sale) return;
    if (sale.refunded || sale.voided) {
      triggerToast(`Already ${sale.voided ? 'deleted' : 'refunded'} — nothing left to return`, 'info');
      return;
    }
    const kept = computeKeptItems(sale.items, returns);
    const returnedQty = sale.items.reduce((a, i) => a + i.qty, 0) - kept.reduce((a, i) => a + i.qty, 0);
    if (returnedQty <= 0) return;
    const clamped = returns;
    const label = kept.length < sale.items.length || returnedQty > 0
      ? sale.items
          .map(item => {
            const kq = kept.find(k => `${k.productId}::${k.variantId || ''}` === `${item.productId}::${item.variantId || ''}`)?.qty ?? 0;
            const rq = Math.round((item.qty - kq) * 1000) / 1000;
            return rq > 0 ? `${item.productName} ×${rq}` : null;
          })
          .filter(Boolean)
          .join(', ')
      : '';
    if (!(await confirmDialog({ title: 'Return items', message: `Return ${label}?\n\n${sale.orderNumber} will be refunded and re-rung without ${clamped.length > 1 ? 'them' : 'it'}.`, confirmLabel: 'Return', danger: true }))) return;
    const refunded = await handleRefundSale(saleId);
    if (!refunded) return;
    if (kept.length === 0) return;
    const subtotal = kept.reduce((a, i) => a + i.lineTotal, 0);
    const discount = scaleKept(sale.discount || 0, subtotal, sale.subtotal);
    const total = Math.max(0, subtotal - discount);
    let splitTenders = sale.splitTenders;
    if (sale.paymentMethod === 'Split' && sale.splitTenders && sale.splitTenders.length > 0 && total > 0) {
      let assigned = 0;
      splitTenders = sale.splitTenders.map((l, i, arr) => {
        if (i === arr.length - 1) return { method: l.method, amount: Math.max(0, total - assigned) };
        const a = scaleKept(l.amount, subtotal, sale.subtotal);
        assigned += a;
        return { method: l.method, amount: a };
      }).filter(l => l.amount > 0);
    }
    const balance: Sale = {
      id: `sale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      // Temp numbers are renumbered to the canonical sequence server-side.
      orderNumber: `Temp #${Date.now()}`,
      timestamp: new Date().toISOString(),
      items: kept, subtotal, tax: 0, total,
      paymentMethod: sale.paymentMethod,
      splitTenders,
      customerName: sale.customerName,
      discount: discount > 0 ? discount : undefined,
      notes: `Balance re-ring of ${sale.orderNumber} (returned: ${label})`,
      staffName: activeStaff?.name || staffName?.trim() || sale.staffName,
      branch: sale.branch,
    };
    await handleAddSale(balance);
    triggerToast(`Returned ${label} — balance re-rung`, 'success');
  };

  // New-cashier safety net: undo your own just-made sale (≤60s old)
  // without a manager PIN. Anything older goes through the normal refund path.
  const handleUndoSale = async (saleId: string) => {
    const sale = sales.find(s => s.id === saleId);
    if (!sale) return;
    if (sale.refunded || sale.voided) {
      triggerToast(`Already ${sale.voided ? 'deleted' : 'refunded'} — nothing left to undo`, 'info');
      return;
    }
    const ageMs = Date.now() - Date.parse(sale.timestamp);
    if (!Number.isFinite(ageMs) || ageMs > 60_000) {
      triggerToast('Too late to undo — ask a manager to refund it instead', 'error');
      return;
    }
    await handleRefundSale(saleId, true);
  };

  const inflightExpenses = useRef(new Map<string, Promise<void>>());
  // Reopening a day must clear the server's close session as well, or every
  // write keeps being rejected after the till's own record is gone.
  const handleReopenDay = async () => {
    try {
      const session = await closeSessionApi.current();
      if (session?.id && session.status === 'closed') {
        await closeSessionApi.reopen(session.id, 'Reopened from the till to keep trading');
        triggerToast('Books reopened for today', 'success');
      }
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'CLOSE_SESSION_NOT_FOUND' || err.status === 404)) return;
      triggerToast('Could not reopen the books on the server — check the connection', 'error');
    }
  };

  // Filing the close: the evening briefing goes to the owner's in-app inbox
  // the moment the day is closed. Idempotent per day + department, and the
  // one story the till, the inbox and WhatsApp all tell.
  const handleCloseDayFinished = async (close: {
    businessDate: string;
    branch: string;
    cash: {
      collected: number;
      cashSales: number;
      phoneCollected?: number;
      openingCapital: number;
      drawerExpenses: number;
      expectedInDrawer: number;
      assigned: number;
      unassigned: number;
      countedCash?: number | null;
      variance?: number | null;
    };
    closedByName: string;
  }): Promise<{ id: string; body: string } | null> => {
    try {
      const dayTotals = closeTotals(close.businessDate, sales, expenses, creditPayments, creditEats);
      const awaiting = momoTransfers
        .filter(t => t.category === close.branch && t.receiptStatus === 'requested' && (t.createdAt || '').slice(0, 10) === close.businessDate)
        .reduce((sum, t) => sum + (t.amount || 0), 0);
      const payload = buildCloseSummaryPayload({
        shopName: settings.shopName || 'My Shop',
        businessDate: close.businessDate,
        branch: close.branch,
        tookToday: close.cash.collected,
        cashSales: close.cash.cashSales,
        phoneSales: close.cash.phoneCollected || 0,
        openingFloat: close.cash.openingCapital,
        drawerExpenses: close.cash.drawerExpenses,
        expectedInDrawer: close.cash.expectedInDrawer,
        assigned: close.cash.assigned,
        unassigned: close.cash.unassigned,
        counted: close.cash.countedCash ?? null,
        variance: close.cash.variance ?? null,
        creditGivenOut: dayTotals.credit,
        creditCollectedBack: dayTotals.collectedCash,
        awaitingHandover: awaiting,
        closedByName: close.closedByName || activeStaff?.name || staffName || '',
        ownerName: settings.ownerName || '',
      });
      const sent = await closeSummaryApi.send({
        businessDate: close.businessDate,
        branch: close.branch,
        channel: 'in_app',
        recipientRole: 'owner',
        recipientName: settings.ownerName || 'Owner',
        headline: payload.headline,
        body: payload.body,
        totals: payload.totals,
        clientWriteId: closeSummaryClientWriteId(close.businessDate, close.branch),
      });
      return { id: sent.id, body: payload.body };
    } catch {
      return null;
    }
  };

  // Committing tomorrow's plan: the server prices every line from the live
  // recipes and files the record; the same total becomes that department's
  // ingredient money so the kitchen works from what was just worked out.
  // Whoever closed the day can do this — the settings PUT gate is bypassed
  // by design, because this scoped, audited write IS the close action.
  const handleCommitProductionPlan = async (plan: {
    businessDate: string;
    category: string;
    lines: Array<{ productId: string; batchQty: number }>;
    overrideTotal?: number | null;
    note?: string;
  }) => {
    const saved = await productionPlanApi.save({
      ...plan,
      branch: tillBranch || '',
      clientWriteId: `plan:${plan.businessDate}:${plan.category}:${tillBranch || 'shop'}`,
    });
    setSettings(prev => ({
      ...prev,
      eodCapital: { ...(prev.eodCapital || {}), [plan.category]: saved.total },
    }));
    return saved;
  };

  // What the till has left for tomorrow's production: the capital set aside at
  // close, minus the batches already logged today. This is the number the
  // kitchen works against, so the drawer never quietly over-commits.
  const ingredientBudgetToday = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const setAside = Math.max(0, Number(settings.eodCapital?.Eatery || 0) + Math.max(0, Number(settings.eodCapital?.Drinks || 0)));
    if (setAside <= 0) return undefined;
    const spent = productionRegisters
      .filter(p => (p.category === 'Eatery' || p.category === 'Drinks') && p.date === today)
      .reduce((sum, p) => sum + (p.total || 0), 0);
    return Math.max(0, setAside - spent);
  }, [settings.eodCapital, productionRegisters]);

  // A batch that overspends the set-aside money still has to be funded. Record
  // the top-up as a real movement (to float / owner / manager) so the drawer
  // reconciliation stays honest instead of quietly going negative.
  const handleIngredientTopUp = async (amount: number, reason: string) => {
    const amt = Math.max(0, Math.round(amount));
    const who = activeStaff?.name || staffName || 'Till';
    try {
      await handleAddMomoTransfer({
        id: `mt-topup-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        category: 'Eatery',
        amount: amt || 1,
        comment: `Ingredient top-up — ${reason}`.slice(0, 200),
        createdAt: middayStamp(new Date().toISOString().slice(0, 10)),
        to: 'float',
        sentBy: who,
      });
      if (amt > 0) {
        setSettings(prev => ({
          ...prev,
          eodCapital: { ...(prev.eodCapital || {}), Eatery: Math.max(0, Number(prev.eodCapital?.Eatery || 0) + amt) },
        }));
      }
      triggerToast('Ingredient top-up recorded', 'success');
    } catch {
      triggerToast('Could not record the top-up — try from Close day → Money moved', 'error');
    }
  };

  const handleAddExpense = async (newExpense: Expense) => {
    const inflight = inflightExpenses.current.get(newExpense.id);
    if (inflight) return inflight;
    const run = (async () => {
    // Stamp who recorded it (clocked-in seller wins) + default source drawer.
    const who = activeStaff?.name || staffName;
    const stamped = {
      ...newExpense,
      ...(who ? { staffName: who } : {}),
      ...((newExpense as Expense & { source?: string }).source
        ? {}
        : { source: 'drawer' }),
    } as Expense;
    setExpenses(prev => prev.some(e => e.id === stamped.id)
      ? prev.map(e => e.id === stamped.id ? stamped : e)
      : [stamped, ...prev]);
    try { await expenseApi.create(stamped); } catch {
      setExpenses(prev => prev.filter(e => e.id !== newExpense.id));
      triggerToast('Failed to save expense — not added', 'error');
    }
    })();
    inflightExpenses.current.set(newExpense.id, run);
    try {
      await run;
    } finally {
      inflightExpenses.current.delete(newExpense.id);
    }
  };

  const handleDeleteExpense = async (expenseId: string) => {
    const prev = expenses.find(e => e.id === expenseId);
    // Tombstone FIRST so the 30s background boot can't resurrect the row
    // while an offline-queued DELETE is still waiting to flush.
    addDeletedExpense(expenseId);
    setExpenses(prev => prev.filter(e => e.id !== expenseId));
    try { await expenseApi.remove(expenseId); } catch {
      removeDeletedExpense(expenseId);
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
    const prevQuotes = supplierPrices;
    setSuppliers(prev => prev.filter(s => s.id !== supplierId));
    setProducts(prev => prev.map(p => p.supplierId === supplierId ? { ...p, supplierId: undefined } : p));
    setSupplierPrices(prev => prev.filter(q => q.supplierId !== supplierId));
    try { await supplierApi.remove(supplierId); } catch {
      if (prev) setSuppliers(list => [...list, prev]);
      setProducts(prevProducts);
      setSupplierPrices(prevQuotes);
      triggerToast('Failed to delete supplier', 'error');
    }
  };

  const handleUpsertQuote = async (supplierId: string, productId: string, price: number) => {
    const prev = supplierPrices;
    const at = new Date().toISOString();
    const optimistic: SupplierPrice = prev.find(q => q.supplierId === supplierId && q.productId === productId)
      ? { ...prev.find(q => q.supplierId === supplierId && q.productId === productId)!, price, updatedAt: at }
      : { id: `sp-local-${Date.now()}`, supplierId, productId, price, updatedAt: at };
    setSupplierPrices(list => {
      const rest = list.filter(q => !(q.supplierId === supplierId && q.productId === productId));
      return [...rest, optimistic];
    });
    try {
      const saved = await supplierPriceApi.upsert(supplierId, productId, price);
      setSupplierPrices(list => list.map(q =>
        q.supplierId === supplierId && q.productId === productId ? saved : q));
    } catch {
      setSupplierPrices(prev);
      triggerToast('Failed to save supplier price — not added', 'error');
    }
  };

  const handleDeleteQuote = async (quoteId: string) => {
    const prev = supplierPrices.find(q => q.id === quoteId);
    setSupplierPrices(list => list.filter(q => q.id !== quoteId));
    try { await supplierPriceApi.remove(quoteId); } catch {
      if (prev) setSupplierPrices(list => [...list, prev]);
      triggerToast('Failed to delete supplier price', 'error');
    }
  };

  const handleVerifyStaff = async (id: string, pin: string) => {
    setStaffVerifying(true);
    setStaffVerifyError(null);
    try {
      const s = await staffApi.verify(id, pin);
      if (s.token) setStaffToken(s.token);
      markUnlocked();
      const prevName = activeStaff?.name || staffName || '';
      setActiveStaffId(s.id);
      try { localStorage.setItem('boss_pos_staff_id', s.id); } catch {}
      setStaffName(s.name);
      setShowStaffSwitcher(false);
      fetchAllData().catch(() => {});
      // Shift handover: count the drawer as it changes hands (optional, skippable).
      if (prevName && prevName !== s.name) {
        const raw = await promptDialog({ title: 'Shift handover', message: `Handover ${prevName} → ${s.name}.\nCount the drawer now (UGX)? Empty = skip.`, defaultValue: '', inputMode: 'numeric', placeholder: '0 = skip', confirmLabel: 'Count' });
        if (raw !== null && raw !== '') {
          const amt = Math.max(0, Math.round(parseFloat(raw) || 0));
          try {
            const log = JSON.parse(localStorage.getItem('boss_pos_handovers') || '[]');
            const next = [{ at: new Date().toISOString(), from: prevName, to: s.name, amount: amt }, ...(Array.isArray(log) ? log : [])].slice(0, 30);
            localStorage.setItem('boss_pos_handovers', JSON.stringify(next));
          } catch {}
          triggerToast(`Handover counted: ${formatCurrency(amt)} (${prevName} → ${s.name})`, 'success');
        } else {
          triggerToast(`${s.name} is selling (${s.role})`, 'success');
        }
      } else {
        triggerToast(`${s.name} is selling (${s.role})`, 'success');
      }
    } catch (err) {
      setStaffVerifyError(err instanceof Error ? err.message : 'Wrong PIN');
    } finally {
      setStaffVerifying(false);
    }
  };

  const handleSwitchStaff = async () => {
    if (!staffConfigured) {
      const name = await promptDialog({ title: 'Who is selling?', message: 'Cashier name for this phone', placeholder: 'e.g. Amina' });
      if (name) setStaffName(name);
      return;
    }
    setStaffVerifyError(null);
    setShowStaffSwitcher(true);
  };

  const handleAddStaff = async (name: string, role: 'manager' | 'cashier', pin: string) => {
    try {
      const created = await staffApi.create(name, role, pin);
      setStaffList(prev => [...prev, created]);
      triggerToast(`${name} added as ${role}`, 'success');
    } catch (err) {
      triggerToast(err instanceof Error ? err.message.slice(0, 100) : 'Failed to add staff', 'error');
    }
  };

  const handleUpdateStaff = async (id: string, patch: { name?: string; role?: 'manager' | 'cashier'; active?: boolean; pin?: string }) => {
    const prev = staffList;
    setStaffList(list => list.map(s => s.id === id ? { ...s, ...patch, pin: undefined } as StaffMember : s));
    try {
      const updated = await staffApi.update(id, patch);
      setStaffList(list => list.map(s => s.id === id ? updated : s));
    } catch (err) {
      setStaffList(prev);
      triggerToast(err instanceof Error ? err.message.slice(0, 100) : 'Failed to update staff', 'error');
    }
  };

  const handleAddCategory = (name: string) => {
    if (name === 'Drinks') {
      try { localStorage.removeItem(NO_DRINKS_KEY); } catch {}
    }
    setCategories(prev => prev.includes(name) ? prev : [...prev, name]);
  };

  const handleUpdateCategory = (oldName: string, newName: string) => {
    setCategories(prev => prev.map(c => c === oldName ? newName : c));
    setProducts(prev => prev.map(p => p.category === oldName ? { ...p, category: newName } : p));
  };

  const handleDeleteCategory = (name: string) => {
    if (name === 'Drinks') {
      try { localStorage.setItem(NO_DRINKS_KEY, '1'); } catch {}
    }
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

  // A closed business day is a real, common cause here: the till locks the
  // books on Close day, so credit entries after that are rejected by design.
  const creditSaveFailure = (err: unknown, eater: CreditEat): string => {
    const e = err as { message?: string; code?: string };
    if (e?.code === 'SESSION_CLOSED') return 'That day\u2019s books are closed — reopen the day to change it';
    if (e?.code === 'CREDIT_LIMIT_EXCEEDED') return `${eater.customerName} is over their credit limit — a manager must approve it`;
    if (e?.code === 'TOTAL_MISMATCH') return 'Quantity and price do not match the total — check the numbers';
    if (e?.code === 'INVALID_AMOUNT' || e?.code === 'INVALID_CREDIT_RECORD') return 'Enter a price and an item for the credit';
    if (e?.code === 'MANAGER_REQUIRED') return 'Only a manager can do that — ask them to sign in';
    if (/timeout|fetch failed|Failed to fetch|Load failed/i.test(String(e?.message || ''))) {
      return 'No connection — the credit is queued and will sync when you are back online';
    }
    return `Failed to save credit entry — not added${e?.message ? ` (${String(e.message).slice(0, 80)})` : ''}`;
  };

  const handleAddCreditEat = async (newEat: CreditEat) => {
    setCreditEats(prev => [newEat, ...prev]);
    try {
      await creditEatApi.create(newEat);
    } catch (err) {
      // Queued writes come back as a success-shaped result, so a throw here is
      // a real rejection. Offline first-try goes through enqueue() and never
      // throws, which is why this branch is safe to surface.
      setCreditEats(prev => prev.filter(c => c.id !== newEat.id));
      triggerToast(creditSaveFailure(err, newEat), 'error');
    }
  };

  const handlePayCreditEat = async (id: string, amount: number) => {
    const prev = creditEats.find(c => c.id === id);
    const next = { ...(prev as CreditEat), paidAmount: (prev?.paidAmount || 0) + amount, paid: (prev?.paidAmount || 0) + amount >= (prev?.total || 0) };
    // Book collections are cash in hand too — record a payment leg so close
    // totals and the ledger see them (saleId namespaced, never collides).
    const leg: CreditPayment = { id: `cp-${Date.now()}`, saleId: `book:${id}`, amount, createdAt: new Date().toISOString() };
    setCreditEats(cs => cs.map(c => c.id === id ? next : c));
    setCreditPayments(prevPs => [leg, ...prevPs]);
    try { await creditEatApi.pay(id, amount); } catch {
      if (prev) setCreditEats(cs => cs.map(c => c.id === id ? prev : c));
      setCreditPayments(prevPs => prevPs.filter(p => p.id !== leg.id));
      triggerToast('Failed to sync payment to server', 'error');
    }
  };

  const handleSaveCustomer = async (c: CustomerProfile) => {
    const exists = customers.some(x => x.id === c.id);
    const stamped = { ...c, updatedAt: new Date().toISOString() };
    setCustomers(prev => exists ? prev.map(x => x.id === c.id ? stamped : x) : [stamped, ...prev]);
    try {
      if (exists) await customerApi.update(stamped);
      else await customerApi.create({ ...stamped, clientWriteId: `c-${c.id}-${Date.now()}` });
    } catch {
      const prev = customers.find(x => x.id === c.id);
      setCustomers(prevList => exists
        ? prevList.map(x => x.id === c.id ? (prev || x) : x)
        : prevList.filter(x => x.id !== c.id));
      triggerToast('Failed to sync profile — reverted', 'error');
    }
  };

  const handleDeleteCustomer = async (id: string) => {
    const prev = customers.find(c => c.id === id);
    setCustomers(list => list.filter(c => c.id !== id));
    try { await customerApi.remove(id); } catch {
      if (prev) setCustomers(list => [prev, ...list]);
      triggerToast('Failed to delete profile', 'error');
    }
  };

  // One-time migration: device-local profiles move to the server the first
  // time boot returns an empty directory.
  const migratedRef = useRef(false);
  useEffect(() => {
    if (migratedRef.current || authState !== 'ready') return;
    if (customers.length > 0) { migratedRef.current = true; return; }
    let local: CustomerProfile[] = [];
    try { local = loadCustomers(); } catch {}
    if (local.length === 0) { migratedRef.current = true; return; }
    migratedRef.current = true;
    (async () => {
      let moved = 0;
      for (const c of local) {
        try {
          await customerApi.create({ ...c, clientWriteId: `mig-${c.id}` });
          moved += 1;
        } catch {}
      }
      try { setCustomers(await customerApi.list()); } catch {}
      if (moved > 0) triggerToast(`Moved ${moved} regular${moved !== 1 ? 's' : ''} to the server — all tills see them now`, 'success');
    })();
  }, [authState, customers.length]);

  const handleAddProduction = async (p: ProductionRegister) => {
    setProductionRegisters(prev => [p, ...prev]);
    // Morning batch adds to sellable stock so the till can actually sell what
    // the kitchen made (previously production never touched stock, forcing
    // oversell guards to block legitimate chapati sales).
    if (p.productId && p.qty > 0) {
      setProducts(prev => prev.map(prod =>
        prod.id === p.productId && !prod.isService
          ? { ...prod, stockQty: (prod.stockQty || 0) + p.qty }
          : prod
      ));
    }
    try { await productionRegisterApi.create(p); } catch {
      setProductionRegisters(prev => prev.filter(x => x.id !== p.id));
      if (p.productId && p.qty > 0) {
        setProducts(prev => prev.map(prod =>
          prod.id === p.productId && !prod.isService
            ? { ...prod, stockQty: Math.max(0, (prod.stockQty || 0) - p.qty) }
            : prod
        ));
      }
      triggerToast('Failed to save production — not added', 'error');
    }
  };

  const handleDeleteProduction = async (id: string) => {
    const prev = productionRegisters.find(p => p.id === id);
    setProductionRegisters(prev => prev.filter(p => p.id !== id));
    // Mirror the add path: removing a batch takes it back out of sellable
    // stock, so deleting a wrong entry corrects the balance by itself.
    if (prev?.productId && prev.qty > 0) {
      setProducts(list => list.map(prod =>
        prod.id === prev.productId && !prod.isService
          ? { ...prod, stockQty: Math.max(0, (prod.stockQty || 0) - prev.qty) }
          : prod
      ));
    }
    try { await productionRegisterApi.remove(id); } catch {
      if (prev) setProductionRegisters(list => [prev, ...list]);
      if (prev?.productId && prev.qty > 0) {
        setProducts(list => list.map(prod =>
          prod.id === prev.productId && !prod.isService
            ? { ...prod, stockQty: (prod.stockQty || 0) + prev.qty }
            : prod
        ));
      }
      triggerToast('Failed to delete production', 'error');
    }
  };

  const handleAddWastage = async (w: WastageLog) => {
    setWastageLogs(prev => [w, ...prev]);
    // Mirror the server: expired leaves the shelf now; remaining stays —
    // it IS tomorrow's opening stock.
    const touchesStock = w.productId && w.qty > 0 && w.reason !== 'remaining';
    if (touchesStock) {
      setProducts(prev => prev.map(prod =>
        prod.id === w.productId && !prod.isService
          ? { ...prod, stockQty: Math.max(0, (prod.stockQty || 0) - w.qty) }
          : prod
      ));
    }
    try { await wastageLogApi.create(w); } catch {
      setWastageLogs(prev => prev.filter(x => x.id !== w.id));
      if (touchesStock) {
        setProducts(prev => prev.map(prod =>
          prod.id === w.productId && !prod.isService
            ? { ...prod, stockQty: (prod.stockQty || 0) + w.qty }
            : prod
        ));
      }
      triggerToast('Failed to save loss — not added', 'error');
    }
  };

  const handleDeleteWastage = async (id: string) => {
    const prev = wastageLogs.find(w => w.id === id);
    setWastageLogs(prev => prev.filter(w => w.id !== id));
    // Remaining rows never touched stock — only reverse expired removals.
    const touchedStock = prev?.productId && (prev.qty || 0) > 0 && prev.reason !== 'remaining';
    if (touchedStock && prev) {
      setProducts(list => list.map(prod =>
        prod.id === prev.productId && !prod.isService
          ? { ...prod, stockQty: (prod.stockQty || 0) + prev.qty }
          : prod
      ));
    }
    try { await wastageLogApi.remove(id); } catch {
      if (prev) setWastageLogs(list => [prev, ...list]);
      if (touchedStock && prev) {
        setProducts(list => list.map(prod =>
          prod.id === prev.productId && !prod.isService
            ? { ...prod, stockQty: Math.max(0, (prod.stockQty || 0) - prev.qty) }
            : prod
        ));
      }
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

  // Single-category shops (most shops!) only see their own world in Close
  // day: segments come from products + book/production history, with Eatery
  // as a fallback only when there is nothing at all — never a phantom tab.
  const registersSegments = useMemo(() => {
    const cats = new Set<string>();
    products.forEach(p => { if (p.category) cats.add(p.category); });
    creditEats.forEach(e => { if (e.category) cats.add(e.category); });
    productionRegisters.forEach(r => { if (r.category) cats.add(r.category); });
    if (cats.size === 0) cats.add('Eatery');
    return Array.from(cats).sort();
  }, [products, creditEats, productionRegisters]);

  const renderContent = () => {
    switch (activeTab) {
      case 'sales':
        return (
          <ErrorBoundary key="sales">
          {isOn(settings.features, 'briefing') && (
            <MorningBrief sales={sales} products={products} creditEats={creditEats} pendingCount={pendingCount} lastSyncedAt={lastSyncedAt}
              formatCurrency={formatCurrency} onNavigate={(t) => setActiveTab(t)} onSync={handleForceSync}
              dailyGoal={settings.dailyGoalNum} dailyGoalRevenue={settings.dailyGoalRevenue} expenses={expenses} momoTransfers={momoTransfers} eodCapital={settings.eodCapital}
              managerView={isManager || !staffConfigured} sellerName={activeStaff?.name || staffName} />
          )}
          {isManager && isOn(settings.features, 'setupChecklist') && !setupDismissed && products.length === 0 && (
            <SetupQuiz
              onApply={(picked) => {
                if (picked.includes('eatery')) {
                  const cats = new Set(categories);
                  cats.add('Eatery'); cats.add('Drinks');
                  setCategories(ensureDrinks(Array.from(cats)));
                }
                setSettings(prev => ({
                  ...prev,
                  showTailoring: prev.showTailoring || picked.includes('tailoring'),
                  showDesign: prev.showDesign || picked.includes('design'),
                  showBookings: prev.showBookings || picked.includes('bookings'),
                  showRepairs: prev.showRepairs || picked.includes('repairs'),
                }));
                triggerToast(picked.length === 0 ? 'Kept your current setup' : 'Workspace ready — add your first item', picked.length === 0 ? 'info' : 'success');
              }} />
          )}
          {isManager && isOn(settings.features, 'setupChecklist') && !setupDismissed && (() => {
            const installed = typeof window !== 'undefined' && (
              window.matchMedia('(display-mode: standalone)').matches ||
              (window.navigator as unknown as { standalone?: boolean }).standalone === true
            );
            // Slim carousel: one current step + Next, so setup never eats the
            // sell screen. Install always has an action (prompt, or the help
            // banner on laptops where no prompt ever fires).
            const showInstallHelp = () => {
              try { localStorage.removeItem('boss_pos_install_dismissed'); } catch {}
              setInstallDismissed(false);
              try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
            };
            const steps = [
              { key: 'stock', label: 'Add your first products', done: products.length > 0, act: () => setActiveTab('inventory') },
              { key: 'sale', label: 'Make your first sale', done: sales.length > 0 },
              { key: 'pin', label: 'Set a till PIN', done: !!settings.hasPin, act: () => setIsSettingsOpen(true) },
            ];
            const laterSteps = [
              { key: 'name', label: 'Name your shop', done: !!settings.shopName && settings.shopName !== 'My Shop', act: () => setIsSettingsOpen(true) },
              { key: 'install', label: installed ? 'App installed' : 'Install the app', done: installed, act: installPrompt ? () => { runInstallPrompt(); } : showInstallHelp },
            ];
            const allSteps = [...steps, ...laterSteps];
            const doneCount = allSteps.filter(s => s.done).length;
            if (doneCount >= allSteps.length) return null;
            return (
              <div className="boss-card p-4 rounded-2xl border border-gold-brand/30 mb-4">
                <div className="flex items-center justify-between mb-1.5">
                  <h3 className="text-xs font-black text-white uppercase tracking-widest font-display">Get set up {doneCount}/{allSteps.length}</h3>
                  <button onClick={() => { try { localStorage.setItem('boss_pos_setup_done', '1'); } catch {} setSetupDismissed(true); }}
                    aria-label="Dismiss setup checklist"
                    className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 cursor-pointer">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="h-1.5 bg-zinc-900 rounded-full overflow-hidden mb-3">
                  <div className="h-full bg-gold-brand transition-all" style={{ width: `${Math.round((doneCount / allSteps.length) * 100)}%` }} />
                </div>
                <div className="space-y-1.5">
                  {(() => {
                    const pool = steps.filter(s => !s.done);
                    const focusList = pool.length > 0 ? pool : laterSteps.filter(s => !s.done);
                    if (focusList.length === 0) return null;
                    const focus = focusList[setupIdx % focusList.length];
                    const next = focusList[(setupIdx + 1) % focusList.length];
                    return (
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-black bg-[#0A0A0A] text-zinc-500 border border-white/10">•</span>
                        <span className="flex-1 min-w-0 text-xs font-bold uppercase tracking-wider truncate text-zinc-100">{focus.label}</span>
                        {focus.act && (
                          <button onClick={focus.act}
                            className="h-8 px-3 bg-gold-brand/10 border border-gold-brand/40 text-gold-brand rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-gold-brand/20 transition-all cursor-pointer shrink-0">
                            Go
                          </button>
                        )}
                        {focusList.length > 1 && (
                          <button onClick={() => setSetupIdx(i => i + 1)}
                            title={`Next: ${next.label}`} aria-label={`Next setup step: ${next.label}`}
                            className="w-8 h-8 rounded-lg bg-[#0A0A0A] border border-white/10 text-zinc-400 hover:text-gold-brand hover:border-gold-brand/40 flex items-center justify-center shrink-0 transition-all cursor-pointer">
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    );
                  })()}
                  <details className="pt-1">
                    <summary className="text-[10px] font-black text-zinc-500 uppercase tracking-widest cursor-pointer hover:text-zinc-300 touch-target">
                      Later ({laterSteps.filter(s => s.done).length}/{laterSteps.length})
                    </summary>
                    <div className="space-y-1.5 pt-1.5">
                      {laterSteps.map(s => (
                        <div key={s.key} className="flex items-center gap-2">
                          <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-black ${
                            s.done ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-600/40' : 'bg-[#0A0A0A] text-zinc-500 border border-white/10'
                          }`}>{s.done ? '✓' : '•'}</span>
                          <span className={`flex-1 min-w-0 text-xs font-bold uppercase tracking-wider truncate ${s.done ? 'text-zinc-500 line-through' : 'text-zinc-100'}`}>{s.label}</span>
                          {!s.done && s.act && (
                            <button onClick={s.act}
                              className="h-8 px-3 bg-gold-brand/10 border border-gold-brand/40 text-gold-brand rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-gold-brand/20 transition-all cursor-pointer shrink-0">
                              Go
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              </div>
            );
          })()}
          <Sales 
            products={products} onAddSale={handleAddSale}
            onUpdateProduct={handleUpdateProduct}
            formatCurrency={formatCurrency} cart={cart} setCart={setCart}
            triggerToast={triggerToast} settings={settings}
            onAddExpense={handleAddExpense} expenseCategories={expenseCategories}
            isQuickSale={isQuickSale} setIsQuickSale={setIsQuickSale}
            categories={categories}
            staffName={activeStaff?.name || staffName} setStaffName={setStaffName}
            onSaveCustomProduct={handleSaveCustomProduct}
             staffConfigured={staffConfigured} onOpenStaffSwitcher={handleSwitchStaff}
             tillBranch={tillBranch}
             draftScope={draftScope}
             cartDraftReady={cartDraftReady}
             productionRegisters={productionRegisters}
            onAddProduction={handleAddProduction} onDeleteProduction={handleDeleteProduction}
            salesHistory={sales} wastageLogs={wastageLogs}
            onUndoSale={handleUndoSale}
            onGoToStock={() => setActiveTab('inventory')}
            onGoClose={() => setActiveTab('registers')}

            ingredientBudgetToday={ingredientBudgetToday}
            onRecordIngredientTopUp={handleIngredientTopUp}
            hideMoney={!!settings.blindClose && !isManager}
            simple={isSimpleNav}
            hideGuide={tourVisible}
            onRequirePin={(msg) => requirePin(msg, true)}
            customers={customers}
            onSaveCustomer={handleSaveCustomer}
            onDeleteCustomer={handleDeleteCustomer}
          />
          </ErrorBoundary>
        );
      case 'inventory':
        return (
          <ErrorBoundary key="inventory">
          <Suspense fallback={<div className="flex items-center justify-center min-h-[50vh]"><div className="w-8 h-8 border-2 border-gold-brand border-t-transparent rounded-full animate-spin" /></div>}>
          <Inventory 
            products={products} suppliers={suppliers} supplierPrices={supplierPrices}
            sales={sales}
            shopName={settings.shopName}
            categories={categories}
            onAddProduct={handleAddProduct} onUpdateProduct={handleUpdateProduct}
            onDeleteProduct={handleDeleteProduct}
            onUpsertQuote={handleUpsertQuote} onDeleteQuote={handleDeleteQuote}
            onAddCategory={handleAddCategory}
            onUpdateCategory={handleUpdateCategory}
            onDeleteCategory={handleDeleteCategory}
            onAddExpense={handleAddExpense}
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
            onUpdateProduct={handleUpdateProduct}
            formatCurrency={formatCurrency} triggerToast={triggerToast}
            lang={settings.language}
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
            expenses={expenses}
            creditEats={creditEats}
            productionRegisters={productionRegisters}
            wastageLogs={wastageLogs}
            momoTransfers={momoTransfers}
            onAddCreditEat={handleAddCreditEat}
            onPayCreditEat={handlePayCreditEat}
            onAddWastage={handleAddWastage}
            onDeleteWastage={handleDeleteWastage}
            onAddMomoTransfer={handleAddMomoTransfer}
            onDeleteMomoTransfer={handleDeleteMomoTransfer}
            staffName={staffName || undefined}
            shopName={settings.shopName}
            ownerName={settings.ownerName || ''}
            staff={staffList}
            eodCapital={settings.eodCapital}
            onSetEodCapital={(cat, value) => setSettings(prev => ({ ...prev, eodCapital: { ...(prev.eodCapital || {}), [cat]: value } }))}
            formatCurrency={formatCurrency} triggerToast={triggerToast}
            onBack={() => setActiveTab('analytics')}
            onReopenDay={handleReopenDay}
            onCloseDayFinished={handleCloseDayFinished}
            onShareCloseSummary={handleShareCloseSummary}
            onCommitProductionPlan={handleCommitProductionPlan}
            branch={tillBranch}
            ownerPhone={settings.ownerPhone || ''}
            closeSummaryAuto={settings.closeSummaryAuto !== false}
            lang={settings.language}
            onPrintClose={() => printDailyClose(new Date().toISOString().slice(0, 10), sales, expenses, products)}
            onSendClose={() => {
              const url = supplierWhatsAppUrl(settings.ownerPhone, buildCloseSummary(settings.shopName, closeTotals(new Date().toISOString().slice(0, 10), sales, expenses, creditPayments, creditEats), activeStaff?.name || staffName || undefined));
              if (!url) { triggerToast('Enter a valid owner number first', 'error'); return; }
              window.open(url, '_blank', 'noopener');
            }}
            features={settings.features}
            pastClose={isPastClose(settings)}
            blind={!!settings.blindClose && !isManager}
            notifyOwner={settings.closeNotifyOwner !== false}
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
            suppliers={suppliers} supplierPrices={supplierPrices}
            creditPayments={creditPayments}
            creditEats={creditEats}
            onPayCreditEat={handlePayCreditEat}
            momoTransfers={momoTransfers}
            customers={customers}
            onSaveCustomer={handleSaveCustomer}
            onDeleteCustomer={handleDeleteCustomer}
            expenseCategories={expenseCategories}
            onAddExpense={handleAddExpense}
            onDeleteExpense={handleDeleteExpense}
            onAddExpenseCategory={handleAddExpenseCategory}
            onUpdateExpenseCategory={handleUpdateExpenseCategory}
            onDeleteExpenseCategory={handleDeleteExpenseCategory}
            onAddSupplier={handleAddSupplier} onUpdateSupplier={handleUpdateSupplier}
            onUpdateProduct={handleUpdateProduct}
            onDeleteSupplier={handleDeleteSupplier}
            onPayCredit={handlePayCredit}
            formatCurrency={formatCurrency} triggerToast={triggerToast}
            showSuppliers={showSuppliers} setShowSuppliers={setShowSuppliers}
            onNavigate={(tab) => setActiveTab(tab)}
            onRepeatLastSale={handleRepeatLastSale} onRefundSale={handleRefundSale}
            onReturnItems={handleReturnItems}
            onVoidSale={handleVoidSale}
            settings={settings}
            isManager={isManager}
            staffName={activeStaff?.name || staffName}
            onSalesChanged={() => { fetchAllData().catch(() => {}); }}
          />
          </Suspense>
          </ErrorBoundary>
        );
      default:
        return (
          <ErrorBoundary key="sales-fallback">
          <Sales 
            products={products} onAddSale={handleAddSale}
            onUpdateProduct={handleUpdateProduct}
            formatCurrency={formatCurrency} cart={cart} setCart={setCart}
            triggerToast={triggerToast} settings={settings}
            onAddExpense={handleAddExpense} expenseCategories={expenseCategories}
            isQuickSale={isQuickSale} setIsQuickSale={setIsQuickSale}
            categories={categories}
            staffName={activeStaff?.name || staffName} setStaffName={setStaffName}
            onSaveCustomProduct={handleSaveCustomProduct}
             staffConfigured={staffConfigured} onOpenStaffSwitcher={handleSwitchStaff}
             tillBranch={tillBranch}
             draftScope={draftScope}
             cartDraftReady={cartDraftReady}
             productionRegisters={productionRegisters}
            onAddProduction={handleAddProduction} onDeleteProduction={handleDeleteProduction}
            salesHistory={sales} wastageLogs={wastageLogs}
            onUndoSale={handleUndoSale}
            onGoToStock={() => setActiveTab('inventory')}
            onGoClose={() => setActiveTab('registers')}
            ingredientBudgetToday={ingredientBudgetToday}
            onRecordIngredientTopUp={handleIngredientTopUp}
            hideMoney={!!settings.blindClose && !isManager}
            simple={isSimpleNav}
            hideGuide={tourVisible}
            onRequirePin={(msg) => requirePin(msg, true)}
            customers={customers}
            onSaveCustomer={handleSaveCustomer}
            onDeleteCustomer={handleDeleteCustomer}
          />
          </ErrorBoundary>
        );
    }
  };

  const handleRetry = () => window.location.reload();

  // Hidden super-agent console: not linked anywhere in the till UI, needs
  // the server SUPER_ADMIN_SECRET. Bypasses the till lock on purpose.
  // Marketer portal shares the bypass: <url>#marketer-BOSS-XXXX (code is secret).
  if (typeof window !== 'undefined' && (window.location.hash === '#admin' || window.location.hash.startsWith('#marketer-'))) {
    return <AdminDashboard />;
  }

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
      className={`flex flex-col min-h-screen pb-24 text-zinc-100 bg-[#0A0A0A] relative ${theme === 'dark' ? 'dark-theme' : ''}`}
      style={{
        '--color-gold-brand': THEME_MAP.get(settings.themeId)?.brand ?? '#ffcc00',
        '--color-gold-medium': THEME_MAP.get(settings.themeId)?.medium ?? '#f1c100',
        '--color-gold-light': THEME_MAP.get(settings.themeId)?.light ?? '#ffedc3',
      } as Record<string, string>}
    >
      <header className="bg-[#141414] border-b border-white/5 sticky top-0 z-50 flex justify-between items-center gap-2 px-3 sm:px-4 py-2 h-14 w-full overflow-hidden">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <h1 className="text-xs sm:text-sm md:text-base font-black text-gold-brand uppercase tracking-tighter font-display truncate max-w-[90px] min-[400px]:max-w-[130px] sm:max-w-none shrink-0">
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
              {pendingCount}<span className="hidden sm:inline"> unsynced</span>
            </span>
          ) : lastSyncedAt ? (
            <span className="hidden md:inline-block text-[8px] bg-emerald-950/40 text-emerald-400 font-extrabold px-2 py-0.5 rounded-full uppercase tracking-widest font-sans border border-emerald-500/30" title="Latest server sync time">
              Synced {formatSyncedAgo(lastSyncedAt)}
            </span>
          ) : null}
          {cart.length > 0 && (
            <button onClick={() => setActiveTab('sales')} title="Go to cart"
              aria-label={`Cart total ${formatCurrency(cart.reduce((s, i) => s + i.lineTotal, 0))}. Go to sell screen.`}
              className="text-[8px] bg-gold-brand/10 text-gold-brand font-extrabold px-2 py-0.5 rounded-full uppercase tracking-widest font-sans border border-gold-brand/30 hover:bg-gold-brand/20 transition-all cursor-pointer tabular-nums">
              Cart • {formatCurrency(cart.reduce((s, i) => s + i.lineTotal, 0))}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          {installPrompt && (
            <button onClick={() => { runInstallPrompt(); }}
              className="h-7 px-2 sm:px-3 bg-gold-brand text-black font-black text-[10px] rounded-lg uppercase tracking-wider hover:opacity-90 transition-all cursor-pointer shrink-0">
              Install<span className="hidden sm:inline"> app</span>
            </button>
          )}
          <button onClick={handleSwitchStaff} title={staffConfigured ? 'Switch seller (PIN-checked)' : 'Who is selling'}
            aria-label={staffConfigured ? `Switch seller, currently ${activeStaff?.name || staffName || 'unset'}` : 'Set seller name'}
            className="flex items-center gap-1.5 h-7 px-2 sm:px-2.5 bg-[#0A0A0A] border border-white/5 hover:border-gold-brand/40 rounded-lg text-[10px] font-black uppercase tracking-wider text-zinc-300 hover:text-gold-brand transition-all cursor-pointer min-w-0">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${activeStaff ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
            <span className="max-w-[64px] min-[400px]:max-w-[90px] sm:max-w-[120px] truncate">{activeStaff?.name || staffName || 'Seller'}</span>
            {staffConfigured && <span className="hidden sm:inline text-[8px] text-zinc-600 shrink-0">{activeStaff?.role === 'manager' ? 'MGR' : 'CSH'}</span>}
          </button>
          <NotificationsBell onNavigate={(t) => setActiveTab(t)} />
          {isManager && (
            <button onClick={() => { refreshCloseSummaries(); setShowSummaryInbox(true); }}
              className="relative p-1.5 bg-[#0A0A0A] border border-white/5 hover:border-gold-brand/40 text-zinc-400 hover:text-gold-brand rounded-xl transition-all cursor-pointer shrink-0"
              title={unreadSummaries.length > 0 ? `${unreadSummaries.length} unread close ${unreadSummaries.length === 1 ? 'summary' : 'summaries'}` : 'Close summaries'}
              aria-label={unreadSummaries.length > 0 ? `Close summaries, ${unreadSummaries.length} unread` : 'Close summaries'}>
              <Mail className="w-4 h-4" />
              {unreadSummaries.length > 0 && (
                <span aria-hidden="true" className="absolute -top-1.5 -right-1.5 bg-gold-brand text-black text-[9px] font-black min-w-4 h-4 px-1 rounded-full flex items-center justify-center border border-[#0F0F0F]">
                  {unreadSummaries.length > 9 ? '9+' : unreadSummaries.length}
                </span>
              )}
            </button>
          )}
          <button onClick={() => {
            const next = theme === 'light' ? 'dark' : 'light';
            setTheme(next);
            try { localStorage.setItem(THEME_KEY, next); } catch {}
          }} className="p-1.5 bg-[#0A0A0A] border border-white/5 hover:border-gold-brand/40 text-zinc-400 hover:text-gold-brand rounded-xl transition-all cursor-pointer shrink-0" title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'} aria-label="Toggle dark mode">
            {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
          <button onClick={() => setIsSettingsOpen(true)} className="p-1.5 bg-[#0A0A0A] border border-white/5 hover:border-gold-brand/40 text-zinc-400 hover:text-gold-brand rounded-xl transition-all cursor-pointer shrink-0" title="Settings" id="settings-gear-btn">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] max-w-7xl mx-auto w-full">
        <CloseReminderBar
          hours={settings}
          leadMinutes={settings.closeReminderLeadMin}
          soundOn={settings.closeReminderSound !== false}
          onStartClose={() => setActiveTab('registers')}
          onDismiss={() => {}}
        />
        {pendingHandoffs.length > 0 && (
          <HandoverPrompt
            pending={pendingHandoffs}
            summary={handoffSummary}
            currentStaffName={activeStaff?.name || staffName}
            formatCurrency={formatCurrency}
            onConfirm={confirmHandoff}
            onDismiss={() => {}}
          />
        )}
        {showSummaryInbox && (
          <CloseSummaryInbox
            summaries={closeSummaries}
            formatCurrency={formatCurrency}
            triggerToast={triggerToast}
            onRead={handleReadCloseSummary}
            onShare={handleShareCloseSummary}
            onClose={() => {
              markSummariesSeen(closeSummaries.map(s => s.id));
              setShowSummaryInbox(false);
              refreshCloseSummaries();
            }}
          />
        )}
        {!isOnline && (
          <div role="status" className="rounded-2xl border border-amber-500/30 bg-amber-950/25 px-4 py-3 mb-4 flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" aria-hidden="true" />
            <p className="text-xs font-bold text-amber-200 leading-snug">
              You're offline — keep selling.
              {pendingCount > 0
                ? ` ${pendingCount} change${pendingCount !== 1 ? 's' : ''} will sync when you're back.`
                : " Everything syncs when you're back."}
            </p>
          </div>
        )}
        {/* First-run install banner: new devices see this before anything else.
            Dismissed forever on "Not now". iPhones get manual steps (no prompt). */}
        {!installDismissed && (() => {
          try {
            if (isStandalone()) return null;
          } catch { return null; }
          const ios = isIOSDevice();
          const desktop = !ios && isDesktopLike();
          if (!installPrompt && !ios && !desktop) return null;
          return (
            <div className="boss-card p-4 rounded-2xl border border-gold-brand/40 bg-gold-brand/5 mb-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-gold-brand/15 border border-gold-brand/30 flex items-center justify-center shrink-0">
                  <Download className="w-5 h-5 text-gold-brand" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black text-white uppercase tracking-widest">Install the app</p>
                  <p className="text-[11px] text-zinc-400 font-bold mt-0.5 leading-snug">
                    {ios
                      ? 'On iPhone: tap Share, then "Add to Home Screen" — it opens fast and works offline.'
                      : installPrompt
                        ? 'One tap — opens fast, works offline, syncs faster.'
                        : 'On this laptop: browser menu ⋮ → “Install page as app” (Chrome/Edge) — then it opens fast and works offline.'}
                  </p>
                  <div className="flex gap-2 mt-2.5">
                    {!ios && installPrompt && (
                      <button onClick={() => { runInstallPrompt(); }}
                        className="h-10 px-5 bg-gold-brand text-black font-black uppercase tracking-widest text-xs rounded-xl hover:opacity-90 active:scale-95 transition-all cursor-pointer">
                        Install
                      </button>
                    )}
                    <button onClick={dismissInstall}
                      className="h-10 px-4 border border-zinc-700 text-zinc-400 font-bold uppercase tracking-wider text-xs rounded-xl hover:text-zinc-200 transition-all cursor-pointer">
                      {ios || !installPrompt ? 'Got it' : 'Not now'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
        {renderContent()}
      </main>

      {/* Bottom nav sits at z-40 (below every modal/sheet/backdrop) so no
          form footer can ever hide behind it. Page content has no z-index,
          so the nav still floats above scrolling content.
          Simple mode (#25): beginners get Sell / Money / More. Stock,
          Spending, Sales and Close day live under Money/More until the
          20-sale graduation prompt. */}
      {isSimpleNav ? (
      <nav id="bottom-nav" aria-label="Simple menu" className="fixed bottom-0 inset-x-0 w-full z-40 flex justify-around items-center h-[calc(4rem+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] bg-[#141414] border-t border-white/5 shadow-[0_-4px_20px_rgba(0,0,0,0.5)]">
        <button onClick={() => { setActiveTab('sales'); setShowMore(false); }} aria-label={t(settings.language, 'sell')} className={`flex flex-col items-center justify-center flex-1 min-w-0 h-full py-1 select-none transition-all active:scale-95 ${activeTab === 'sales' ? 'text-gold-brand font-black' : 'text-zinc-500 hover:text-zinc-300'}`} aria-current={activeTab === "sales" ? "page" : undefined} id="sales-nav-btn">
          <div className="relative">
            <ShoppingCart className="w-5 h-5 mb-1" />
            {cart.length > 0 && (
              <span className="absolute -top-1.5 -right-2 bg-gold-brand text-black text-[8px] font-black w-4 h-4 rounded-full flex items-center justify-center border border-[#0F0F0F]">
                {cart.reduce((sum, item) => sum + item.qty, 0)}
              </span>
            )}
          </div>
          <span className="text-xs font-bold uppercase tracking-wider">{t(settings.language, 'sell')}</span>
        </button>
        <button onClick={() => { setActiveTab(isManager ? 'analytics' : 'expenses'); setShowMore(false); }} aria-label={isManager ? 'Money' : 'Spend'}
          className={`flex flex-col items-center justify-center flex-1 min-w-0 h-full py-1 select-none transition-all active:scale-95 ${activeTab === 'analytics' || activeTab === 'expenses' ? 'text-gold-brand font-black' : 'text-zinc-500 hover:text-zinc-300'}`}
          aria-current={activeTab === 'analytics' || activeTab === 'expenses' ? 'page' : undefined} id="money-nav-btn">
          <Wallet className="w-5 h-5 mb-1" />
          <span className="text-xs font-bold uppercase tracking-wider">{t(settings.language, isManager ? 'money' : 'spend')}</span>
        </button>
        <button onClick={() => setShowMore(true)} aria-label="More options" aria-expanded={showMore}
          className={`flex flex-col items-center justify-center flex-1 min-w-0 h-full py-1 select-none transition-all active:scale-95 ${showMore || (activeTab !== 'sales' && activeTab !== 'analytics' && activeTab !== 'expenses') ? 'text-gold-brand font-black' : 'text-zinc-500 hover:text-zinc-300'}`} id="more-nav-btn">
          <Ellipsis className="w-5 h-5 mb-1" />
          <span className="text-xs font-bold uppercase tracking-wider">{t(settings.language, 'more')}</span>
        </button>
      </nav>
      ) : (
      <nav id="bottom-nav" className="fixed bottom-0 inset-x-0 w-full z-40 flex justify-around items-center h-[calc(4rem+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] bg-[#141414] border-t border-white/5 shadow-[0_-4px_20px_rgba(0,0,0,0.5)]">
        <button onClick={() => setActiveTab('sales')} aria-label={t(settings.language, 'sell')} className={`flex flex-col items-center justify-center flex-1 min-w-0 h-full py-1 select-none transition-all active:scale-95 ${activeTab === 'sales' ? 'text-gold-brand font-black' : 'text-zinc-500 hover:text-zinc-300'}`} aria-current={activeTab === "sales" ? "page" : undefined} id="sales-nav-btn">
          <div className="relative">
            <ShoppingCart className="w-5 h-5 mb-1" />
            {cart.length > 0 && (
              <span className="absolute -top-1.5 -right-2 bg-gold-brand text-black text-[8px] font-black w-4 h-4 rounded-full flex items-center justify-center border border-[#0F0F0F]">
                {cart.reduce((sum, item) => sum + item.qty, 0)}
              </span>
            )}
          </div>
          <span className="text-xs font-bold uppercase tracking-wider">{t(settings.language, 'sell')}</span>
        </button>
        {tabOpen('inventory') && (
        <button onClick={() => setActiveTab('inventory')} aria-label={t(settings.language, 'stock')} className={`flex flex-col items-center justify-center flex-1 min-w-0 h-full py-1 select-none transition-all active:scale-95 ${activeTab === 'inventory' ? 'text-gold-brand font-black' : 'text-zinc-500 hover:text-zinc-300'}`} aria-current={activeTab === "inventory" ? "page" : undefined} id="inventory-nav-btn">
          <Package className="w-5 h-5 mb-1" />
          <span className="text-xs font-bold uppercase tracking-wider">{t(settings.language, 'stock')}</span>
        </button>
        )}
        <button onClick={() => { setActiveTab('expenses'); }} aria-label={t(settings.language, 'spend')} className={`flex flex-col items-center justify-center flex-1 min-w-0 h-full py-1 select-none transition-all active:scale-95 ${activeTab === 'expenses' ? 'text-gold-brand font-black' : 'text-zinc-500 hover:text-zinc-300'}`} aria-current={activeTab === "expenses" ? "page" : undefined} id="expenses-nav-btn">
          <Wallet className="w-5 h-5 mb-1" />
          <span className="text-xs font-bold uppercase tracking-wider">{t(settings.language, 'spend')}</span>
        </button>
        {tabOpen('analytics') && (
        <button onClick={() => { setActiveTab('analytics'); setShowSuppliers(false); }} aria-label={t(settings.language, 'salesTab')} className={`flex flex-col items-center justify-center flex-1 min-w-0 h-full py-1 select-none transition-all active:scale-95 ${activeTab === 'analytics' ? 'text-gold-brand font-black' : 'text-zinc-500 hover:text-zinc-300'}`} aria-current={activeTab === "analytics" ? "page" : undefined} id="analytics-nav-btn">
          <ReceiptText className="w-5 h-5 mb-1" />
          <span className="text-xs font-bold uppercase tracking-wider">{t(settings.language, 'salesTab')}</span>
        </button>
        )}
        {/* Close day follows the manager's cashier doors — blind hides totals. */}
        {tabOpen('registers') && (
        <button onClick={() => setActiveTab('registers')} aria-label={t(settings.language, 'closeDay')} className={`flex flex-col items-center justify-center flex-1 min-w-0 h-full py-1 select-none transition-all active:scale-95 ${activeTab === 'registers' ? 'text-gold-brand font-black' : 'text-zinc-500 hover:text-zinc-300'}`} aria-current={activeTab === "registers" ? "page" : undefined} id="registers-nav-btn">
          <LayoutGrid className="w-5 h-5 mb-1" />
          <span className="text-xs font-bold uppercase tracking-wider">{t(settings.language, 'closeDay')}</span>
        </button>
        )}
      </nav>
      )}

      {/* Simple → Full graduation prompt (#25): once at 20 sales, never nags. */}
      {showGraduation && (
        <div role="status" aria-label="Try the full menu" className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] inset-x-4 z-40 boss-card p-4 rounded-2xl border border-gold-brand/40 bg-[#141414]/95 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-black text-white uppercase tracking-widest">You've made 20 sales — ready for the full menu?</p>
              <p className="text-[11px] text-zinc-400 font-bold mt-0.5 leading-snug">Stock, Spending, Sales and Close day get their own tabs.</p>
              <div className="flex gap-2 mt-2.5">
                <button onClick={() => setNav('full')}
                  className="h-10 px-5 bg-gold-brand text-black font-black uppercase tracking-widest text-xs rounded-xl hover:opacity-90 active:scale-95 transition-all cursor-pointer">
                  Try full menu
                </button>
                <button onClick={staySimple}
                  className="h-10 px-4 border border-zinc-700 text-zinc-400 font-bold uppercase tracking-wider text-xs rounded-xl hover:text-zinc-200 transition-all cursor-pointer">
                  Stay simple
                </button>
              </div>
            </div>
            <button onClick={staySimple} aria-label="Dismiss full menu suggestion"
              className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 cursor-pointer shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* More sheet (simple mode): Stock / Spending / Reports / Close day. */}
      {isSimpleNav && showMore && (
        <div className="fixed inset-0 z-[80] flex flex-col" role="dialog" aria-label="More options">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowMore(false)} />
          <div className="relative mt-auto bg-[#141414] border-t border-zinc-800 rounded-t-3xl max-h-[80vh] flex flex-col shadow-2xl animate-slide-up">
            <div className="flex justify-center pt-2 pb-1">
              <div className="w-10 h-1 rounded-full bg-zinc-700" />
            </div>
            <div className="flex items-center justify-between px-5 pb-3 border-b border-white/5">
              <h3 className="text-sm font-black text-white uppercase tracking-wider">{t(settings.language, 'more')}</h3>
              <button onClick={() => setShowMore(false)} aria-label="Close more options"
                className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 transition-all cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-2">
              {tabOpen('inventory') && (
              <button onClick={() => { setActiveTab('inventory'); setShowMore(false); }}
                className="w-full flex items-center gap-3 p-4 rounded-2xl border border-white/5 bg-[#0A0A0A] hover:border-gold-brand/40 text-left active:scale-[0.98] transition-all cursor-pointer min-h-[60px]">
                <Package className="w-5 h-5 text-gold-brand shrink-0" />
                <span><span className="block text-sm font-bold text-white">{t(settings.language, 'stock')}</span>
                <span className="block text-[11px] text-zinc-500 font-bold">Add products, check what's left</span></span>
              </button>
              )}
              <button onClick={() => { setActiveTab('expenses'); setShowMore(false); }}
                className="w-full flex items-center gap-3 p-4 rounded-2xl border border-white/5 bg-[#0A0A0A] hover:border-gold-brand/40 text-left active:scale-[0.98] transition-all cursor-pointer min-h-[60px]">
                <Wallet className="w-5 h-5 text-gold-brand shrink-0" />
                <span><span className="block text-sm font-bold text-white">{t(settings.language, 'spend')}</span>
                <span className="block text-[11px] text-zinc-500 font-bold">Log what the shop spends</span></span>
              </button>
              {tabOpen('analytics') && (
              <button onClick={() => { setActiveTab('analytics'); setShowSuppliers(false); setShowMore(false); }}
                className="w-full flex items-center gap-3 p-4 rounded-2xl border border-white/5 bg-[#0A0A0A] hover:border-gold-brand/40 text-left active:scale-[0.98] transition-all cursor-pointer min-h-[60px]">
                <TrendingUp className="w-5 h-5 text-gold-brand shrink-0" />
                <span><span className="block text-sm font-bold text-white">{t(settings.language, 'salesTab')}</span>
                <span className="block text-[11px] text-zinc-500 font-bold">Today's summary and past sales</span></span>
              </button>
              )}
              {tabOpen('registers') && (
              <button onClick={() => { setActiveTab('registers'); setShowMore(false); }}
                className="w-full flex items-center gap-3 p-4 rounded-2xl border border-white/5 bg-[#0A0A0A] hover:border-gold-brand/40 text-left active:scale-[0.98] transition-all cursor-pointer min-h-[60px]">
                <LayoutGrid className="w-5 h-5 text-gold-brand shrink-0" />
                <span><span className="block text-sm font-bold text-white">{t(settings.language, 'closeDay')}</span>
                <span className="block text-[11px] text-zinc-500 font-bold">Count today's money, finish the books</span></span>
              </button>
              )}
              <button onClick={() => { setIsSettingsOpen(true); setShowMore(false); }}
                className="w-full flex items-center gap-3 p-4 rounded-2xl border border-white/5 bg-[#0A0A0A] hover:border-gold-brand/40 text-left active:scale-[0.98] transition-all cursor-pointer min-h-[60px]">
                <Settings className="w-5 h-5 text-gold-brand shrink-0" />
                <span><span className="block text-sm font-bold text-white">{t(settings.language, 'settings')}</span>
                <span className="block text-[11px] text-zinc-500 font-bold">Shop name, PIN, app options</span></span>
              </button>
              <button onClick={() => setNav('full')}
                className="w-full p-4 rounded-2xl border border-gold-brand/30 bg-gold-brand/5 text-gold-brand text-xs font-black uppercase tracking-widest hover:bg-gold-brand/10 active:scale-[0.98] transition-all cursor-pointer min-h-[52px]">
                Show full menu (5 tabs)
              </button>
            </div>
          </div>
        </div>
      )}

      {tourVisible && (
        // The guide is non-critical: if it ever throws, it dies silently and
        // the till keeps selling (the per-tab boundary would nuke the screen).
        <ErrorBoundary key="tour" fallback={<></>}>
          <FirstSaleTour key={tourSession}
          onDone={() => setTourDone(true)}
          onNavigate={(t) => setActiveTab(t)}
          signals={{
            cartCount: cart.reduce((s, i) => s + i.qty, 0),
            hasProducts: products.length > 0,
            salesCount: sales.length,
            activeTab,
          }} />
        </ErrorBoundary>
      )}

      {toastMessage && <Toast message={toastMessage} type={toastType} action={toastAction} onClose={() => { setToastMessage(null); setToastAction(undefined); }} />}

      {showStaffSwitcher && staffConfigured && (
        <StaffSwitcher
          staff={staffList.filter(s => s.active)}
          mandatory={false}
          verifying={staffVerifying}
          error={staffVerifyError}
          onVerify={handleVerifyStaff}
          onClose={() => setShowStaffSwitcher(false)}
        />
      )}
      {staffConfigured && !activeStaff && (
        <StaffSwitcher
          staff={staffList.filter(s => s.active)}
          mandatory={true}
          verifying={staffVerifying}
          error={staffVerifyError}
          onVerify={handleVerifyStaff}
          onClose={() => {}}
        />
      )}

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
            <div className="space-y-4 flex-1 min-h-0 overflow-y-auto pr-1">
              {staffConfigured && !isManager ? (
                // Sellers get a limited Settings: accounts are created by a
                // manager, and shop-wide options stay out of reach. Only
                // device-local display choices remain.
                <div className="space-y-3">
                  <div className="rounded-2xl border border-gold-brand/30 bg-gold-brand/5 p-4">
                    <p className="text-xs font-black text-white uppercase tracking-widest">
                      Clocked in as {activeStaff?.name || staffName || 'seller'}
                    </p>
                    <p className="text-[11px] text-zinc-400 font-bold mt-1 leading-snug">
                      Shop settings are managed by a manager. Ask them to change prices, stock, PINs or staff accounts.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Who is selling</label>
                    <button onClick={handleSwitchStaff}
                      className="w-full h-12 bg-[#0A0A0A] border border-white/5 px-4 rounded-xl text-white font-bold focus:border-gold-brand outline-none flex items-center justify-between cursor-pointer">
                      <span>{activeStaff?.name || staffName || 'Tap to set seller'}</span>
                      <span className="text-[10px] text-gold-brand font-black uppercase">Switch</span>
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={async () => {
                      const newTheme = theme === 'light' ? 'dark' : 'light';
                      setTheme(newTheme);
                      localStorage.setItem(THEME_KEY, newTheme);
                      if (newTheme === 'dark') {
                        document.documentElement.classList.add('dark');
                      } else {
                        document.documentElement.classList.remove('dark');
                      }
                      document.documentElement.classList.toggle('light-theme', newTheme === 'light');
                    }}
                      className="flex-1 h-10 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-gold-brand/40 transition-all cursor-pointer">
                      {theme === 'light' ? 'Switch to Dark' : 'Switch to Light'}
                    </button>
                    <button onClick={toggleSimpleTill}
                      title="Attendant mode: hides discounts, quotes and parking on this phone"
                      className={`flex-1 h-10 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer border ${simpleTill ? 'bg-gold-brand/15 border-gold-brand/50 text-gold-brand' : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-gold-brand/40'}`}>
                      {simpleTill ? 'Simple: On' : 'Simple: Off'}
                    </button>
                    <button onClick={() => setSettings(prev => ({ ...prev, largeText: !prev.largeText }))}
                      title="Bigger text and buttons for sunlight and tired eyes"
                      className={`flex-1 h-10 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer border ${settings.largeText ? 'bg-gold-brand/15 border-gold-brand/50 text-gold-brand' : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-gold-brand/40'}`}>
                      {settings.largeText ? 'Big text: On' : 'Big text: Off'}
                    </button>
                  </div>
                </div>
              ) : (
              <>
              {/* Section doors: seven areas, one open at a time — jump via chips. */}
              <div className="sticky top-0 z-10 -mx-1 px-1 py-1.5 bg-[#141414]/95 backdrop-blur flex gap-1.5 overflow-x-auto scrollbar-none">
                {SETTINGS_SECTIONS.map(s => (
                  <button key={s.key} onClick={() => openSettingsSection(s.key)}
                    className={`shrink-0 h-9 px-3.5 rounded-xl text-[11px] font-black uppercase tracking-wider border transition-all active:scale-95 cursor-pointer ${settingsSection === s.key ? 'bg-gold-brand border-gold-brand text-black' : 'bg-[#0A0A0A] border-white/10 text-zinc-400 hover:text-zinc-200'}`}>
                    {s.label}
                  </button>
                ))}
              </div>
              <SettingsSection id="set-shop" icon={Store} title="Shop" hint="Name, type, language, hours, branches"
                open={settingsSection === 'shop'} onToggle={() => toggleSettingsSection('shop')}>
              <div className="space-y-1">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1 flex-wrap">Shop Name <SettingHelp label="Shop Name" text="Your shop's name. It shows at the top of every till, on receipts and on the daily close message." /></label>
                <input type="text" value={settings.shopName} onChange={(e) => setSettings(prev => ({ ...prev, shopName: e.target.value || 'My Shop' }))}
                  className="w-full h-12 bg-[#0A0A0A] border border-white/5 text-sm px-4 rounded-xl text-white font-bold focus:border-gold-brand outline-none" placeholder="e.g. IMAC Phone Shop" />
                <input type="text" value={settings.receiptFooter || ''} onChange={(e) => setSettings(prev => ({ ...prev, receiptFooter: e.target.value.slice(0, 120) || undefined }))}
                  title="Printed under every receipt (slogan, returns policy)"
                  className="mt-2 w-full h-12 bg-[#0A0A0A] border border-white/5 text-sm px-4 rounded-xl text-white font-bold focus:border-gold-brand outline-none" placeholder="Receipt footer, e.g. No returns after 3 days" />
                <div className="mt-2 flex items-center gap-2">
                  {settings.receiptLogoUrl ? (
                    <img src={settings.receiptLogoUrl} alt="Shop logo"
                      className="h-12 w-12 rounded-xl object-contain bg-white border border-white/10 shrink-0"
                      onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />
                  ) : null}
                  <button onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo}
                    className="flex-1 h-12 bg-[#0A0A0A] border border-white/5 hover:border-gold-brand/40 text-zinc-300 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer disabled:opacity-50">
                    {uploadingLogo ? 'Uploading…' : settings.receiptLogoUrl ? 'Change logo' : 'Add receipt logo'}
                  </button>
                  {settings.receiptLogoUrl ? (
                    <button onClick={() => setSettings(prev => ({ ...prev, receiptLogoUrl: undefined }))}
                      className="h-12 px-4 bg-[#0A0A0A] border border-white/5 hover:border-rose-600/50 text-zinc-400 hover:text-rose-300 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer">
                      Remove
                    </button>
                  ) : null}
                </div>
                <input ref={logoInputRef} type="file" accept="image/*" className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    setUploadingLogo(true);
                    try {
                      const url = await uploadImage(file);
                      setSettings(prev => ({ ...prev, receiptLogoUrl: url }));
                      triggerToast('Logo added — it prints on every receipt', 'success');
                    } catch {
                      triggerToast('Could not upload the logo — try a smaller photo', 'error');
                    } finally {
                      setUploadingLogo(false);
                    }
                  }} />
                <p className="text-[10px] text-zinc-600">Logo prints on receipts and the PNG share. Square photos work best.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1 flex-wrap">Shop Type <SettingHelp label="Shop Type" text="Tells the till what you sell. Eatery unlocks recipes and morning production; tailoring, design, bookings and repairs add their order screens." /></label>
                <select value={settings.vibe} onChange={(e) => setSettings(prev => ({ ...prev, vibe: e.target.value }))}
                  className="w-full h-12 bg-[#0A0A0A] border border-white/5 text-sm px-3 rounded-xl text-white font-bold focus:border-gold-brand outline-none">
                  <option value="Phone & Accessories">Phone & Accessories</option>
                  <option value="Eatery & Food">Eatery & Food</option>
                  <option value="Bespoke Tailoring">Bespoke Tailoring</option>
                  <option value="General Store">General Store</option>
                </select>
                {settings.vibe !== 'General Store' && (
                  <button onClick={async () => {
                    const presets: Record<string, { cats: string[]; tailoring?: boolean; design?: boolean }> = {
                      'Eatery & Food': { cats: ['Eatery', 'Drinks'] },
                      'Phone & Accessories': { cats: ['Phones', 'Accessories', 'Airtime'] },
                      'Bespoke Tailoring': { cats: ['Tailoring'], tailoring: true },
                    };
                    const preset = presets[settings.vibe];
                    if (!preset) return;
                    if (!(await confirmDialog({ title: 'Set up shop', message: `Set this shop up for ${settings.vibe}?\n\nCategories become: ${preset.cats.join(', ')}.\nYour products stay — recategorize them in Stock afterwards.`, confirmLabel: 'Set up' }))) return;
                    try { localStorage.removeItem(NO_DRINKS_KEY); } catch {}
                    setCategories(preset.cats);
                    if (preset.tailoring) setSettings(prev => ({ ...prev, showTailoring: true }));
                    if (preset.design) setSettings(prev => ({ ...prev, showDesign: true }));
                    triggerToast(`Shop set for ${settings.vibe} — add your stock in Stock`, 'success');
                  }}
                    className="mt-2 w-full h-11 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer border bg-gold-brand/10 border-gold-brand/40 text-gold-brand hover:bg-gold-brand/20 active:scale-[0.98]">
                    Set up shop for {settings.vibe}
                  </button>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1 flex-wrap">Till language <SettingHelp label="Till language" text="Switches Sell, Expenses, Money, Sales and Close day between English and Luganda. Settings always stay in English." /></label>
                <select value={settings.language || 'english'} onChange={(e) => setSettings(prev => ({ ...prev, language: e.target.value as StoreSettings['language'] }))}
                  className="w-full h-12 bg-[#0A0A0A] border border-white/5 text-sm px-3 rounded-xl text-white font-bold focus:border-gold-brand outline-none">
                  <option value="english">English</option>
                  <option value="luganda">Luganda (sell screen)</option>
                </select>
                <p className="text-[10px] text-zinc-600">Luganda covers Sell, Expenses, Money, Sales and Close day. Settings stay in English.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1 flex-wrap">Shop hours <SettingHelp label="Shop hours" text="Opening and closing times plus days off. End-of-day money nudges wait until after close — no more mid-day alarms for money that simply hasn't been assigned yet. Blank = nudge anytime (old behaviour)." /></label>
                <div className="flex gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-zinc-500 font-bold uppercase mb-1">Opens</p>
                    <input type="time" value={settings.openTime || ''}
                      onChange={(e) => setSettings(prev => ({ ...prev, openTime: e.target.value || undefined }))}
                      className="w-full h-12 bg-[#0A0A0A] border border-white/5 text-sm px-3 rounded-xl text-white font-bold focus:border-gold-brand outline-none tabular-nums" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-zinc-500 font-bold uppercase mb-1">Closes</p>
                    <input type="time" value={settings.closeTime || ''}
                      onChange={(e) => setSettings(prev => ({ ...prev, closeTime: e.target.value || undefined }))}
                      className="w-full h-12 bg-[#0A0A0A] border border-white/5 text-sm px-3 rounded-xl text-white font-bold focus:border-gold-brand outline-none tabular-nums" />
                  </div>
                </div>
                <p className="text-[10px] text-zinc-500 font-bold uppercase mt-2 mb-1">Days off (no close flags)</p>
                <div className="flex gap-1.5">
                  {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => {
                    const off = (settings.closedDays || []).includes(i);
                    return (
                      <button key={i} onClick={() => setSettings(prev => {
                        const cur = prev.closedDays || [];
                        return { ...prev, closedDays: off ? cur.filter(x => x !== i) : [...cur, i] };
                      })}
                        title={off ? 'Tap to mark open' : 'Tap to mark closed'}
                        className={`flex-1 h-10 rounded-xl text-xs font-black transition-all active:scale-95 cursor-pointer border ${off ? 'bg-rose-950/40 border-rose-600/50 text-rose-300' : 'bg-[#0A0A0A] border-white/5 text-zinc-500 hover:text-zinc-300'}`}>
                        {d}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-zinc-600">Close-out flags fire {settings.closeTime ? `after ${settings.closeTime}` : 'anytime until you set a closing time'}.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1 flex-wrap">
                  Closing reminder
                  <SettingHelp label="Closing reminder" text="How long before your closing time the till starts reminding the cashier to close the day. Set the pace that suits your business — leave it off if you close at different times each day." />
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {[[0, 'Off'], [15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '60 min']].map(([mins, label]) => {
                    const value = Number(mins);
                    const active = (settings.closeReminderLeadMin || 0) === value;
                    return (
                      <button key={String(mins)} onClick={() => setSettings(prev => ({ ...prev, closeReminderLeadMin: value }))}
                        className={`h-11 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all active:scale-95 border ${
                          active ? 'bg-gold-brand border-gold-brand text-black' : 'bg-[#0A0A0A] border-white/5 text-zinc-400 hover:text-zinc-200'
                        }`}>
                        {label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <p className="text-[10px] text-zinc-600 font-bold uppercase">
                    {settings.closeReminderLeadMin
                      ? `The sell screen counts down and reminds ${settings.closeReminderLeadMin} min before ${settings.closeTime || 'close'}.`
                      : 'No reminder — the till never nudges the cashier.'}
                  </p>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <button onClick={() => setSettings(prev => ({ ...prev, closeReminderSound: !prev.closeReminderSound }))}
                    className={`flex-1 h-11 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all active:scale-95 border ${
                      settings.closeReminderSound !== false ? 'bg-gold-brand border-gold-brand text-black' : 'bg-[#0A0A0A] border-white/5 text-zinc-400'
                    }`}>
                    Sound
                  </button>
                  <button onClick={() => setSettings(prev => ({ ...prev, closeSummaryAuto: prev.closeSummaryAuto !== false }))}
                    className={`flex-1 h-11 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all active:scale-95 border ${
                      settings.closeSummaryAuto !== false ? 'bg-gold-brand border-gold-brand text-black' : 'bg-[#0A0A0A] border-white/5 text-zinc-400'
                    }`}>
                    Auto owner summary
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1 flex-wrap">
                  Owner
                  <SettingHelp label="Owner" text="The name shown when money is handed to the owner. Every shop sets its own — nothing is hardcoded." />
                </label>
                <input type="text" value={settings.ownerName || ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, ownerName: e.target.value.slice(0, 60) || undefined }))}
                  placeholder="e.g. the owner of this shop"
                  className="w-full h-12 bg-[#0A0A0A] border border-white/5 text-sm px-3 rounded-xl text-white font-bold focus:border-gold-brand outline-none" />
                <p className="text-[10px] text-zinc-600">Shown as "Given to Owner (name)" when recording a handover.</p>
              </div>
              <div className="border-t border-white/5 pt-3 space-y-2">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1">
                  <LayoutGrid className="w-3.5 h-3.5 text-gold-brand" /> Branches
                </label>
                <label className="block text-[10px] text-zinc-500 font-bold uppercase">This till belongs to</label>
                <select value={tillBranch} onChange={(e) => setTillBranch(e.target.value)}
                  className="w-full h-11 bg-[#0A0A0A] border border-white/5 text-sm px-3 rounded-xl text-white font-bold focus:border-gold-brand outline-none">
                  <option value="">Main shop (no branch)</option>
                  {(settings.branches || []).map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                {isManager ? (
                  <>
                    <label className="block text-[10px] text-zinc-500 font-bold uppercase pt-1">All branches (one per line or comma)</label>
                    <input type="text" value={(settings.branches || []).join(', ')} placeholder="e.g. Owino, Kikuubo"
                      onChange={(e) => setSettings(prev => ({
                        ...prev,
                        branches: e.target.value.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean).slice(0, 20),
                      }))}
                      className="w-full h-11 bg-[#0A0A0A] border border-white/5 text-sm px-3 rounded-xl text-white font-bold focus:border-gold-brand outline-none" />
                    {(settings.branches || []).length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {(settings.branches || []).map(b => (
                          <span key={b} className="flex items-center gap-1.5 bg-[#0A0A0A] border border-white/10 rounded-lg pl-2.5 pr-1.5 py-1 text-[11px] font-bold text-zinc-200">
                            {b}
                            <button
                              onClick={async () => {
                                if (!(await confirmDialog({ title: 'Delete branch', message: `Delete branch "${b}"? Old sales keep the name, new sales can't use it.`, confirmLabel: 'Delete', danger: true }))) return;
                                setSettings(prev => ({ ...prev, branches: (prev.branches || []).filter(x => x !== b) }));
                                if (tillBranch === b) setTillBranch('');
                                triggerToast(`Deleted branch "${b}"`, 'info');
                              }}
                              className="p-1 text-zinc-500 hover:text-rose-400 rounded cursor-pointer"
                              title={`Delete ${b}`}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        ))}
                        <button
                          onClick={async () => {
                            if (!(await confirmDialog({ title: 'Clear branches', message: 'Clear ALL branches? Tills fall back to main shop.', confirmLabel: 'Clear all', danger: true }))) return;
                            setSettings(prev => ({ ...prev, branches: [] }));
                            setTillBranch('');
                            triggerToast('All branches cleared', 'info');
                          }}
                          className="text-[10px] font-black uppercase text-rose-400 hover:text-rose-300 px-2 py-1 cursor-pointer"
                        >
                          Clear all
                        </button>
                      </div>
                    )}
                    <p className="text-[10px] text-zinc-600 leading-relaxed">Each sale is stamped with its till's branch; Reports can filter per branch. Stock stays pooled across branches. Rename carefully — old sales keep the old name.</p>
                  </>
                ) : (
                  <p className="text-[10px] text-zinc-600 leading-relaxed">Branch list is managed by a manager. Your sales are stamped “{tillBranch || 'main shop'}”.</p>
                )}
              </div>
              </SettingsSection>
              <SettingsSection id="set-selling" icon={ShoppingCart} title="Selling" hint="Modules, till control, payments, goals, rewards"
                open={settingsSection === 'selling'} onToggle={() => toggleSettingsSection('selling')}>
              <div className="space-y-2">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1 flex-wrap">Extra Modules <SettingHelp label="Extra Modules" text="Order screens for side businesses — tailoring, design & print, bookings, repairs. Off means hidden everywhere until you need them." /></label>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setSettings(prev => ({ ...prev, showTailoring: !prev.showTailoring }))}
                    className={`py-3 rounded-xl border text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2 ${settings.showTailoring ? 'border-gold-brand bg-gold-brand/10 text-white' : 'bg-[#0A0A0A] border-transparent text-zinc-500 hover:text-zinc-300'}`}>
                    <Scissors className="w-3.5 h-3.5" /> Tailoring
                  </button>
                  <button onClick={() => setSettings(prev => ({ ...prev, showDesign: !prev.showDesign }))}
                    className={`py-3 rounded-xl border text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2 ${settings.showDesign ? 'border-gold-brand bg-gold-brand/10 text-white' : 'bg-[#0A0A0A] border-transparent text-zinc-500 hover:text-zinc-300'}`}>
                    <Palette className="w-3.5 h-3.5" /> Design & Print
                  </button>
                  <button onClick={() => setSettings(prev => ({ ...prev, showBookings: !prev.showBookings }))}
                    className={`py-3 rounded-xl border text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2 ${settings.showBookings ? 'border-gold-brand bg-gold-brand/10 text-white' : 'bg-[#0A0A0A] border-transparent text-zinc-500 hover:text-zinc-300'}`}>
                    <CalendarCheck className="w-3.5 h-3.5" /> Bookings
                  </button>
                  <button onClick={() => setSettings(prev => ({ ...prev, showRepairs: !prev.showRepairs }))}
                    className={`py-3 rounded-xl border text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2 ${settings.showRepairs ? 'border-gold-brand bg-gold-brand/10 text-white' : 'bg-[#0A0A0A] border-transparent text-zinc-500 hover:text-zinc-300'}`}>
                    <Wrench className="w-3.5 h-3.5" /> Repairs
                  </button>
                </div>
                <p className="text-[10px] text-zinc-600">Turn on the order screens you actually use. Hidden until enabled.</p>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1 flex-wrap">Till control <SettingHelp label="Till control" text="Master switches for helper features — fast sellers, cash shortcuts, briefing, checklist. Everything is ON by default; turn off what your shop doesn't use." /></label>
                <div className="space-y-1.5">
                  {FEATURES.map(f => {
                    const on = isOn(settings.features, f.key);
                    const flip = () => setSettings(prev => {
                      const feats = { ...(prev.features || {}) };
                      feats[f.key] = !isOn(prev.features, f.key as FeatureKey);
                      return { ...prev, features: feats };
                    });
                    return (
                      <button key={f.key} onClick={flip}
                        className="w-full flex items-center gap-3 bg-[#0A0A0A] border border-white/5 hover:border-gold-brand/40 rounded-xl px-3 py-2.5 text-left transition-all cursor-pointer">
                        <span className="flex-1 min-w-0">
                          <span className="block text-xs font-black text-white uppercase tracking-wider">{f.label}</span>
                          <span className="block text-[10px] text-zinc-500 font-bold mt-0.5">{f.hint}</span>
                        </span>
                        <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-lg border shrink-0 ${on ? 'bg-gold-brand/15 border-gold-brand/50 text-gold-brand' : 'bg-zinc-900 border-zinc-800 text-zinc-500'}`}>
                          {on ? 'On' : 'Off'}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setSettings(prev => ({ ...prev, features: {} }));
                      triggerToast('Till control reset — everything ON', 'success');
                    }}
                    className="flex-1 h-9 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-[10px] font-black uppercase tracking-wider hover:border-gold-brand/40 cursor-pointer"
                  >
                    Reset all ON
                  </button>
                  <button
                    onClick={() => {
                      try {
                        localStorage.removeItem('boss_api_cache_/api/boot');
                        localStorage.removeItem('boss_api_cache_/api/products');
                      } catch {}
                      triggerToast('Local cache cleared — reopen to reload', 'info');
                    }}
                    className="flex-1 h-9 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-[10px] font-black uppercase tracking-wider hover:border-gold-brand/40 cursor-pointer"
                  >
                    Clear cache
                  </button>
                </div>
                <p className="text-[10px] text-zinc-600">Everything is on by default — turn off what your shop doesn’t use. Choices sync to all tills.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1 flex-wrap">Default Payment <SettingHelp label="Default Payment" text="The payment button pre-selected in every new cart. Cashiers can still switch per sale — this just saves a tap." /></label>
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
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider">MoMo fee % (MTN/Airtel cut)</label>
                <input type="number" min="0" max="20" step="any" value={settings.momoFeePct || ''}
                  placeholder="0 = off"
                  onChange={(e) => setSettings(prev => ({ ...prev, momoFeePct: Math.min(20, Math.max(0, parseFloat(e.target.value) || 0)) || undefined }))}
                  className="w-full h-12 bg-[#0A0A0A] border border-white/5 text-sm px-4 rounded-xl text-white font-bold focus:border-gold-brand outline-none" />
                <p className="text-[10px] text-zinc-600">Each MoMo sale auto-books its fee as a MoMo Fees expense, so profit stays honest.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1 flex-wrap">Seller commission % <SettingHelp label="Seller commission" text="Percent of their own sales each seller earns. Shown per seller in Reports — pay out at close." /></label>
                <input type="number" min="0" max="50" step="any" value={settings.commissionPct || ''}
                  placeholder="0 = off"
                  onChange={(e) => setSettings(prev => ({ ...prev, commissionPct: Math.min(50, Math.max(0, parseFloat(e.target.value) || 0)) || undefined }))}
                  className="w-full h-12 bg-[#0A0A0A] border border-white/5 text-sm px-4 rounded-xl text-white font-bold focus:border-gold-brand outline-none" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1 flex-wrap">Big discounts need PIN <SettingHelp label="Big discounts need PIN" text="Discounts above this amount need a manager PIN at checkout — stops quiet friend-discounts. 0 = never ask." /></label>
                <input type="number" min="0" step="500" value={settings.discountPinAbove || ''}
                  placeholder="0 = never ask"
                  onChange={(e) => setSettings(prev => ({ ...prev, discountPinAbove: Math.max(0, parseFloat(e.target.value) || 0) || undefined }))}
                  className="w-full h-12 bg-[#0A0A0A] border border-white/5 text-sm px-4 rounded-xl text-white font-bold focus:border-gold-brand outline-none" />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between items-baseline">
                  <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1 flex-wrap">Daily Goal <SettingHelp label="Daily Goal" text="How many sales you aim for today. The sell screen shows progress — hit it and the till celebrates." /></label>
                  <span className="text-xs font-black text-gold-brand">{settings.dailyGoalNum} Sales</span>
                </div>
                <input type="range" min="5" max="30" value={settings.dailyGoalNum}
                  onChange={(e) => setSettings(prev => ({ ...prev, dailyGoalNum: parseInt(e.target.value) }))}
                  className="w-full accent-gold-brand cursor-pointer h-1.5 bg-[#0A0A0A] rounded-lg appearance-none mt-2" />
                <div className="flex items-center gap-2 mt-2">
                  <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider shrink-0">UGX goal</label>
                  <input type="number" min="0" step="1000" value={settings.dailyGoalRevenue || ''}
                    placeholder="e.g. 300000 (optional)"
                    onChange={(e) => setSettings(prev => ({ ...prev, dailyGoalRevenue: Math.max(0, parseFloat(e.target.value) || 0) || undefined }))}
                    className="flex-1 min-w-0 h-10 bg-[#0A0A0A] border border-white/5 text-sm px-3 rounded-xl text-white font-bold focus:border-gold-brand outline-none tabular-nums" />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1 flex-wrap">Regulars reward <SettingHelp label="Regulars reward" text="Every Nth visit from the same customer earns a one-tap percent discount at checkout. The till counts past sales by name and offers it — never applies it on its own." /></label>
                <div className="flex gap-2">
                  <input type="number" min="2" max="100" value={settings.loyaltyEveryN ?? 10}
                    onChange={(e) => setSettings(prev => ({ ...prev, loyaltyEveryN: Math.min(100, Math.max(2, Math.round(parseFloat(e.target.value) || 10))) }))}
                    aria-label="Reward every Nth visit"
                    className="w-20 h-12 bg-[#0A0A0A] border border-white/5 text-sm px-3 rounded-xl text-white font-bold text-center focus:border-gold-brand outline-none" />
                  <input type="number" min="1" max="50" value={settings.loyaltyPct ?? 5}
                    onChange={(e) => setSettings(prev => ({ ...prev, loyaltyPct: Math.min(50, Math.max(1, Math.round(parseFloat(e.target.value) || 5))) }))}
                    aria-label="Reward discount percent"
                    className="w-20 h-12 bg-[#0A0A0A] border border-white/5 text-sm px-3 rounded-xl text-white font-bold text-center focus:border-gold-brand outline-none" />
                  <p className="text-[10px] text-zinc-600 self-center leading-snug">Every <b className="text-zinc-300">{settings.loyaltyEveryN ?? 10}th</b> visit earns <b className="text-zinc-300">{settings.loyaltyPct ?? 5}%</b> off — offered, never forced.</p>
                </div>
              </div>
              </SettingsSection>
              <SettingsSection id="set-staff" icon={Users} title="Staff" hint="Who sells, staff logins"
                open={settingsSection === 'staff'} onToggle={() => toggleSettingsSection('staff')}>
              <div className="space-y-1">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1 flex-wrap">Who is selling <SettingHelp label="Who is selling" text="The name stamped on every sale, so Reports can show sales per seller. Each phone remembers its own seller." /></label>
                <button onClick={handleSwitchStaff}
                  className="w-full h-12 bg-[#0A0A0A] border border-white/5 px-4 rounded-xl text-white font-bold focus:border-gold-brand outline-none flex items-center justify-between cursor-pointer">
                  <span>{activeStaff?.name || staffName || 'Tap to set seller'}</span>
                  <span className="text-[10px] text-gold-brand font-black uppercase">Switch</span>
                </button>
                <p className="text-[10px] text-zinc-600">Every sale is stamped with this name so Reports can show sales by seller.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1 flex-wrap">Close-out <SettingHelp label="Close-out" text="No manager at close? Cashiers do the evening close blind: they count, move and log, but never see totals. The manager gets it all on WhatsApp instead." /></label>
                <button onClick={() => setSettings(prev => ({ ...prev, blindClose: !prev.blindClose }))}
                  title="Cashiers close without seeing any totals"
                  className={`w-full h-11 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer border ${settings.blindClose ? 'bg-gold-brand/15 border-gold-brand/50 text-gold-brand' : 'bg-[#0A0A0A] border-white/5 text-zinc-500 hover:text-zinc-300'}`}>
                  {settings.blindClose ? 'Blind close: On (cashiers never see totals)' : 'Blind close: Off'}
                </button>
                <button onClick={() => setSettings(prev => ({ ...prev, closeNotifyOwner: prev.closeNotifyOwner === false }))}
                  title="After closing, prompt a WhatsApp summary to the owner number"
                  className={`w-full h-11 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer border ${settings.closeNotifyOwner !== false ? 'bg-gold-brand/15 border-gold-brand/50 text-gold-brand' : 'bg-[#0A0A0A] border-white/5 text-zinc-500 hover:text-zinc-300'}`}>
                  {settings.closeNotifyOwner !== false ? 'WhatsApp owner after close: On' : 'WhatsApp owner after close: Off'}
                </button>
                <p className="text-[10px] text-zinc-600">Blind = count blind so figures can't be cooked to match. Needs the owner number below (Data section) for the WhatsApp handoff.</p>
              </div>
              <div className="border-t border-white/5 pt-3 space-y-2">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1 flex-wrap">
                  <User className="w-3.5 h-3.5 text-gold-brand" /> Staff logins <SettingHelp label="Staff logins" text="PIN-checked accounts. Managers unlock everything; sellers (cashiers) only see Sell and Spend. Only a manager can add or change accounts." />
                </label>
                {!staffConfigured ? (
                  <>
                    <p className="text-[10px] text-zinc-600 leading-relaxed">One shared till PIN today. Add the first staff member to switch on PIN-checked logins: cashiers sell, managers unlock everything.</p>
                    <StaffFirstSetup onAdd={handleAddStaff} />
                  </>
                ) : isManager ? (
                  <>
                    {staffList.map(s => (
                      <div key={s.id} className="flex items-center gap-2 bg-[#0A0A0A] border border-white/5 rounded-xl px-3 py-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${s.active ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                        <span className="flex-1 min-w-0 text-xs font-bold text-zinc-200 truncate">{s.name}</span>
                        <button onClick={() => handleUpdateStaff(s.id, { role: s.role === 'manager' ? 'cashier' : 'manager' })}
                          className="text-[9px] font-black uppercase px-2 py-1 rounded-lg border border-gold-brand/40 text-gold-brand" title="Toggle role">
                          {s.role === 'manager' ? 'MGR' : 'CSH'}
                        </button>
                        <button onClick={async () => {
                          const pin = await promptDialog({ title: 'Reset staff PIN', message: `New 4-digit PIN for ${s.name}:`, secure: true, inputMode: 'numeric', placeholder: '4-digit PIN', validate: value => /^\d{4}$/.test(value) ? null : 'PIN must be 4 digits.' });
                          if (pin) handleUpdateStaff(s.id, { pin });
                        }} className="text-[9px] font-black uppercase px-2 py-1 rounded-lg border border-zinc-700 text-zinc-400" title="Reset PIN">PIN</button>
                        <button onClick={() => handleUpdateStaff(s.id, { active: !s.active })}
                          className="text-[9px] font-black uppercase px-2 py-1 rounded-lg border border-zinc-700 text-zinc-400" title={s.active ? 'Disable' : 'Enable'}>
                          {s.active ? 'On' : 'Off'}
                        </button>
                      </div>
                    ))}
                    <StaffFirstSetup onAdd={handleAddStaff} />
                    <p className="text-[10px] text-zinc-600 leading-relaxed">Cashiers see Sell + Spend only — no stock, reports, close-out, or settings. Voids and refunds ask for a manager.</p>
                  </>
                ) : (
                  <p className="text-[10px] text-zinc-600 leading-relaxed">You are clocked in as {activeStaff?.name} (cashier). A manager can add staff here.</p>
                )}
              </div>
              </SettingsSection>
              <SettingsSection id="set-money" icon={Wallet} title="Money" hint="Owner number, sheets, EFRIS receipts"
                open={settingsSection === 'money'} onToggle={() => toggleSettingsSection('money')}>
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
              {isManager && (
              <div className="border-t border-white/5 pt-3 space-y-2">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1">
                  <ReceiptText className="w-3.5 h-3.5 text-gold-brand" /> URA EFRIS fiscal invoices
                </label>
                {efrisForm ? (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      {(['off', 'sandbox', 'provider'] as const).map(m => (
                        <button key={m} onClick={() => setEfrisForm(prev => prev ? { ...prev, mode: m, enabled: m !== 'off' } : prev)}
                          className={`py-2 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${efrisForm.mode === m ? 'border-gold-brand bg-gold-brand/10 text-white font-extrabold' : 'bg-[#0A0A0A] border-transparent text-zinc-500 hover:text-zinc-300'}`}>
                          {m === 'off' ? 'Off' : m === 'sandbox' ? 'Sandbox' : 'Live'}
                        </button>
                      ))}
                    </div>
                    {efrisForm.mode !== 'off' && (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <input type="text" value={efrisForm.tin} placeholder="Shop TIN"
                            onChange={(e) => setEfrisForm(prev => prev ? { ...prev, tin: e.target.value } : prev)}
                            className="h-11 bg-[#0A0A0A] border border-white/5 text-sm px-3 rounded-xl text-white font-bold focus:border-gold-brand outline-none" />
                          <input type="text" value={efrisForm.deviceNo} placeholder="Device no."
                            onChange={(e) => setEfrisForm(prev => prev ? { ...prev, deviceNo: e.target.value } : prev)}
                            className="h-11 bg-[#0A0A0A] border border-white/5 text-sm px-3 rounded-xl text-white font-bold focus:border-gold-brand outline-none" />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <input type="text" value={efrisForm.branchCode} placeholder="Branch"
                            onChange={(e) => setEfrisForm(prev => prev ? { ...prev, branchCode: e.target.value } : prev)}
                            className="h-11 bg-[#0A0A0A] border border-white/5 text-sm px-3 rounded-xl text-white font-bold focus:border-gold-brand outline-none" />
                          <input type="number" min="0" max="100" value={efrisForm.vatRate} placeholder="VAT %"
                            onChange={(e) => setEfrisForm(prev => prev ? { ...prev, vatRate: Number(e.target.value) } : prev)}
                            className="h-11 bg-[#0A0A0A] border border-white/5 text-sm px-3 rounded-xl text-white font-bold focus:border-gold-brand outline-none" />
                          <input type="text" value={efrisForm.goodsPrefix} placeholder="Goods prefix"
                            onChange={(e) => setEfrisForm(prev => prev ? { ...prev, goodsPrefix: e.target.value } : prev)}
                            className="h-11 bg-[#0A0A0A] border border-white/5 text-sm px-3 rounded-xl text-white font-bold focus:border-gold-brand outline-none" />
                        </div>
                        {efrisForm.mode === 'provider' && (
                          <>
                            <input type="url" value={efrisForm.providerBase} placeholder="Fiscal endpoint base URL (https://…)"
                              onChange={(e) => setEfrisForm(prev => prev ? { ...prev, providerBase: e.target.value } : prev)}
                              className="w-full h-11 bg-[#0A0A0A] border border-white/5 text-sm px-3 rounded-xl text-white font-bold focus:border-gold-brand outline-none" />
                            <input type="password" value={efrisToken} placeholder={efrisHasToken ? 'Token saved — enter a new one to replace' : 'Provider bearer token'}
                              onChange={(e) => setEfrisToken(e.target.value)}
                              className="w-full h-11 bg-[#0A0A0A] border border-white/5 text-sm px-3 rounded-xl text-white font-bold focus:border-gold-brand outline-none" />
                            <div className="rounded-xl border border-amber-800/30 bg-amber-950/20 p-3 space-y-1">
                              <p className="text-[10px] font-black uppercase tracking-wider text-amber-300">Before going live</p>
                              <p className="text-[10px] text-zinc-400 font-bold leading-relaxed">1 · URA approved this TIN's device (1–2 days). 2 · Goods registered in EFRIS matching prefix “{efrisForm.goodsPrefix || 'BOSS'}”. 3 · Endpoint + token filled — your provider may bill separately. Rehearse in Sandbox first; filing never blocks a sale.</p>
                            </div>
                          </>
                        )}
                        <label className="flex items-center gap-2 text-xs text-zinc-300 font-bold cursor-pointer">
                          <input type="checkbox" checked={efrisForm.autoIssue}
                            onChange={(e) => setEfrisForm(prev => prev ? { ...prev, autoIssue: e.target.checked } : prev)}
                            className="w-4 h-4 accent-gold-brand" />
                          File every sale automatically
                        </label>
                        <button disabled={efrisSaving} onClick={async () => {
                          if (!efrisForm) return;
                          setEfrisSaving(true);
                          try {
                            const res = await efrisApi.save(efrisForm, efrisToken || undefined);
                            setEfrisForm(res.config);
                            setEfrisHasToken(res.hasToken);
                            setEfrisToken('');
                            setSettings(prev => ({ ...prev, efris: res.config }));
                            triggerToast(res.config.enabled ? `EFRIS enabled (${res.config.mode})` : 'EFRIS disabled', 'success');
                          } catch (err) {
                            triggerToast(err instanceof Error ? err.message.slice(0, 100) : 'Failed to save EFRIS settings', 'error');
                          } finally {
                            setEfrisSaving(false);
                          }
                        }}
                          className="w-full h-10 bg-gold-brand/10 border border-gold-brand/40 text-gold-brand rounded-xl text-xs font-black uppercase tracking-wider hover:bg-gold-brand/20 transition-all cursor-pointer disabled:opacity-50">
                          {efrisSaving ? 'Saving…' : 'Save EFRIS settings'}
                        </button>
                      </>
                    )}
                    <p className="text-[10px] text-zinc-600 leading-relaxed">Sandbox rehearses the full flow with simulated URA responses — no credentials needed. Live mode needs URA device approval for this shop's TIN (1–2 days) and goods registered in EFRIS with matching codes. Fiscal filing never blocks a sale: failures queue as failed for retry.</p>
                  </>
                ) : (
                  <p className="text-[10px] text-zinc-600">Loading EFRIS settings…</p>
                )}
              </div>
              )}
              <div className="border-t border-white/5 pt-3 space-y-2">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Send the close to the owner</label>
                <button onClick={() => printDailyClose(new Date().toISOString().slice(0,10), sales, expenses, products)}
                  className="w-full h-10 bg-gold-brand/10 border border-gold-brand/30 text-gold-brand rounded-xl text-xs font-black uppercase tracking-wider hover:bg-gold-brand/20">
                  Print Daily Close (PDF)
                </button>
                <div className="border border-white/5 rounded-xl p-3 space-y-2 bg-[#0A0A0A]">
                  <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Send close to owner</label>
                  <input type="tel" inputMode="tel" value={settings.ownerPhone || ''} placeholder="Owner WhatsApp (e.g. 0772...)"
                    onChange={(e) => setSettings(prev => ({ ...prev, ownerPhone: e.target.value.replace(/\D/g, '').slice(0, 12) || undefined }))}
                    className="w-full h-11 bg-[#141414] border border-white/5 text-sm px-3 rounded-xl text-white font-bold focus:border-gold-brand outline-none" />
                  <button onClick={() => {
                    const url = supplierWhatsAppUrl(settings.ownerPhone, buildCloseSummary(settings.shopName, closeTotals(new Date().toISOString().slice(0, 10), sales, expenses, creditPayments, creditEats), activeStaff?.name || staffName || undefined));
                    if (!url) { triggerToast('Enter a valid owner number first', 'error'); return; }
                    window.open(url, '_blank', 'noopener');
                  }} className="w-full h-10 bg-emerald-950/40 border border-emerald-800/40 text-emerald-300 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-emerald-950/60">
                    WhatsApp today's close
                  </button>
                  <p className="text-[10px] text-zinc-600">Totals, cash vs MoMo, expenses, what is left — one message, no account needed.</p>
                </div>
                <div className="border border-white/5 rounded-xl p-3 space-y-2 bg-[#0A0A0A]">
                  <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Customer community</label>
                  <input type="url" inputMode="url" value={settings.communityGroupUrl || ''} placeholder="Shop WhatsApp group invite link"
                    onChange={(e) => setSettings(prev => ({ ...prev, communityGroupUrl: e.target.value.trim().slice(0, 300) || undefined }))}
                    className="w-full h-11 bg-[#141414] border border-white/5 text-sm px-3 rounded-xl text-white font-bold focus:border-gold-brand outline-none" />
                  <p className="text-[10px] text-zinc-600">Paste the group's invite link once — regulars get a one-tap join message in their own chat.</p>
                </div>
              </div>
              </SettingsSection>
              <SettingsSection id="set-staff-doors" icon={LayoutGrid} title="Cashier doors" hint="What cashiers may open — Sell and Spend always on"
                open={settingsSection === 'staff-doors'} onToggle={() => toggleSettingsSection('staff-doors')}>
              <div className="space-y-1">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1 flex-wrap">Cashier can open <SettingHelp label="Cashier doors" text="Sell and Spend are always on. Tick what else cashiers may open: Close day for the evening close-out (blind mode hides every total), Stock and Sales only if you trust them with it. Cashiers need the Sales door to spot mistakes and ask for fixes." /></label>
                {([['registers', 'Close day'], ['inventory', 'Stock'], ['analytics', 'Sales']] as const).map(([tab, label]) => {
                  const doors = settings.cashierTabs ?? ['registers'];
                  const on = doors.includes(tab);
                  return (
                    <button key={tab} onClick={() => setSettings(prev => {
                      const cur = prev.cashierTabs ?? ['registers'];
                      return { ...prev, cashierTabs: on ? cur.filter(t => t !== tab) : [...cur, tab] };
                    })}
                      className={`w-full h-11 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer border flex items-center justify-between px-4 ${on ? 'bg-gold-brand/15 border-gold-brand/50 text-gold-brand' : 'bg-[#0A0A0A] border-white/5 text-zinc-500 hover:text-zinc-300'}`}>
                      <span>{label}</span>
                      <span>{on ? 'On' : 'Off'}</span>
                    </button>
                  );
                })}
                <p className="text-[10px] text-zinc-600">Blind close (Shop hours section) hides every total on Close day.</p>
              </div>
              </SettingsSection>
              <SettingsSection id="set-security" icon={User} title="PINs & lock" hint="Till PIN, auto-lock, manager PIN, log out all"
                open={settingsSection === 'security'} onToggle={() => toggleSettingsSection('security')}>
              {isManager && (
              <div className="border-t border-white/5 pt-3 space-y-2">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Security</label>
                <div className="flex gap-2">
                  <button onClick={async () => {
                    const newPin = await promptDialog({ title: settings.hasPin ? 'Change till PIN' : 'Set till PIN', message: settings.hasPin ? 'Enter new 4-digit PIN:' : 'Set a 4-digit PIN:', secure: true, inputMode: 'numeric', placeholder: '4-digit PIN', validate: value => /^\d{4}$/.test(value) ? null : 'PIN must be 4 digits.' });
                    if (newPin) { try { await handleSetPin(newPin); } catch { triggerToast('Failed to save PIN', 'error'); } }
                  }}
                    className="flex-1 h-10 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider hover:border-gold-brand/40 transition-all cursor-pointer">
                    {settings.hasPin ? 'Change PIN' : 'Set PIN'}
                  </button>
                  {settings.hasPin && (
                    <button onClick={async () => { if (await confirmDialog({ title: 'Remove PIN', message: 'Remove PIN security?', confirmLabel: 'Remove', danger: true })) { try { await handleSetPin(''); } catch { triggerToast('Failed to remove PIN', 'error'); } } }}
                      className="h-10 px-3 bg-rose-950/20 border border-rose-800/30 text-rose-400 rounded-xl text-[10px] font-bold uppercase tracking-wider hover:bg-rose-950/40 transition-all cursor-pointer">
                      Remove
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-zinc-600">Auto-lock after idle:</p>
                <div className="flex gap-1.5">
                  {LOCK_OPTIONS.map(m => (
                    <button key={m} onClick={() => setSettings(prev => ({ ...prev, lockMinutes: m }))}
                      className={`flex-1 h-10 rounded-xl text-xs font-black uppercase tracking-wider border transition-all cursor-pointer ${lockMinutesOf(settings) === m ? 'bg-gold-brand/15 border-gold-brand text-gold-brand' : 'bg-[#0A0A0A] border-white/5 text-zinc-500 hover:text-zinc-300'}`}>
                      {m} min
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-zinc-600">Solo seller glued to the till? 30–60 min nags less. Shared phone? Keep 10. PIN is still required on load.</p>
                <div className="flex gap-2">
                  <button onClick={async () => {
                    const m = await promptDialog({ title: 'Manager PIN', message: localStorage.getItem('boss_pos_manager_pin') ? 'Enter new MANAGER 4-digit PIN:' : 'Set MANAGER 4-digit PIN (for voids/refunds):', secure: true, inputMode: 'numeric', placeholder: '4-digit PIN', validate: value => /^\d{4}$/.test(value) ? null : 'PIN must be 4 digits.' });
                    if (m) {
                      try { localStorage.setItem('boss_pos_manager_pin', m); } catch {}
                      try { await fetch('/api/settings', { method:'PUT', headers:{'Content-Type':'application/json', Authorization: `Bearer ${getAuthToken()}`}, body: JSON.stringify({ managerPin: m }) }); } catch {}
                      triggerToast('Manager PIN set', 'success');
                    } else if (m) triggerToast('PIN must be 4 digits', 'error');
                  }} className="flex-1 h-10 bg-amber-950/30 border border-amber-800/40 text-amber-400 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-amber-950/50">Set Manager PIN</button>
                  {localStorage.getItem('boss_pos_manager_pin') && <button onClick={()=>{ localStorage.removeItem('boss_pos_manager_pin'); triggerToast('Manager PIN removed — staff PIN now used for voids', 'info'); }} className="h-10 px-3 bg-zinc-800 border border-zinc-700 text-zinc-400 rounded-xl text-[10px] font-bold uppercase">Clear</button>}
                </div>
                <p className="text-[10px] text-zinc-600">Voids/refunds need manager PIN if set, else staff PIN. Set a different 4-digit for managers.</p>
                <button onClick={handleRevokeAll}
                  className="w-full h-10 bg-rose-950/20 border border-rose-800/30 text-rose-400 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-rose-950/40 transition-all cursor-pointer">
                  Log out all devices
                </button>
                <p className="text-[10px] text-zinc-600">Use if a till is lost/stolen or shared. Ends the session everywhere instantly.</p>
                <div className="rounded-xl border border-white/5 bg-[#0A0A0A] p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">Why PIN keeps asking ({lockLog.length})</span>
                    {lockLog.length > 0 && (
                      <button onClick={() => { clearLockLog(); setLockLog([]); }}
                        className="text-[9px] font-black uppercase text-zinc-500 hover:text-white cursor-pointer">Clear</button>
                    )}
                  </div>
                  {isRapidRelock(lockLog) && (
                    <p className="text-[10px] font-bold text-amber-300">Locking repeatedly — {lockLog[0]?.reason} is the likely cause, not a wrong PIN.</p>
                  )}
                  {lockLog.length === 0 ? (
                    <p className="text-[10px] text-zinc-600">No recent locks recorded.</p>
                  ) : (
                    <div className="space-y-1 max-h-28 overflow-y-auto">
                      {lockLog.slice(0, 5).map((e, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 text-[10px] font-bold">
                          <span className="text-zinc-300 truncate">{e.reason}</span>
                          <span className="text-zinc-600 shrink-0">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
</div>
              )}
              </SettingsSection>
              <SettingsSection id="set-look" icon={Palette} title="Look & feel" hint="Colours, text size, sounds, tour"
                open={settingsSection === 'look'} onToggle={() => toggleSettingsSection('look')}>
              <div className="space-y-2">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1 flex-wrap">
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
                <div className="flex gap-2">
                  <button onClick={async () => {
                    const newTheme = theme === 'light' ? 'dark' : 'light';
                    setTheme(newTheme);
                    localStorage.setItem(THEME_KEY, newTheme);
                    if (newTheme === 'dark') {
                      document.documentElement.classList.add('dark');
                    } else {
                      document.documentElement.classList.remove('dark');
                    }
                    document.documentElement.classList.toggle('light-theme', newTheme === 'light');
                  }}
                    className="flex-1 h-10 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-gold-brand/40 transition-all cursor-pointer">
                    {theme === 'light' ? 'Switch to Dark' : 'Switch to Light'}
                  </button>
                  <button onClick={() => setSettings(prev => ({ ...prev, largeText: !prev.largeText }))}
                    title="Bigger text and buttons for sunlight and tired eyes"
                    className={`flex-1 h-10 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer border ${settings.largeText ? 'bg-gold-brand/15 border-gold-brand/50 text-gold-brand' : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-gold-brand/40'}`}>
                    {settings.largeText ? 'Big text: On' : 'Big text: Off'}
                  </button>
                </div>
                <button onClick={toggleChargeSound}
                  title="Beep + vibration: adding to cart, completing sales, errors"
                  className={`w-full h-10 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer border ${chargeSound ? 'bg-gold-brand/15 border-gold-brand/50 text-gold-brand' : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-gold-brand/40'}`}>
                  {chargeSound ? 'Sale feedback: On' : 'Sale feedback: Off'}
                </button>
                <button onClick={() => setNav(isSimpleNav ? 'full' : 'simple')}
                  title="Simple shows Sell, Money and More. Full shows all five tabs."
                  className="w-full h-10 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider hover:border-gold-brand/40 transition-all cursor-pointer">
                  {isSimpleNav ? 'Menu: Simple (Sell · Money · More)' : 'Menu: Full (5 tabs)'}
                </button>
                <button onClick={replayTour}
                  title="Walk through the first sale again"
                  className="w-full h-10 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider hover:border-gold-brand/40 transition-all cursor-pointer">
                  Replay first-sale tour
                </button>
                <button onClick={toggleSimpleTill}
                  title="Attendant mode: hides discounts, quotes and parking on this phone"
                  className={`w-full h-10 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer border ${simpleTill ? 'bg-gold-brand/15 border-gold-brand/50 text-gold-brand' : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-gold-brand/40'}`}>
                  {simpleTill ? 'Simple till: On' : 'Simple till: Off'}
                </button>
              </SettingsSection>
              <SettingsSection id="set-data" icon={Database} title="Data & sync" hint="Backups, sync queue, gaps, exports"
                open={settingsSection === 'data'} onToggle={() => toggleSettingsSection('data')}>
              {isManager && (
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
                    const before = await outboxCountAsync();
                    const n = await flushOutbox();
                    await refreshOutboxState();
                    const after = await outboxCountAsync();
                    if (n > 0) triggerToast(`Force-synced ${n} change(s)`, 'success');
                    else if (after > 0) {
                      const items = await listOutboxItemsAsync();
                      const sample = items.filter(e => e.status === 'queued' || e.status === 'retrying' || e.status === 'blocked_auth').slice(0, 3).map(e => e.path).join(', ');
                      triggerToast(`Still ${after}/${before} queued (${sample || 'retry'}) — re-enter PIN if needed`, 'error');
                    } else triggerToast(before > 0 ? 'Queue now empty' : 'Nothing pending', 'info');
                    if (n > 0) fetchAllData();
                  }}
                    className="flex-1 h-10 bg-emerald-950/30 border border-emerald-800/40 text-emerald-400 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-emerald-950/50 transition-all cursor-pointer">
                    Force sync now
                  </button>
                  <button onClick={async () => {
                    if (!(await confirmDialog({ title: 'Clear queue', message: `Clear ALL ${outboxCountsState.total} saved sync items? This discards offline edits and their review details.`, confirmLabel: 'Clear all', danger: true }))) return;
                    await clearOutboxAsync();
                    await refreshOutboxState();
                    triggerToast('Queue cleared — refresh to pull latest', 'info');
                  }}
                    className="flex-1 h-10 bg-rose-950/30 border border-rose-800/40 text-rose-400 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-rose-950/50 transition-all cursor-pointer">
                    Clear queue
                  </button>
                </div>
                {outboxPreview.length > 0 && (
                  <div className="rounded-xl border border-amber-800/30 bg-amber-950/20 overflow-hidden">
                    <div className="px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-amber-300 border-b border-amber-800/20">Sync items — {outboxCountsState.pending} pending · {outboxCountsState.failed} failed · {outboxCountsState.synced} synced</div>
                    <div className="divide-y divide-white/5 max-h-48 overflow-y-auto">
                      {outboxPreview.map((e) => {
                        const ageMins = Math.max(0, Math.round((Date.now() - (e.statusAt || e.queuedAt)) / 60000));
                        const age = ageMins < 1 ? 'now' : ageMins < 60 ? `${ageMins}m` : `${Math.round(ageMins / 60)}h`;
                        const canRetry = e.status === 'failed' || e.status === 'blocked_auth' || e.status === 'retrying';
                        return (
                          <div key={e.id} className="px-3 py-2 text-[10px] font-bold">
                            <div className="flex items-center gap-2">
                              <span className={`shrink-0 px-1.5 py-0.5 rounded uppercase text-[8px] font-black ${e.status === 'failed' ? 'bg-rose-950 text-rose-300 border border-rose-800' : e.status === 'synced' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-amber-950 text-amber-300 border border-amber-800'}`}>
                                {e.status.replace('_', ' ')}
                              </span>
                              <span className="text-zinc-300 truncate min-w-0">{e.entityLabel || e.entityType || e.method} · {e.method} {e.path}</span>
                              <span className="text-zinc-500 shrink-0 ml-auto">{age}</span>
                            </div>
                            {e.lastError && <p className="text-rose-300/80 mt-1 truncate">{e.lastError}</p>}
                            <div className="flex gap-2 mt-1">
                              {canRetry && <button onClick={async () => { await retryOutboxEntry(e.id); await refreshOutboxState(); }} className="text-[9px] font-black uppercase text-amber-300 hover:text-white cursor-pointer">Retry</button>}
                              <button onClick={async () => { await dismissOutboxEntryAsync(e.id); await refreshOutboxState(); }} className="text-[9px] font-black uppercase text-zinc-600 hover:text-rose-300 cursor-pointer">Dismiss</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <button onClick={async () => {
                      const list = await listOutboxItemsAsync();
                      const oldest = list.find(e => e.status === 'queued' || e.status === 'retrying' || e.status === 'blocked_auth');
                      if (!oldest) return;
                      await dismissOutboxEntryAsync(oldest.id);
                      await refreshOutboxState();
                      triggerToast('Dismissed oldest sync item', 'info');
                    }} className="w-full h-7 text-[9px] font-black uppercase tracking-wider text-amber-400 hover:bg-amber-950/40">Dismiss oldest pending</button>
                  </div>
                )}
                {syncReview.length > 0 && (
                  <div className="rounded-xl border border-rose-800/30 bg-rose-950/20 overflow-hidden">
                    <div className="px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-rose-300 border-b border-rose-800/20 flex items-center justify-between">
                      <span>Needs review — {syncReview.length} refused</span>
                      <button onClick={() => { clearSyncReview(); setSyncReview([]); }}
                        className="text-[9px] font-black uppercase text-zinc-500 hover:text-white cursor-pointer">Clear all</button>
                    </div>
                    <div className="divide-y divide-white/5 max-h-40 overflow-y-auto">
                      {syncReview.slice(0, 10).map((r) => {
                        const m = Math.round((Date.now() - r.at) / 60000);
                        const age = m < 1 ? 'now' : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
                        return (
                          <div key={r.id} className="px-3 py-2 text-[10px] font-bold">
                            <div className="flex items-center gap-2">
                              <span className={`shrink-0 px-1.5 py-0.5 rounded uppercase text-[8px] font-black ${r.kind === 'stock' ? 'bg-amber-950 text-amber-300 border border-amber-800' : 'bg-rose-950 text-rose-300 border border-rose-800'}`}>
                                {r.kind === 'stock' ? 'sold out' : r.kind === 'conflict' ? 'race lost' : 'rejected'}
                              </span>
                              <span className="text-zinc-500 shrink-0 ml-auto">{age}</span>
                            </div>
                            <p className="text-zinc-200 mt-1 leading-snug">{r.summary}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <p className="text-[10px] font-black text-gold-brand uppercase tracking-widest pt-2">This device &amp; data</p>
                <div className="flex gap-2">
                  <button onClick={async () => {
                    try {
                      const r = await reconcileApi.check();
                      setReconcileResult(r);
                      if (r.totalMismatches===0 && r.negativeStock.length===0 && r.dupOrderNumbers.length===0) triggerToast(`Check OK: ${r.salesChecked} sales checked`, 'success');
                      else triggerToast(`Found ${r.totalMismatches} total mismatches, ${r.negativeStock.length} negative stock`, 'error');
                    } catch { triggerToast('Check failed — try again', 'error'); }
                  }} className="flex-1 h-10 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider hover:border-gold-brand/40">Check gaps</button>
                  <button onClick={async () => {
                    if (!(await confirmDialog({ title: 'Fix gaps', message: 'Fix totals & clamp negative stock? This writes to server.', confirmLabel: 'Fix', danger: true }))) return;
                    try {
                      const r = await reconcileApi.fix();
                      setReconcileResult({ salesChecked: r.salesChecked, totalMismatches: r.totalMismatches, negativeStock: r.negativeStock });
                      triggerToast(`Fixed ${r.totalFixes} totals, ${r.negativeFixed} stock`, 'success');
                      fetchAllData();
                    } catch { triggerToast('Fix failed — try again', 'error'); }
                  }} className="flex-1 h-10 bg-emerald-950/30 border border-emerald-800/40 text-emerald-400 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-emerald-950/50">Fix gaps</button>
                </div>
                {reconcileResult && (
                  <div className="rounded-xl border border-white/5 bg-[#0A0A0A] p-3 text-[10px] font-bold">
                    <div className="text-zinc-300">{reconcileResult.salesChecked} sales checked — {reconcileResult.totalMismatches} total mismatches</div>
                    {reconcileResult.negativeStock.length > 0 && <div className="text-rose-300">{reconcileResult.negativeStock.slice(0,3).map(s=>`${s.name} (${s.qty})`).join(', ')}</div>}
                    {reconcileResult.negativeStock.length===0 && reconcileResult.totalMismatches===0 && <div className="text-emerald-300">No gaps</div>}
                  </div>
                )}
                <button onClick={async () => {
                  try {
                    const b = await backupsApi.data();
                    if (!b.data) { triggerToast('No server backup yet — run one first', 'error'); return; }
                    const curProds = products.length;
                    const backupProds = backupTableRows(b.data, 'products');
                    const curSales = sales.length;
                    const backupSales = backupTableRows(b.data, 'sales');
                    const when = b.createdAt ? new Date(b.createdAt).toLocaleString() : 'unknown time';
                    triggerToast(`Backup ${b.id || ''} (${when}) — Products: ${backupProds} vs ${curProds} now, Sales: ${backupSales} vs ${curSales} now`, 'info');
                  } catch (err) { triggerToast((err as { message?: string })?.message || 'Backup diff failed', 'error'); }
                }} className="w-full h-10 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider hover:border-gold-brand/40">Compare with last backup</button>
                <button onClick={handleExportData}
                  className="w-full h-10 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider hover:border-gold-brand/40 transition-all cursor-pointer flex items-center justify-center gap-2">
                  <Download className="w-4 h-4" /> Download Backup
                </button>
                <div>
                  <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Accountant exports (CSV)</label>
                  <div className="grid grid-cols-3 gap-2 mt-1.5">
                    {([
                      ['Sales', () => salesCsv(sales), 'sales'],
                      ['Stock', () => productsCsv(products), 'stock'],
                      ['Credit', () => creditCsv(creditEats), 'credit'],
                    ] as const).map(([label, build, kind]) => (
                      <button key={kind} onClick={() => {
                        try {
                          const slug = (settings.shopName || 'pos').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                          const ok = downloadBlob(new Blob([build()], { type: 'text/csv' }), `${slug}-${kind}-${new Date().toISOString().slice(0, 10)}.csv`);
                          triggerToast(ok ? `${label} CSV downloaded` : 'Download failed on this device', ok ? 'success' : 'error');
                        } catch {
                          triggerToast('Export failed', 'error');
                        }
                      }}
                        className="h-10 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-[10px] font-black uppercase tracking-wider hover:border-gold-brand/40 transition-all cursor-pointer">
                        {label} CSV
                      </button>
                    ))}
                  </div>
                </div>
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
                <p className="text-[10px] text-zinc-600">Restore merges by record ID: rows in the file overwrite the same rows here, nothing is deleted, and PINs, tokens, order numbers and backup flags stay as they are. Download a fresh backup first. Product photos are not inside the file.</p>
              </div>
              )}
              </SettingsSection>
              <SyncProductsButton triggerToast={triggerToast} onSynced={() => {
                clearProductsCache();
                const apiCacheKey = `boss_api_cache_/api/products`;
                try { localStorage.removeItem(apiCacheKey); } catch {}
                try {
                  const keys = JSON.parse(localStorage.getItem('boss_api_cache_keys') || '[]');
                  const filtered = keys.filter((k: string) => k !== apiCacheKey);
                  localStorage.setItem('boss_api_cache_keys', JSON.stringify(filtered));
                } catch {}
                fetch('/api/products').then(r => r.json()).then((p: Product[]) => {
                  const enriched = enrichProductsWithIcons(p);
                  setProducts(enriched);
                  saveProducts(enriched);
                }).catch(()=>{});
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
                            {entry.requestId && <p className="text-[9px] text-zinc-600 font-mono truncate">trace {entry.requestId}</p>}
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
              <div className="border-t border-white/5 pt-3 space-y-2">
                <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Support</label>
                <div className="flex items-center justify-between text-[10px] text-zinc-500 font-bold">
                  <span>Server</span>
                  <span className={supportReport ? (supportReport.status === 'ready' ? 'text-emerald-300' : 'text-amber-300') : 'text-zinc-600'}>
                    {supportReport ? `${supportReport.status} · build ${supportReport.build} · up ${Math.round(supportReport.uptimeSeconds / 60)}m` : 'Checking…'}
                  </span>
                </div>
                {supportReport && !supportReport.database.ok && (
                  <p className="text-[10px] text-amber-300 font-bold">
                    Server database unreachable ({supportReport.database.error || 'error'}) — sales are being queued on this device
                    {supportReport.traceId ? ` · trace ${supportReport.traceId}` : ''}
                  </p>
                )}
                <div className="flex items-center justify-between text-[10px] text-zinc-500 font-bold">
                  <span>Error reports on this device</span>
                  <span>{clientErrors.length} kept</span>
                </div>
                {clientErrors.slice(0, 3).map(row => (
                  <div key={row.id} className="bg-[#0A0A0A] border border-white/5 rounded-xl px-3 py-2 text-[10px] font-bold">
                    <p className="text-zinc-300 truncate">{row.msg}</p>
                    <p className="text-[9px] text-zinc-600 font-bold">
                      {row.kind} · {new Date(row.at).toLocaleString()}
                      {row.sent ? ' · reported' : ' · waiting for signal'}
                      {row.traceId ? ` · trace ${row.traceId}` : ''}
                    </p>
                  </div>
                ))}
                <button onClick={async () => {
                  const summary = supportSummary({
                    serverBuild: supportReport?.build,
                    serverStatus: supportReport?.status,
                    traceId: supportReport?.traceId || clientErrors.find(r => r.traceId)?.traceId,
                  });
                  try {
                    if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
                    await navigator.clipboard.writeText(summary);
                    triggerToast('Support details copied', 'success');
                  } catch {
                    triggerToast('Copy not available on this device', 'error');
                  }
                }} className="w-full h-10 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider hover:border-gold-brand/40 transition-all cursor-pointer">
                  Copy support details
                </button>
              </div>
            </>)}
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
