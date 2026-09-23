// Repair TODAY home: the workshop bench surface. What's in shop, what's
// ready for collection, and balances still due — composed read-only from
// the repair-jobs engine. It never writes except through the engine's own
// actions (new intake, settle collection), so deposits and parts stay
// single-source with Reports and the drawer.
import { useEffect, useMemo, useState } from 'react';
import { Wrench, ArrowRightLeft, Plus, HandCoins } from 'lucide-react';
import type { RepairJob } from '../types';
import { repairJobApi } from '../api';

interface RepairHomeProps {
  formatCurrency: (val: number) => string;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  onBackSell: () => void;
  onOpenBook: () => void;
}

export default function RepairHome({
  formatCurrency, triggerToast, onBackSell, onOpenBook,
}: RepairHomeProps) {
  const [jobs, setJobs] = useState<RepairJob[]>([]);
  useEffect(() => {
    let live = true;
    repairJobApi.list()
      .then(l => { if (live) setJobs(Array.isArray(l) ? l : []); })
      .catch(() => { if (live) triggerToast('Could not load repairs — showing cached view', 'error'); });
    return () => { live = false; };
  }, [triggerToast]);

  const inShop = useMemo(
    () => jobs.filter(r => r.status === 'received' || r.status === 'in_progress'),
    [jobs],
  );
  const ready = useMemo(
    () => jobs.filter(r => r.status === 'ready'),
    [jobs],
  );
  const balanceDue = useMemo(
    () => jobs
      .filter(r => r.status !== 'collected')
      .reduce((s, r) => s + Math.max(0, (r.price || 0) - (r.deposit || 0)), 0),
    [jobs],
  );

  return (
    <div className="space-y-4" aria-label="Repairs today">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-orange-950/40 border border-orange-800/40 flex items-center justify-center">
          <Wrench className="w-5 h-5 text-orange-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-black text-white uppercase tracking-tight font-display">Today — Repairs</h2>
          <p className="text-xs text-zinc-500 font-bold">Bench • ready • balances due</p>
        </div>
        <button onClick={onBackSell}
          className="shrink-0 h-10 px-4 bg-gold-brand text-black rounded-xl text-xs font-black uppercase tracking-wider active:scale-95 transition-all cursor-pointer">
          Sell
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="boss-card p-3 border-l-4 border-l-orange-500">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">On the bench</p>
          <p className="text-lg font-black text-white font-display mt-1 tabular-nums">{inShop.length || '—'}</p>
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
          {ready.slice(0, 4).map(r => (
            <div key={r.id} className="bg-zinc-900/50 border border-emerald-800/40 rounded-xl px-3 py-2 flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-white truncate min-w-0">{r.customerName} — {r.itemLabel}</p>
              <p className="text-xs font-black text-emerald-400 tabular-nums shrink-0">{formatCurrency(Math.max(0, (r.price || 0) - (r.deposit || 0)))}</p>
            </div>
          ))}
        </div>
      )}

      <button onClick={onOpenBook}
        className="w-full h-12 bg-gold-brand text-black rounded-xl text-sm font-black uppercase tracking-widest hover:opacity-90 active:scale-[0.99] transition-all cursor-pointer flex items-center justify-center gap-2">
        <Plus className="w-4 h-4" /> New intake / open book
      </button>
      <button onClick={onBackSell}
        className="w-full h-10 bg-[#141414] border border-white/10 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer">
        <ArrowRightLeft className="w-4 h-4" /> Back to products
      </button>
    </div>
  );
}
