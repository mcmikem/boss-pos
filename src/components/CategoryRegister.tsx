import { useEffect, useMemo, useState } from 'react';
import {
  Users, PackageX, Plus, Trash2, X,
  Check, Wallet, AlertTriangle, Coins, LayoutGrid, Smartphone, CalendarDays, ArrowRightLeft, FileText
} from 'lucide-react';
import StatementModal from './StatementModal';
import BeginnerTip from './BeginnerTip';
import { t } from '../utils/i18n';
import type { CreditEat, ProductionRegister, WastageLog, Product, MomoTransfer, Sale, Expense } from '../types';
import { localDayKey, localMonthKey, todayLocalKey, middayStamp } from '../utils/dates';
import { daysOverdue, ageingBucket } from '../utils/creditAge';
import { isDailyMakeCategory, CATEGORY_WORKFLOW_HINT } from '../utils/dailyMake';
import { isOn, type FeatureKey } from '../utils/features';
import {
  computeDayCash, getOpeningCapital, getClosingCapital, setClosingCapital,
  moneyOutByCategory, drawerExpensesByCategory, buildTheftFlags, voidsOnDay,
} from '../utils/cashflow';
import { pushNotice } from '../utils/notifications';

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
  eodCapital?: Record<string, number>;
  onSetEodCapital?: (category: string, value: number) => void;
  formatCurrency: (val: number) => string;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  onBack?: () => void;
  lang?: unknown;
  onPrintClose?: () => void;
  onSendClose?: () => void;
  features?: Record<string, boolean>;
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

export default function CategoryRegister({
  segments, products, sales, expenses = [], creditEats, productionRegisters, wastageLogs,
  momoTransfers,
  onAddCreditEat, onPayCreditEat,
  onAddWastage, onDeleteWastage, onAddMomoTransfer, onDeleteMomoTransfer,
  staffName, shopName, eodCapital, onSetEodCapital, formatCurrency, triggerToast, onBack, lang,
  onPrintClose, onSendClose, features,
}: CategoryRegisterProps) {
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
  const closeDayKey = `${todayStr()}::${selected}`;
  const [closeTicks, setCloseTicks] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try { setCloseTicks(JSON.parse(localStorage.getItem(`boss_pos_close_${closeDayKey}`) || '{}')); } catch { setCloseTicks({}); }
  }, [closeDayKey]);
  const toggleTick = (k: string) => setCloseTicks(prev => {
    const next = { ...prev, [k]: !prev[k] };
    try { localStorage.setItem(`boss_pos_close_${closeDayKey}`, JSON.stringify(next)); } catch {}
    return next;
  });
  const scrollToSection = (id: string) => {
    try { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {}
  };

  const [showCreditForm, setShowCreditForm] = useState(false);
  const [creditName, setCreditName] = useState('');
  const [creditDate, setCreditDate] = useState(todayStr());
  const [creditItem, setCreditItem] = useState('');
  const [creditCustomItem, setCreditCustomItem] = useState('');
  const [creditQty, setCreditQty] = useState('1');
  const [creditPrice, setCreditPrice] = useState('');

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

  // Today's money movement across ALL departments — so the boss can see where
  // every coin is without tapping through each category.
  const allCollectedToday = useMemo(() =>
    Object.values(todayCollectedByCategory).reduce((a, b) => a + b, 0), [todayCollectedByCategory]);
  const todayStrKey = todayLocalKey();
  const allMoneyOutToday = momoTransfers.filter(t => localDayKey(t.createdAt) === todayStrKey);
  const allFloatOut = allMoneyOutToday.filter(t => (t.to || 'float') === 'float').reduce((s, t) => s + t.amount, 0);
  const allCashOut = allMoneyOutToday.filter(t => (t.to || 'float') === 'cash').reduce((s, t) => s + t.amount, 0);
  const allOwnerOut = allMoneyOutToday.filter(t => (t.to || 'float') === 'owner').reduce((s, t) => s + t.amount, 0);

  // Daily close-out: for each dish, produced - sold - expired - carried.
  // A positive remainder is stock that "vanished" (shrinkage); negative means
  // sales were covered from earlier production (normal when leftover existed).
  // Carried (remaining) is explained — tomorrow's opening, never shrinkage.
  const balanceRows = useMemo(() => {
    const daySales = sales.filter(s => !s.refunded && localDayKey(s.timestamp) === balanceDate);
    return catProducts.map(p => {
      const made = catProduction.filter(x => x.productId === p.id && x.date === balanceDate)
        .reduce((s, x) => s + (x.qty || 0), 0);
      const lost = catWastage.filter(x => x.productId === p.id && x.date === balanceDate && x.reason !== 'remaining')
        .reduce((s, x) => s + (x.qty || 0), 0);
      const carried = catWastage.filter(x => x.productId === p.id && x.date === balanceDate && x.reason === 'remaining')
        .reduce((s, x) => s + (x.qty || 0), 0);
      const sold = daySales.flatMap(s => s.items)
        .filter(i => i.productId === p.id)
        .reduce((s, i) => s + (i.qty || 0), 0);
      return { product: p, made, sold, lost, carried, onHand: p.stockQty || 0, recon: made - sold - lost - carried };
    }).filter(r => r.made + r.sold + r.lost + r.carried > 0 || r.onHand > 0);
  }, [catProducts, catProduction, catWastage, sales, balanceDate]);

  const totalShrinkage = useMemo(() => balanceRows.reduce((s, r) => s + Math.max(0, r.recon), 0), [balanceRows]);

  const [payId, setPayId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [statementFor, setStatementFor] = useState<string | null>(null);

  const [showMomoForm, setShowMomoForm] = useState(false);
  const [momoAmount, setMomoAmount] = useState('');
  const [momoComment, setMomoComment] = useState('');
  const [momoDest, setMomoDest] = useState<'float' | 'cash' | 'owner'>('float');
  const [momoSentBy, setMomoSentBy] = useState(staffName || '');
  // Business date for the move (default today — a 00:10 close-out attributes
  // to the day just ended instead of leaking into the new day).
  const [momoDate, setMomoDate] = useState(todayStr());

  const activeItem = (list: string[], custom: string, picked: string) =>
    picked === '__custom' ? custom.trim() : (list.find(i => i === picked) || '');

  // ---- Credit (Ababanjibwa Sente) ----
  const openCredits = catCreditEats.filter(e => !e.paid);
  const outstanding = openCredits.reduce((s, e) => s + (e.total - e.paidAmount), 0);

  const handleSubmitCredit = () => {
    const item = activeItem(catProducts.map(p => p.name), creditCustomItem, creditItem);
    const name = creditName.trim();
    if (!name) { triggerToast('Enter customer name', 'error'); return; }
    if (!item) { triggerToast('Select the item taken', 'error'); return; }
    const qty = Math.max(1, parseInt(creditQty, 10) || 1);
    const unitPrice = Math.max(0, parseFloat(creditPrice) || 0);
    if (unitPrice <= 0) { triggerToast('Enter the unit price', 'error'); return; }
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
    setCreditName(''); setCreditItem(''); setCreditCustomItem(''); setCreditQty('1'); setCreditPrice('');
    setShowCreditForm(false);
  };

  const handlePay = () => {
    if (!payId) return;
    const rec = openCredits.find(c => c.id === payId);
    const amt = parseFloat(payAmount);
    if (!rec) return;
    if (isNaN(amt) || amt <= 0) { triggerToast('Enter a valid amount', 'error'); return; }
    const remaining = rec.total - rec.paidAmount;
    if (amt > remaining) { triggerToast(`Only ${formatCurrency(remaining)} is outstanding`, 'error'); return; }
    onPayCreditEat(payId, amt);
    triggerToast(`Payment recorded: ${formatCurrency(amt)}`, 'success');
    setPayId(null); setPayAmount('');
  };

  // ---- Production (read-only here: morning log lives on Sell → Eatery) ----
  const todayProdCost = catProduction.filter(p => p.date === todayStr()).reduce((s, p) => s + p.total, 0);

  // ---- Wastage: expired is a true loss; remaining carries to tomorrow ----
  const todayWastage = catWastage.filter(w => w.date === todayStr() && w.reason !== 'remaining').reduce((s, w) => s + w.lossAmount, 0);
  const todayCarried = catWastage.filter(w => w.date === todayStr() && w.reason === 'remaining').reduce((s, w) => s + w.lossAmount, 0);
  const todayLossCount = catWastage.filter(w => w.date === todayStr()).length;

  // ---- Money Out (Mobile Money / Owner / Float for tomorrow) ----
  const collectedToday = todayCollectedByCategory[selected] || 0;
  const todayMoneyOut = momoTransfers
    .filter(t => t.category === selected && localDayKey(t.createdAt) === todayStr());
  const sentToday = todayMoneyOut.reduce((s, t) => s + t.amount, 0);
  const floatOutToday = todayMoneyOut.filter(t => (t.to || 'float') === 'float').reduce((s, t) => s + t.amount, 0);
  const cashOutToday = todayMoneyOut.filter(t => (t.to || 'float') === 'cash').reduce((s, t) => s + t.amount, 0);
  const ownerOutToday = todayMoneyOut.filter(t => (t.to || 'float') === 'owner').reduce((s, t) => s + t.amount, 0);
  const catMomoTransfers = momoTransfers.filter(t => t.category === selected);

  // Daily capital kept for this department; profit to send = collected − capital.
  const todayKey = todayLocalKey();
  const capForSelected = eodCapital && eodCapital[selected] ? Number(eodCapital[selected]) : getClosingCapital(todayKey, selected, eodCapital);
  const profitToSend = Math.max(0, collectedToday - capForSelected);

  // Smart drawer equation: opening (yesterday's capital carried forward) +
  // collected − drawer expenses − moved out − closing = unaccounted (FLAG).
  const drawerExpensesToday = useMemo(() => drawerExpensesByCategory(expenses, todayKey), [expenses, todayKey]);
  const smartCash = useMemo(() => computeDayCash({
    category: selected,
    dayKey: todayKey,
    openingCapital: getOpeningCapital(todayKey, selected, eodCapital),
    closingCapital: capForSelected,
    collected: collectedToday,
    drawerExpenses: drawerExpensesToday[selected] || 0,
    floatOut: floatOutToday,
    cashOut: cashOutToday,
    ownerOut: ownerOutToday,
  }), [selected, todayKey, eodCapital, capForSelected, collectedToday, drawerExpensesToday, floatOutToday, cashOutToday, ownerOutToday]);

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
  }), [todayKey, segments, todayCollectedByCategory, drawerExpensesToday, momoTransfers, eodCapital, sales, products, productionRegisters, wastageLogs]);

  useEffect(() => {
    for (const f of theftFlags.slice(0, 4)) {
      try {
        pushNotice(
          f.kind === 'unaccounted' ? 'unaccounted' : f.kind === 'no-production' ? 'no-production' : 'shrinkage',
          f.title,
          f.detail,
          `theft:${todayKey}:${f.kind}:${f.title}`.slice(0, 120),
        );
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayKey, theftFlags.length]);

  // Per-department view of today's money, for the reconciliation table.
  const todayMoneyOutByCat = useMemo(() => {
    const map: { [cat: string]: { float: number; cash: number; owner: number } } = {};
    momoTransfers.forEach(t => {
      if (localDayKey(t.createdAt) !== todayStr()) return;
      const d = map[t.category] || (map[t.category] = { float: 0, cash: 0, owner: 0 });
      if (t.to === 'cash') d.cash += t.amount;
      else if (t.to === 'owner') d.owner += t.amount;
      else d.float += t.amount;
    });
    return map;
  }, [momoTransfers]);

  const MONEY_DEST = [
    { key: 'float' as const, label: 'Float', icon: '📲', hint: 'Money put onto the Mobile Money agent line (MTN/Airtel float)' },
    { key: 'cash' as const, label: 'Cash', icon: '💵', hint: 'Kept as physical cash — e.g. retained capital for tomorrow / handed out' },
    { key: 'owner' as const, label: 'Given to Owner (Mike)', icon: '👑', hint: 'Handed to the business owner (McMike), or eatery profits sent' },
  ];

  const handleSubmitMomo = () => {
    const amt = Math.round(parseFloat(momoAmount) || 0);
    if (amt <= 0) { triggerToast('Enter the amount you moved', 'error'); return; }
    onAddMomoTransfer({
      id: `mt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      category: selected,
      amount: amt,
      comment: momoComment.trim(),
      createdAt: middayStamp(momoDate),
      to: momoDest,
      sentBy: momoSentBy.trim() || staffName || '',
    });
    const dest = MONEY_DEST.find(d => d.key === momoDest)?.label || 'recorded';
    const backdated = momoDate !== todayStr();
    triggerToast(`Confirmed: ${formatCurrency(amt)} ${dest}${backdated ? ` (for ${momoDate})` : ''}`, 'success');
    setMomoAmount('');
    setMomoComment('');
    setMomoDate(todayStr());
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
          <p className="text-xs text-zinc-500 font-bold">{showProduction ? 'Credit • Daily balance • Losses' : 'Credit • Losses • Money out'}</p>
        </div>
      </div>
      <BeginnerTip tipKey="close-day" text="Close day = count today's money and finish the books. Do it every evening." />
      {onBack && (
        /* Consistent back (#24): same Back button as every other sub-panel. */
        <button onClick={onBack} aria-label="Back to reports"
          className="h-10 px-4 bg-[#141414] border border-white/10 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer touch-target">
          <ArrowRightLeft className="w-4 h-4" /> {t(lang, 'back')}
        </button>
      )}

      {/* Category segment chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {segments.map(cat => (
          <button key={cat} onClick={() => setSelected(cat)}
            className={`py-2.5 px-4 rounded-xl text-xs font-black uppercase tracking-wider border transition-all cursor-pointer active:scale-95 whitespace-nowrap min-h-[44px] ${
              selected === cat
                ? 'bg-gold-brand border-gold-brand text-black'
                : 'bg-[#141414]/60 border-white/5 text-zinc-400 hover:text-zinc-200'
            }`}>
            {cat}
          </button>
        ))}
      </div>
      {!isDailyMake && workflowHint && (
        <p className="text-[11px] text-zinc-500 font-bold -mt-3">{workflowHint}</p>
      )}

      {/* Theft / accountability flags: unaccounted cash, no-production sales */}
      {theftFlags.length > 0 && (
        <section className="space-y-2">
          {theftFlags.slice(0, 4).map((f, i) => (
            <div
              key={`${f.kind}-${i}`}
              className={`rounded-2xl border p-4 flex items-start gap-3 ${
                f.severity === 'critical'
                  ? 'bg-rose-950/30 border-rose-600/40'
                  : 'bg-amber-950/25 border-amber-600/30'
              }`}
            >
              <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${f.severity === 'critical' ? 'text-rose-400' : 'text-amber-400'}`} />
              <div className="min-w-0">
                <p className={`text-xs font-black uppercase tracking-wider ${f.severity === 'critical' ? 'text-rose-300' : 'text-amber-300'}`}>
                  {f.severity === 'critical' ? 'Flag — ' : 'Check — '}{f.title}
                </p>
                <p className="text-[11px] text-zinc-300 font-bold mt-1 leading-relaxed">{f.detail}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Smart drawer card: opening (carried) → collected → expenses → moved → capital → unaccounted */}
      <section className={`boss-card p-4 rounded-2xl border ${smartCash.status === 'missing' ? 'border-rose-600/50' : smartCash.status === 'balanced' ? 'border-emerald-800/40' : 'border-white/5'}`}>
        <h3 className="text-xs font-black text-white uppercase tracking-widest mb-1">
          Drawer math — {selected} today
        </h3>
        <p className="text-[10px] text-zinc-500 font-bold uppercase mb-3">
          Opening {formatCurrency(smartCash.openingCapital)} (yesterday's capital) + Sold {formatCurrency(smartCash.collected)}
          {smartCash.drawerExpenses > 0 && <> − Expenses {formatCurrency(smartCash.drawerExpenses)}</>} − Moved {formatCurrency(smartCash.movedOut)} − Capital {formatCurrency(smartCash.closingCapital)}
        </p>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-black/30 rounded-xl p-2.5">
            <p className="text-[9px] font-bold text-zinc-500 uppercase">Opening</p>
            <p className="text-sm font-black text-zinc-200">{formatCurrency(smartCash.openingCapital)}</p>
          </div>
          <div className="bg-black/30 rounded-xl p-2.5">
            <p className="text-[9px] font-bold text-zinc-500 uppercase">Sold today</p>
            <p className="text-sm font-black text-cyan-300">{formatCurrency(smartCash.collected)}</p>
          </div>
          <div className="bg-black/30 rounded-xl p-2.5">
            <p className="text-[9px] font-bold text-zinc-500 uppercase">Still unexplained</p>
            <p className={`text-sm font-black ${smartCash.status === 'balanced' ? 'text-emerald-400' : smartCash.status === 'missing' ? 'text-rose-400' : 'text-amber-300'}`}>
              {formatCurrency(Math.abs(smartCash.unaccounted))}
            </p>
          </div>
        </div>
        <p className={`text-[11px] font-bold uppercase mt-2.5 ${smartCash.status === 'balanced' ? 'text-emerald-300' : smartCash.status === 'missing' ? 'text-rose-300' : 'text-amber-300'}`}>
          {smartCash.status === 'balanced' ? '✓ Every shilling accounted for.' : smartCash.message}
        </p>
      </section>

      {/* Close-the-day ritual: work the steps top to bottom, tick each off. */}
      {isOn(features, 'closeWizard' as FeatureKey) && (() => {
        const steps = [
          { key: 'balance', label: 'Review today\u2019s balance', hint: `${balanceRows.length} lines \u2022 ${totalShrinkage} unmatched`, target: 'close-balance' },
          { key: 'losses', label: 'Log today\u2019s leftovers & losses', hint: `${todayLossCount} logged \u2022 lost ${formatCurrency(todayWastage)}${todayCarried > 0 ? ` \u2022 carried ${formatCurrency(todayCarried)}` : ''}`, target: 'close-losses' },
          { key: 'money', label: 'Move today\u2019s money', hint: `${formatCurrency(sentToday)} of ${formatCurrency(collectedToday)} moved out`, target: 'close-money' },
        ];
        const done = steps.filter(s => closeTicks[s.key]).length;
        return (
          <section className="boss-card p-4 rounded-2xl border border-gold-brand/20">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-xs font-black text-white uppercase tracking-widest font-display">Close the day \u2014 {selected}</h3>
              <span className="text-[11px] font-black text-gold-brand tabular-nums">{done}/3</span>
            </div>
            <div className="h-1.5 bg-zinc-900 rounded-full overflow-hidden mb-3">
              <div className="h-full bg-gold-brand transition-all" style={{ width: `${Math.round((done / steps.length) * 100)}%` }} />
            </div>
            <div className="space-y-1.5">
              {steps.map((s, i) => (
                <div key={s.key} className="flex items-center gap-2">
                  <button onClick={() => toggleTick(s.key)} aria-label={`Mark ${s.label} done`}
                    className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 transition-all active:scale-90 cursor-pointer ${
                      closeTicks[s.key] ? 'bg-gold-brand border-gold-brand text-black' : 'bg-[#0A0A0A] border-white/10 text-transparent'
                    }`}>
                    <Check className="w-4 h-4" />
                  </button>
                  <button onClick={() => scrollToSection(s.target)}
                    className="flex-1 min-w-0 text-left bg-[#0A0A0A] border border-white/5 hover:border-gold-brand/40 rounded-xl px-3 py-2 transition-all cursor-pointer">
                    <span className="text-xs font-black text-zinc-100 uppercase tracking-wider">{i + 1}. {s.label}</span>
                    <span className="block text-[10px] text-zinc-500 font-bold mt-0.5">{s.hint} \u2014 tap to jump</span>
                  </button>
                </div>
              ))}
            </div>
            {(onPrintClose || onSendClose) && (
              <div className="flex gap-2 mt-3">
                {onPrintClose && (
                  <button onClick={onPrintClose}
                    className="flex-1 h-11 bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-xl text-xs font-black uppercase tracking-wider hover:border-gold-brand/40 transition-all cursor-pointer">
                    Print close (PDF)
                  </button>
                )}
                {onSendClose && (
                  <button onClick={onSendClose}
                    className="flex-1 h-11 bg-emerald-950/40 border border-emerald-800/40 text-emerald-300 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-emerald-950/60 transition-all cursor-pointer">
                    WhatsApp owner
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })()}

      {/* History time filter */}
      <div className="flex items-center justify-between gap-2">
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

      {/* Today summary */}
      <section className="grid grid-cols-3 gap-2">
        {showProduction && (
        <div className="boss-card p-3 border-l-4 border-l-amber-500">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Made today</p>
          <p className="text-lg font-black text-white font-display mt-1">{formatCurrency(todayProdCost)}</p>
        </div>
        )}
        <div className="boss-card p-3 border-l-4 border-l-rose-500">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Lost today</p>
          <p className="text-lg font-black text-rose-400 font-display mt-1">{formatCurrency(todayWastage)}</p>
          {todayCarried > 0 && (
            <p className="text-[10px] text-amber-300 font-bold uppercase mt-0.5">+ {formatCurrency(todayCarried)} carried → tomorrow</p>
          )}
        </div>
        <div className="boss-card p-3 border-l-4 border-l-emerald-500">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Outstanding</p>
          <p className="text-lg font-black text-emerald-400 font-display mt-1">{formatCurrency(outstanding)}</p>
        </div>
        <div className="boss-card p-3 border-l-4 border-l-cyan-500 col-span-3 sm:col-span-1">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Collected today</p>
          <p className="text-lg font-black text-cyan-400 font-display mt-1">{formatCurrency(collectedToday)}</p>
          <p className="text-[10px] text-zinc-500 font-bold uppercase mt-0.5">
            Float: <span className="text-emerald-400 font-black">{formatCurrency(floatOutToday)}</span>
            {' · '}Cash: <span className="text-zinc-300 font-black">{formatCurrency(cashOutToday)}</span>
            {' · '}Owner: <span className="text-amber-400 font-black">{formatCurrency(ownerOutToday)}</span>
          </p>
        </div>
      </section>

      {/* Where the money is today — across ALL departments */}
      <section className="boss-card p-4 rounded-2xl border border-cyan-900/40 bg-cyan-950/10">
        <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-2">
          <Wallet className="w-3.5 h-3.5 text-cyan-400" /> Where the money is today (all departments)
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-3">
            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Sold today</p>
            <p className="text-base font-black text-white font-display">{formatCurrency(allCollectedToday)}</p>
          </div>
          <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-3">
            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Float (on MoMo)</p>
            <p className="text-base font-black text-emerald-400 font-display">{formatCurrency(allFloatOut)}</p>
          </div>
          <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-3">
            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Cash (kept)</p>
            <p className="text-base font-black text-zinc-300 font-display">{formatCurrency(allCashOut)}</p>
          </div>
          <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-3">
            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">To Owner (Mike)</p>
            <p className="text-base font-black text-amber-400 font-display">{formatCurrency(allOwnerOut)}</p>
          </div>
        </div>
        <p className="text-[10px] text-zinc-600 mt-2">
          Unaccounted balance (sold − moved out): <span className="text-gold-brand font-black">{formatCurrency(allCollectedToday - (allFloatOut + allCashOut + allOwnerOut))}</span> — still in the drawers.
        </p>

        {/* Reconciliation: who sold, moved, and where it should still be, per dept */}
        <div className="mt-3 overflow-x-auto no-scrollbar">
          <table className="w-full text-[10px] font-bold uppercase">
            <thead>
              <tr className="text-zinc-500">
                <th className="text-left py-1.5 pr-2">Department</th>
                <th className="text-right px-2">Sold</th>
                <th className="text-right px-2 text-emerald-500">Float</th>
                <th className="text-right px-2 text-zinc-300">Cash</th>
                <th className="text-right px-2 text-amber-400">Owner</th>
                <th className="text-right pl-2 text-gold-brand">In drawers</th>
              </tr>
            </thead>
            <tbody>
              {segments.map(cat => {
                const sold = todayCollectedByCategory[cat] || 0;
                const m = todayMoneyOutByCat[cat] || { float: 0, cash: 0, owner: 0 };
                const left = sold - m.float - m.cash - m.owner;
                return (
                  <tr key={cat} className={`border-t border-white/5 ${cat === selected ? 'text-white' : 'text-zinc-400'}`}>
                    <td className="py-1.5 pr-2">{cat}</td>
                    <td className="text-right px-2">{formatCurrency(sold)}</td>
                    <td className="text-right px-2 text-emerald-400">{formatCurrency(m.float)}</td>
                    <td className="text-right px-2 text-zinc-300">{formatCurrency(m.cash)}</td>
                    <td className="text-right px-2 text-amber-400">{formatCurrency(m.owner)}</td>
                    <td className="text-right pl-2 font-black">{formatCurrency(Math.max(0, left))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ============ DAILY BALANCE / CLOSE-OUT (daily-make only: made-sold-lost means nothing without production) ============ */}
      {showProduction && (
      <section id="close-balance" className="boss-card p-5 rounded-2xl scroll-mt-20">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-gold-brand" /> Daily Balance & Close-Out
          </h3>
          <div className="flex items-center gap-2">
            <input type="date" value={balanceDate} max={todayStr()} onChange={e => setBalanceDate(e.target.value || todayStr())}
              className="bg-zinc-900 border border-zinc-800 text-white rounded-lg h-9 px-2 text-xs outline-none focus:border-gold-brand" />
          </div>
        </div>

        {balanceRows.length === 0 ? (
          <div className="text-center py-6">
            <CalendarDays className="w-9 h-9 text-gold-brand/40 mx-auto mb-2" />
            <p className="text-xs text-zinc-500 font-bold uppercase">No {selected} items made, sold or in stock on this day</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[9px] uppercase tracking-widest text-zinc-500">
                    <th className="text-left py-1.5 pr-2 font-bold">Item</th>
                    <th className="text-right py-1.5 px-2 font-bold text-amber-400">Made</th>
                    <th className="text-right py-1.5 px-2 font-bold text-emerald-400">Sold</th>
                    <th className="text-right py-1.5 px-2 font-bold text-rose-400">Lost</th>
                    <th className="text-right py-1.5 px-2 font-bold text-amber-400">Carried</th>
                    <th className="text-right py-1.5 px-2 font-bold text-cyan-400">On-hand</th>
                    <th className="text-right py-1.5 pl-2 font-bold">Check</th>
                  </tr>
                </thead>
                <tbody>
                  {balanceRows.map(({ product, made, sold, lost, carried, onHand, recon }) => {
                    const status = recon > 0 ? 'miss' : recon < 0 ? 'fromStock' : 'ok';
                    return (
                      <tr key={product.id} className="border-t border-white/5">
                        <td className="py-2 pr-2 font-bold text-white truncate max-w-[120px]">{product.name}</td>
                        <td className="py-2 px-2 text-right font-mono text-amber-400">{made || '—'}</td>
                        <td className="py-2 px-2 text-right font-mono text-emerald-400">{sold || '—'}</td>
                        <td className="py-2 px-2 text-right font-mono text-rose-400">{lost || '—'}</td>
                        <td className="py-2 px-2 text-right font-mono text-amber-300">{carried || '—'}</td>
                        <td className="py-2 px-2 text-right font-mono text-cyan-400">{onHand}</td>
                        <td className="py-2 pl-2 text-right">
                          {status === 'ok' ? (
                            <span className="text-emerald-400 font-black">✓</span>
                          ) : status === 'miss' ? (
                            <span className="text-amber-400 font-black" title={`${recon} made but not sold, lost, or carried`}>+{recon}</span>
                          ) : (
                            <span className="text-zinc-500 font-bold" title="Sold more than made — covered from earlier stock">−{Math.abs(recon)}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalShrinkage > 0 && (
              <div className="mt-3 bg-amber-950/30 border border-amber-600/30 rounded-xl px-3 py-2.5 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <p className="text-[11px] font-bold text-amber-300 uppercase">
                  {totalShrinkage} item{totalShrinkage !== 1 ? 's' : ''} produced but not sold, lost, or carried — check for shrinkage
                </p>
              </div>
            )}
          </>
        )}
      </section>
      )}

      {/* ============ 1. ABABANJIBWA SENTE ============ */}
      <section className="boss-card p-5 rounded-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
            <Users className="w-4 h-4 text-emerald-400" /> Ababanjibwa Sente
          </h3>
          <button onClick={() => setShowCreditForm(v => !v)}
            className="flex items-center gap-1 text-[10px] bg-emerald-600/20 text-emerald-400 border border-emerald-600/40 rounded-lg px-2.5 py-1.5 font-black uppercase tracking-wider cursor-pointer touch-target">
            <Plus className="w-3.5 h-3.5" /> {showCreditForm ? 'Close' : 'Add Credit'}
          </button>
        </div>

        {showCreditForm && (
          <div className="bg-zinc-950/60 border border-emerald-600/20 rounded-xl p-4 space-y-3 mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Customer Name</label>
                <input type="text" value={creditName} onChange={e => setCreditName(e.target.value)}
                  placeholder="e.g. Nakato Sarah" autoFocus
                  className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Date</label>
                <input type="date" value={creditDate} onChange={e => setCreditDate(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-emerald-500" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Item Taken</label>
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
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Number Taken</label>
                <input type="number" min="1" value={creditQty} onChange={e => setCreditQty(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Unit Price</label>
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
                <Check className="w-4 h-4" /> Save Credit
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
                  Record Payment
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
      </section>

      {/* ============ 2. REMAINING / EXPIRED (LOSES) ============ */}
      <section id="close-losses" className="boss-card p-5 rounded-2xl scroll-mt-20">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
            <PackageX className="w-4 h-4 text-rose-400" /> Remaining / Expired (Losses)
          </h3>
          <button onClick={() => setShowWasteForm(v => !v)}
            className="flex items-center gap-1 text-[10px] bg-rose-600/20 text-rose-400 border border-rose-600/40 rounded-lg px-2.5 py-1.5 font-black uppercase tracking-wider cursor-pointer touch-target">
            <Plus className="w-3.5 h-3.5" /> {showWasteForm ? 'Close' : 'Log Loss'}
          </button>
        </div>

        {showWasteForm && (
          <div className="bg-zinc-950/60 border border-rose-600/20 rounded-xl p-4 space-y-3 mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Item</label>
                <select value={wasteItem} onChange={e => selectOnChange(e.target.value, setWasteCustomItem, setWasteItem, setWasteCost, setWasteProductId)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none font-bold" autoFocus>
                  <option value="">Select item...</option>
                  {catProducts.map(p => <option key={p.id} value={p.name}>{p.name} — cost {formatCurrency(p.cost)}</option>)}
                  <option value="__custom">Other / custom item...</option>
                </select>
                {wasteItem === '__custom' && (
                  <input type="text" value={wasteCustomItem} onChange={e => setWasteCustomItem(e.target.value)}
                    placeholder="Type the item name..." autoFocus
                    className="mt-2 w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-rose-500" />
                )}
              </div>
              <div>
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Date</label>
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
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Reason</label>
                <div className="flex gap-2">
                  <button onClick={() => setWasteReason('remaining')}
                    className={`flex-1 h-11 rounded-xl text-xs font-black uppercase tracking-wider border cursor-pointer transition-all ${wasteReason === 'remaining' ? 'bg-amber-600/20 border-amber-500/50 text-amber-400' : 'bg-zinc-900 border-zinc-800 text-zinc-500'}`}>
                    Remaining
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
                {wasteReason === 'remaining' ? 'Carried value: ' : 'Loss value: '}
                <span className={`${wasteReason === 'remaining' ? 'text-amber-300' : 'text-rose-400'} font-black text-base`}>{formatCurrency((parseInt(wasteQty, 10) || 0) * (parseFloat(wasteCost) || 0))}</span>
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
                    <p className="text-[10px] text-zinc-500 font-bold uppercase">{formatDay(w.date)} • {w.qty} × {formatCurrency(w.costEach)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {w.reason === 'remaining' ? (
                    <p className="text-sm font-black text-amber-300 font-display" title="Carried to tomorrow — not a loss">{formatCurrency(w.lossAmount)} →</p>
                  ) : (
                    <p className="text-sm font-black text-rose-400 font-display">-{formatCurrency(w.lossAmount)}</p>
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
      </section>

      {/* ============ 3. MONEY OUT — mobile money / owner / float ============ */}
      <section id="close-money" className="boss-card p-5 rounded-2xl scroll-mt-20">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-cyan-400" /> Money Out (who took it & where)
          </h3>
          <button onClick={() => setShowMomoForm(v => !v)}
            className="flex items-center gap-1 text-[10px] bg-cyan-600/20 text-cyan-400 border border-cyan-600/40 rounded-lg px-2.5 py-1.5 font-black uppercase tracking-wider cursor-pointer touch-target">
            <Plus className="w-3.5 h-3.5" /> {showMomoForm ? 'Close' : 'Record Money Out'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-3">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Collected today</p>
            <p className="text-base font-black text-cyan-400 font-display">{formatCurrency(collectedToday)}</p>
          </div>
          <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-3">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Moved out today</p>
            <p className="text-base font-black text-emerald-400 font-display">{formatCurrency(sentToday)}</p>
          </div>
          <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-3">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Float (on MoMo)</p>
            <p className="text-base font-black text-emerald-400 font-display">{formatCurrency(floatOutToday)}</p>
          </div>
          <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-3">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Cash / Owner</p>
            <p className="text-base font-black text-amber-400 font-display">{formatCurrency(cashOutToday + ownerOutToday)}</p>
          </div>
        </div>

        {/* Daily capital: yesterday's closing auto-carries as today's opening.
            Set tonight's keep-aside — tomorrow opens with it. */}
        {onSetEodCapital && (
          <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-3 mb-3">
            <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">
              Capital chain — {selected} (opening {formatCurrency(smartCash.openingCapital)} → closing for tomorrow)
            </label>
            <div className="flex items-center gap-2">
              <input type="number" min="0" step="1000" inputMode="numeric"
                value={capForSelected || ''}
                onChange={(e) => {
                  const v = Math.max(0, parseInt(e.target.value || '0', 10) || 0);
                  try { setClosingCapital(todayKey, selected, v); } catch {}
                  onSetEodCapital(selected, v);
                }}
                placeholder="e.g. 10000 kept in drawer"
                className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-10 px-3 text-sm outline-none focus:border-gold-brand font-bold" />
            </div>
            <p className="text-[10px] text-zinc-500 font-bold uppercase mt-1.5">
              Yesterday left {formatCurrency(smartCash.openingCapital)} → today opens with it. Buy ingredients from it and the drawer math above tracks where it went.
            </p>
            {collectedToday > 0 && capForSelected > 0 && (
              <p className="text-[10px] text-gold-brand font-bold uppercase mt-1.5">
                Keep {formatCurrency(capForSelected)} as capital → send profit of approx {formatCurrency(profitToSend)}
              </p>
            )}
            {collectedToday > 0 && capForSelected === 0 && (
              <p className="text-[10px] text-zinc-500 font-bold uppercase mt-1.5">
                No capital set — the full {formatCurrency(collectedToday)} is treated as sendable profit.
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
              <div className="grid grid-cols-3 gap-1.5">
                {MONEY_DEST.map(d => (
                  <button key={d.key} onClick={() => setMomoDest(d.key)}
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
            <div>
              <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Amount (UGX)</label>
              <input type="number" min="0" value={momoAmount}
                onChange={(e) => setMomoAmount(e.target.value)}
                placeholder={String(collectedToday)}
                className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-cyan-500 font-bold" />
              {collectedToday > 0 && (
                <button onClick={() => setMomoAmount(String(collectedToday))}
                  className="mt-1 text-[10px] text-cyan-400 font-bold uppercase tracking-wider cursor-pointer">
                  Use collected total {formatCurrency(collectedToday)}
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
            <p className="text-xs text-zinc-500 font-bold uppercase">No money out recorded for {selected}</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {catMomoTransfers.slice(0, 100).map(t => {
              const d = MONEY_DEST.find(x => x.key === (t.to || 'float'));
              return (
                <div key={t.id} className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-emerald-400 font-display">{formatCurrency(t.amount)}
                      <span className="ml-2 text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{d?.icon} {d?.label}</span>
                    </p>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase">
                      {formatDay(t.createdAt)}{t.sentBy ? ` • by ${t.sentBy}` : ''}
                    </p>
                    {t.comment && <p className="text-[11px] text-zinc-400 mt-0.5 truncate">{t.comment}</p>}
                  </div>
                  <button onClick={() => { onDeleteMomoTransfer(t.id); triggerToast('Entry deleted', 'info'); }}
                    className="p-1.5 text-zinc-600 hover:text-rose-400 rounded-lg hover:bg-rose-950/30 cursor-pointer shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

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
                <Wallet className="w-4 h-4 text-emerald-400" /> Record Payment
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
