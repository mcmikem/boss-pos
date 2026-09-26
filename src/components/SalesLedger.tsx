import { useEffect, useMemo, useState } from 'react';
import { Check, Flag, Clock, ArrowRightLeft } from 'lucide-react';
import type { Product, Sale } from '../types';
import { localDayKey, localMonthKey, todayLocalKey, shiftDayKey } from '../utils/dates';
import { saleChangeApi, type SaleChangeRequest } from '../api';
import { isLiveSale } from '../utils/saleStatus';
import type { TriggerToast } from './Toast';

type RangeKey = 'today' | 'yesterday' | 'week' | 'month';

const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
];

interface SalesLedgerProps {
  sales: Sale[];
  products: Product[];
  categories: string[];
  formatCurrency: (val: number) => string;
  triggerToast: TriggerToast;
  isManager: boolean;
  onChanged: () => void;
}

function inRange(sale: Sale, range: RangeKey, today: string): boolean {
  const day = localDayKey(sale.timestamp);
  if (range === 'today') return day === today;
  if (range === 'yesterday') return day === shiftDayKey(today, -1);
  if (range === 'month') return localMonthKey(sale.timestamp) === localMonthKey(new Date().toISOString());
  const ms = Date.parse(sale.timestamp);
  return Number.isFinite(ms) && ms >= Date.now() - 7 * 86400000;
}

function saleCategories(sale: Sale, products: Product[]): string[] {
  const cats = new Set<string>();
  for (const item of sale.items) {
    const prod = products.find(p => p.id === item.productId);
    if (prod?.category) cats.add(prod.category);
  }
  return [...cats];
}

function lineSummary(sale: Sale): string {
  return sale.items.slice(0, 2).map(i => `${i.productName} ×${i.qty}`).join(', ')
    + (sale.items.length > 2 ? ` +${sale.items.length - 2} more` : '');
}

export default function SalesLedger({
  sales, products, categories, formatCurrency, triggerToast, isManager, onChanged,
}: SalesLedgerProps) {
  const [range, setRange] = useState<RangeKey>('today');
  const [category, setCategory] = useState('All');
  const [bigFirst, setBigFirst] = useState(false);
  const [requests, setRequests] = useState<SaleChangeRequest[]>([]);
  const [fixSale, setFixSale] = useState<Sale | null>(null);
  const [fixVoid, setFixVoid] = useState(false);
  const [fixQty, setFixQty] = useState<Record<string, number>>({});
  const [fixReason, setFixReason] = useState('');
  const [busy, setBusy] = useState(false);
  const today = todayLocalKey();

  const refreshRequests = async () => {
    try {
      setRequests(await saleChangeApi.list());
    } catch {}
  };
  useEffect(() => { refreshRequests(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleCats = useMemo(() => {
    const inSales = new Set<string>();
    for (const s of sales) for (const c of saleCategories(s, products)) inSales.add(c);
    return categories.filter(c => inSales.has(c));
  }, [sales, products, categories]);

  const rows = useMemo(() => {
    const list = sales.filter(s => inRange(s, range, today));
    const scoped = category === 'All' ? list : list.filter(s => saleCategories(s, products).includes(category));
    return scoped.sort((a, b) => bigFirst
      ? (b.total || 0) - (a.total || 0)
      : String(b.timestamp).localeCompare(String(a.timestamp)));
  }, [sales, range, today, category, products, bigFirst]);

  const liveRows = rows.filter(isLiveSale);
  const periodTotal = liveRows.reduce((sum, s) => sum + (s.total || 0), 0);
  const pending = requests.filter(r => r.status === 'pending');
  const mine = requests.filter(r => r.status !== 'pending').slice(0, 5);

  const openFix = (sale: Sale) => {
    const qtys: Record<string, number> = {};
    for (const item of sale.items) qtys[`${item.productId}::${item.variantId || ''}`] = item.qty;
    setFixQty(qtys);
    setFixVoid(false);
    setFixReason('');
    setFixSale(sale);
  };

  const sendRequest = async () => {
    if (!fixSale) return;
    if (!fixReason.trim()) { triggerToast('Say why — the manager needs a reason', 'error'); return; }
    const lines = fixSale.items.map(item => ({
      productId: item.productId,
      variantId: item.variantId || null,
      qty: fixVoid ? 0 : Math.max(0, Math.round((fixQty[`${item.productId}::${item.variantId || ''}`] ?? item.qty) * 1000) / 1000),
    }));
    if (!fixVoid && !lines.some((l, i) => l.qty !== fixSale.items[i].qty)) {
      triggerToast('Nothing changed — adjust a quantity or choose void', 'error');
      return;
    }
    setBusy(true);
    try {
      await saleChangeApi.create({
        saleId: fixSale.id,
        kind: fixVoid ? 'void' : 'edit',
        reason: fixReason.trim(),
        lines: fixVoid ? undefined : lines,
      });
      triggerToast('Sent to a manager for approval', 'success');
      setFixSale(null);
      refreshRequests();
    } catch (err) {
      triggerToast(err instanceof Error ? err.message.slice(0, 110) : 'Could not send the request', 'error');
    } finally {
      setBusy(false);
    }
  };

  const decide = async (id: string, approve: boolean) => {
    setBusy(true);
    try {
      if (approve) await saleChangeApi.approve(id);
      else await saleChangeApi.reject(id);
      triggerToast(approve ? 'Change approved and applied' : 'Request turned down', approve ? 'success' : 'info');
      refreshRequests();
      onChanged();
    } catch (err) {
      triggerToast(err instanceof Error ? err.message.slice(0, 110) : 'Could not decide', 'error');
    } finally {
      setBusy(false);
    }
  };

  const describeRequest = (r: SaleChangeRequest): string => {
    if (r.kind === 'void') return 'Delete this sale for good';
    const lines = r.payload?.lines || [];
    const sale = r.sale;
    if (!sale) return 'Fix quantities';
    return lines.map(l => {
      const old = sale.items.find(i => i.productId === l.productId && (i.variantId || null) === (l.variantId || null));
      const name = old?.productName || l.productId;
      return `${name}: ${old?.qty ?? '?'} → ${l.qty}`;
    }).join(' · ');
  };

  return (
    <div className="space-y-4" id="sales-ledger">
      {isManager && pending.length > 0 && (
        <section className="boss-card p-4 rounded-2xl border border-amber-600/40 bg-amber-950/15" aria-label="Corrections waiting for approval">
          <p className="text-xs font-black text-amber-300 uppercase tracking-widest mb-3">
            Waiting for your approval ({pending.length})
          </p>
          <div className="space-y-2">
            {pending.map(r => (
              <div key={r.id} className="bg-black/30 border border-white/5 rounded-xl p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-black text-white truncate">
                    {r.sale?.orderNumber || r.saleId} · {r.kind === 'void' ? 'Delete sale' : 'Fix quantities'}
                  </p>
                  <p className="text-xs font-black text-gold-brand tabular-nums shrink-0">{formatCurrency(r.sale?.total || 0)}</p>
                </div>
                <p className="text-[11px] text-zinc-400 font-bold mt-1">{describeRequest(r)}</p>
                <p className="text-[10px] text-zinc-500 font-bold uppercase mt-1">
                  Asked by {r.requestedByName || 'a seller'} • {r.reason}
                </p>
                <div className="grid grid-cols-2 gap-2 mt-2.5">
                  <button onClick={() => decide(r.id, true)} disabled={busy}
                    className="h-10 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-black uppercase text-[10px] tracking-widest rounded-xl transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer">
                    <Check className="w-4 h-4" /> Approve
                  </button>
                  <button onClick={() => decide(r.id, false)} disabled={busy}
                    className="h-10 bg-zinc-900 border border-zinc-800 hover:border-rose-600/50 text-zinc-300 font-black uppercase text-[10px] tracking-widest rounded-xl transition-all active:scale-95 cursor-pointer">
                    Turn down
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="boss-card p-4 rounded-2xl" aria-label="Sales ledger">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-black text-white uppercase tracking-wider font-display">Sales</h2>
          <p className="text-xs font-black text-gold-brand tabular-nums">
            {liveRows.length} sale{liveRows.length === 1 ? '' : 's'} · {formatCurrency(periodTotal)}
          </p>
        </div>
        <div className="flex gap-1.5 mt-3 overflow-x-auto pb-1 scrollbar-none" role="group" aria-label="Period">
          {RANGES.map(r => (
            <button key={r.key} onClick={() => setRange(r.key)}
              aria-pressed={range === r.key}
              className={`h-9 px-3.5 rounded-xl text-[11px] font-black uppercase tracking-wider border whitespace-nowrap transition-all active:scale-95 cursor-pointer ${range === r.key ? 'bg-gold-brand border-gold-brand text-black' : 'bg-[#0A0A0A] border-white/5 text-zinc-400 hover:text-zinc-200'}`}>
              {r.label}
            </button>
          ))}
          <button onClick={() => setBigFirst(v => !v)} aria-pressed={bigFirst} title="Sort by size instead of time"
            className={`h-9 px-3.5 rounded-xl text-[11px] font-black uppercase tracking-wider border whitespace-nowrap transition-all active:scale-95 cursor-pointer ${bigFirst ? 'bg-gold-brand border-gold-brand text-black' : 'bg-[#0A0A0A] border-white/5 text-zinc-400 hover:text-zinc-200'}`}>
            Biggest
          </button>
        </div>
        {visibleCats.length > 1 && (
          <div className="flex gap-1.5 mt-2 overflow-x-auto pb-1 scrollbar-none" role="group" aria-label="Business area">
            {['All', ...visibleCats].map(c => (
              <button key={c} onClick={() => setCategory(c)} aria-pressed={category === c}
                className={`h-9 px-3.5 rounded-xl text-[11px] font-black uppercase tracking-wider border whitespace-nowrap transition-all active:scale-95 cursor-pointer ${category === c ? 'bg-cyan-600/20 border-cyan-500/50 text-cyan-300' : 'bg-[#0A0A0A] border-white/5 text-zinc-400 hover:text-zinc-200'}`}>
                {c}
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 space-y-2">
          {rows.length === 0 && (
            <p className="text-xs text-zinc-500 font-bold uppercase text-center py-8">No sales in this view yet</p>
          )}
          {rows.map(s => {
            const dead = !isLiveSale(s);
            return (
              <div key={s.id} className="bg-black/30 border border-white/5 rounded-xl p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-black text-white truncate">
                    {s.orderNumber}
                    <span className="text-zinc-500 font-bold"> · {new Date(s.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </p>
                  <p className={`text-sm font-black tabular-nums shrink-0 ${dead ? 'text-zinc-600 line-through' : 'text-gold-brand'}`}>
                    {formatCurrency(s.total)}
                  </p>
                </div>
                <p className="text-[11px] text-zinc-400 font-bold mt-0.5 truncate">{lineSummary(s)}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{s.paymentMethod}</span>
                  {s.staffName && <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 truncate">{s.staffName}</span>}
                  {s.refunded && <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800">Refunded</span>}
                  {s.voided && <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-zinc-700">Voided</span>}
                  {!dead && (
                    <button onClick={() => openFix(s)}
                      className="ml-auto h-8 px-3 rounded-lg text-[10px] font-black uppercase tracking-wider border border-white/10 text-zinc-300 hover:border-gold-brand/50 hover:text-gold-brand transition-all active:scale-95 cursor-pointer flex items-center gap-1">
                      <Flag className="w-3 h-3" /> {isManager ? 'Fix' : 'Ask to fix'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {!isManager && mine.length > 0 && (
        <section className="boss-card p-4 rounded-2xl" aria-label="My correction requests">
          <p className="text-xs font-black text-zinc-300 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-gold-brand" /> My requests
          </p>
          <div className="space-y-1.5">
            {mine.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-2 bg-black/30 rounded-lg px-3 py-2">
                <p className="text-[11px] font-bold text-zinc-300 truncate min-w-0">
                  {r.sale?.orderNumber || r.saleId} · {r.kind === 'void' ? 'Delete' : 'Fix quantities'}
                </p>
                <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded shrink-0 ${r.status === 'approved' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : r.status === 'rejected' ? 'bg-rose-950 text-rose-300 border border-rose-800' : 'bg-amber-950 text-amber-300 border border-amber-800'}`}>
                  {r.status === 'approved' ? 'Done' : r.status === 'rejected' ? 'Turned down' : 'Waiting'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {fixSale && (
        <div className="fixed inset-0 z-[130] bg-black/90 backdrop-blur-md flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Ask a manager to fix this sale">
          <div className="w-full max-w-md bg-[#141414] border border-gold-brand/40 rounded-3xl p-5 max-h-[92vh] overflow-y-auto">
            <p className="text-[10px] font-black text-gold-brand uppercase tracking-widest">Ask a manager</p>
            <h2 className="text-lg font-black text-white uppercase tracking-tight font-display mt-1">
              Fix {fixSale.orderNumber}
            </h2>
            <p className="text-[11px] text-zinc-500 font-bold uppercase mt-1">
              Nothing changes until a manager approves it
            </p>
            <div className="grid grid-cols-2 gap-2 mt-4 mb-3">
              <button onClick={() => setFixVoid(false)} aria-pressed={!fixVoid}
                className={`h-11 rounded-xl text-[11px] font-black uppercase tracking-wider border transition-all cursor-pointer ${!fixVoid ? 'border-gold-brand bg-gold-brand/10 text-white' : 'border-white/5 bg-[#0A0A0A] text-zinc-500'}`}>
                Fix quantities
              </button>
              <button onClick={() => setFixVoid(true)} aria-pressed={fixVoid}
                className={`h-11 rounded-xl text-[11px] font-black uppercase tracking-wider border transition-all cursor-pointer ${fixVoid ? 'border-rose-500 bg-rose-950/40 text-white' : 'border-white/5 bg-[#0A0A0A] text-zinc-500'}`}>
                Delete sale
              </button>
            </div>
            {!fixVoid && (
              <div className="space-y-2 mb-3">
                {fixSale.items.map(item => {
                  const key = `${item.productId}::${item.variantId || ''}`;
                  return (
                    <div key={key} className="flex items-center gap-2 bg-black/30 rounded-xl px-3 py-2">
                      <p className="flex-1 min-w-0 text-xs font-black text-white truncate">
                        {item.productName}{item.variantLabel ? ` (${item.variantLabel})` : ''}
                      </p>
                      <input type="number" min="0" step="any" inputMode="decimal"
                        aria-label={`${item.productName} corrected quantity`}
                        value={fixQty[key] ?? item.qty}
                        onChange={e => setFixQty(prev => ({ ...prev, [key]: Math.max(0, parseFloat(e.target.value) || 0) }))}
                        className="w-20 h-10 bg-zinc-900 border border-zinc-800 text-white rounded-lg px-2 text-right text-sm font-black tabular-nums focus:border-gold-brand outline-none" />
                    </div>
                  );
                })}
              </div>
            )}
            {fixVoid && (
              <p className="text-[11px] font-bold text-rose-300 bg-rose-950/25 border border-rose-800/40 rounded-xl px-3 py-2 mb-3">
                The whole sale goes away and the stock comes back — after approval.
              </p>
            )}
            <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest" htmlFor="fix-reason">
              Why? (the manager reads this)
            </label>
            <input id="fix-reason" type="text" value={fixReason} onChange={e => setFixReason(e.target.value)}
              placeholder="e.g. rang 3 chapatis, customer took 2"
              className="mt-1 w-full h-12 bg-zinc-900 border border-zinc-800 text-white rounded-xl px-3 text-sm font-bold focus:border-gold-brand outline-none" />
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button onClick={() => setFixSale(null)} disabled={busy}
                className="h-12 bg-zinc-900 border border-zinc-800 text-zinc-300 font-black uppercase text-xs tracking-widest rounded-xl cursor-pointer">
                Cancel
              </button>
              <button onClick={sendRequest} disabled={busy}
                className="h-12 bg-gold-brand text-black font-black uppercase text-xs tracking-widest rounded-xl hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer">
                <ArrowRightLeft className="w-4 h-4" /> {busy ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
