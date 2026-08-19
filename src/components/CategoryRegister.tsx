import { useEffect, useMemo, useState } from 'react';
import {
  Users, ChefHat, PackageX, Plus, Trash2, X,
  Check, Wallet, AlertTriangle, Coins, LayoutGrid, Smartphone, CalendarDays, ArrowRightLeft
} from 'lucide-react';
import type { CreditEat, ProductionRegister, WastageLog, Product, MomoTransfer, Sale } from '../types';
import { localDayKey, localMonthKey, todayLocalKey } from '../utils/dates';

interface CategoryRegisterProps {
  segments: string[];
  products: Product[];
  sales: Sale[];
  creditEats: CreditEat[];
  productionRegisters: ProductionRegister[];
  wastageLogs: WastageLog[];
  momoTransfers: MomoTransfer[];
  onAddCreditEat: (e: CreditEat) => void;
  onPayCreditEat: (id: string, amount: number) => void;
  onAddProduction: (p: ProductionRegister) => void;
  onDeleteProduction: (id: string) => void;
  onAddWastage: (w: WastageLog) => void;
  onDeleteWastage: (id: string) => void;
  onAddMomoTransfer: (t: MomoTransfer) => void;
  onDeleteMomoTransfer: (id: string) => void;
  formatCurrency: (val: number) => string;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  onBack?: () => void;
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
  segments, products, sales, creditEats, productionRegisters, wastageLogs,
  momoTransfers,
  onAddCreditEat, onPayCreditEat, onAddProduction, onDeleteProduction,
  onAddWastage, onDeleteWastage, onAddMomoTransfer, onDeleteMomoTransfer,
  formatCurrency, triggerToast, onBack,
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

  const [showCreditForm, setShowCreditForm] = useState(false);
  const [creditName, setCreditName] = useState('');
  const [creditDate, setCreditDate] = useState(todayStr());
  const [creditItem, setCreditItem] = useState('');
  const [creditCustomItem, setCreditCustomItem] = useState('');
  const [creditQty, setCreditQty] = useState('1');
  const [creditPrice, setCreditPrice] = useState('');

  const [showProdForm, setShowProdForm] = useState(false);
  const [prodDate, setProdDate] = useState(todayStr());
  const [prodItem, setProdItem] = useState('');
  const [prodCustomItem, setProdCustomItem] = useState('');
  const [prodProductId, setProdProductId] = useState<string | null>(null);
  const [prodQty, setProdQty] = useState('');
  const [prodCost, setProdCost] = useState('');

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

  const filteredProduction = useMemo(() => catProduction.filter(p => timeRange.filter(p.date)), [catProduction, timeRange]);
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

  // Daily close-out: for each dish, produced - sold - lost on the chosen day.
  // A positive remainder is stock that "vanished" (shrinkage); negative means
  // sales were covered from earlier production (normal when leftover existed).
  const balanceRows = useMemo(() => {
    const daySales = sales.filter(s => !s.refunded && localDayKey(s.timestamp) === balanceDate);
    return catProducts.map(p => {
      const made = catProduction.filter(x => x.productId === p.id && x.date === balanceDate)
        .reduce((s, x) => s + (x.qty || 0), 0);
      const lost = catWastage.filter(x => x.productId === p.id && x.date === balanceDate)
        .reduce((s, x) => s + (x.qty || 0), 0);
      const sold = daySales.flatMap(s => s.items)
        .filter(i => i.productId === p.id)
        .reduce((s, i) => s + (i.qty || 0), 0);
      return { product: p, made, sold, lost, onHand: p.stockQty || 0, recon: made - sold - lost };
    }).filter(r => r.made + r.sold + r.lost > 0 || r.onHand > 0);
  }, [catProducts, catProduction, catWastage, sales, balanceDate]);

  const totalShrinkage = useMemo(() => balanceRows.reduce((s, r) => s + Math.max(0, r.recon), 0), [balanceRows]);

  const [payId, setPayId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');

  const [showMomoForm, setShowMomoForm] = useState(false);
  const [momoAmount, setMomoAmount] = useState('');
  const [momoComment, setMomoComment] = useState('');

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

  // ---- Production ----
  const prodTotal = (q: string, c: string) => Math.round((parseInt(q, 10) || 0) * (parseFloat(c) || 0));
  const todayProdCost = catProduction.filter(p => p.date === todayStr()).reduce((s, p) => s + p.total, 0);

  const handleSubmitProduction = () => {
    const item = activeItem(catProducts.map(p => p.name), prodCustomItem, prodItem);
    if (!item) { triggerToast('Select the item', 'error'); return; }
    const qty = parseInt(prodQty, 10) || 0;
    if (qty <= 0) { triggerToast('Enter the number made', 'error'); return; }
    const cost = parseFloat(prodCost) || 0;
    if (cost <= 0) { triggerToast('Enter the cost price each', 'error'); return; }
    onAddProduction({
      id: `pr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date: prodDate,
      item,
      category: selected,
      productId: prodProductId || undefined,
      qty,
      costEach: cost,
      total: Math.round(qty * cost),
    });
    triggerToast(`Production logged: ${qty} × ${item}`, 'success');
    setProdItem(''); setProdCustomItem(''); setProdProductId(null); setProdQty(''); setProdCost('');
    setShowProdForm(false);
  };

  // ---- Wastage ----
  const todayWastage = catWastage.filter(w => w.date === todayStr()).reduce((s, w) => s + w.lossAmount, 0);

  // ---- Mobile Money ----
  const collectedToday = todayCollectedByCategory[selected] || 0;
  const sentToday = momoTransfers
    .filter(t => t.category === selected && localDayKey(t.createdAt) === todayStr())
    .reduce((s, t) => s + t.amount, 0);
  const catMomoTransfers = momoTransfers.filter(t => t.category === selected);

  const handleSubmitMomo = () => {
    const amt = Math.round(parseFloat(momoAmount) || 0);
    if (amt <= 0) { triggerToast('Enter the amount you sent', 'error'); return; }
    onAddMomoTransfer({
      id: `mt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      category: selected,
      amount: amt,
      comment: momoComment.trim(),
      createdAt: new Date().toISOString(),
    });
    triggerToast(`Confirmed: ${formatCurrency(amt)} sent to Mobile Money`, 'success');
    setMomoAmount('');
    setMomoComment('');
    setShowMomoForm(false);
  };

  const handleSubmitWastage = () => {
    const item = activeItem(catProducts.map(p => p.name), wasteCustomItem, wasteItem);
    if (!item) { triggerToast('Select the item', 'error'); return; }
    const qty = parseInt(wasteQty, 10) || 0;
    if (qty <= 0) { triggerToast('Enter how many were lost', 'error'); return; }
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
    triggerToast('Loss logged', 'success');
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
          <h2 className="text-lg font-black text-white uppercase tracking-tight font-display">Registers</h2>
          <p className="text-xs text-zinc-500 font-bold">Credit • Daily production • Losses</p>
        </div>
      </div>
      {onBack && (
        <button onClick={onBack}
          className="h-10 px-4 bg-[#141414] border border-white/10 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer touch-target">
          <ArrowRightLeft className="w-4 h-4" /> Back to Reports
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
        <div className="boss-card p-3 border-l-4 border-l-amber-500">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Made today</p>
          <p className="text-lg font-black text-white font-display mt-1">{formatCurrency(todayProdCost)}</p>
        </div>
        <div className="boss-card p-3 border-l-4 border-l-rose-500">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Lost today</p>
          <p className="text-lg font-black text-rose-400 font-display mt-1">{formatCurrency(todayWastage)}</p>
        </div>
        <div className="boss-card p-3 border-l-4 border-l-emerald-500">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Outstanding</p>
          <p className="text-lg font-black text-emerald-400 font-display mt-1">{formatCurrency(outstanding)}</p>
        </div>
        <div className="boss-card p-3 border-l-4 border-l-cyan-500 col-span-3 sm:col-span-1">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Collected today</p>
          <p className="text-lg font-black text-cyan-400 font-display mt-1">{formatCurrency(collectedToday)}</p>
          <p className="text-[10px] text-zinc-500 font-bold uppercase mt-0.5">
            Sent to MoMo: <span className="text-emerald-400 font-black">{formatCurrency(sentToday)}</span>
          </p>
        </div>
      </section>

      {/* ============ DAILY BALANCE / CLOSE-OUT ============ */}
      <section className="boss-card p-5 rounded-2xl">
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
                    <th className="text-right py-1.5 px-2 font-bold text-cyan-400">On-hand</th>
                    <th className="text-right py-1.5 pl-2 font-bold">Check</th>
                  </tr>
                </thead>
                <tbody>
                  {balanceRows.map(({ product, made, sold, lost, onHand, recon }) => {
                    const status = recon > 0 ? 'miss' : recon < 0 ? 'fromStock' : 'ok';
                    return (
                      <tr key={product.id} className="border-t border-white/5">
                        <td className="py-2 pr-2 font-bold text-white truncate max-w-[120px]">{product.name}</td>
                        <td className="py-2 px-2 text-right font-mono text-amber-400">{made || '—'}</td>
                        <td className="py-2 px-2 text-right font-mono text-emerald-400">{sold || '—'}</td>
                        <td className="py-2 px-2 text-right font-mono text-rose-400">{lost || '—'}</td>
                        <td className="py-2 px-2 text-right font-mono text-cyan-400">{onHand}</td>
                        <td className="py-2 pl-2 text-right">
                          {status === 'ok' ? (
                            <span className="text-emerald-400 font-black">✓</span>
                          ) : status === 'miss' ? (
                            <span className="text-amber-400 font-black" title={`${recon} made but not sold/lost`}>+{recon}</span>
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
                  {totalShrinkage} item{totalShrinkage !== 1 ? 's' : ''} produced but not sold or lost — check for shrinkage
                </p>
              </div>
            )}
          </>
        )}
      </section>

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
            {openCredits.map(c => (
              <div key={c.id} className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-white truncate">{c.customerName}</p>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase truncate">
                      {formatDay(c.date)} • {c.qty}× {c.item}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-black text-emerald-400 font-display">{formatCurrency(c.total - c.paidAmount)}</p>
                    <p className="text-[10px] text-zinc-500 font-bold">due of {formatCurrency(c.total)}</p>
                  </div>
                </div>
                <button onClick={() => { setPayId(c.id); setPayAmount(String(c.total - c.paidAmount)); }}
                  className="mt-2 w-full h-9 bg-emerald-600/15 text-emerald-400 border border-emerald-600/30 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-emerald-600/25 cursor-pointer">
                  Record Payment
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ============ 2. DAILY PRODUCTION ============ */}
      <section className="boss-card p-5 rounded-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
            <ChefHat className="w-4 h-4 text-amber-400" /> Daily Production
          </h3>
          <button onClick={() => setShowProdForm(v => !v)}
            className="flex items-center gap-1 text-[10px] bg-amber-600/20 text-amber-400 border border-amber-600/40 rounded-lg px-2.5 py-1.5 font-black uppercase tracking-wider cursor-pointer touch-target">
            <Plus className="w-3.5 h-3.5" /> {showProdForm ? 'Close' : 'Register'}
          </button>
        </div>

        {showProdForm && (
          <div className="bg-zinc-950/60 border border-amber-600/20 rounded-xl p-4 space-y-3 mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Item Made</label>
                <select value={prodItem} onChange={e => selectOnChange(e.target.value, setProdCustomItem, setProdItem, setProdCost, setProdProductId)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none font-bold" autoFocus>
                  <option value="">Select item...</option>
                  {catProducts.map(p => <option key={p.id} value={p.name}>{p.name} — cost {formatCurrency(p.cost)}</option>)}
                  <option value="__custom">Other / custom item...</option>
                </select>
                {prodItem === '__custom' && (
                  <input type="text" value={prodCustomItem} onChange={e => setProdCustomItem(e.target.value)}
                    placeholder="Type the item name..." autoFocus
                    className="mt-2 w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-amber-500" />
                )}
              </div>
              <div>
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Date</label>
                <input type="date" value={prodDate} onChange={e => setProdDate(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-amber-500" />
              </div>
              <div>
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Number Made</label>
                <input type="number" min="1" value={prodQty} onChange={e => setProdQty(e.target.value)}
                  placeholder="e.g. 100" className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-amber-500" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Cost Price Each</label>
                <input type="number" min="0" value={prodCost} onChange={e => setProdCost(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-amber-500" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-zinc-400 uppercase">
                Total cost: <span className="text-amber-400 font-black text-base">{formatCurrency(prodTotal(prodQty, prodCost))}</span>
              </p>
              <button onClick={handleSubmitProduction}
                className="h-11 px-5 bg-amber-600 hover:bg-amber-500 text-black font-black uppercase tracking-widest text-xs rounded-xl cursor-pointer active:scale-95 transition-all flex items-center gap-1.5">
                <Check className="w-4 h-4" /> Save Production
              </button>
            </div>
          </div>
        )}

        {catProduction.length === 0 ? (
          <div className="text-center py-8">
            <ChefHat className="w-10 h-10 text-amber-500 mx-auto mb-2 opacity-40" />
            <p className="text-xs text-zinc-500 font-bold uppercase">No production registered in {selected}</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {filteredProduction.map(p => (
              <div key={p.id} className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-black text-white truncate">{p.item}</p>
                  <p className="text-[10px] text-zinc-500 font-bold uppercase">{formatDay(p.date)}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-black text-amber-400 font-display">{formatCurrency(p.total)}</p>
                    <p className="text-[10px] text-zinc-500 font-bold">{p.qty} × {formatCurrency(p.costEach)}</p>
                  </div>
                  <button onClick={() => { onDeleteProduction(p.id); triggerToast('Production entry deleted', 'info'); }}
                    className="p-1.5 text-zinc-600 hover:text-rose-400 rounded-lg hover:bg-rose-950/30 cursor-pointer">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ============ 3. REMAINING / EXPIRED (LOSES) ============ */}
      <section className="boss-card p-5 rounded-2xl">
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
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">How Many Lost</label>
                <input type="number" min="1" value={wasteQty} onChange={e => setWasteQty(e.target.value)}
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
                Loss value: <span className="text-rose-400 font-black text-base">{formatCurrency((parseInt(wasteQty, 10) || 0) * (parseFloat(wasteCost) || 0))}</span>
              </p>
              <button onClick={handleSubmitWastage}
                className="h-11 px-5 bg-rose-600 hover:bg-rose-500 text-white font-black uppercase tracking-widest text-xs rounded-xl cursor-pointer active:scale-95 transition-all flex items-center gap-1.5">
                <Check className="w-4 h-4" /> Log Loss
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
                    <p className="text-[10px] text-zinc-500 font-bold uppercase">{formatDay(w.date)} • {w.qty} lost × {formatCurrency(w.costEach)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <p className="text-sm font-black text-rose-400 font-display">-{formatCurrency(w.lossAmount)}</p>
                  <button onClick={() => { onDeleteWastage(w.id); triggerToast('Loss entry deleted', 'info'); }}
                    className="p-1.5 text-zinc-600 hover:text-rose-400 rounded-lg hover:bg-rose-950/30 cursor-pointer">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ============ 4. SENT TO MOBILE MONEY ============ */}
      <section className="boss-card p-5 rounded-2xl">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-cyan-400" /> Sent to Mobile Money
          </h3>
          <button onClick={() => setShowMomoForm(v => !v)}
            className="flex items-center gap-1 text-[10px] bg-cyan-600/20 text-cyan-400 border border-cyan-600/40 rounded-lg px-2.5 py-1.5 font-black uppercase tracking-wider cursor-pointer touch-target">
            <Plus className="w-3.5 h-3.5" /> {showMomoForm ? 'Close' : 'Confirm Sent'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-3">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Collected today</p>
            <p className="text-base font-black text-cyan-400 font-display">{formatCurrency(collectedToday)}</p>
          </div>
          <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-3">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Sent today</p>
            <p className="text-base font-black text-emerald-400 font-display">{formatCurrency(sentToday)}</p>
          </div>
        </div>

        {showMomoForm && (
          <div className="bg-zinc-950/60 border border-cyan-600/20 rounded-xl p-4 space-y-3 mb-4">
            <p className="text-[11px] font-bold text-zinc-400 uppercase">
              Confirm the money from <span className="text-cyan-400">{selected}</span> that you sent to Mobile Money.
            </p>
            <div>
              <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Amount Sent (UGX)</label>
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
              <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Comment (optional)</label>
              <input type="text" value={momoComment} onChange={e => setMomoComment(e.target.value)}
                placeholder="e.g. Sent by MTN MoMo to 0700 000 000"
                className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-cyan-500" />
            </div>
            <button onClick={handleSubmitMomo}
              className="w-full h-11 bg-cyan-600 hover:bg-cyan-500 text-black font-black uppercase tracking-widest text-xs rounded-xl cursor-pointer active:scale-95 transition-all flex items-center justify-center gap-1.5">
              <Check className="w-4 h-4" /> Confirm Sent
            </button>
          </div>
        )}

        {catMomoTransfers.length === 0 ? (
          <div className="text-center py-6">
            <Smartphone className="w-10 h-10 text-cyan-500 mx-auto mb-2 opacity-40" />
            <p className="text-xs text-zinc-500 font-bold uppercase">No transfers confirmed for {selected}</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {catMomoTransfers.slice(0, 100).map(t => (
              <div key={t.id} className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-black text-emerald-400 font-display">{formatCurrency(t.amount)}</p>
                  <p className="text-[10px] text-zinc-500 font-bold uppercase">{formatDay(t.createdAt)}</p>
                  {t.comment && <p className="text-[11px] text-zinc-400 mt-0.5 truncate">{t.comment}</p>}
                </div>
                <button onClick={() => { onDeleteMomoTransfer(t.id); triggerToast('Transfer entry deleted', 'info'); }}
                  className="p-1.5 text-zinc-600 hover:text-rose-400 rounded-lg hover:bg-rose-950/30 cursor-pointer shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Payment modal */}
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
