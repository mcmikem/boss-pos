// Restaurant TODAY home: the Eatery operating surface. Morning production,
// sold, remaining (auto-carry), waste, and money — composed read-only from
// the shared engine (production registers, sales, wastage). It never writes
// except through the engine's own actions (log production, ring sales,
// close day), so the books stay single-source.
import { useMemo } from 'react';
import { ChefHat, ArrowRightLeft, Flame, PackageX, Wallet } from 'lucide-react';
import type { Product, ProductionRegister, Sale, WastageLog } from '../types';
import { todayLocalKey } from '../utils/dates';
import { leftoverFor } from '../utils/cashflow';
import { eateryDayClose } from '../utils/eateryClose';

interface EateryHomeProps {
  products: Product[];
  productionRegisters: ProductionRegister[];
  sales: Sale[];
  wastageLogs: WastageLog[];
  formatCurrency: (val: number) => string;
  onBackSell: () => void;
  onLogProduction: () => void;
  onCloseKitchen: () => void;
}

export default function EateryHome({
  products, productionRegisters, sales, wastageLogs,
  formatCurrency, onBackSell, onLogProduction, onCloseKitchen,
}: EateryHomeProps) {
  const today = todayLocalKey();
  const rows = useMemo(
    () => leftoverFor(products, productionRegisters, sales, wastageLogs, today),
    [products, productionRegisters, sales, wastageLogs, today],
  );
  const money = useMemo(
    () => eateryDayClose(today, sales, products, []),
    [today, sales, products],
  );
  const madeToday = useMemo(
    () => productionRegisters.filter(p => p.date === today && p.category === 'Eatery'),
    [productionRegisters, today],
  );
  const expiredToday = useMemo(
    () => wastageLogs.filter(w => w.date === today && w.category === 'Eatery' && w.reason !== 'remaining'),
    [wastageLogs, today],
  );
  const expiredQty = expiredToday.reduce((s, w) => s + (w.qty || 0), 0);
  const remaining = rows.filter(r => r.leftover > 0);
  const sold = rows.filter(r => r.sold > 0);

  return (
    <div className="space-y-4" aria-label="Eatery today">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-amber-950/40 border border-amber-800/40 flex items-center justify-center">
          <ChefHat className="w-5 h-5 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-black text-white uppercase tracking-tight font-display">Today — Eatery</h2>
          <p className="text-xs text-zinc-500 font-bold">Cooked • sold • left • wasted • money</p>
        </div>
        <button onClick={onBackSell}
          className="shrink-0 h-10 px-4 bg-gold-brand text-black rounded-xl text-xs font-black uppercase tracking-wider active:scale-95 transition-all cursor-pointer">
          Sell
        </button>
      </div>

      <div className="boss-card p-4 border-l-4 border-l-amber-500">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Morning production</p>
          <button onClick={onLogProduction}
            className="text-[10px] font-black text-amber-300 uppercase tracking-wider hover:underline cursor-pointer shrink-0">
            + Log
          </button>
        </div>
        {madeToday.length === 0 ? (
          <p className="text-xs text-zinc-500 font-bold uppercase mt-1">Nothing logged yet today</p>
        ) : (
          <p className="text-sm font-black text-white mt-1 tabular-nums">
            {madeToday.map(p => `${p.item} ${p.qty}`).join(' • ')}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="boss-card p-3 border-l-4 border-l-emerald-500">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Sold</p>
          {sold.length === 0
            ? <p className="text-xs text-zinc-500 font-bold uppercase mt-1">Nothing yet</p>
            : sold.slice(0, 4).map(r => (
              <p key={r.productId} className="text-xs font-bold text-zinc-200 mt-1 tabular-nums truncate">{r.productName} {r.sold}</p>
            ))}
        </div>
        <div className="boss-card p-3 border-l-4 border-l-cyan-500">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Remaining</p>
          {remaining.length === 0
            ? <p className="text-xs text-zinc-500 font-bold uppercase mt-1">Tray clear</p>
            : remaining.slice(0, 4).map(r => (
              <p key={r.productId} className="text-xs font-bold text-cyan-200 mt-1 tabular-nums truncate">{r.productName} {r.leftover} →</p>
            ))}
        </div>
        <div className="boss-card p-3 border-l-4 border-l-rose-500">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-1">
            <PackageX className="w-3 h-3" /> Waste
          </p>
          <p className="text-lg font-black text-rose-400 font-display mt-1 tabular-nums">{expiredQty || '—'}</p>
        </div>
        <div className="boss-card p-3 border-l-4 border-l-gold-brand">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-1">
            <Wallet className="w-3 h-3" /> Money
          </p>
          <p className="text-lg font-black text-white font-display mt-1 tabular-nums">{formatCurrency(money.revenue)}</p>
          <p className="text-[10px] text-zinc-500 font-bold uppercase">kept {formatCurrency(money.dishProfit)}</p>
        </div>
      </div>

      <button onClick={onCloseKitchen}
        className="w-full h-12 bg-gold-brand text-black rounded-xl text-sm font-black uppercase tracking-widest hover:opacity-90 active:scale-[0.99] transition-all cursor-pointer flex items-center justify-center gap-2">
        <Flame className="w-4 h-4" /> Close kitchen
      </button>
      <button onClick={onBackSell}
        className="w-full h-10 bg-[#141414] border border-white/10 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer">
        <ArrowRightLeft className="w-4 h-4" /> Back to products
      </button>
    </div>
  );
}
