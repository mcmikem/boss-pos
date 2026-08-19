import { useState, useMemo } from 'react';
import { ChefHat, X, PlusCircle, ArrowRightLeft, Search, Tag } from 'lucide-react';
import type { Product, Recipe, RecipeIngredient, ProductVariant } from '../types';
import { RECIPE_UNITS, calculateRecipe, emptyRecipe, suggestedFor, effectiveCost } from '../utils/recipe';

interface EateryPricingProps {
  products: Product[];
  onUpdateProduct: (p: Product) => void;
  formatCurrency: (val: number) => string;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

const sanitizeRecipe = (recipe: Recipe | null): Recipe | undefined => {
  if (!recipe) return undefined;
  const ingredients = recipe.ingredients
    .filter(i => i.name.trim() !== '')
    .map(i => ({
      ...i,
      name: i.name.trim(),
      qty: Math.max(0, parseFloat(String(i.qty)) || 0),
      unitCost: Math.max(0, parseFloat(String(i.unitCost)) || 0),
      wastePct: Math.min(99, Math.max(0, parseFloat(String(i.wastePct)) || 0)),
    }));
  const yieldVal = Math.max(0, parseFloat(String(recipe.yield)) || 0);
  if (ingredients.length === 0 || yieldVal <= 0) return undefined;
  return {
    ingredients,
    yield: yieldVal,
    overhead: Math.max(0, parseFloat(String(recipe.overhead)) || 0),
    targetMarginPct: Math.min(99, Math.max(1, parseFloat(String(recipe.targetMarginPct)) || 60)),
  };
};

export default function EateryPricing({ products, onUpdateProduct, formatCurrency, triggerToast }: EateryPricingProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const dishes = useMemo(() => {
    const q = search.toLowerCase().trim();
    return products
      .filter(p => p.category === 'Eatery')
      .filter(p => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, search]);

  const selected = dishes.find(p => p.id === selectedId) || null;

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [price, setPrice] = useState('');
  const [variants, setVariants] = useState<ProductVariant[]>([]);

  const selectDish = (p: Product) => {
    setSelectedId(p.id);
    setRecipe(p.recipe ? JSON.parse(JSON.stringify(p.recipe)) : emptyRecipe());
    setPrice(String(p.price));
    setVariants(p.variants ? p.variants.map(v => ({ ...v })) : []);
  };

  const back = () => {
    setSelectedId(null);
    setRecipe(null);
    setPrice('');
    setVariants([]);
  };

  const calc = calculateRecipe(recipe ?? undefined, parseFloat(price) || 0);

  const updateIng = (id: string, patch: Partial<RecipeIngredient>) => {
    setRecipe(prev => prev && {
      ...prev,
      ingredients: prev.ingredients.map(i => i.id === id ? { ...i, ...patch } : i),
    });
  };
  const removeIng = (id: string) => {
    setRecipe(prev => prev && { ...prev, ingredients: prev.ingredients.filter(i => i.id !== id) });
  };
  const addIng = () => {
    setRecipe(prev => prev && {
      ...prev,
      ingredients: [...prev.ingredients, { id: `ing-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: '', qty: 1, unit: 'kg', unitCost: 0, wastePct: 0 }],
    });
  };

  const applySuggested = () => {
    if (!calc || !selected) return;
    const suggested = String(Math.round(calc.suggestedPrice));
    setPrice(suggested);
    const newVariants = variants.map(v => ({
      ...v,
      price: Math.round(suggestedFor(v.cost ?? calc.cogsPerUnit, recipe?.targetMarginPct || 60)),
    }));
    setVariants(newVariants);
    save(suggested, newVariants);
    triggerToast('Suggested prices applied', 'success');
  };

  const save = (priceVal?: string, variantList?: ProductVariant[]) => {
    if (!selected) return;
    const clean = sanitizeRecipe(recipe);
    if (!clean) {
      triggerToast('Add at least one ingredient and a batch yield', 'error');
      return;
    }
    const nextPrice = priceVal ?? price;
    const nextVariants = variantList ?? variants;
    onUpdateProduct({
      ...selected,
      price: parseFloat(nextPrice) || 0,
      variants: nextVariants,
      recipe: clean,
    });
    triggerToast('Recipe saved', 'success');
  };

  return (
    <div className="space-y-3">
      {!selected ? (
        <>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-zinc-600 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search dishes…"
                className="w-full bg-[#0A0A0A] border border-white/5 text-white rounded-xl h-10 pl-9 pr-3 text-sm focus:border-gold-brand focus:outline-none" />
            </div>
          </div>

          {dishes.length === 0 && (
            <div className="py-16 text-center boss-card rounded-xl">
              <ChefHat className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
              <p className="text-sm text-zinc-400 font-bold uppercase tracking-wider">No Eatery dishes found</p>
              <p className="text-[11px] text-zinc-600 mt-1">Add dishes under the Eatery category in Stock first.</p>
            </div>
          )}

          <div className="space-y-2">
            {dishes.map(p => {
              const eff = effectiveCost(p);
              const margin = p.price > 0 ? ((p.price - eff) / p.price) * 100 : 0;
              const hasRecipe = !!p.recipe;
              return (
                <button key={p.id} onClick={() => selectDish(p)}
                  className="w-full boss-card rounded-xl p-3 flex items-center justify-between gap-3 active:scale-[0.99] transition-all cursor-pointer text-left">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-gold-brand/10 border border-gold-brand/20 flex items-center justify-center shrink-0">
                      <Tag className="w-4 h-4 text-gold-brand" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-black text-white truncate">{p.name}</p>
                      <p className="text-[10px] text-zinc-500 font-bold mt-0.5">
                        Cost {formatCurrency(eff)} • Sell {formatCurrency(p.price)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`text-[10px] font-black px-2 py-1 rounded-md ${
                      hasRecipe
                        ? margin <= 0 ? 'bg-rose-950/40 text-rose-400' : margin < 20 ? 'bg-amber-950/40 text-amber-400' : 'bg-emerald-950/40 text-emerald-400'
                        : 'bg-zinc-900 text-zinc-500'
                    }`}>
                      {hasRecipe ? `${margin.toFixed(0)}%` : 'No recipe'}
                    </span>
                    <p className="text-[10px] text-gold-brand font-bold mt-1">Tap to cost →</p>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <button onClick={back}
            className="h-10 px-4 bg-[#141414] border border-white/10 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer">
            <ArrowRightLeft className="w-4 h-4" /> Back to dishes
          </button>

          <div className="bg-zinc-900/60 rounded-xl p-3 border border-gold-brand/20 space-y-3">
            <div className="flex justify-between items-center mb-1">
              <h4 className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
                <ChefHat className="w-3.5 h-3.5 text-gold-brand" /> Recipe Costing — {selected.name}
              </h4>
              <span className="text-[10px] text-zinc-600 uppercase font-bold">Eatery dish</span>
            </div>

            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_3.5rem_4rem_4.5rem_3.5rem_1.5rem] gap-1.5 text-[10px] text-zinc-500 font-bold uppercase">
                <span>Ingredient</span><span>Qty</span><span>Unit</span><span>Cost/Unit</span><span>Waste %</span><span></span>
              </div>
              {recipe?.ingredients.map(ing => (
                <div key={ing.id} className="grid grid-cols-[1fr_3.5rem_4rem_4.5rem_3.5rem_1.5rem] gap-1.5 items-center">
                  <input value={ing.name} placeholder="e.g. Chicken breast"
                    onChange={(e) => updateIng(ing.id, { name: e.target.value })}
                    className="min-w-0 bg-zinc-950 border border-zinc-800 text-gold-light rounded-lg h-9 px-2 text-xs focus:border-gold-brand focus:outline-none" />
                  <input type="number" min="0" step="any" value={ing.qty || ''}
                    onChange={(e) => updateIng(ing.id, { qty: parseFloat(e.target.value) || 0 })}
                    className="bg-zinc-950 border border-zinc-800 text-gold-light rounded-lg h-9 px-2 text-xs focus:border-gold-brand focus:outline-none text-right" />
                  <select value={ing.unit}
                    onChange={(e) => updateIng(ing.id, { unit: e.target.value })}
                    className="bg-zinc-950 border border-zinc-800 text-zinc-300 rounded-lg h-9 px-1 text-xs focus:border-gold-brand focus:outline-none">
                    {RECIPE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                  <input type="number" min="0" step="any" value={ing.unitCost || ''}
                    onChange={(e) => updateIng(ing.id, { unitCost: parseFloat(e.target.value) || 0 })}
                    className="bg-zinc-950 border border-zinc-800 text-gold-light rounded-lg h-9 px-2 text-xs focus:border-gold-brand focus:outline-none text-right" />
                  <input type="number" min="0" max="99" value={ing.wastePct || ''}
                    onChange={(e) => updateIng(ing.id, { wastePct: Math.min(99, Math.max(0, parseFloat(e.target.value) || 0)) })}
                    className="bg-zinc-950 border border-zinc-800 text-amber-400 rounded-lg h-9 px-2 text-xs focus:border-gold-brand focus:outline-none text-right" />
                  <button onClick={() => removeIng(ing.id)} className="text-rose-400 hover:text-rose-300 p-1.5"><X className="w-4 h-4" /></button>
                </div>
              ))}
              <button onClick={addIng} className="text-gold-brand text-xs font-bold flex items-center gap-1 hover:text-gold-light transition-colors">
                <PlusCircle className="w-3.5 h-3.5" /> Add ingredient
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] text-zinc-500 font-bold uppercase mb-1">Batch Yield</label>
                <input type="number" min="1" value={recipe?.yield || ''}
                  onChange={(e) => setRecipe(prev => prev && { ...prev, yield: Math.max(1, parseFloat(e.target.value) || 1) })}
                  className="w-full bg-zinc-950 border border-zinc-800 text-gold-light rounded-lg h-9 px-2 text-xs focus:border-gold-brand focus:outline-none text-right" />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-500 font-bold uppercase mb-1">Extra costs (UGX)</label>
                <input type="number" min="0" value={recipe?.overhead || ''}
                  onChange={(e) => setRecipe(prev => prev && { ...prev, overhead: Math.max(0, parseFloat(e.target.value) || 0) })}
                  className="w-full bg-zinc-950 border border-zinc-800 text-gold-light rounded-lg h-9 px-2 text-xs focus:border-gold-brand focus:outline-none text-right" />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-500 font-bold uppercase mb-1">Target profit %</label>
                <input type="number" min="1" max="99" value={recipe?.targetMarginPct || ''}
                  onChange={(e) => setRecipe(prev => prev && { ...prev, targetMarginPct: Math.min(99, Math.max(1, parseFloat(e.target.value) || 60)) })}
                  className="w-full bg-zinc-950 border border-zinc-800 text-amber-400 rounded-lg h-9 px-2 text-xs focus:border-gold-brand focus:outline-none text-right" />
              </div>
            </div>

            <div>
              <label className="block text-[10px] text-zinc-500 font-bold uppercase mb-1">Sell Price (UGX)</label>
              <input type="number" min="0" value={price || ''}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 text-gold-light rounded-lg h-9 px-2 text-xs focus:border-gold-brand focus:outline-none text-right" />
            </div>

            {calc && (
              <div className="bg-zinc-950/60 border border-zinc-800 rounded-xl p-3 space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-zinc-500 font-bold uppercase">Batch cost</span><span className="text-zinc-300 font-bold">{formatCurrency(calc.batchCost)}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500 font-bold uppercase">+ Extra costs</span><span className="text-zinc-300 font-bold">{formatCurrency(calc.totalCost - calc.batchCost)}</span></div>
                <div className="flex justify-between border-t border-zinc-800 pt-1.5"><span className="text-zinc-500 font-bold uppercase">Cost per piece</span><span className="text-gold-light font-black">{formatCurrency(calc.cogsPerUnit)}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500 font-bold uppercase">Sell price</span><span className="text-zinc-300 font-bold">{formatCurrency(parseFloat(price) || 0)}</span></div>
                <div className="flex justify-between">
                  <span className="text-zinc-500 font-bold uppercase">Profit / piece</span>
                  <span className={`font-black ${calc.isLoss ? 'text-rose-400' : 'text-emerald-400'}`}>{formatCurrency(calc.profitPerUnit)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500 font-bold uppercase">Profit %</span>
                  <span className={`font-black ${calc.marginPct <= 0 ? 'text-rose-400' : calc.marginPct < 20 ? 'text-amber-400' : 'text-emerald-400'}`}>{calc.marginPct.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500 font-bold uppercase">Suggested price</span>
                  <span className="text-gold-brand font-black">{formatCurrency(Math.round(calc.suggestedPrice))}</span>
                </div>
                {calc.isLoss && <p className="text-rose-400 text-[11px] font-bold">You are selling this below cost!</p>}
                {!calc.isLoss && calc.isUnderpriced && <p className="text-amber-400 text-[11px] font-bold">Under target margin — tap apply suggested price.</p>}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button onClick={applySuggested} disabled={!calc}
                className="h-10 bg-gold-brand hover:bg-gold-medium disabled:opacity-40 disabled:cursor-not-allowed text-black font-black uppercase tracking-widest text-xs rounded-xl transition-colors cursor-pointer">
                Apply Suggested
              </button>
              <button onClick={() => save()}
                className="h-10 bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest text-xs rounded-xl transition-colors cursor-pointer">
                Save Recipe
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
