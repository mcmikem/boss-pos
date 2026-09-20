// Stocktake mode: walk the shelves, tap in what you actually see, review
// the differences priced at cost, apply. Only changed lines are written —
// untouched products are never echoed back to the server.
import { useMemo, useState } from 'react';
import { logAdjustment } from '../utils/adjustLog';
import { ClipboardCheck, Search, Check, ArrowRightLeft } from 'lucide-react';
import type { Product } from '../types';
import { diffStocktake, shrinkageValue, surplusValue } from '../utils/stocktake';

interface StocktakePanelProps {
  products: Product[];
  onUpdateProduct: (p: Product) => void;
  formatCurrency: (val: number) => string;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  onBack: () => void;
}

export default function StocktakePanel({ products, onUpdateProduct, formatCurrency, triggerToast, onBack }: StocktakePanelProps) {
  const countable = useMemo(
    () => products.filter(p => !p.isService).sort((a, b) => a.name.localeCompare(b.name)),
    [products]
  );
  const [query, setQuery] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);

  const visible = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return countable;
    return countable.filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
  }, [countable, query]);

  const countedIds = useMemo(
    () => Object.keys(counts).filter(id => counts[id] !== '' && Number.isFinite(parseFloat(counts[id]))),
    [counts]
  );
  const numeric = useMemo(() => {
    const m: Record<string, number> = {};
    for (const id of countedIds) m[id] = parseFloat(counts[id]);
    return m;
  }, [counts, countedIds]);
  const diffs = useMemo(() => diffStocktake(products, numeric), [products, numeric]);
  const shrink = shrinkageValue(diffs);
  const surplus = surplusValue(diffs);

  const setCount = (id: string, v: string) => {
    const clean = v.replace(/[^0-9.]/g, '');
    setCounts(prev => ({ ...prev, [id]: clean }));
  };

  const apply = async () => {
    if (diffs.length === 0 || applying) return;
    setApplying(true);
    try {
      for (const d of diffs) {
        onUpdateProduct({ ...d.product, stockQty: d.counted });
        logAdjustment({
          ts: new Date().toISOString(), productId: d.product.id, name: d.product.name,
          type: 'set', qty: d.counted, reason: 'Stock-take count',
        });
      }
      triggerToast(
        `Stocktake applied: ${diffs.length} line${diffs.length !== 1 ? 's' : ''}${shrink > 0 ? ` • shrinkage ${formatCurrency(shrink)}` : ''}${surplus > 0 ? ` • surplus ${formatCurrency(surplus)}` : ''}`,
        shrink > 0 ? 'error' : 'success'
      );
      setCounts({});
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Consistent back (#24): every sub-panel uses the same Back button. */}
      <button onClick={onBack} aria-label="Back to stock"
        className="h-10 px-4 bg-[#141414] border border-white/10 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer touch-target">
        <ArrowRightLeft className="w-4 h-4" /> Back
      </button>

      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-cyan-950/40 border border-cyan-800/40 flex items-center justify-center">
          <ClipboardCheck className="w-5 h-5 text-cyan-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-black text-white uppercase tracking-tight font-display">Stocktake</h2>
          <p className="text-xs text-zinc-500 font-bold">{countedIds.length}/{countable.length} counted{diffs.length > 0 ? ` • ${diffs.length} differ` : ''}</p>
        </div>
      </div>
      <div className="h-1.5 bg-zinc-900 rounded-full overflow-hidden">
        <div className="h-full bg-cyan-400 transition-all" style={{ width: `${countable.length === 0 ? 0 : Math.round((countedIds.length / countable.length) * 100)}%` }} />
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find an item to count"
          className="w-full bg-[#0A0A0A] border border-white/5 text-sm pl-9 pr-3 rounded-xl text-white font-bold focus:border-gold-brand outline-none h-11" />
      </div>

      <div className="space-y-2">
        {visible.map(p => {
          const raw = counts[p.id] ?? '';
          const num = raw === '' ? null : parseFloat(raw);
          const differs = num !== null && Number.isFinite(num) && Math.abs(num - (p.stockQty || 0)) > 1e-9;
          return (
            <div key={p.id} className={`boss-card p-3 flex items-center gap-3 ${differs ? 'border-amber-500/50' : ''}`}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white truncate">{p.name}</p>
                <p className="text-[10px] text-zinc-500 font-bold uppercase">System: {p.stockQty}{differs && num !== null ? ` → ${num} (${num - (p.stockQty || 0) > 0 ? '+' : ''}${Math.round((num - (p.stockQty || 0)) * 1000) / 1000})` : ''}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => setCount(p.id, String(Math.max(0, Math.floor((num ?? p.stockQty + 1) - 1))))}
                  className="touch-target rounded-xl bg-zinc-800 text-white text-lg font-bold cursor-pointer" aria-label={`Count one less ${p.name}`}>−</button>
                <input type="number" min="0" inputMode="decimal" value={raw} placeholder={String(p.stockQty)}
                  onChange={e => setCount(p.id, e.target.value)}
                  aria-label={`Counted stock for ${p.name}`}
                  className="w-20 bg-[#0A0A0A] border border-white/10 rounded-xl h-11 text-center text-sm font-black text-gold-brand outline-none focus:border-gold-brand tabular-nums" />
                <button onClick={() => setCount(p.id, String(Math.floor(num ?? p.stockQty) + 1))}
                  className="touch-target rounded-xl bg-zinc-800 text-white text-lg font-bold cursor-pointer" aria-label={`Count one more ${p.name}`}>+</button>
              </div>
            </div>
          );
        })}
        {visible.length === 0 && (
          <p className="text-center text-xs text-zinc-600 font-bold uppercase py-8">No items match</p>
        )}
      </div>

      {diffs.length > 0 && (
        <div className="boss-card p-4 rounded-2xl border border-amber-500/30 space-y-2">
          <div className="flex justify-between text-xs font-bold uppercase">
            <span className="text-zinc-400">{diffs.length} lines differ</span>
            <span>
              {shrink > 0 && <span className="text-rose-400">−{formatCurrency(shrink)} </span>}
              {surplus > 0 && <span className="text-emerald-400">+{formatCurrency(surplus)}</span>}
            </span>
          </div>
          <button onClick={apply} disabled={applying}
            className="w-full h-12 bg-gold-brand text-black font-black uppercase tracking-widest text-xs rounded-xl hover:opacity-90 active:scale-95 transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2">
            <Check className="w-4 h-4" /> {applying ? 'Applying…' : `Apply ${diffs.length} counts`}
          </button>
        </div>
      )}
    </div>
  );
}
