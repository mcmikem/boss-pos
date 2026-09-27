// Morning kitchen log — lives on Sell → Eatery & Drinks, NOT in the Close tab.
// What the kitchen made this morning (adds to stock for today's selling).
// The Close tab only reads this data for the evening balance check.
// Drinks note: depot sodas (Coca-Cola, Mirinda, Rock Boom…) are buy-resell —
// restock those in Stock. Only fresh juices (Obutunda, Omunanansi, i.e. the
// Drinks lines with a recipe) are made here.
import { useEffect, useMemo, useState } from 'react';
import { ChefHat, Trash2, ArrowRight, Check } from 'lucide-react';
import type { Expense, Product, ProductionRegister, RecipeIngredient, Sale, WastageLog } from '../types';
import { middayStamp, todayLocalKey } from '../utils/dates';
import { leftoverFor, prevDayKey } from '../utils/cashflow';
import { confirmDialog } from './Dialog';
import { MoneyHero, MoneyStat, PrimaryAction } from './Design';

// One batch, one screen: pick the dish, see what the recipe needs, edit what
// was actually bought and paid, watch the profit, save. The save logs the
// batch AND (optionally) the ingredient expense together — no second trip to
// Expenses, no double counting.
interface MorningProductionProps {
  products: Product[];
  productionRegisters: ProductionRegister[];
  sales?: Sale[];
  wastageLogs?: WastageLog[];
  // All three report the server's answer. The batch toast names the batch AND
  // its expense, so announcing it before both writes are confirmed is how a
  // kitchen ends up told a batch was logged when neither write landed.
  onAddProduction: (p: ProductionRegister) => void | boolean | Promise<void | boolean>;
  onDeleteProduction: (id: string) => void | boolean | Promise<void | boolean>;
  onAddExpense?: (e: Expense) => void | boolean | Promise<void | boolean>;
  onUpdateProduct?: (p: Product) => void | boolean | Promise<void | boolean>;
  formatCurrency: (val: number) => string;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  // Which kitchen this is. Eatery sees Eatery items, Drinks sees Drinks —
  // depot sodas never borrow Eatery details again.
  category?: string;
  // Draft money set aside at close for tomorrow's ingredients. Logging today's
  // batch spends it, so the kitchen can see what is left to work with.
  availableBudget?: number;
  onRequestTopUp?: (amount: number) => void;
  // What last evening's close committed the kitchen to make. Shown first so
  // the batch starts from the plan, not from memory.
  plannedLines?: Array<{ productId: string; productName: string; batchQty: number; totalCost: number }>;
}

// Recipe line plus what was actually bought for this batch. `boughtQty` starts
// at the recipe need and stays user-owned once touched; prices always flow.
type DraftIngredient = RecipeIngredient & { boughtQty: number; boughtTouched?: boolean };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export default function MorningProduction({
  products, productionRegisters, sales = [], wastageLogs = [], onAddProduction, onDeleteProduction,
  onAddExpense, onUpdateProduct, formatCurrency, triggerToast,
  category, availableBudget, onRequestTopUp, plannedLines = [],
}: MorningProductionProps) {
  const inScope = (cat: string) => !category || cat === category;
  const eateryProducts = useMemo(
    () => products.filter(p => inScope(p.category) && (p.category === 'Eatery' || !!p.recipe)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, category]);
  const [prodDate, setProdDate] = useState(todayLocalKey());
  const [prodItem, setProdItem] = useState('');
  const [prodCustomItem, setProdCustomItem] = useState('');
  const [prodProductId, setProdProductId] = useState<string | null>(null);
  const [prodQty, setProdQty] = useState('');
  const [prodCost, setProdCost] = useState('');
  // When the chosen item has a recipe, its ingredients load with today's prices
  // and stay editable. Editing a price here also writes back to the recipe, so
  // the next morning starts from what was actually paid.
  const [draftIngredients, setDraftIngredients] = useState<DraftIngredient[] | null>(null);
  const [recipeProductId, setRecipeProductId] = useState<string | null>(null);
  const [recordExpense, setRecordExpense] = useState(true);
  const [savingBatch, setSavingBatch] = useState(false);

  const today = todayLocalKey();
  const todayMade = useMemo(
    () => productionRegisters.filter(p => inScope(p.category || 'Eatery') && p.date === today),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [productionRegisters, today, category]
  );
  const todayCost = todayMade.reduce((s, p) => s + p.total, 0);

  const usePlannedLine = (line: { productId: string; productName: string; batchQty: number }) => {
    const prod = eateryProducts.find(x => x.id === line.productId || x.name === line.productName);
    if (!prod) {
      triggerToast(`${line.productName} is no longer on the menu`, 'error');
      return;
    }
    handleSelect(prod.name);
    setProdQty(String(Math.max(1, Math.round(line.batchQty))));
    triggerToast(`${prod.name}: planned ${Math.round(line.batchQty)} — adjust and save`, 'info');
  };


  // Yesterday's leftovers auto-carry as today's opening — kitchen makes less.
  // Only food logged 'expired' is a loss; everything else stays on the tray.
  const yesterdayKey = prevDayKey(today);

  // Same again: yesterday's batches one tap away (same menu most mornings).
  const yesterdayRegs = useMemo(
    () => productionRegisters.filter(p => inScope(p.category || 'Eatery') && p.date === yesterdayKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [productionRegisters, yesterdayKey, category]
  );
  const repeatYesterday = async () => {
    if (yesterdayRegs.length === 0) return;
    if (!(await confirmDialog({ title: 'Repeat batch', message: `Log yesterday's ${yesterdayRegs.length} batch${yesterdayRegs.length !== 1 ? 'es' : ''} again for today?`, confirmLabel: 'Repeat' }))) return;
    // Awaited, and honest about the count. "Repeated 6 batches" was printed
    // before a single one had been attempted, so a refusal just lost the batch
    // and left the day's production short with no warning.
    const answers = await Promise.all(yesterdayRegs.map(r => onAddProduction({
      ...r,
      id: `pr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date: today,
    })));
    const refused = answers.filter(a => a === false).length;
    const okCount = yesterdayRegs.length - refused;
    if (refused > 0) {
      triggerToast(`Repeated ${okCount} of ${yesterdayRegs.length} batches — ${refused} not saved`, 'error');
      return;
    }
    triggerToast(`Repeated ${yesterdayRegs.length} batch${yesterdayRegs.length !== 1 ? 'es' : ''} for today`, 'success');
  };
  const leftovers = useMemo(
    () => (sales.length ? leftoverFor(products, productionRegisters, sales, wastageLogs, yesterdayKey) : []),
    [products, productionRegisters, sales, wastageLogs, yesterdayKey]
  );
  const carryable = leftovers.filter(r => {
    if (r.leftover <= 0) return false;
    const prod = products.find(p => p.id === r.productId);
    return !prod || inScope(prod.category);
  }).slice(0, 5);

  const batchesFor = (qty: number, yieldQty: number) => Math.max(0, qty / Math.max(1, yieldQty));

  // Undo hand-edits: back to the recipe's own numbers for this batch size.
  const resetBoughtToRecipe = () => {
    const prod = eateryProducts.find(p => p.id === recipeProductId);
    const batches = Math.max(1, batchesFor(parseInt(prodQty, 10) || 0, Number(prod?.recipe?.yield) || 1));
    setDraftIngredients((prod?.recipe?.ingredients || []).map(ing => ({
      ...ing,
      boughtQty: round3((Number(ing.qty) || 0) * batches),
    })));
  };

  const handleSelect = (value: string) => {
    setProdItem(value);
    if (value === '__custom') {
      setProdCustomItem('');
      setProdCost('');
      setProdProductId(null);
      setDraftIngredients(null);
      setRecipeProductId(null);
      return;
    }
    const prod = eateryProducts.find(p => p.name === value);
    setProdProductId(prod ? prod.id : null);
    if (prod) setProdCost(String(prod.cost || ''));
    const hasRecipe = !!prod?.recipe && Array.isArray(prod.recipe.ingredients) && prod.recipe.ingredients.length > 0;
    if (hasRecipe && prod) {
      const batches = Math.max(1, batchesFor(parseInt(prodQty, 10) || 0, Number(prod.recipe!.yield) || 1));
      setRecipeProductId(prod.id);
      setDraftIngredients(prod.recipe!.ingredients.map(ing => ({
        ...ing,
        boughtQty: round3((Number(ing.qty) || 0) * batches),
      })));
    } else {
      setRecipeProductId(null);
      setDraftIngredients(null);
    }
  };

  // Bought quantities follow the batch size until the cook touches them —
  // what was actually bought stays theirs, prices always stay live.
  useEffect(() => {
    if (!recipeProductId) return;
    const prod = eateryProducts.find(p => p.id === recipeProductId);
    const yieldQty = Math.max(1, Number(prod?.recipe?.yield) || 1);
    const batches = batchesFor(parseInt(prodQty, 10) || 0, yieldQty);
    setDraftIngredients(prev => (prev || []).map((ing, i) => {
      if (ing.boughtTouched) return ing;
      const base = prod?.recipe?.ingredients[i];
      return { ...ing, boughtQty: round3((Number(base?.qty) || 0) * (batches || 1)) };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prodQty, recipeProductId]);

  // What leaves the drawer for this batch: bought × paid, no waste factor —
  // waste is a recipe-planning number, not money spent.
  const batchSpend = useMemo(() => {
    if (!draftIngredients || draftIngredients.length === 0) return 0;
    return Math.round(draftIngredients.reduce(
      (sum, ing) => sum + (Number(ing.boughtQty) || 0) * (Number(ing.unitCost) || 0), 0));
  }, [draftIngredients]);

  // What the recipe says the batch should need (reference only — bought wins).
  const recipeNeed = useMemo(() => {
    if (!draftIngredients || draftIngredients.length === 0) return 0;
    return Math.round(draftIngredients.reduce((sum, ing) => {
      const qty = Number(ing.qty) || 0;
      const unit = Number(ing.unitCost) || 0;
      const waste = 1 + (Math.max(0, Number(ing.wastePct) || 0) / 100);
      return sum + qty * unit * waste;
    }, 0));
  }, [draftIngredients]);

  const selectedProduct = eateryProducts.find(p => p.id === prodProductId) || null;
  const batchQtyNum = Math.max(0, parseInt(prodQty, 10) || 0);
  const batchRevenue = selectedProduct && batchQtyNum > 0 ? Math.round(batchQtyNum * (selectedProduct.price || 0)) : 0;
  const batchProfit = batchRevenue - batchSpend;
  const batchMargin = batchRevenue > 0 ? Math.round((batchProfit / batchRevenue) * 100) : 0;
  const recipePath = !!draftIngredients && draftIngredients.length > 0;
  const formSpend = recipePath ? batchSpend : Math.round(batchQtyNum * (parseFloat(prodCost) || 0));

  const scopedCategory = category === 'Drinks' ? 'Drinks' : 'Eatery';

  const handleSubmit = async () => {
    if (savingBatch) return;
    setSavingBatch(true);
    try {
      await submitBatch();
    } finally {
      setSavingBatch(false);
    }
  };

  const submitBatch = async () => {
    const item = prodItem === '__custom' ? prodCustomItem.trim() : prodItem;
    if (!item) { triggerToast('Select the item', 'error'); return; }
    const qty = parseInt(prodQty, 10) || 0;
    if (qty <= 0) { triggerToast('Enter the number made', 'error'); return; }
    const prod = eateryProducts.find(p => p.name === item) || null;
    // Recipe batches cost what was actually bought; custom items without a
    // recipe keep the typed cost. Zero spend means made from stock on hand —
    // a real batch, just no money out today.
    const spend = recipePath ? batchSpend : Math.round(qty * (parseFloat(prodCost) || 0));
    if (!recipePath && spend <= 0) { triggerToast('Enter the cost price each', 'error'); return; }
    const cost = qty > 0 ? spend / qty : 0;
    const batchSaved = await onAddProduction({
      id: `pr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date: prodDate,
      item,
      category: category || (prod?.category === 'Drinks' ? 'Drinks' : 'Eatery'),
      productId: prodProductId || prod?.id || undefined,
      qty,
      costEach: cost,
      total: spend,
    });
    // One place, one tap: the ingredient spend lands in Expenses with its
    // breakdown, so nobody makes a second trip to log the same money.
    let expensed = 0;
    let expenseSaved = true;
    if (recordExpense && spend > 0 && onAddExpense) {
      const items = recipePath
        ? draftIngredients
          .map(ing => ({ name: String(ing.name || 'Ingredient').slice(0, 120), amount: Math.round((Number(ing.boughtQty) || 0) * (Number(ing.unitCost) || 0)) }))
          .filter(i => i.amount > 0)
        : undefined;
      const written = await onAddExpense({
        id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: middayStamp(prodDate),
        description: `Ingredients · ${qty} × ${item}`,
        amount: spend,
        category: scopedCategory,
        source: 'drawer',
        ...(items && items.length ? { items } : {}),
        ...(prod ? { linkedProductId: prod.id, linkedProductName: prod.name } : {}),
      });
      expenseSaved = written !== false;
      expensed = expenseSaved ? spend : 0;
    }
    // What was paid today becomes tomorrow's cost.
    if (recipePath && prod?.recipe && onUpdateProduct) {
      try {
        const nextIngredients = prod.recipe.ingredients.map(ing => {
          const draft = (draftIngredients || []).find(d => d.id === ing.id);
          return draft && Number(draft.unitCost) > 0 ? { ...ing, unitCost: Number(draft.unitCost) } : ing;
        });
        const changed = nextIngredients.some((n, idx) => n.unitCost !== prod.recipe!.ingredients[idx].unitCost);
        if (changed) {
          // Stated explicitly: without it the server refuses this write, which
          // is what a price change must always do.
          const written = await onUpdateProduct({ ...prod, recipeCostsOnly: true, recipe: { ...prod.recipe, ingredients: nextIngredients } } as Product);
          if (written !== false) triggerToast('Recipe costs updated from what you paid', 'info');
        }
      } catch {}
    }
    // Announced only after the server has the batch. The form keeps everything
    // typed when it does not, so the cook can simply press Save again.
    if (batchSaved === false) return;
    if (!expenseSaved) {
      triggerToast(`Batch logged, but the ${formatCurrency(spend)} ingredient expense was refused \u2014 record it in Expenses`, 'error');
    } else {
      triggerToast(
        expensed > 0
          ? `Batch logged + ${formatCurrency(expensed)} expense recorded: ${qty} \u00d7 ${item}`
          : spend > 0
            ? `Production logged: ${qty} \u00d7 ${item} \u00b7 ${formatCurrency(spend)} of ingredients`
            : `Production logged: ${qty} \u00d7 ${item} (from stock on hand)`,
        'success',
      );
    }
    if (spend > 0 && onRequestTopUp && availableBudget != null && spend > availableBudget) {
      onRequestTopUp(spend - availableBudget);
    }
    setProdItem(''); setProdCustomItem(''); setProdProductId(null); setProdQty(''); setProdCost('');
    setDraftIngredients(null); setRecipeProductId(null);
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

      {/* Log first. Money set aside, the evening's plan and yesterday's numbers
          are context — they sit under the form, never between the cook and the
          job. */}
      <div className="bg-zinc-950/60 border border-amber-600/20 rounded-xl p-4 space-y-3">
        <div>
          <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Item Made</label>
          <select value={prodItem} onChange={e => handleSelect(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none font-bold">
            <option value="">Select item...</option>
            {eateryProducts.map(p => <option key={p.id} value={p.name}>{p.name} — sells {formatCurrency(p.price)}</option>)}
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
            <input type="number" min="1" inputMode="numeric" value={prodQty} onChange={e => setProdQty(e.target.value)}
              placeholder="e.g. 100" className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-amber-500" />
          </div>
        </div>

        {/* What was actually bought and paid for this batch. The recipe sets the
            starting numbers; what the cook types is what the money and the
            tomorrow recipe become. */}
        {recipePath && (
          <div className="bg-black/25 border border-white/5 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Bought &amp; paid</p>
              <button onClick={resetBoughtToRecipe}
                className="shrink-0 text-[10px] font-black uppercase tracking-wider text-zinc-400 hover:text-amber-300 cursor-pointer">
                Back to recipe
              </button>
            </div>
            {(draftIngredients || []).map((ing, idx) => {
              const lineTotal = Math.round((Number(ing.boughtQty) || 0) * (Number(ing.unitCost) || 0));
              return (
                <div key={ing.id || idx} className="bg-black/20 border border-white/5 rounded-lg p-2 space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xs font-black text-white truncate">{ing.name || 'Ingredient'}</p>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase shrink-0">
                      Recipe needs {ing.qty} {ing.unit}
                    </p>
                  </div>
                  <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                    <label className="min-w-0">
                      <span className="text-[9px] font-black text-zinc-500 uppercase block mb-0.5">Bought</span>
                      <input type="number" min="0" step="any" inputMode="decimal" value={ing.boughtQty}
                        aria-label={`${ing.name} bought quantity`}
                        onChange={e => setDraftIngredients(prev => (prev || []).map((x, i) => i === idx ? { ...x, boughtQty: parseFloat(e.target.value) || 0, boughtTouched: true } : x))}
                        className="w-full h-10 bg-zinc-900 border border-zinc-800 text-white rounded-lg px-2 text-right text-xs font-bold tabular-nums focus:border-amber-500 outline-none" />
                    </label>
                    <label className="min-w-0">
                      <span className="text-[9px] font-black text-zinc-500 uppercase block mb-0.5">Price each</span>
                      <input type="number" min="0" step="any" inputMode="decimal" value={ing.unitCost}
                        aria-label={`${ing.name} price each`}
                        onChange={e => setDraftIngredients(prev => (prev || []).map((x, i) => i === idx ? { ...x, unitCost: parseFloat(e.target.value) || 0 } : x))}
                        className="w-full h-10 bg-zinc-900 border border-zinc-800 text-white rounded-lg px-2 text-right text-xs font-bold tabular-nums focus:border-amber-500 outline-none" />
                    </label>
                    <p className="text-xs font-black text-amber-400 font-display tabular-nums pb-2.5 w-20 text-right">{formatCurrency(lineTotal)}</p>
                  </div>
                </div>
              );
            })}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/5">
              <div>
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Spent on this batch</p>
                <p className="text-base font-black text-amber-400 font-display tabular-nums">{formatCurrency(batchSpend)}</p>
              </div>
              <div>
                <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Recipe says</p>
                <p className="text-base font-black text-zinc-500 font-display tabular-nums">{formatCurrency(recipeNeed)}</p>
                <p className="text-[9px] font-bold text-zinc-600 uppercase">includes waste allowance</p>
              </div>
            </div>
          </div>
        )}

        {!recipePath && (
          <div>
            <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Cost Price Each</label>
            <input type="number" min="0" inputMode="decimal" value={prodCost} onChange={e => setProdCost(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-amber-500" />
            <p className="text-[10px] font-bold text-zinc-500 uppercase mt-1">No recipe for this item — leave it at 0 if it came from stock on hand.</p>
          </div>
        )}

        {/* The one number this screen exists to answer: what the batch will make
            if it all sells, after the ingredients actually paid for. */}
        <div className="boss-card p-3 space-y-3">
          <MoneyHero
            label="Profit if all sold"
            value={formatCurrency(batchProfit)}
            tone={batchProfit > 0 ? 'emerald' : batchProfit < 0 ? 'rose' : 'zinc'}
            sub={batchQtyNum > 0 ? `${batchQtyNum} × ${formatCurrency(selectedProduct?.price || 0)} selling price` : 'Enter the number made'}
          />
          <div className="grid grid-cols-2 gap-3">
            <MoneyStat label="Ingredients" value={formatCurrency(formSpend)} tone={formSpend > 0 ? 'amber' : 'zinc'}
              sub={recipePath ? 'bought × paid' : 'cost each × made'} />
            <MoneyStat label="Sells for" value={formatCurrency(batchRevenue)} tone="white"
              sub={batchRevenue > 0 ? `${batchMargin}% margin` : 'no selling price set'} />
          </div>
        </div>

        {/* One tap logs the batch AND the money out. Off means the money is not
            leaving the drawer today (stock on hand, paid another way). */}
        <button type="button" onClick={() => setRecordExpense(v => !v)} aria-pressed={recordExpense}
          className={`w-full rounded-xl border px-3 py-2.5 flex items-center gap-2.5 text-left cursor-pointer active:scale-[0.99] transition-all ${recordExpense ? 'border-emerald-600/50 bg-emerald-950/30' : 'border-zinc-800 bg-zinc-900/50'}`}>
          <span className={`w-5 h-5 rounded-md border grid place-items-center shrink-0 ${recordExpense ? 'bg-emerald-500 border-emerald-400 text-black' : 'border-zinc-700'}`}>
            {recordExpense && <Check className="w-3.5 h-3.5" />}
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-black text-white uppercase tracking-wider">Record ingredient expense</span>
            <span className="block text-[10px] font-bold text-zinc-500 uppercase">
              {formSpend > 0
                ? `${formatCurrency(formSpend)} leaves the drawer and lands in Expenses`
                : 'Nothing to record — no money out on this batch'}
            </span>
          </span>
        </button>

        <PrimaryAction onClick={handleSubmit} disabled={savingBatch}>
          <Check className="w-4 h-4" /> {savingBatch ? 'Saving\u2026' : 'Save batch'}
        </PrimaryAction>
      </div>

      {availableBudget != null && (
        <div className={`boss-card p-3 border-l-4 ${availableBudget - todayCost > 0 ? 'border-l-emerald-500' : 'border-l-rose-500'}`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Ingredient money set aside</p>
              <p className="text-lg font-black text-white font-display mt-1">
                {formatCurrency(availableBudget - todayCost)}
                <span className="text-xs text-zinc-500 font-bold"> left of {formatCurrency(availableBudget)}</span>
              </p>
            </div>
            {availableBudget - todayCost <= 0 && onRequestTopUp && (
              <button onClick={() => onRequestTopUp(0)}
                className="shrink-0 h-10 px-3 bg-rose-950/40 border border-rose-600/40 text-rose-300 rounded-xl text-[10px] font-black uppercase tracking-wider hover:bg-rose-950/60 active:scale-95 transition-all cursor-pointer">
                Need more
              </button>
            )}
          </div>
          <p className="text-[10px] font-bold text-zinc-500 uppercase mt-1.5">
            This was set aside at close for tomorrow's production. Logging a batch spends it.
          </p>
        </div>
      )}

      {plannedLines.length > 0 && (
        <div className="bg-violet-950/25 border border-violet-800/40 rounded-xl p-3 space-y-2">
          <p className="text-[10px] font-black text-violet-300 uppercase tracking-widest">
            Planned last evening — make these first
          </p>
          {plannedLines.map(line => (
            <div key={line.productId} className="flex items-center justify-between gap-2 bg-black/30 rounded-lg px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-black text-white truncate">{line.productName}</p>
                <p className="text-[10px] text-zinc-500 font-bold uppercase">
                  {Math.round(line.batchQty)} planned · {formatCurrency(Math.round(line.totalCost))} ingredients
                </p>
              </div>
              <button onClick={() => usePlannedLine(line)}
                className="shrink-0 h-9 px-3 bg-violet-600/20 border border-violet-600/40 text-violet-300 rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-violet-600/30 cursor-pointer flex items-center gap-1">
                Use <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="boss-card p-3 border-l-4 border-l-amber-500">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Made today</p>
            <p className="text-lg font-black text-white font-display mt-1">{formatCurrency(todayCost)}</p>
          </div>
          {yesterdayRegs.length > 0 && todayMade.length === 0 && (
            <button onClick={repeatYesterday}
              className="shrink-0 h-10 px-4 bg-amber-950/40 border border-amber-600/40 text-amber-300 rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-amber-950/60 active:scale-95 transition-all cursor-pointer">
              ↺ Same as yesterday
            </button>
          )}
        </div>
      </div>

      {carryable.length > 0 && (
        <div className="bg-cyan-950/25 border border-cyan-800/40 rounded-xl p-3 space-y-2">
          <p className="text-[10px] font-black text-cyan-300 uppercase tracking-widest">
            Auto-carried → today's opening (unless logged expired)
          </p>
          {carryable.map(r => (
              <div key={r.productId} className="flex items-center justify-between gap-2 bg-black/30 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-black text-white truncate">{r.productName}</p>
                  <p className="text-[10px] text-zinc-500 font-bold uppercase">
                    Made {r.made} • Sold {r.sold} • Expired {r.lost}{r.carried > 0 ? ` • Carried ${r.carried}` : ''} → open {r.leftover}
                  </p>
                  {r.carried > 0 && r.gap !== 0 && (
                    <p className="text-[10px] font-black uppercase mt-0.5 text-amber-300">
                      Tray says {r.carried}, math says {r.expected} — {Math.abs(r.gap)} {r.gap > 0 ? 'missing' : 'extra'}
                    </p>
                  )}
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
          <p className="text-[10px] text-zinc-500 font-bold uppercase">Auto-carried — tap Use to prefill and make less today, sell leftover first.</p>
        </div>
      )}

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
                <button onClick={async () => {
                    // Awaited: this used to announce the deletion before the
                    // server had been asked, and it takes the batch's stock out
                    // of sellable too, so a refusal has to be visible.
                    if ((await onDeleteProduction(p.id)) === false) return;
                    triggerToast('Production entry deleted', 'info');
                  }}
                  aria-label={`Delete the ${p.item} batch`}
                  className="p-2 text-zinc-600 hover:text-rose-400 rounded-lg hover:bg-rose-950/30 cursor-pointer">
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
