// Tailor TODAY home: the tailoring operating surface. Today's orders,
// balances still due, and work ready for collection — composed read-only
// from the orders engine. It never writes except through the engine's own
// actions (new order, settle balance), so deposits and handovers stay
// single-source with Reports and the drawer.
import { useEffect, useMemo, useState } from 'react';
import { Scissors, ArrowRightLeft, Plus, HandCoins } from 'lucide-react';
import type { TailoringOrder } from '../types';
import { tailoringOrderApi } from '../api';
import { todayLocalKey } from '../utils/dates';

interface TailorHomeProps {
  formatCurrency: (val: number) => string;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  onBackSell: () => void;
  onNewOrder: () => void;
  onOpenBook: () => void;
}

export default function TailorHome({
  formatCurrency, triggerToast, onBackSell, onNewOrder, onOpenBook,
}: TailorHomeProps) {
  const [orders, setOrders] = useState<TailoringOrder[]>([]);
  useEffect(() => {
    let live = true;
    tailoringOrderApi.list()
      .then(l => { if (live) setOrders(Array.isArray(l) ? l : []); })
      .catch(() => { if (live) triggerToast('Could not load orders — showing cached view', 'error'); });
    return () => { live = false; };
  }, [triggerToast]);

  const today = todayLocalKey();
  const open = useMemo(
    () => orders.filter(o => o.status === 'pending' || o.status === 'in_progress'),
    [orders],
  );
  const ready = useMemo(
    () => orders.filter(o => o.status === 'completed'),
    [orders],
  );
  const dueToday = useMemo(
    () => orders.filter(o => (o.status === 'pending' || o.status === 'in_progress') && (o.expectedDate || '').slice(0, 10) <= today),
    [orders, today],
  );
  const balanceDue = useMemo(
    () => open.reduce((s, o) => s + Math.max(0, (o.totalAmount || 0) - (o.depositPaid || 0)), 0),
    [open],
  );

  return (
    <div className="space-y-4" aria-label="Tailoring today">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-amber-950/40 border border-amber-800/40 flex items-center justify-center">
          <Scissors className="w-5 h-5 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-black text-white uppercase tracking-tight font-display">Today — Tailoring</h2>
          <p className="text-xs text-zinc-500 font-bold">Orders • balances due • ready</p>
        </div>
        <button onClick={onBackSell}
          className="shrink-0 h-10 px-4 bg-gold-brand text-black rounded-xl text-xs font-black uppercase tracking-wider active:scale-95 transition-all cursor-pointer">
          Sell
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="boss-card p-3 border-l-4 border-l-amber-500">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Being sewn</p>
          <p className="text-lg font-black text-white font-display mt-1 tabular-nums">{open.length || '—'}</p>
          {dueToday.length > 0 && (
            <p className="text-[10px] text-amber-300 font-bold uppercase">{dueToday.length} due</p>
          )}
        </div>
        <div className="boss-card p-3 border-l-4 border-l-emerald-500">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Ready to collect</p>
          <p className="text-lg font-black text-emerald-400 font-display mt-1 tabular-nums">{ready.length || '—'}</p>
        </div>
        <div className="boss-card p-3 border-l-4 border-l-gold-brand col-span-2">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-1">
            <HandCoins className="w-3 h-3" /> Balances still due
          </p>
          <p className="text-lg font-black text-white font-display mt-1 tabular-nums">{formatCurrency(balanceDue)}</p>
        </div>
      </div>

      {ready.length > 0 && (
        <div className="space-y-1.5">
          {ready.slice(0, 4).map(o => (
            <div key={o.id} className="bg-zinc-900/50 border border-emerald-800/40 rounded-xl px-3 py-2 flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-white truncate min-w-0">{o.customerName} — {o.workDescription || o.workType}</p>
              <p className="text-xs font-black text-emerald-400 tabular-nums shrink-0">{formatCurrency(Math.max(0, (o.totalAmount || 0) - (o.depositPaid || 0)))}</p>
            </div>
          ))}
        </div>
      )}

      <button onClick={onNewOrder}
        className="w-full h-12 bg-gold-brand text-black rounded-xl text-sm font-black uppercase tracking-widest hover:opacity-90 active:scale-[0.99] transition-all cursor-pointer flex items-center justify-center gap-2">
        <Plus className="w-4 h-4" /> New order
      </button>
      <button onClick={onOpenBook}
        className="w-full h-10 bg-[#141414] border border-white/10 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all cursor-pointer">
        Open book
      </button>
      <button onClick={onBackSell}
        className="w-full h-10 bg-[#141414] border border-white/10 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer">
        <ArrowRightLeft className="w-4 h-4" /> Back to products
      </button>
    </div>
  );
}
