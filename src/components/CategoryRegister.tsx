import { useEffect, useMemo, useState } from 'react';
import {
  Users, PackageX, Plus, Trash2, X,
  Check, Wallet, AlertTriangle, Coins, LayoutGrid, Smartphone, CalendarDays, ArrowRightLeft, FileText, ChevronDown
} from 'lucide-react';
import StatementModal from './StatementModal';
import BeginnerTip from './BeginnerTip';
import { t } from '../utils/i18n';
import type { CreditEat, ProductionRegister, WastageLog, Product, MomoTransfer, Sale, Expense, StaffMember } from '../types';
import { localDayKey, localMonthKey, todayLocalKey, middayStamp } from '../utils/dates';
import { daysOverdue, ageingBucket } from '../utils/creditAge';
import { isDailyMakeCategory, CATEGORY_WORKFLOW_HINT } from '../utils/dailyMake';
import {
  computeDayCash, getOpeningCapital, getClosingCapital, setClosingCapital,
  moneyOutByCategory, drawerExpensesByCategory, buildTheftFlags, voidsOnDay,
  prevDayKey, openingForDay, tenderByCategory, momoExpensesByCategory, openingPhoneFor,
  type TheftFlag,
} from '../utils/cashflow';
import { pushNotice } from '../utils/notifications';
import { confirmDialog, promptDialog } from './Dialog';

interface CategoryRegisterProps {
  segments: string[];
  products: Product[];
  sales: Sale[];
  expenses?: Expense[];
  creditEats: CreditEat[];
  productionRegisters: ProductionRegister[];
  wastageLogs: WastageLog[];
  momoTransfers: MomoTransfer[];
  onAddCreditEat: (e: CreditEat) => void;
  onPayCreditEat: (id: string, amount: number) => void;
  onAddWastage: (w: WastageLog) => void;
  onDeleteWastage: (id: string) => void;
  onAddMomoTransfer: (t: MomoTransfer) => void;
  onDeleteMomoTransfer: (id: string) => void;
  staffName?: string;
  shopName?: string;
  ownerName?: string;
  staff?: StaffMember[];
  eodCapital?: Record<string, number>;
  onSetEodCapital?: (category: string, value: number) => void;
  formatCurrency: (val: number) => string;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  onBack?: () => void;
  lang?: unknown;
  onPrintClose?: () => void;
  onReopenDay?: () => void | Promise<void>;
  onSendClose?: () => void;
  features?: Record<string, boolean>;
  // Close-time gating: unaccounted/momo flags wait for the shop's close.
  pastClose?: boolean;
  // Blind cashier close: the seller counts, moves and logs but never sees
  // totals (manager gets them on WhatsApp). Masks every money figure.
  blind?: boolean;
  // Prompt a WhatsApp close summary to the owner after finishing (default on).
  notifyOwner?: boolean;
}

type TimeFilter = 'today' | 'week' | 'month' | 'all';

const HIST_FILTERS: { key: TimeFilter; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: '7 Days' },
  { key: 'month', label: 'This Month' },
  { key: 'all', label: 'All' },
];

const todayStr = () => todayLocalKey();

function formatDay(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

// Compact money for chip sublabels: 5000 -> "5k".
function compactUGX(v: number): string {
  const n = Math.round(v || 0);
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

// One accountability flag card. Cash flags render inside Money, production
// flags inside Balance — each where it gets fixed. Shop-level ones stay up top.
function FlagCard({ f }: { f: TheftFlag }) {
  const crit = f.severity === 'critical';
  return (
    <div className={`rounded-2xl border p-4 flex items-start gap-3 ${crit ? 'bg-rose-950/30 border-rose-600/40' : 'bg-amber-950/25 border-amber-600/30'}`}>
      <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${crit ? 'text-rose-400' : 'text-amber-400'}`} />
      <div className="min-w-0">
        <p className={`text-xs font-black uppercase tracking-wider ${crit ? 'text-rose-300' : 'text-amber-300'}`}>
          {crit ? 'Flag — ' : 'Check — '}{f.title}
        </p>
        <p className="text-[11px] text-zinc-300 font-bold mt-1 leading-relaxed">{f.detail}</p>
      </div>
    </div>
  );
}

// Collapsible close-out section: the page used to render everything at once
// (summary, money map, balance, credit book, losses, money-out) as one
// endless scroll. Glance + balance open by default; the rest open themselves
// when the wizard jumps to them. Choice sticks per day + department.
function CloseSection({ id, icon: Icon, title, hint, open, onToggle, action, children }: {
  id?: string;
  icon: (props: { className?: string }) => React.ReactNode;
  title: React.ReactNode;
  hint: string;
  open: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="boss-card rounded-2xl overflow-hidden scroll-mt-20">
      <div className="flex items-center gap-2 px-4 py-3">
        <button onClick={onToggle} aria-expanded={open}
          className="flex-1 min-w-0 flex items-center gap-2.5 text-left cursor-pointer active:opacity-70 transition-opacity">
          <Icon className="w-4 h-4 text-gold-brand shrink-0" />
          <span className="flex-1 min-w-0">
            <span className="block text-xs font-black text-white uppercase tracking-widest truncate">{title}</span>
            <span className="block text-[10px] text-zinc-500 font-bold truncate">{hint}</span>
          </span>
          <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
        </button>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {open && <div className="px-4 pb-4 border-t border-white/5 pt-3">{children}</div>}
    </section>
  );
}

export default function CategoryRegister({
  segments, products, sales, expenses = [], creditEats, productionRegisters, wastageLogs,
  momoTransfers,
  onAddCreditEat, onPayCreditEat,
  onAddWastage, onDeleteWastage, onAddMomoTransfer, onDeleteMomoTransfer,
  staffName, shopName, eodCapital, onSetEodCapital, formatCurrency, triggerToast, onBack, lang,
  onPrintClose, onSendClose, onReopenDay, pastClose = true, blind = false, notifyOwner = true,
  staff = [], ownerName = '',
}: CategoryRegisterProps) {
  // Whoever owns this shop, named by the owner in Settings. Never hardcoded —
  // every other business on this software must see their own name here.
  const ownerLabel = ownerName ? `Given to Owner (${ownerName})` : 'Given to Owner';
  // Managers who can receive a handover and confirm it on their own phone.
  const managerList = staff.filter(m => m.active !== false && m.role === 'manager');
  const [handoffRecipient, setHandoffRecipient] = useState<{ id: string; name: string } | null>(null);
  // Masked money: blind closers see ••• everywhere except the inputs they
  // operate and the credit rows they must collect.
  const fmt = (v: number): string => (blind ? '•••' : formatCurrency(v));
  const [selected, setSelected] = useState<string>(() =>
    segments.includes('Eatery') ? 'Eatery' : (segments[0] || 'Eatery')
  );
  useEffect(() => {
    if (!segments.includes(selected)) setSelected(segments[0] || 'Eatery');
  }, [segments]);

  const catProducts = useMemo(
    () => products.filter(p => p.category === selected),
    [products, selected]
  );
  const catCreditEats = useMemo(() => creditEats.filter(e => e.category === selected), [creditEats, selected]);
  const catProduction = useMemo(() => productionRegisters.filter(p => p.category === selected), [productionRegisters, selected]);
  const catWastage = useMemo(() => wastageLogs.filter(w => w.category === selected), [wastageLogs, selected]);

  // Daily production + the made-sold-lost balance only exist for categories
  // that MAKE goods fresh each morning (Eatery). Other categories sell
  // buy-resell stock or make-to-order jobs — but keep showing legacy rows if
  // any were logged before the gate, so no history silently disappears.
  const isDailyMake = isDailyMakeCategory(selected);
  const showProduction = isDailyMake || catProduction.length > 0;
  const workflowHint = CATEGORY_WORKFLOW_HINT[selected];

  // Close-the-day ritual ticks, kept per day + department so a refresh or a
  // shared till never loses the evening's progress.
  const [, setBump] = useState(0);
  const bump = () => setBump(b => b + 1);
  const scrollToSection = (id: string) => {
    // Checklist jumps also unfold the target — a closed card would look dead.
    const key = id === 'close-balance' ? 'balance' : id === 'close-losses' ? 'losses' : id === 'close-money' ? 'money' : id === 'close-glance' ? 'glance' : null;
    if (key) {
      setSecOpen(prev => {
        if (prev[key]) return prev;
        const next = { ...prev, [key]: true };
        try { localStorage.setItem(`boss_pos_closesec_${todayStr()}::${selected}`, JSON.stringify(next)); } catch {}
        return next;
      });
      // Let the unfold render before scrolling to it.
      setTimeout(() => { try { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {} }, 60);
      return;
    }
    try { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {}
  };

  // Which close-out cards are unfolded. Balance starts open (it is step 1);
  // glance is reference and starts folded. Reloaded per day + department.
  const secStoreKey = `boss_pos_closesec_${todayStr()}::${selected}`;
  // money: true — recording where the money went is the main job of this page,
  // not a footnote hidden behind a collapsed card.
  const [secOpen, setSecOpen] = useState<Record<string, boolean>>({ glance: false, balance: true, credit: false, losses: true, money: true });
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(secStoreKey) || '{}');
      setSecOpen({ glance: false, balance: true, credit: false, losses: true, money: true, ...(saved && typeof saved === 'object' ? saved : {}) });
    } catch {}
  }, [secStoreKey]);
  const toggleSec = (k: string) => setSecOpen(prev => {
    const next = { ...prev, [k]: !prev[k] };
    try { localStorage.setItem(secStoreKey, JSON.stringify(next)); } catch {}
    return next;
  });

  const [showCreditForm, setShowCreditForm] = useState(false);
  const [creditName, setCreditName] = useState('');
  const [creditDate, setCreditDate] = useState(todayStr());
  const [creditItem, setCreditItem] = useState('');
  const [creditCustomItem, setCreditCustomItem] = useState('');
  const [creditQty, setCreditQty] = useState('1');
  const [creditPrice, setCreditPrice] = useState('');
  const [creditCap, setCreditCap] = useState('');

  // Per-customer credit caps (per device): warn/block before the book grows.
  // Stored as {lowercasedName: cap}; empty = unlimited.
  const readCaps = (): Record<string, number> => {
    try {
      const raw = JSON.parse(localStorage.getItem('boss_pos_credit_caps') || '{}');
      return (raw && typeof raw === 'object') ? raw as Record<string, number> : {};
    } catch { return {}; }
  };
  const capFor = (name: string): number => {
    const v = readCaps()[name.trim().toLowerCase()];
    return typeof v === 'number' && v > 0 ? v : 0;
  };
  const owesFor = (name: string): number => {
    const n = name.trim().toLowerCase();
    if (!n) return 0;
    return creditEats.filter(e => !e.paid && (e.customerName || '').trim().toLowerCase() === n)
      .reduce((s, e) => s + Math.max(0, e.total - (e.paidAmount || 0)), 0);
  };

  const [showWasteForm, setShowWasteForm] = useState(false);
  const [wasteDate, setWasteDate] = useState(todayStr());
  const [wasteItem, setWasteItem] = useState('');
  const [wasteCustomItem, setWasteCustomItem] = useState('');
  const [wasteProductId, setWasteProductId] = useState<string | null>(null);
  const [wasteQty, setWasteQty] = useState('');
  const [wasteCost, setWasteCost] = useState('');
  const [wasteReason, setWasteReason] = useState<'remaining' | 'expired'>('remaining');

  const [histFilter, setHistFilter] = useState<TimeFilter>('today');
  const [balanceDate, setBalanceDate] = useState(todayStr());

  const timeRange = useMemo(() => {
    switch (histFilter) {
      case 'today': {
        const today = todayLocalKey();
        return { label: 'Today', filter: (d: string) => localDayKey(d) === today };
      }
      case 'week': {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 7);
        return { label: 'Last 7 days', filter: (d: string) => new Date(d) >= cutoff };
      }
      case 'month': {
        const month = localMonthKey(new Date().toISOString());
        return { label: 'This month', filter: (d: string) => localMonthKey(d) === month };
      }
      default:
        return { label: 'All time', filter: () => true };
    }
  }, [histFilter]);

  const filteredWastage = useMemo(() => catWastage.filter(w => timeRange.filter(w.date)), [catWastage, timeRange]);

  // Today's collected cash per category (excludes credit/book and refunds).
  const todayCollectedByCategory = useMemo(() => {
    const map: { [key: string]: number } = {};
    const today = todayLocalKey();
    sales.forEach(s => {
      if (s.refunded) return;
      if (s.paymentMethod === 'Credit / Book') return;
      if (localDayKey(s.timestamp) !== today) return;
      s.items.forEach(item => {
        const prod = products.find(p => p.id === item.productId);
        const cat = prod?.category || 'Eatery';
        map[cat] = (map[cat] || 0) + (item.lineTotal || 0);
      });
    });
    return map;
  }, [sales, products]);

  // Today's date key shared by the money memos below.
  const todayStrKey = todayLocalKey();

  // Daily close-out: opening (auto-carried) + produced − sold − expired.
  // Eats are NEVER stocked — no on-hand column (live stockQty is polluted by
  // placeholder figures and misleads). A positive remainder auto-carries to
  // tomorrow unless logged expired — no manual carry tap needed. The optional
  // 'remaining' log below is just a tray-count audit (expected vs counted).
  // Negative means sales ate into earlier stock (covered from the tray).
  const balanceRows = useMemo(() => {
    const daySales = sales.filter(s => !s.refunded && localDayKey(s.timestamp) === balanceDate);
    let openingMap: Map<string, number>;
    try {
      openingMap = openingForDay(products, productionRegisters, sales, wastageLogs, balanceDate);
    } catch {
      openingMap = new Map();
    }
    return catProducts.map(p => {
      const opening = openingMap.get(p.id) || 0;
      const made = catProduction.filter(x => x.productId === p.id && x.date === balanceDate)
        .reduce((s, x) => s + (x.qty || 0), 0);
      const lost = catWastage.filter(x => x.productId === p.id && x.date === balanceDate && x.reason !== 'remaining')
        .reduce((s, x) => s + (x.qty || 0), 0);
      const carried = catWastage.filter(x => x.productId === p.id && x.date === balanceDate && x.reason === 'remaining')
        .reduce((s, x) => s + (x.qty || 0), 0);
      const sold = daySales.flatMap(s => s.items)
        .filter(i => i.productId === p.id)
        .reduce((s, i) => s + (i.qty || 0), 0);
      const expected = Math.max(0, opening + made - sold - lost);
      // Authoritative carry: a confirmed tray count wins over the math.
      const recon = carried > 0 ? Math.round(carried * 1000) / 1000 : expected;
      const gap = Math.round((expected - carried) * 1000) / 1000;
      return { product: p, opening, made, sold, lost, carried, recon, expected, gap };
    }).filter(r => r.opening + r.made + r.sold + r.lost + r.carried > 0);
  }, [catProducts, catProduction, catWastage, sales, balanceDate, products, productionRegisters, wastageLogs]);

  const totalAutoCarry = useMemo(() => balanceRows.reduce((s, r) => s + Math.max(0, r.recon), 0), [balanceRows]);

  // Optional tray-count audit: logs a 'remaining' row confirming the counted
  // tray. Not required — leftover auto-carries anyway (see openingForDay).
  const carryRow = (row: { product: Product; recon: number }) => {
    const qty = Math.round(row.recon);
    if (qty <= 0) return;
    // Recount replaces the old tray count — otherwise two "remaining" rows
    // stack and the gap math reads double.
    try {
      catWastage
        .filter(x => x.productId === row.product.id && x.date === balanceDate && x.reason === 'remaining')
        .forEach(x => onDeleteWastage(x.id));
    } catch {}
    onAddWastage({
      id: `wl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date: balanceDate,
      item: row.product.name,
      category: selected,
      productId: row.product.id,
      qty,
      costEach: row.product.cost || 0,
      lossAmount: Math.round(qty * (row.product.cost || 0)),
      reason: 'remaining',
    });
    triggerToast(`${qty} × ${row.product.name} → tomorrow's opening`, 'success');
  };
  const carryAll = async () => {
    const rows = balanceRows.filter(r => r.recon > 0);
    if (rows.length === 0) return;
    if (!(await confirmDialog({ title: 'Carry tray', message: `Confirm tray counts for ${rows.reduce((s, r) => s + Math.round(r.recon), 0)} item(s)? They auto-carry anyway.`, confirmLabel: 'Carry' }))) return;
    rows.forEach(carryRow);
  };

  const [payId, setPayId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [statementFor, setStatementFor] = useState<string | null>(null);

  const [showMomoForm, setShowMomoForm] = useState(false);
  const [momoAmount, setMomoAmount] = useState('');
  const [momoComment, setMomoComment] = useState('');
  const [momoDest, setMomoDest] = useState<'float' | 'cash' | 'owner' | 'manager' | 'bank'>('float');
  const [momoSentBy, setMomoSentBy] = useState(staffName || '');
  // Business date for the move (default today — a 00:10 close-out attributes
  // to the day just ended instead of leaking into the new day).
  const [momoDate, setMomoDate] = useState(todayStr());

  const activeItem = (list: string[], custom: string, picked: string) =>
    picked === '__custom' ? custom.trim() : (list.find(i => i === picked) || '');

  // ---- Credit (Ababanjibwa Sente) ----
  const openCredits = catCreditEats.filter(e => !e.paid);
  const outstanding = openCredits.reduce((s, e) => s + (e.total - e.paidAmount), 0);

  // Close ticks: the genuine closing sequence — business, leftovers, money,
  // cash count. Persisted per day + department. Tapping a row jumps there.
  const [closeTicks, setCloseTicks] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try { setCloseTicks(JSON.parse(localStorage.getItem(`boss_pos_closeticks_${todayStr()}::${selected}`) || '{}')); } catch { setCloseTicks({}); }
  }, [selected]);
  const toggleTick = (k: string) => setCloseTicks(prev => {
    const next = { ...prev, [k]: !prev[k] };
    try { localStorage.setItem(`boss_pos_closeticks_${todayStr()}::${selected}`, JSON.stringify(next)); } catch {}
    return next;
  });

  // Day-closed record: tonight's books snapshotted as the closing record.
  // Re-openable — a mistaken close never strands the shop.
  const closedStoreKey = `boss_pos_dayclosed_${todayStr()}::${selected}`;
  const [dayClosedAt, setDayClosedAt] = useState<string | null>(null);
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(closedStoreKey) || 'null');
      setDayClosedAt(raw?.at || null);
    } catch { setDayClosedAt(null); }
  }, [closedStoreKey]);
  const finishCloseDay = () => {
    const rec = { at: new Date().toISOString(), by: staffName || '', collected: collectedToday, moved: sentToday };
    try { localStorage.setItem(closedStoreKey, JSON.stringify(rec)); } catch {}
    setDayClosedAt(rec.at);
    triggerToast(`Day closed — ${selected} finished`, 'success');
  };
  const reopenDay = async () => {
    try { localStorage.removeItem(closedStoreKey); } catch {}
    setDayClosedAt(null);
    triggerToast('Day reopened — closing record cleared', 'info');
    if (onReopenDay) await onReopenDay();
  };
  const [showCloseHelp, setShowCloseHelp] = useState(false);

  const handleSubmitCredit = async () => {
    const item = activeItem(catProducts.map(p => p.name), creditCustomItem, creditItem);
    const name = creditName.trim();
    if (!name) { triggerToast('Enter customer name', 'error'); return; }
    if (!item) { triggerToast('Select the item taken', 'error'); return; }
    const qty = Math.max(1, parseInt(creditQty, 10) || 1);
    const unitPrice = Math.max(0, parseFloat(creditPrice) || 0);
    if (unitPrice <= 0) { triggerToast('Enter the unit price', 'error'); return; }
    const newTotal = Math.round(qty * unitPrice);
    // CapGate: save/refresh this customer's cap, then block-or-override.
    const capTyped = Math.max(0, Math.round(parseFloat(creditCap) || 0));
    const caps = readCaps();
    if (capTyped > 0) {
      caps[name.toLowerCase()] = capTyped;
      try { localStorage.setItem('boss_pos_credit_caps', JSON.stringify(caps)); } catch {}
    }
    const cap = capTyped > 0 ? capTyped : capFor(name);
    const alreadyOwes = owesFor(name);
    if (cap > 0 && alreadyOwes + newTotal > cap) {
      const ok = await confirmDialog({
        title: 'Over credit cap',
        message: `${name} owes ${fmt(alreadyOwes)} of a ${fmt(cap)} cap. This adds ${fmt(newTotal)} (total ${fmt(alreadyOwes + newTotal)}).\n\nLend anyway = lend • Cancel = stop and collect first.`,
        confirmLabel: 'Lend anyway',
        danger: true,
      });
      if (!ok) { triggerToast('Stopped — collect old debt first', 'info'); return; }
    }
    onAddCreditEat({
      id: `ce-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      customerName: name,
      date: creditDate,
      item,
      category: selected,
      qty,
      unitPrice,
      total: Math.round(qty * unitPrice),
      paidAmount: 0,
      paid: false,
    });
    triggerToast('Added to Ababanjibwa Sente', 'success');
    setCreditName(''); setCreditItem(''); setCreditCustomItem(''); setCreditQty('1'); setCreditPrice(''); setCreditCap('');
    setShowCreditForm(false);
  };

  const handlePay = () => {
    if (!payId) return;
    const rec = openCredits.find(c => c.id === payId);
    const amt = parseFloat(payAmount);
    if (!rec) return;
    if (isNaN(amt) || amt <= 0) { triggerToast('Enter a valid amount', 'error'); return; }
    const remaining = rec.total - rec.paidAmount;
    if (amt > remaining) { triggerToast(`Only ${fmt(remaining)} is outstanding`, 'error'); return; }
    onPayCreditEat(payId, amt);
    triggerToast(`Payment recorded: ${fmt(amt)}`, 'success');
    setPayId(null); setPayAmount('');
  };

  // ---- Wastage: expired is a true loss; remaining carries to tomorrow ----
  const todayWastage = catWastage.filter(w => w.date === todayStr() && w.reason !== 'remaining').reduce((s, w) => s + w.lossAmount, 0);
  const todayLossCount = catWastage.filter(w => w.date === todayStr()).length;

  // ---- Money Out (Mobile Money / Owner / Float for tomorrow) ----
  const collectedToday = todayCollectedByCategory[selected] || 0;
  const todayMoneyOut = momoTransfers
    .filter(t => t.category === selected && localDayKey(t.createdAt) === todayStr());
  const sentToday = todayMoneyOut.reduce((s, t) => s + t.amount, 0);
  const floatOutToday = todayMoneyOut.filter(t => (t.to || 'float') === 'float').reduce((s, t) => s + t.amount, 0);
  const cashOutToday = todayMoneyOut.filter(t => (t.to || 'float') === 'cash').reduce((s, t) => s + t.amount, 0);
  const ownerOutToday = todayMoneyOut.filter(t => (t.to || 'float') === 'owner').reduce((s, t) => s + t.amount, 0);
  const bankOutToday = todayMoneyOut.filter(t => t.to === 'bank').reduce((s, t) => s + t.amount, 0);
  const catMomoTransfers = momoTransfers.filter(t => t.category === selected);
  const pastTransfers = catMomoTransfers
    .filter(t => localDayKey(t.createdAt) !== todayStr())
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 50);

  // Daily capital kept for this department; profit to send = collected − capital.
  const todayKey = todayLocalKey();
  const capForSelected = eodCapital && eodCapital[selected] ? Number(eodCapital[selected]) : getClosingCapital(todayKey, selected, eodCapital);

  // Smart drawer equation: opening (yesterday's capital carried forward) +
  // collected − drawer expenses − moved out − closing = unaccounted (FLAG).
  const drawerExpensesToday = useMemo(() => drawerExpensesByCategory(expenses, todayKey), [expenses, todayKey]);
  // Tender + phone-money buckets, hoisted above every equation that reads
  // them (reading earlier is a TDZ crash — seen live on the Close page).
  const tenderToday = useMemo(() => tenderByCategory(sales, products, todayStrKey), [sales, products, todayStrKey]);
  const momoExpToday = useMemo(() => momoExpensesByCategory(expenses, todayStrKey), [expenses, todayStrKey]);
  const phoneOpening = useMemo(
    () => openingPhoneFor(sales, products, momoTransfers, expenses, todayKey),
    [sales, products, momoTransfers, expenses, todayKey],
  );
  // Physical drawer count per department. Counted cash is the only proof that
  // the money is really there, so it feeds the equation (and the variance) as
  // state instead of being re-read from localStorage during render.
  const [showIdleAreas, setShowIdleAreas] = useState(false);
  const [countedByCat, setCountedByCat] = useState<Record<string, number | null>>(() => {
    const out: Record<string, number | null> = {};
    const day = todayLocalKey();
    for (const cat of segments) {
      let value: number | null = null;
      try {
        const raw = localStorage.getItem(`boss_pos_counted_${day}_${cat}`);
        const parsed = raw == null || raw === '' ? null : parseFloat(raw);
        if (parsed != null && Number.isFinite(parsed) && parsed >= 0) value = Math.round(parsed);
      } catch {}
      out[cat] = value;
    }
    return out;
  });
  const setCounted = (cat: string, value: number | null) => {
    setCountedByCat(prev => ({ ...prev, [cat]: value }));
    try {
      const key = `boss_pos_counted_${todayLocalKey()}_${cat}`;
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    } catch {}
  };
  const countedSelected = countedByCat[selected] ?? null;

  const smartCash = useMemo(() => computeDayCash({
    category: selected,
    dayKey: todayKey,
    openingCapital: getOpeningCapital(todayKey, selected, eodCapital),
    closingCapital: capForSelected,
    collected: collectedToday,
    phoneCollected: (tenderToday[selected] || { cash: 0, momo: 0 }).momo,
    drawerExpenses: drawerExpensesToday[selected] || 0,
    floatOut: floatOutToday,
    cashOut: cashOutToday,
    ownerOut: ownerOutToday,
    bankOut: bankOutToday,
    countedCash: countedSelected,
  }), [selected, todayKey, eodCapital, capForSelected, collectedToday, drawerExpensesToday, floatOutToday, cashOutToday, ownerOutToday, bankOutToday, tenderToday, countedSelected]);

  // Shop-wide reconciliation on ONE basis, so the headline figures add up:
  // expectedInDrawer = assigned + unassigned, always.
  const shopCash = useMemo(() => {
    const moves = moneyOutByCategory(momoTransfers, todayKey);
    let cashSales = 0, phoneSales = 0, opening = 0, expenses = 0;
    let expected = 0, assigned = 0, unassigned = 0, counted = 0, countedCount = 0;
    for (const cat of segments) {
      const m = moves[cat] || { float: 0, cash: 0, owner: 0, bank: 0 };
      const r = computeDayCash({
        category: cat,
        dayKey: todayKey,
        openingCapital: getOpeningCapital(todayKey, cat, eodCapital),
        closingCapital: getClosingCapital(todayKey, cat, eodCapital),
        collected: todayCollectedByCategory[cat] || 0,
        phoneCollected: (tenderToday[cat] || { cash: 0, momo: 0 }).momo,
        drawerExpenses: drawerExpensesToday[cat] || 0,
        floatOut: m.float, cashOut: m.cash, ownerOut: m.owner, bankOut: m.bank || 0,
        countedCash: countedByCat[cat] ?? null,
      });
      cashSales += r.cashSales;
      phoneSales += r.phoneCollected || 0;
      opening += r.openingCapital;
      expenses += r.drawerExpenses;
      expected += r.expectedInDrawer;
      assigned += r.assigned;
      unassigned += r.unassigned;
      const c = countedByCat[cat];
      if (c != null) { counted += c; countedCount += 1; }
    }
    const allCounted = countedCount > 0 && countedCount === segments.length;
    return {
      cashSales, phoneSales, opening, expenses, expected, assigned, unassigned,
      tookToday: cashSales + phoneSales,
      counted: allCounted ? counted : null,
      variance: allCounted ? counted - expected : null,
    };
  }, [segments, momoTransfers, todayKey, eodCapital, todayCollectedByCategory, tenderToday, drawerExpensesToday, countedByCat]);
  // Theft flags for ALL departments (once per day → bell, not spam).
  const theftFlags = useMemo(() => buildTheftFlags({
    dayKey: todayKey,
    categories: segments,
    collected: todayCollectedByCategory,
    drawerExpenses: drawerExpensesToday,
    moneyOut: moneyOutByCategory(momoTransfers, todayKey),
    eodCapital,
    sales,
    products,
    production: productionRegisters,
    wastage: wastageLogs,
    voidCount: (() => { try { return voidsOnDay(todayKey); } catch { return 0; } })(),
    pastClose,
    transfers: momoTransfers,
    momoExpenses: momoExpToday,
  }), [todayKey, segments, todayCollectedByCategory, drawerExpensesToday, momoTransfers, eodCapital, sales, products, productionRegisters, wastageLogs, pastClose, momoExpToday]);

  useEffect(() => {
    // Blind tills never see flags — the manager gets them on WhatsApp.
    if (blind) return;
    for (const f of theftFlags.slice(0, 4)) {
      try {
        pushNotice(
          f.kind === 'unaccounted' ? 'unaccounted' : f.kind === 'no-production' ? 'no-production' : f.kind === 'momo' ? 'momo' : 'shrinkage',
          f.title,
          f.detail,
          `theft:${todayKey}:${f.kind}:${f.title}`.slice(0, 120),
          {
            action:
              f.kind === 'no-production'
                ? { label: 'Log batch', tab: 'sales' }
                : { label: 'Open Close day', tab: 'registers' },
          },
        );
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayKey, theftFlags.length, blind]);

  // Per-department view of today's money, for the reconciliation table.
  const todayMoneyOutByCat = useMemo(() => {
    const map: { [cat: string]: { float: number; cash: number; owner: number; bank: number } } = {};
    momoTransfers.forEach(t => {
      if (localDayKey(t.createdAt) !== todayStr()) return;
      const d = map[t.category] || (map[t.category] = { float: 0, cash: 0, owner: 0, bank: 0 });
      if (t.to === 'cash') d.cash += t.amount;
      else if (t.to === 'owner' || t.to === 'manager') d.owner += t.amount;
      else if (t.to === 'bank') d.bank += t.amount;
      else d.float += t.amount;
    });
    return map;
  }, [momoTransfers]);

  // Tender + phone-money buckets live above (see hoist note); bucket math:
  const bucketFor = (cat: string): { drawer: number; phone: number } => {
    const opening = getOpeningCapital(todayKey, cat, eodCapital);
    const t = tenderToday[cat] || { cash: 0, momo: 0 };
    const drawerExp = drawerExpensesToday[cat] || 0;
    const m = todayMoneyOutByCat[cat] || { float: 0, cash: 0, owner: 0, bank: 0 };
    const moved = m.float + m.cash + m.owner + m.bank;
    return {
      drawer: opening + t.cash - drawerExp - moved,
      phone: (phoneOpening.get(cat) || 0) + t.momo + m.float - (momoExpToday[cat] || 0),
    };
  };
  // Cumulative handoffs across loaded history: what the owner has received
  // in total, and what sits banked. Totals, not today-flows.
  const ownerTotal = useMemo(() => momoTransfers.filter(t => (t.to || 'float') === 'owner').reduce((s, t) => s + (t.amount || 0), 0), [momoTransfers]);
  const bankTotal = useMemo(() => momoTransfers.filter(t => t.to === 'bank').reduce((s, t) => s + (t.amount || 0), 0), [momoTransfers]);
  const MONEY_DEST = [
    { key: 'float' as const, label: 'Float', icon: '📲', hint: 'Money put onto the Mobile Money agent line (MTN/Airtel float)' },
    { key: 'cash' as const, label: 'Cash', icon: '💵', hint: 'Kept as physical cash — e.g. retained capital for tomorrow / handed out' },
    { key: 'owner' as const, label: ownerLabel, icon: '👑', hint: `Handed to the business owner${ownerName ? ` (${ownerName})` : ''} — they confirm receipt on their phone` },
    { key: 'manager' as const, label: 'Given to Manager', icon: '🧑‍💼', hint: 'Handed to a named manager — they confirm receipt on their phone' },
    { key: 'bank' as const, label: 'Bank', icon: '🏦', hint: 'Deposited to the bank account — out of drawer and phone' },
  ];

  const handleSubmitMomo = () => {
    const amt = Math.round(parseFloat(momoAmount) || 0);
    if (amt <= 0) { triggerToast('Enter the amount you moved', 'error'); return; }
    // Handing money to a person (not to float/cash/bank) needs a named human,
    // otherwise there is nobody to send the receipt request to.
    const handsToPerson = momoDest === 'owner' || momoDest === 'manager';
    if (momoDest === 'manager' && !handoffRecipient) {
      triggerToast('Choose which manager received the money', 'error');
      return;
    }
    const dest = MONEY_DEST.find(d => d.key === momoDest)?.label || 'recorded';
    const recipientName = momoDest === 'manager'
      ? handoffRecipient?.name || ''
      : ownerName || 'the owner';
    onAddMomoTransfer({
      id: `mt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      category: selected,
      amount: amt,
      comment: momoComment.trim(),
      createdAt: middayStamp(momoDate),
      to: momoDest,
      sentBy: momoSentBy.trim() || staffName || '',
      ...(momoDest === 'manager' && handoffRecipient
        ? { recipientId: handoffRecipient.id, recipientName: handoffRecipient.name, recipientRole: 'manager' as const }
        : {}),
      ...(momoDest === 'owner'
        ? { recipientName: ownerName || 'Owner', recipientRole: 'owner' as const }
        : {}),
    });
    const backdated = momoDate !== todayStr();
    triggerToast(
      handsToPerson
        ? `${formatCurrency(amt)} → ${recipientName}. Waiting for them to confirm receipt.`
        : `Confirmed: ${formatCurrency(amt)} ${dest}${backdated ? ` (for ${momoDate})` : ''}`,
      'success',
    );
    setMomoAmount('');
    setMomoComment('');
    setMomoDate(todayStr());
    setHandoffRecipient(null);
    setShowMomoForm(false);
  };

  const handleSubmitWastage = () => {
    const item = activeItem(catProducts.map(p => p.name), wasteCustomItem, wasteItem);
    if (!item) { triggerToast('Select the item', 'error'); return; }
    const qty = parseInt(wasteQty, 10) || 0;
    if (qty <= 0) { triggerToast('Enter how many', 'error'); return; }
    const cost = parseFloat(wasteCost) || 0;
    if (cost <= 0) { triggerToast('Enter the cost price each', 'error'); return; }
    onAddWastage({
      id: `wl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date: wasteDate,
      item,
      category: selected,
      productId: wasteProductId || undefined,
      qty,
      costEach: cost,
      lossAmount: Math.round(qty * cost),
      reason: wasteReason,
    });
    triggerToast(wasteReason === 'remaining' ? `Carried to tomorrow — not a loss` : 'Loss logged', 'success');
    setWasteItem(''); setWasteCustomItem(''); setWasteProductId(null); setWasteQty(''); setWasteCost('');
    setShowWasteForm(false);
  };

  const selectOnChange = (value: string, custom: (v: string) => void, picked: (v: string) => void, price: (v: string) => void, setProductId: (v: string | null) => void) => {
    picked(value);
    if (value === '__custom') {
      custom('');
      price('');
      setProductId(null);
    } else {
      const prod = catProducts.find(p => p.name === value);
      setProductId(prod ? prod.id : null);
      if (prod) price(String(prod.price || prod.cost || ''));
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-amber-950/40 border border-amber-800/40 flex items-center justify-center">
          <LayoutGrid className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h2 className="text-lg font-black text-white uppercase tracking-tight font-display">{t(lang, 'closeDayCta')}</h2>
          <p className="text-xs text-zinc-500 font-bold">Count the drawer. Decide the money. Finish today.</p>
        </div>
      </div>
      <BeginnerTip tipKey="close-day" text="Close day = count the drawer, decide where tonight's money goes, then finish. Do it every evening." />
      <div className="flex items-center gap-2">
        {onBack && (
          <button onClick={onBack} aria-label="Back to reports"
            className="h-10 px-4 bg-[#141414] border border-white/10 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer touch-target">
            <ArrowRightLeft className="w-4 h-4" /> {t(lang, 'back')}
          </button>
        )}
        <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Business areas</p>
      </div>

      {/* Category chips: departments with takings first. Quiet departments are
          hidden behind a count so the row stays scannable. */}
      {(() => {
        const ordered = [...segments].sort((a, b) => (todayCollectedByCategory[b] || 0) - (todayCollectedByCategory[a] || 0));
        const active = ordered.filter(cat => (todayCollectedByCategory[cat] || 0) > 0);
        const idle = ordered.filter(cat => (todayCollectedByCategory[cat] || 0) <= 0);
        const chip = (cat: string) => {
          const sold = todayCollectedByCategory[cat] || 0;
          return (
            <button key={cat} onClick={() => setSelected(cat)}
              className={`py-2 px-4 rounded-xl text-xs font-black uppercase tracking-wider border transition-all cursor-pointer active:scale-95 whitespace-nowrap min-h-[44px] ${
                selected === cat
                  ? 'bg-gold-brand border-gold-brand text-black'
                  : 'bg-[#141414]/60 border-white/5 text-zinc-400 hover:text-zinc-200'
              }`}>
              {cat}{sold > 0 && <span className="opacity-60"> • {compactUGX(sold)}</span>}
            </button>
          );
        };
        return (
          <>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {(active.length > 0 ? active : ordered).map(chip)}
            </div>
            {idle.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                {showIdleAreas
                  ? idle.map(chip)
                  : [(
                    <button key="show-idle" onClick={() => setShowIdleAreas(true)}
                      className="py-2 px-4 rounded-xl text-xs font-black uppercase tracking-wider border border-dashed border-white/10 text-zinc-500 hover:text-zinc-300 transition-all cursor-pointer whitespace-nowrap min-h-[44px]">
                      + {idle.length} quiet today
                    </button>
                  )]}
              </div>
            )}
          </>
        );
      })()}
      {!isDailyMake && workflowHint && (
        <p className="text-[11px] text-zinc-500 font-bold -mt-3">{workflowHint}</p>
      )}

      {/* One reconciliation, one basis. Every figure below adds up:
          expected in drawer = assigned + not yet assigned. Nothing here is
          called "unaccounted" — money in the drawer is where it belongs. */}
      {(() => {
        const { tookToday, cashSales, phoneSales, opening, expenses, expected, assigned, unassigned, counted, variance } = shopCash;
        const hasVariance = variance != null && Math.abs(variance) > 0.5;
        const tone = hasVariance ? 'rose' : unassigned > 0.5 ? 'amber' : 'emerald';
        const shell = tone === 'rose'
          ? 'bg-rose-950/30 border-rose-600/40'
          : tone === 'amber'
            ? 'bg-amber-950/25 border-amber-600/30'
            : 'bg-emerald-950/25 border-emerald-600/30';
        // Money type scale: the figure you act on is 20px+, supporting rows
        // 16px, labels 11px. Never all-equal — all-equal reads as noise.
        const Row = ({ label, sub, value, hero, strong, tone: rowTone }: { label: string; sub?: string; value: string; hero?: boolean; strong?: boolean; tone?: 'amber' | 'emerald' | 'rose' }) => (
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <p className={`font-black uppercase tracking-wider ${hero ? 'text-[13px] text-white' : strong ? 'text-xs text-zinc-200' : 'text-[11px] text-zinc-400'}`}>{label}</p>
              {sub && <p className="text-[10px] font-bold text-zinc-500 mt-0.5">{sub}</p>}
            </div>
            <p className={`font-black tabular-nums shrink-0 ${hero ? 'text-xl sm:text-2xl' : strong ? 'text-lg' : 'text-base'} ${rowTone === 'amber' ? 'text-amber-300' : rowTone === 'rose' ? 'text-rose-300' : rowTone === 'emerald' ? 'text-emerald-300' : strong ? 'text-white' : 'text-zinc-200'}`}>
              {value}
            </p>
          </div>
        );
        return (
          <section className={`rounded-2xl border p-4 space-y-3 ${shell}`} aria-label="Today's money, reconciled">
            <Row label="Took today" sub={`cash ${fmt(cashSales)} · phone ${fmt(phoneSales)}`} value={fmt(tookToday)} />
            <div className="border-t border-white/5 pt-2.5 space-y-1.5">
              <Row label="Opening float" value={fmt(opening)} />
              {expenses > 0 && <Row label="− Drawer expenses" value={`−${fmt(expenses)}`} />}
              <Row label="Expected in drawer" value={fmt(expected)} hero />
            </div>
            <div className="border-t border-white/5 pt-2.5 space-y-1.5">
              <Row label="Assigned" sub="moved out + kept for tomorrow" value={fmt(assigned)} />
              <Row
                label="Not yet assigned"
                sub={unassigned > 0.5 ? 'decide: keep, send, or bank' : undefined}
                value={unassigned > 0.5 ? fmt(unassigned) : '✓'}
                hero
                tone={unassigned > 0.5 ? 'amber' : 'emerald'}
              />
            </div>
            <div className="border-t border-white/5 pt-2.5 space-y-1.5">
              <Row label="Counted" value={counted == null ? '—' : fmt(counted)} />
              <Row
                label="Difference"
                value={variance == null ? '—' : variance === 0 ? '✓ 0' : `${variance > 0 ? '+' : '−'}${fmt(Math.abs(variance))}`}
                tone={hasVariance ? 'rose' : variance === 0 ? 'emerald' : undefined}
              />
            </div>
            {(unassigned > 0.5 || variance == null) && (
              <button onClick={() => scrollToSection(variance == null ? 'close-count' : 'close-money')}
                className="w-full h-11 rounded-xl bg-gold-brand text-black text-xs font-black uppercase tracking-wider hover:opacity-90 active:scale-[0.99] transition-all cursor-pointer">
                {variance == null ? 'Count the drawer' : 'Decide tonight’s money'}
              </button>
            )}
          </section>
        );
      })()}

      {/* Flags live beneath their sections now (cash → Money, production →
          Balance); shop-level ones stay here. Managers only. */}
      {(() => {
        const top = theftFlags.filter(f => f.kind !== 'unaccounted' && f.kind !== 'no-production' && f.kind !== 'momo').slice(0, 4);
        if (top.length === 0 || blind) return null;
        return (
          <section className="space-y-2">
            {top.map((f, i) => <FlagCard key={`${f.kind}-${i}`} f={f} />)}
          </section>
        );
      })()}

      {/* Step 1: count the drawer. The equation is shown, not hidden — the
          arithmetic is the whole point of the page. */}
      <section id="close-count" className={`boss-card p-4 rounded-2xl border ${
        smartCash.status === 'variance' ? 'border-rose-600/50'
        : smartCash.status === 'balanced' ? 'border-emerald-800/40'
        : 'border-gold-brand/30'}`}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-xs font-black text-white uppercase tracking-widest">
            Count the drawer — {selected}
          </h3>
          <span className="text-[9px] font-black uppercase text-zinc-500">Step 1</span>
        </div>
        {(() => {
          const expected = smartCash.expectedInDrawer;
          const variance = smartCash.variance;
          const tender = tenderToday[selected] || { cash: 0, momo: 0 };
          return (
            <>
              <div className="bg-black/30 rounded-xl p-3 space-y-1.5 text-[11px] font-bold tabular-nums">
                <div className="flex justify-between gap-2">
                  <span className="text-zinc-500 uppercase">Opening float (yesterday kept)</span>
                  <span className="text-zinc-200">{fmt(smartCash.openingCapital)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-zinc-500 uppercase">Cash sales today</span>
                  <span className="text-zinc-200">{fmt(smartCash.cashSales)}</span>
                </div>
                {smartCash.drawerExpenses > 0 && (
                  <div className="flex justify-between gap-2">
                    <span className="text-zinc-500 uppercase">Drawer expenses</span>
                    <span className="text-zinc-200">−{fmt(smartCash.drawerExpenses)}</span>
                  </div>
                )}
                <div className="flex justify-between gap-2 pt-1.5 border-t border-white/5">
                  <span className="text-zinc-300 uppercase font-black">Expected in drawer</span>
                  <span className="text-white font-black text-sm">{fmt(expected)}</span>
                </div>
              </div>
              {tender.momo > 0 && (
                <p className="text-[10px] font-bold text-zinc-500 uppercase mt-1.5">
                  Phone sales {fmt(tender.momo)} are not in the drawer — never count them here.
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 text-center mt-3">
                <div className="bg-black/30 rounded-xl p-2.5">
                  <label htmlFor="tour-counted-drawer" className="text-[9px] font-bold text-zinc-500 uppercase block">
                    {t(lang, 'countedDrawer')}
                  </label>
                  <input type="number" min="0" inputMode="numeric"
                    id="tour-counted-drawer"
                    value={countedSelected == null ? '' : String(countedSelected)}
                    placeholder="—"
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') { setCounted(selected, null); return; }
                      const n = parseFloat(raw);
                      if (Number.isFinite(n) && n >= 0) setCounted(selected, Math.round(n));
                    }}
                    className="mt-1 w-full bg-zinc-900 border border-zinc-800 text-gold-brand rounded-lg h-11 px-2 text-base font-black tabular-nums focus:border-gold-brand outline-none text-center" />
                </div>
                <div className="bg-black/30 rounded-xl p-2.5">
                  <p className="text-[9px] font-bold text-zinc-500 uppercase">Difference</p>
                  <p className={`text-base font-black tabular-nums mt-1 ${
                    variance == null ? 'text-zinc-600' : variance === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {variance == null ? '—' : variance === 0 ? '✓ 0' : `${variance > 0 ? '+' : '−'}${fmt(Math.abs(variance))}`}
                  </p>
                </div>
              </div>
              <p className={`text-[11px] font-bold uppercase mt-2 ${
                blind ? 'text-zinc-500'
                : smartCash.status === 'variance' ? 'text-rose-300'
                : smartCash.status === 'balanced' ? 'text-emerald-300'
                : 'text-amber-300'}`}>
                {blind ? 'Noted — the manager sees the rest.' : smartCash.message}
              </p>
              <button onClick={async () => {
                  const raw = await promptDialog({ title: 'Recount opening', message: `Recount opening cash for ${selected} (yesterday's capital)?`, defaultValue: String(blind ? '' : smartCash.openingCapital), inputMode: 'numeric', placeholder: '0', confirmLabel: 'Recount' });
                  if (raw === null) return;
                  const v = Math.max(0, Math.round(parseFloat(raw) || 0));
                  try { setClosingCapital(prevDayKey(todayKey), selected, v); } catch {}
                  setCounted(selected, null);
                  bump();
                  triggerToast(`Opening recounted: ${formatCurrency(v)}`, 'success');
                }}
                title="Tap to recount yesterday's closing (today's opening)"
                className="mt-2 text-[10px] font-black text-zinc-500 uppercase tracking-wider hover:text-gold-brand cursor-pointer">
                {t(lang, 'opening')} ✎ recount
              </button>
            </>
          );
        })()}
      </section>

      {/* The closing sequence, in the order the work actually happens:
          count → decide the money → check stock → review the day.
          Count and money tick themselves from real state, so the counter
          rewards progress instead of nagging. */}
      {(() => {
        const cashDone = countedSelected != null;
        const moneyDone = shopCash.unassigned <= 0.5;
        const steps = [
          { key: 'cash', label: 'Count the drawer', hint: cashDone
            ? `Counted ${fmt(countedSelected as number)}${smartCash.variance ? ` · ${smartCash.variance > 0 ? '+' : '−'}${fmt(Math.abs(smartCash.variance))}` : ' · matches'}`
            : `Expected ${fmt(smartCash.expectedInDrawer)}`, target: 'close-count', auto: cashDone },
          { key: 'money', label: 'Decide tonight’s money', hint: moneyDone
            ? 'All assigned'
            : `${fmt(shopCash.unassigned)} not yet assigned`, target: 'close-money', auto: moneyDone },
          ...(showProduction ? [{ key: 'leftovers', label: 'Check leftovers & losses', hint: `${balanceRows.length} lines • ${totalAutoCarry} auto-carry`, target: 'close-balance', auto: false }] : []),
          { key: 'business', label: 'Check today’s business', hint: `${fmt(collectedToday)} sold • ${openCredits.length} debt${openCredits.length !== 1 ? 's' : ''} open`, target: 'close-glance', auto: false },
        ];
        const isDone = (s: { key: string; auto?: boolean }) => (s.auto ? true : !!closeTicks[s.key]);
        const done = steps.filter(isDone).length;
        return (
          <section id="close-steps" className="boss-card p-4 rounded-2xl border border-gold-brand/20 scroll-mt-20">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-xs font-black text-white uppercase tracking-widest font-display">Close the day — {selected}</h3>
              <span className="text-[11px] font-black text-gold-brand tabular-nums">{done}/{steps.length}</span>
            </div>
            <div className="h-1.5 bg-zinc-900 rounded-full overflow-hidden mb-3">
              <div className="h-full bg-gold-brand transition-all" style={{ width: `${Math.round((done / steps.length) * 100)}%` }} />
            </div>
            <div className="space-y-1.5">
              {steps.map((s, i) => (
                <div key={s.key} className="flex items-center gap-2">
                  {s.auto ? (
                    <span aria-hidden="true"
                      className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${isDone(s) ? 'bg-gold-brand border-gold-brand text-black' : 'bg-[#0A0A0A] border-white/10 text-transparent'}`}>
                      <Check className="w-4 h-4" />
                    </span>
                  ) : (
                    <button onClick={() => toggleTick(s.key)} aria-label={`Mark ${s.label} done`}
                      className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 transition-all active:scale-90 cursor-pointer ${
                        closeTicks[s.key] ? 'bg-gold-brand border-gold-brand text-black' : 'bg-[#0A0A0A] border-white/10 text-transparent'
                      }`}>
                      <Check className="w-4 h-4" />
                    </button>
                  )}
                  <button onClick={() => scrollToSection(s.target)}
                    className="flex-1 min-w-0 text-left bg-[#0A0A0A] border border-white/5 hover:border-gold-brand/40 rounded-xl px-3 py-2 transition-all cursor-pointer">
                    <span className="text-xs font-black text-zinc-100 uppercase tracking-wider">{i + 1}. {s.label}</span>
                    <span className="block text-[10px] text-zinc-500 font-bold mt-0.5">{s.hint} — tap to jump</span>
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-3">
              {dayClosedAt ? (
                <div className="rounded-xl border border-emerald-600/40 bg-emerald-950/25 px-3 py-2.5">
                  <p className="text-xs font-black text-emerald-300 uppercase tracking-wider">
                    Day closed ✓ {new Date(dayClosedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — tonight's records are locked as the closing record.
                  </p>
                  <button onClick={reopenDay}
                    className="mt-1.5 text-[10px] font-black text-zinc-500 uppercase tracking-wider hover:text-zinc-300 cursor-pointer">
                    Reopen day
                  </button>
                </div>
              ) : (
                <>
                  <button onClick={finishCloseDay}
                    className="w-full h-12 bg-gold-brand text-black rounded-xl text-sm font-black uppercase tracking-widest hover:opacity-90 active:scale-[0.99] transition-all cursor-pointer font-display">
                    Close day
                  </button>
                  <div className="flex gap-2 mt-2">
                    {onPrintClose && (
                      <button onClick={onPrintClose}
                        className="flex-1 h-11 bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-xl text-xs font-black uppercase tracking-wider hover:border-gold-brand/40 transition-all cursor-pointer">
                        Print close (PDF)
                      </button>
                    )}
                    {notifyOwner && onSendClose && (
                      <button onClick={onSendClose}
                        className={`flex-1 h-11 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer bg-emerald-950/40 border border-emerald-800/40 text-emerald-300 hover:bg-emerald-950/60 ${collectedToday > sentToday ? 'animate-pulse' : ''}`}>
                        WhatsApp owner
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </section>
        );
      })()}


      {/* ============ DAILY BALANCE / CLOSE-OUT (daily-make only: made-sold-lost means nothing without production) ============ */}
      {showProduction && (
      <CloseSection id="close-balance" icon={CalendarDays} title={t(lang, 'closeBalance')}
        hint={`${balanceRows.length} lines • ${totalAutoCarry} auto-carry`}
        open={secOpen.balance} onToggle={() => toggleSec('balance')}
        action={
          <input type="date" value={balanceDate} max={todayStr()} onChange={e => setBalanceDate(e.target.value || todayStr())}
            className="bg-zinc-900 border border-zinc-800 text-white rounded-lg h-9 px-2 text-xs outline-none focus:border-gold-brand" />
        }>
        {!blind && theftFlags.filter(f => f.kind === 'no-production').slice(0, 3).map((f, i) => (
          <div key={`b-${i}`} className="mb-2"><FlagCard f={f} /></div>
        ))}
        {balanceRows.length === 0 ? (
          <div className="text-center py-6">
            <CalendarDays className="w-9 h-9 text-gold-brand/40 mx-auto mb-2" />
            <p className="text-xs text-zinc-500 font-bold uppercase">No {selected} items made, sold, lost or carried on this day</p>
          </div>
        ) : (
          <>
            {totalAutoCarry > 0 && (
              <div className="mb-3 bg-emerald-950/25 border border-emerald-600/30 rounded-xl px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-emerald-400 shrink-0" />
                  <p className="text-[11px] font-bold text-emerald-300 uppercase flex-1">
                    {totalAutoCarry} item{totalAutoCarry !== 1 ? 's' : ''} auto-carry → tomorrow (unless logged expired)
                  </p>
                </div>
                {balanceRows.some(r => r.recon > 0 && (r.carried <= 0 || r.gap !== 0)) && (
                  <>
                    <button onClick={carryAll}
                      className="mt-2 w-full h-10 bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-emerald-500/20 active:scale-[0.99] transition-all cursor-pointer">
                      Confirm tray count (optional)
                    </button>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase mt-1.5">…or log spoiled food as expired below — only expired is a loss</p>
                  </>
                )}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[9px] uppercase tracking-widest text-zinc-500">
                    <th className="text-left py-1.5 pr-2 font-bold">{t(lang, 'itemK')}</th>
                    <th className="text-right py-1.5 px-2 font-bold text-amber-400">{t(lang, 'madeK')}</th>
                    <th className="text-right py-1.5 px-2 font-bold text-emerald-400">{t(lang, 'soldK')}</th>
                    <th className="text-right py-1.5 px-2 font-bold text-rose-400">{t(lang, 'lostK')}</th>
                    <th className="text-right py-1.5 px-2 font-bold text-zinc-400" title="Opening + made − sold − lost">Exp</th>
                    <th className="text-right py-1.5 px-2 font-bold text-emerald-300">Left</th>
                    <th className="text-right py-1.5 pl-2 font-bold">{t(lang, 'checkK')}</th>
                  </tr>
                </thead>
                <tbody>
                  {balanceRows.map(({ product, opening, made, sold, lost, carried, recon, expected, gap }) => {
                    const status = recon > 0 ? 'tray' : recon < 0 ? 'fromStock' : 'ok';
                    return (
                    <tr key={product.id} className="border-t border-white/5">
                      <td className="py-2 pr-2 font-bold text-white truncate max-w-[120px]">
                        {product.name}
                        {opening > 0 && <span className="block text-[9px] text-zinc-500 font-bold uppercase">open {opening}</span>}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-amber-400">{made || '—'}</td>
                      <td className="py-2 px-2 text-right font-mono text-emerald-400">{sold || '—'}</td>
                      <td className="py-2 px-2 text-right font-mono text-rose-400">{lost || '—'}</td>
                      <td className="py-2 px-2 text-right font-mono text-zinc-400" title="Opening + made − sold − lost">
                        {expected || '—'}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-emerald-300"
                        title={recon > 0 ? `${recon} left — carries to tomorrow unless logged expired` : undefined}>
                        {recon > 0 ? `→${recon}` : recon < 0 ? `−${Math.abs(recon)}` : '—'}
                      </td>
                      <td className="py-2 pl-2 text-right">
                        {status === 'ok' || (status === 'tray' && carried > 0 && gap === 0) ? (
                          <span className="text-emerald-400 font-black" title={status === 'tray' ? 'Tray count confirmed' : undefined}>✓</span>
                        ) : status === 'tray' ? (
                          <button onClick={() => carryRow({ product, recon })}
                            title={`${recon} left according to BOSS — tap to confirm the actual count`}
                            className="text-[10px] font-black uppercase tracking-wider text-zinc-300 border border-white/10 rounded-lg px-1.5 py-0.5 hover:border-emerald-500/40 hover:text-emerald-300 active:scale-95 transition-all cursor-pointer tabular-nums">
                            {carried > 0 ? 'Recount' : 'Confirm'}
                          </button>
                        ) : (
                          <span className="text-zinc-500 font-bold" title="Sold more than opening + made — covered from earlier stock">−{Math.abs(recon)}</span>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CloseSection>
      )}


      {/* ============ 2. REMAINING / EXPIRED (LOSES) ============ */}
      <CloseSection id="close-losses" icon={PackageX} title="Leftovers & losses"
        hint={`${todayLossCount} logged • lost ${fmt(todayWastage)}`}
        open={secOpen.losses} onToggle={() => toggleSec('losses')}
        action={
          <button onClick={() => setShowWasteForm(v => !v)}
            className="flex items-center gap-1 text-[10px] bg-rose-600/20 text-rose-400 border border-rose-600/40 rounded-lg px-2.5 py-1.5 font-black uppercase tracking-wider cursor-pointer touch-target">
            <Plus className="w-3.5 h-3.5" /> {showWasteForm ? t(lang, 'closeBtn') : '+ Add entry'}
          </button>
        }>
        {/* History range lives here now — it filters the loss list below. */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest shrink-0">History</p>
          <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
            {HIST_FILTERS.map(f => (
              <button key={f.key} onClick={() => setHistFilter(f.key)}
                className={`py-1.5 px-3 rounded-lg text-[10px] font-black uppercase tracking-wider border whitespace-nowrap transition-all cursor-pointer active:scale-95 min-h-[36px] ${
                  histFilter === f.key
                    ? 'bg-gold-brand border-gold-brand text-black'
                    : 'bg-[#141414]/60 border-white/5 text-zinc-500 hover:text-zinc-300'
                }`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {showWasteForm && (
          <div className="bg-zinc-950/60 border border-rose-600/20 rounded-xl p-4 space-y-3 mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Item</label>
                <select value={wasteItem} onChange={e => selectOnChange(e.target.value, setWasteCustomItem, setWasteItem, setWasteCost, setWasteProductId)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none font-bold" autoFocus>
                  <option value="">Select item...</option>
                  {catProducts.map(p => <option key={p.id} value={p.name}>{blind ? p.name : `${p.name} — cost ${fmt(p.cost)}`}</option>)}
                  <option value="__custom">Other / custom item...</option>
                </select>
                {wasteItem === '__custom' && (
                  <input type="text" value={wasteCustomItem} onChange={e => setWasteCustomItem(e.target.value)}
                    placeholder="Type the item name..." autoFocus
                    className="mt-2 w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-rose-500" />
                )}
              </div>
              <div>
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">{t(lang, 'dateK')}</label>
                <input type="date" value={wasteDate} onChange={e => setWasteDate(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-rose-500" />
              </div>
              <div>
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">How Many</label>
                <input type="number" min="1" value={wasteQty} onChange={(e) => setWasteQty(e.target.value)}
                  placeholder="e.g. 12" className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-rose-500" />
              </div>
              <div>
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Cost Price Each</label>
                <input type="number" min="0" value={wasteCost} onChange={e => setWasteCost(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-rose-500" />
              </div>
              <div>
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">What happened?</label>
                <div className="flex gap-2">
                  <button onClick={() => setWasteReason('remaining')}
                    className={`flex-1 h-11 rounded-xl text-xs font-black uppercase tracking-wider border cursor-pointer transition-all ${wasteReason === 'remaining' ? 'bg-amber-600/20 border-amber-500/50 text-amber-400' : 'bg-zinc-900 border-zinc-800 text-zinc-500'}`}>
                    Left over
                  </button>
                  <button onClick={() => setWasteReason('expired')}
                    className={`flex-1 h-11 rounded-xl text-xs font-black uppercase tracking-wider border cursor-pointer transition-all ${wasteReason === 'expired' ? 'bg-rose-600/20 border-rose-500/50 text-rose-400' : 'bg-zinc-900 border-zinc-800 text-zinc-500'}`}>
                    Expired
                  </button>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-zinc-400 uppercase">
                {wasteReason === 'remaining' ? 'Left-over value: ' : 'Loss value: '}
                <span className={`${wasteReason === 'remaining' ? 'text-amber-300' : 'text-rose-400'} font-black text-base`}>{fmt((parseInt(wasteQty, 10) || 0) * (parseFloat(wasteCost) || 0))}</span>
              </p>
              <button onClick={handleSubmitWastage}
                className="h-11 px-5 bg-rose-600 hover:bg-rose-500 text-white font-black uppercase tracking-widest text-xs rounded-xl cursor-pointer active:scale-95 transition-all flex items-center gap-1.5">
                <Check className="w-4 h-4" /> {wasteReason === 'remaining' ? 'Carry over' : 'Log Loss'}
              </button>
            </div>
          </div>
        )}

        {catWastage.length === 0 ? (
          <div className="text-center py-8">
            <Coins className="w-10 h-10 text-rose-500 mx-auto mb-2 opacity-40" />
            <p className="text-xs text-zinc-500 font-bold uppercase">No losses recorded in {selected}</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {filteredWastage.map(w => (
              <div key={w.id} className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${w.reason === 'expired' ? 'bg-rose-950/40 text-rose-400' : 'bg-amber-950/40 text-amber-400'}`}>
                    {w.reason === 'expired' ? <AlertTriangle className="w-4 h-4" /> : <PackageX className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-black text-white truncate">{w.item}
                      <span className={`ml-2 text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${w.reason === 'expired' ? 'bg-rose-600/20 text-rose-400' : 'bg-amber-600/20 text-amber-400'}`}>{w.reason}</span>
                    </p>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase">{formatDay(w.date)} • {w.qty} × {fmt(w.costEach)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {w.reason === 'remaining' ? (
                    <p className="text-sm font-black text-amber-300 font-display" title="Carried to tomorrow — not a loss">{fmt(w.lossAmount)} →</p>
                  ) : (
                    <p className="text-sm font-black text-rose-400 font-display">-{fmt(w.lossAmount)}</p>
                  )}
                  <button onClick={() => { onDeleteWastage(w.id); triggerToast('Entry deleted', 'info'); }}
                    className="p-1.5 text-zinc-600 hover:text-rose-400 rounded-lg hover:bg-rose-950/30 cursor-pointer">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CloseSection>

      {/* ============ 3. MONEY OUT — mobile money / owner / float ============ */}
      <CloseSection id="close-money" icon={Smartphone} title="Money moved"
        hint="Where today's money went"
        open={secOpen.money} onToggle={() => toggleSec('money')}
        action={
          <button onClick={() => setShowMomoForm(v => !v)} id="tour-record-money"
            className={`flex items-center gap-1.5 text-[11px] rounded-xl px-3.5 h-11 font-black uppercase tracking-wider transition-all active:scale-95 touch-target ${
              showMomoForm
                ? 'bg-zinc-900 border border-zinc-800 text-zinc-300'
                : 'bg-cyan-500 hover:bg-cyan-400 text-black shadow-lg shadow-cyan-500/20'
            }`}>
            <Plus className="w-4 h-4" /> {showMomoForm ? 'Cancel' : 'Record Money Out'}
          </button>
        }>

        <p className="text-[11px] text-zinc-400 font-bold uppercase mb-3">Where did the money go?</p>
        {!blind && theftFlags.filter(f => f.kind === 'unaccounted' || f.kind === 'momo').slice(0, 3).map((f, i) => (
          <div key={`m-${i}`} className="mb-2"><FlagCard f={f} /></div>
        ))}
        <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-3 mb-3">
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Took today</p>
              <p className="text-[10px] font-bold text-zinc-500 uppercase mt-0.5">
                cash {fmt(tenderToday[selected]?.cash || 0)} · phone {fmt(tenderToday[selected]?.momo || 0)}
              </p>
            </div>
            <p className="text-base font-black text-cyan-400 font-display">{fmt(collectedToday)}</p>
          </div>
          <div className="border-t border-white/5 mt-2.5 pt-2.5 space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Not yet assigned</p>
              <p className={`text-base font-black font-display ${shopCash.unassigned > 0.5 ? 'text-amber-300' : 'text-emerald-400'}`}>
                {shopCash.unassigned > 0.5 ? fmt(shopCash.unassigned) : '✓'}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <div className="bg-black/30 rounded-lg px-2 py-1.5 text-center">
                <p className="text-[9px] font-black text-zinc-500 uppercase">Float</p>
                <p className="text-xs font-black text-emerald-400 tabular-nums">{fmt(floatOutToday)}</p>
              </div>
              <div className="bg-black/30 rounded-lg px-2 py-1.5 text-center">
                <p className="text-[9px] font-black text-zinc-500 uppercase">Owner / Cash</p>
                <p className="text-xs font-black text-amber-400 tabular-nums">{fmt(cashOutToday + ownerOutToday)}</p>
              </div>
              <div className="bg-black/30 rounded-lg px-2 py-1.5 text-center">
                <p className="text-[9px] font-black text-zinc-500 uppercase">Banked</p>
                <p className="text-xs font-black text-sky-300 tabular-nums">{fmt(bankOutToday)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tomorrow's opening: tonight's keep-aside is what the drawer opens with. */}
        {onSetEodCapital && (
          <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-3 mb-3">
            <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">
              Tomorrow's opening — {selected}
            </label>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-500 font-bold uppercase shrink-0">Keep in business</span>
              <input type="number" min="0" step="1000" inputMode="numeric" id="tour-capital-input"
                value={capForSelected || ''}
                onChange={(e) => {
                  const v = Math.max(0, parseInt(e.target.value || '0', 10) || 0);
                  try { setClosingCapital(todayKey, selected, v); } catch {}
                  onSetEodCapital(selected, v);
                }}
                placeholder="e.g. 10000"
                className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-10 px-3 text-sm outline-none focus:border-gold-brand font-bold" />
            </div>
            <p className="text-[10px] text-zinc-500 font-bold uppercase mt-1.5">
              Tomorrow opens {selected} with {fmt(capForSelected)}.
            </p>
            {smartCash.unassigned > 0.5 && (
              <p className="text-[10px] text-amber-300 font-bold uppercase mt-1.5">
                {fmt(smartCash.unassigned)} still to assign in {selected}
              </p>
            )}
            {smartCash.unassigned <= 0.5 && collectedToday > 0 && (
              <p className="text-[10px] text-emerald-300 font-bold uppercase mt-1.5">
                ✓ All of {selected}’s money has a home tonight
              </p>
            )}
          </div>
        )}

        {showMomoForm && (
          <div className="bg-zinc-950/60 border border-cyan-600/20 rounded-xl p-4 space-y-3 mb-4">
            <p className="text-[11px] font-bold text-zinc-400 uppercase">
              Record money from <span className="text-cyan-400">{selected}</span>; it leaves the drawer and goes somewhere — track it so all money is accounted for.
            </p>
            <div>
              <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Where did it go?</label>
              <div className="grid grid-cols-5 gap-1.5">
                {MONEY_DEST.map(d => (
                  <button key={d.key} onClick={() => { setMomoDest(d.key); setHandoffRecipient(null); }}
                    className={`h-16 rounded-xl border text-center px-1 cursor-pointer transition-all ${
                      momoDest === d.key ? 'border-cyan-400 bg-cyan-600/15 text-cyan-300' : 'border-zinc-800 bg-zinc-900/40 text-zinc-500 hover:border-zinc-700'
                    }`}>
                    <span className="block text-lg leading-none mb-1">{d.icon}</span>
                    <span className="text-[9px] font-black uppercase tracking-wide leading-tight block">{d.label}</span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-zinc-600 mt-1">{MONEY_DEST.find(d => d.key === momoDest)?.hint}</p>
            </div>
            {momoDest === 'manager' && (
              <div>
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Which manager?</label>
                {managerList.length === 0 ? (
                  <p className="text-[11px] text-amber-300 font-bold bg-amber-950/25 border border-amber-800/40 rounded-xl px-3 py-2">
                    No managers set up yet. Add one in Settings → Staff, or give it to the owner instead.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5">
                    {managerList.map(m => (
                      <button key={m.id} onClick={() => setHandoffRecipient({ id: m.id, name: m.name })}
                        className={`h-12 rounded-xl border px-2 text-left cursor-pointer transition-all ${
                          handoffRecipient?.id === m.id ? 'border-cyan-400 bg-cyan-600/15 text-cyan-300' : 'border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700'
                        }`}>
                        <span className="block text-xs font-black truncate">{m.name}</span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-zinc-600 mt-1">They will get a notification on their phone to confirm they received it.</p>
              </div>
            )}
            {(momoDest === 'owner' || momoDest === 'manager') && (
              <p className="text-[11px] font-bold text-cyan-300 bg-cyan-950/25 border border-cyan-800/40 rounded-xl px-3 py-2">
                {momoDest === 'owner'
                  ? `${ownerName || 'The owner'} will be asked to confirm receipt on their phone.`
                  : `${handoffRecipient?.name || 'The manager'} will be asked to confirm receipt on their phone.`}
              </p>
            )}
            <div>
              <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Amount (UGX)</label>
              <input type="number" min="0" value={momoAmount}
                onChange={(e) => setMomoAmount(e.target.value)}
                placeholder={String(collectedToday)}
                className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-cyan-500 font-bold" />
              {collectedToday > 0 && (
                <button onClick={() => setMomoAmount(String(collectedToday))}
                  className="mt-1 text-[10px] text-cyan-400 font-bold uppercase tracking-wider cursor-pointer">
                  Use collected total {fmt(collectedToday)}
                </button>
              )}
            </div>
            <div>
              <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Who did it? *</label>
              <input type="text" value={momoSentBy} onChange={e => setMomoSentBy(e.target.value)}
                placeholder="Staff member who sent/moved the money"
                className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-cyan-500" />
            </div>
            <div>
              <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">For day</label>
              <input type="date" value={momoDate} max={todayStr()} onChange={(e) => setMomoDate(e.target.value || todayStr())}
                className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-cyan-500 font-bold" />
            </div>
            <div>
              <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Comment (optional)</label>
              <input type="text" value={momoComment} onChange={e => setMomoComment(e.target.value)}
                placeholder="e.g. Sent by MTN MoMo to 0700 000 000 / Kept 50k capital for tomorrow"
                className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-cyan-500" />
            </div>
            <button onClick={handleSubmitMomo}
              className="w-full h-11 bg-cyan-600 hover:bg-cyan-500 text-black font-black uppercase tracking-widest text-xs rounded-xl cursor-pointer active:scale-95 transition-all flex items-center justify-center gap-1.5">
              <Check className="w-4 h-4" /> Record
            </button>
          </div>
        )}

        {catMomoTransfers.length === 0 ? (
          <div className="text-center py-6">
            <Smartphone className="w-10 h-10 text-cyan-500 mx-auto mb-2 opacity-40" />
            <p className="text-xs text-zinc-500 font-bold uppercase">No money moved for {selected} yet</p>
          </div>
        ) : (
          <>
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Moved today</p>
            {todayMoneyOut.length === 0 ? (
              <p className="text-[11px] font-bold text-zinc-500 uppercase bg-black/20 rounded-xl px-3 py-3 mb-3">
                Nothing moved yet today
              </p>
            ) : (
              <div className="space-y-2 mb-3">
                {todayMoneyOut.map(t => {
                  const d = MONEY_DEST.find(x => x.key === (t.to || 'float'));
                  return (
                    <div key={t.id} className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-3 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-black text-emerald-400 font-display">
                          {fmt(t.amount)}
                          <span className="ml-2 text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 whitespace-nowrap">{d?.icon} {d?.label}</span>
                        </p>
                        <p className="text-[10px] text-zinc-500 font-bold uppercase">
                          {formatDay(t.createdAt)}{t.sentBy ? ` • by ${t.sentBy}` : ''}
                        </p>
                        {t.comment && <p className="text-[11px] text-zinc-400 mt-0.5">{t.comment}</p>}
                      </div>
                      <button onClick={() => { onDeleteMomoTransfer(t.id); triggerToast('Entry deleted', 'info'); }}
                        aria-label={`Delete ${fmt(t.amount)} ${d?.label || 'move'}`}
                        className="p-1.5 text-zinc-600 hover:text-rose-400 rounded-lg hover:bg-rose-950/30 cursor-pointer shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {pastTransfers.length > 0 && (
              <details className="bg-black/20 rounded-xl px-3 py-2">
                <summary className="text-[10px] font-black text-zinc-500 uppercase tracking-wider cursor-pointer hover:text-zinc-300">
                  Past moves ({pastTransfers.length}) — not today
                </summary>
                <div className="space-y-2 mt-2 max-h-72 overflow-y-auto">
                  {pastTransfers.map(t => {
                    const d = MONEY_DEST.find(x => x.key === (t.to || 'float'));
                    return (
                      <div key={t.id} className="bg-zinc-900/40 border border-zinc-800/60 rounded-xl p-3 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-black text-zinc-300 font-display">
                            {fmt(t.amount)}
                            <span className="ml-2 text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 whitespace-nowrap">{d?.icon} {d?.label}</span>
                          </p>
                          <p className="text-[10px] text-zinc-500 font-bold uppercase">
                            {formatDay(t.createdAt)}{t.sentBy ? ` • by ${t.sentBy}` : ''}
                          </p>
                          {t.comment && <p className="text-[11px] text-zinc-400 mt-0.5">{t.comment}</p>}
                        </div>
                        <button onClick={() => { onDeleteMomoTransfer(t.id); triggerToast('Entry deleted', 'info'); }}
                          aria-label={`Delete ${fmt(t.amount)} ${d?.label || 'move'}`}
                          className="p-1.5 text-zinc-600 hover:text-rose-400 rounded-lg hover:bg-rose-950/30 cursor-pointer shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </>
        )}
      </CloseSection>

      {/* ============ 1. ABABANJIBWA SENTE ============ */}
      <CloseSection icon={Users} title="Ababanjibwa Sente"
        hint={openCredits.length > 0 ? (blind ? `${openCredits.length} to collect` : `${formatCurrency(outstanding)} outstanding`) : 'Customers who still owe you — books clear'}
        open={secOpen.credit} onToggle={() => toggleSec('credit')}
        action={
          <button onClick={() => setShowCreditForm(v => !v)}
            className="flex items-center gap-1 text-[10px] bg-emerald-600/20 text-emerald-400 border border-emerald-600/40 rounded-lg px-2.5 py-1.5 font-black uppercase tracking-wider cursor-pointer touch-target">
            <Plus className="w-3.5 h-3.5" /> {showCreditForm ? t(lang, 'closeBtn') : t(lang, 'addCreditK')}
          </button>
        }>
        {showCreditForm && (
          <div className="bg-zinc-950/60 border border-emerald-600/20 rounded-xl p-4 space-y-3 mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">{t(lang, 'customerName')}</label>
                <input type="text" value={creditName} onChange={e => setCreditName(e.target.value)}
                  placeholder="e.g. Nakato Sarah" autoFocus
                  className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-emerald-500" />
                {creditName.trim() && (() => {
                  const owes = owesFor(creditName);
                  const typed = Math.max(0, Math.round(parseFloat(creditCap) || 0));
                  const cap = typed > 0 ? typed : capFor(creditName);
                  if (owes <= 0 && cap <= 0) return null;
                  const over = cap > 0 && owes >= cap;
                  return (
                    <p className={`text-[10px] font-black uppercase mt-1 ${over ? 'text-rose-400' : 'text-zinc-500'}`}>
                      Owes {formatCurrency(owes)}{cap > 0 ? ` / cap ${formatCurrency(cap)}` : ' • no cap set'}
                    </p>
                  );
                })()}
              </div>
              <div>
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Cap (optional)</label>
                <input type="number" min="0" value={creditCap} onChange={e => setCreditCap(e.target.value)}
                  placeholder={(() => { const c = capFor(creditName); return c > 0 ? String(c) : 'e.g. 50000'; })()}
                  className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">{t(lang, 'dateK')}</label>
                <input type="date" value={creditDate} onChange={e => setCreditDate(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-emerald-500" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">{t(lang, 'itemTakenK')}</label>
                <select value={creditItem} onChange={e => selectOnChange(e.target.value, setCreditCustomItem, setCreditItem, setCreditPrice, () => {})}
                  className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none font-bold">
                  <option value="">Select item...</option>
                  {catProducts.map(p => <option key={p.id} value={p.name}>{p.name} — {formatCurrency(p.price)}</option>)}
                  <option value="__custom">Other / custom item...</option>
                </select>
                {creditItem === '__custom' && (
                  <input type="text" value={creditCustomItem} onChange={e => setCreditCustomItem(e.target.value)}
                    placeholder="Type the item name..." autoFocus
                    className="mt-2 w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-emerald-500" />
                )}
              </div>
              <div>
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">{t(lang, 'qtyK')}</label>
                <input type="number" min="1" value={creditQty} onChange={e => setCreditQty(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">{t(lang, 'unitPriceK')}</label>
                <input type="number" min="0" value={creditPrice} onChange={e => setCreditPrice(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-emerald-500" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-zinc-400 uppercase">
                Total demanded: <span className="text-emerald-400 font-black text-base">
                  {formatCurrency((parseInt(creditQty, 10) || 0) * (parseFloat(creditPrice) || 0))}
                </span>
              </p>
              <button onClick={handleSubmitCredit}
                className="h-11 px-5 bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest text-xs rounded-xl cursor-pointer active:scale-95 transition-all flex items-center gap-1.5">
                <Check className="w-4 h-4" /> {t(lang, 'saveCredit')}
              </button>
            </div>
          </div>
        )}

        {openCredits.length === 0 ? (
          <div className="text-center py-8">
            <Check className="w-10 h-10 text-emerald-500 mx-auto mb-2 opacity-40" />
            <p className="text-xs text-zinc-500 font-bold uppercase">No outstanding credit in {selected}</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {openCredits.map(c => {
              const d = daysOverdue(c.date);
              const buck = ageingBucket(d);
              return (
              <div key={c.id} className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-white truncate flex items-center gap-1.5">{c.customerName} {d>7 && <span className={`text-[8px] px-1.5 py-0.5 rounded font-black uppercase ${buck==='overdue' ? 'bg-rose-950 text-rose-300 border border-rose-800' : 'bg-amber-950 text-amber-300 border border-amber-800'}`}>{d}d overdue</span>}</p>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase truncate">
                      {formatDay(c.date)} • {c.qty}× {c.item} • {d}d ago
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-black text-emerald-400 font-display">{formatCurrency(c.total - c.paidAmount)}</p>
                    <p className="text-[10px] text-zinc-500 font-bold">due of {formatCurrency(c.total)}</p>
                  </div>
                </div>
                <div className="flex gap-2 mt-2">
                <button onClick={() => { setPayId(c.id); setPayAmount(String(c.total - c.paidAmount)); }}
                  className="flex-1 h-9 bg-emerald-600/15 text-emerald-400 border border-emerald-600/30 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-emerald-600/25 cursor-pointer">
                  {t(lang, 'recordPayment')}
                </button>
                <button onClick={() => setStatementFor(c.customerName)} title={`Print ${c.customerName}'s statement`}
                  className="h-9 px-3 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-lg text-[10px] font-black uppercase tracking-widest hover:border-gold-brand/40 hover:text-gold-brand cursor-pointer flex items-center gap-1">
                  <FileText className="w-3.5 h-3.5" /> Bill
                </button>
                <button
                  onClick={() => {
                    const due = c.total - c.paidAmount;
                    const msg = `Hello ${c.customerName}, reminder from ${shopName || 'our shop'}: ${c.qty}× ${c.item} (${formatDay(c.date)}) — balance ${formatCurrency(due)} of ${formatCurrency(c.total)}. Please clear it when you can. Thank you!`;
                    // wa.me share link needs no saved number: WhatsApp opens with
                    // the text prefilled and the cashier just picks the customer.
                    const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
                    const w = window.open(url, '_blank', 'noopener');
                    if (w) triggerToast('Pick the customer in WhatsApp to send', 'success');
                    else triggerToast('Could not open WhatsApp — copy manually', 'error');
                  }}
                  title={`Remind ${c.customerName}`}
                  className="h-9 px-3 bg-emerald-950/30 border border-emerald-800/40 text-emerald-300 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-emerald-950/50 cursor-pointer"
                >
                  WhatsApp
                </button>
                </div>
              </div>
            )})}
          </div>
        )}
      </CloseSection>

      {/* Money across all departments: the reconciliation detail. */}
      <CloseSection id="close-glance" icon={LayoutGrid} title="Money across all departments"
        hint="per-department reconciliation"
        open={secOpen.glance} onToggle={() => toggleSec('glance')}>
      {/* Where the money is today — across ALL departments */}
      <section className="boss-card p-4 rounded-2xl border border-cyan-900/40 bg-cyan-950/10">
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-3">
            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">To owner (total)</p>
            <p className="text-base font-black text-amber-400 font-display">{fmt(ownerTotal)}</p>
          </div>
          <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-3">
            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Banked (total)</p>
            <p className="text-base font-black text-sky-300 font-display">{fmt(bankTotal)}</p>
          </div>
        </div>

        {/* Reconciliation: opening capital + tender buckets per dept — where
            it should still be, drawer cash vs phone money */}
        <div className="mt-3 overflow-x-auto no-scrollbar">
          <table className="w-full text-[10px] font-bold uppercase">
            <thead>
              <tr className="text-zinc-500">
                <th className="text-left py-1.5 pr-2">Department</th>
                <th className="text-right px-2">Sold</th>
                <th className="text-right px-2 text-emerald-500">Float</th>
                <th className="text-right px-2 text-zinc-300">Cash</th>
                <th className="text-right px-2 text-amber-400">Owner</th>
                <th className="text-right px-2 text-sky-300">Bank</th>
                <th className="text-right px-2 text-gold-brand">Drawer</th>
                <th className="text-right pl-2 text-emerald-300">Phone</th>
              </tr>
            </thead>
            <tbody>
              {segments.map(cat => {
                const sold = todayCollectedByCategory[cat] || 0;
                const m = todayMoneyOutByCat[cat] || { float: 0, cash: 0, owner: 0, bank: 0 };
                const b = bucketFor(cat);
                return (
                  <tr key={cat} className={`border-t border-white/5 ${cat === selected ? 'text-white' : 'text-zinc-400'}`}>
                    <td className="py-1.5 pr-2">{cat}</td>
                    <td className="text-right px-2">{fmt(sold)}</td>
                    <td className="text-right px-2 text-emerald-400">{fmt(m.float)}</td>
                    <td className="text-right px-2 text-zinc-300">{fmt(m.cash)}</td>
                    <td className="text-right px-2 text-amber-400">{fmt(m.owner)}</td>
                    <td className="text-right px-2 text-sky-300">{fmt(m.bank)}</td>
                    <td className="text-right px-2 font-black text-gold-brand">{fmt(b.drawer)}</td>
                    <td className="text-right pl-2 font-black text-emerald-300">{fmt(b.phone)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      </CloseSection>

      {/* Need help? Corner coach for new closers — the 30-second how-to. */}
      <button onClick={() => setShowCloseHelp(true)} title="How do I close the day?"
        aria-label="How to close the day"
        className="fixed bottom-24 right-4 z-[70] w-12 h-12 rounded-full bg-gold-brand text-black font-black text-lg shadow-2xl active:scale-90 transition-transform cursor-pointer flex items-center justify-center border border-black/20">
        ?
      </button>
      {showCloseHelp && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-4" role="dialog" aria-label="How to close the day">
          <div className="absolute inset-0 bg-black/70" onClick={() => setShowCloseHelp(false)} />
          <div className="relative bg-[#141414] border border-gold-brand/40 rounded-3xl p-5 max-w-md w-full shadow-2xl animate-tour-card-in">
            <h3 className="text-sm font-black text-white uppercase tracking-wider">Closing in 5 moves</h3>
            <ol className="mt-3 space-y-2 text-xs text-zinc-300 font-bold leading-relaxed">
              <li><span className="text-gold-brand font-black">1 · Count.</span> Count the cash in the drawer, type it. Count blind — never type what the till expects.</li>
              <li><span className="text-gold-brand font-black">2 · Food.</span> Leftover carries itself to tomorrow. Only spoiled food gets logged, as expired.</li>
              <li><span className="text-gold-brand font-black">3 · Losses.</span> Log what was lost or carried, nothing else.</li>
              <li><span className="text-gold-brand font-black">4 · Move.</span> Record every shilling: float, cash, owner, bank. Keep tomorrow's opening.</li>
              <li><span className="text-gold-brand font-black">5 · Done.</span> Send tonight's books to the owner on WhatsApp.</li>
            </ol>
            <button onClick={() => setShowCloseHelp(false)}
              className="mt-4 w-full h-11 bg-gold-brand text-black rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer active:scale-95 transition-all">
              Got it — back to closing
            </button>
          </div>
        </div>
      )}

      {/* Payment modal */}
      {statementFor && (
        <StatementModal customerName={statementFor}
          entries={catCreditEats.filter(e => e.customerName === statementFor)}
          shopName={shopName || 'My Shop'}
          formatCurrency={formatCurrency} onClose={() => setStatementFor(null)} />
      )}
      {payId && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#141414] border border-white/10 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4">
              <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                <Wallet className="w-4 h-4 text-emerald-400" /> {t(lang, 'recordPayment')}
              </h3>
              <button onClick={() => { setPayId(null); setPayAmount(''); }} className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            {(() => {
              const rec = openCredits.find(c => c.id === payId);
              if (!rec) return null;
              return (
                <>
                  <div className="bg-zinc-950 border border-white/5 rounded-xl p-3 mb-4 space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Customer</span>
                      <span className="font-bold text-white">{rec.customerName}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Item</span>
                      <span className="font-bold text-white">{rec.qty}× {rec.item}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Outstanding</span>
                      <span className="font-black text-red-400">{formatCurrency(rec.total - rec.paidAmount)}</span>
                    </div>
                  </div>
                  <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Payment Amount</label>
                  <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                    className="w-full h-12 bg-zinc-950 border border-white/5 text-white text-sm px-4 rounded-xl focus:border-emerald-500 outline-none font-bold mt-2" autoFocus />
                  <button onClick={handlePay}
                    className="mt-4 w-full h-11 bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest rounded-xl text-xs transition-all active:scale-95 cursor-pointer">
                    Confirm Payment
                  </button>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
