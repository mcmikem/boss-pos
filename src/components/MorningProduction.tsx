// Morning kitchen log — lives on Sell → Eatery, NOT in the Close tab.
// What the kitchen made this morning (adds to stock for today's selling).
// The Close tab only reads this data for the evening balance check.
import { useMemo, useState } from 'react';
import { ChefHat, Check, Trash2, ArrowRight } from 'lucide-react';
import type { Product, ProductionRegister, Sale, WastageLog } from '../types';
import { todayLocalKey } from '../utils/dates';
import { leftoverFor, prevDayKey } from '../utils/cashflow';

interface MorningProductionProps {
  products: Product[];
  productionRegisters: ProductionRegister[];
  sales?: Sale[];
  wastageLogs?: WastageLog[];
  onAddProduction: (p: ProductionRegister) => void;
  onDeleteProduction: (id: string) => void;
  formatCurrency: (val: number) => string;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export default function MorningProduction({
  products, productionRegisters, sales = [], wastageLogs = [], onAddProduction, onDeleteProduction,
  formatCurrency, triggerToast,
}: MorningProductionProps) {
  const eateryProducts = useMemo(() => products.filter(p => p.category === 'Eatery'), [products]);
  const [prodDate, setProdDate] = useState(todayLocalKey());
  const [prodItem, setProdItem] = useState('');
  const [prodCustomItem, setProdCustomItem] = useState('');
  const [prodProductId, setProdProductId] = useState<string | null>(null);
  const [prodQty, setProdQty] = useState('');
  const [prodCost, setProdCost] = useState('');

  const today = todayLocalKey();
  const todayMade = useMemo(
    () => productionRegisters.filter(p => p.category === 'Eatery' && p.date === today),
    [productionRegisters, today]
  );
  const todayCost = todayMade.reduce((s, p) => s + p.total, 0);

  // Yesterday's leftovers carry as today's opening — kitchen makes less.
  const yesterdayKey = prevDayKey(today);
  const leftovers = useMemo(
    () => (sales.length ? leftoverFor(products, productionRegisters, sales, wastageLogs, yesterdayKey) : []),
    [products, productionRegisters, sales, wastageLogs, yesterdayKey]
  );
  const carryable = leftovers.filter(r => r.leftover > 0).slice(0, 5);

  const handleSelect = (value: string) => {
    setProdItem(value);
    if (value === '__custom') {
      setProdCustomItem('');
      setProdCost('');
      setProdProductId(null);
    } else {
      const prod = eateryProducts.find(p => p.name === value);
      setProdProductId(prod ? prod.id : null);
      if (prod) setProdCost(String(prod.cost || ''));
    }
  };

  const handleSubmit = () => {
    const item = prodItem === '__custom' ? prodCustomItem.trim() : prodItem;
    if (!item) { triggerToast('Select the item', 'error'); return; }
    const qty = parseInt(prodQty, 10) || 0;
    if (qty <= 0) { triggerToast('Enter the number made', 'error'); return; }
    const cost = parseFloat(prodCost) || 0;
    if (cost <= 0) { triggerToast('Enter the cost price each', 'error'); return; }
    onAddProduction({
      id: `pr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date: prodDate,
      item,
      category: 'Eatery',
      productId: prodProductId || undefined,
      qty,
      costEach: cost,
      total: Math.round(qty * cost),
    });
    triggerToast(`Production logged: ${qty} × ${item}`, 'success');
    setProdItem(''); setProdCustomItem(''); setProdProductId(null); setProdQty(''); setProdCost('');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-amber-950/40 border border-amber-800/40 flex items-center justify-center">
          <ChefHat className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h2 className="text-lg font-black text-white uppercase tracking-tight font-display">Morning Production</h2>
          <p className="text-xs text-zinc-500 font-bold">Log what the kitchen made — adds to stock for today</p>
        </div>
      </div>
      <p className="text-[11px] font-bold text-amber-300/90 bg-amber-950/25 border border-amber-800/30 rounded-xl px-3 py-2 leading-snug">
        One place for kitchen batches: logging here updates Stock automatically — don't add the same pieces in Stock, or they count twice.
      </p>

      <div className="boss-card p-3 border-l-4 border-l-amber-500">
        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Made today</p>
        <p className="text-lg font-black text-white font-display mt-1">{formatCurrency(todayCost)}</p>
      </div>

      {carryable.length > 0 && (
        <div className="bg-cyan-950/25 border border-cyan-800/40 rounded-xl p-3 space-y-2">
          <p className="text-[10px] font-black text-cyan-300 uppercase tracking-widest">
            Yesterday's leftover → today's opening
          </p>
          {carryable.map(r => (
            <div key={r.productId} className="flex items-center justify-between gap-2 bg-black/30 rounded-lg px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-black text-white truncate">{r.productName}</p>
                <p className="text-[10px] text-zinc-500 font-bold uppercase">
                  Made {r.made} • Sold {r.sold} • Lost {r.lost} → left {r.leftover}
                </p>
              </div>
              <button
                onClick={() => {
                  setProdItem(r.productName);
                  const prod = eateryProducts.find(p => p.id === r.productId);
                  setProdProductId(prod ? prod.id : null);
                  if (prod) setProdCost(String(prod.cost || ''));
                  setProdQty('');
                  triggerToast(`${r.productName}: ${r.leftover} carried — adjust today's batch down`, 'info');
                }}
                className="shrink-0 h-9 px-3 bg-cyan-600/20 border border-cyan-600/40 text-cyan-300 rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-cyan-600/30 cursor-pointer flex items-center gap-1"
              >
                Use <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          ))}
          <p className="text-[10px] text-zinc-500 font-bold uppercase">Tap Use to prefill — make less today, sell leftover first.</p>
        </div>
      )}

      <div className="bg-zinc-950/60 border border-amber-600/20 rounded-xl p-4 space-y-3">
        <div>
          <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Item Made</label>
          <select value={prodItem} onChange={e => handleSelect(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none font-bold">
            <option value="">Select item...</option>
            {eateryProducts.map(p => <option key={p.id} value={p.name}>{p.name} — cost {formatCurrency(p.cost)}</option>)}
            <option value="__custom">Other / custom item...</option>
          </select>
          {prodItem === '__custom' && (
            <input type="text" value={prodCustomItem} onChange={e => setProdCustomItem(e.target.value)}
              placeholder="Type the item name..."
              className="mt-2 w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-amber-500" />
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Date</label>
            <input type="date" value={prodDate} onChange={e => setProdDate(e.target.value || todayLocalKey())}
              className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-amber-500" />
          </div>
          <div>
            <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Number Made</label>
            <input type="number" min="1" value={prodQty} onChange={e => setProdQty(e.target.value)}
              placeholder="e.g. 100" className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-amber-500" />
          </div>
        </div>
        <div>
          <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Cost Price Each</label>
          <input type="number" min="0" value={prodCost} onChange={e => setProdCost(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-amber-500" />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-zinc-400 uppercase">
            Total cost: <span className="text-amber-400 font-black text-base">{formatCurrency(Math.round((parseInt(prodQty, 10) || 0) * (parseFloat(prodCost) || 0)))}</span>
          </p>
          <button onClick={handleSubmit}
            className="h-11 px-5 bg-amber-600 hover:bg-amber-500 text-black font-black uppercase tracking-widest text-xs rounded-xl cursor-pointer active:scale-95 transition-all flex items-center gap-1.5">
            <Check className="w-4 h-4" /> Save
          </button>
        </div>
      </div>

      {todayMade.length === 0 ? (
        <div className="text-center py-8">
          <ChefHat className="w-10 h-10 text-amber-500 mx-auto mb-2 opacity-40" />
          <p className="text-xs text-zinc-500 font-bold uppercase">Nothing logged today yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {todayMade.map(p => (
            <div key={p.id} className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-black text-white truncate">{p.item}</p>
                <p className="text-[10px] text-zinc-500 font-bold uppercase">{p.qty} × {formatCurrency(p.costEach)}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <p className="text-sm font-black text-amber-400 font-display">{formatCurrency(p.total)}</p>
                <button onClick={() => { onDeleteProduction(p.id); triggerToast('Production entry deleted', 'info'); }}
                  className="p-1.5 text-zinc-600 hover:text-rose-400 rounded-lg hover:bg-rose-950/30 cursor-pointer">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
