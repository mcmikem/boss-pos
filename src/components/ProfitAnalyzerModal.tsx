import { X, ChefHat, TrendingUp, TrendingDown } from 'lucide-react';
import { Product, SaleItem } from '../types';
import { effectiveCost, calculateRecipe, ingredientCost } from '../utils/recipe';

interface ProfitAnalyzerModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  cart: SaleItem[];
  formatCurrency: (val: number) => string;
  orderDiscount?: number;
}

// Live unit cost for a cart line: variant cost first, then the product's
// recipe-derived cost, then the snapshot taken at add-to-cart time (covers
// deleted products). Nothing typed by hand in this modal — everything flows
// from the recipe + the prices already set.
function liveUnitCost(item: SaleItem, products: Product[]): number {
  const live = products.find(p => p.id === item.productId);
  if (live?.variants && item.variantId) {
    const v = live.variants.find(vv => vv.id === item.variantId);
    if (v) return v.cost ?? effectiveCost(live);
  }
  if (live) return effectiveCost(live);
  return item.unitCost || 0;
}

export default function ProfitAnalyzerModal({ isOpen, onClose, products, cart, formatCurrency, orderDiscount = 0 }: ProfitAnalyzerModalProps) {
  if (!isOpen) return null;

  // THIS SALE verdict: revenue (net of per-line discounts) − live ingredient
  // cost − whole-cart discount = what the seller pockets or bleeds.
  const revenue = cart.reduce((s, i) => s + i.lineTotal, 0);
  const cost = cart.reduce((s, i) => s + i.qty * liveUnitCost(i, products), 0);
  const profit = revenue - cost - Math.max(0, orderDiscount);
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
  const isLoss = cart.length > 0 && profit <= 0;

  const eateryProducts = products.filter(p => p.category === 'Eatery' || p.category === 'Drinks').sort((a, b) => {
    const marginA = a.price > 0 ? ((a.price - effectiveCost(a)) / a.price) * 100 : -Infinity;
    const marginB = b.price > 0 ? ((b.price - effectiveCost(b)) / b.price) * 100 : -Infinity;
    return marginA - marginB;
  });

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6 shadow-2xl">
        <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4">
          <div className="flex items-center gap-2">
            <ChefHat className="w-5 h-5 text-amber-400" />
            <h3 className="text-sm font-black text-white uppercase tracking-wider font-display">Profit Analyzer</h3>
          </div>
          <button onClick={onClose} aria-label="Close profit analyzer"
            className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors cursor-pointer"><X className="w-5 h-5" /></button>
        </div>

        {/* THIS SALE — auto verdict from cart + live recipes. No typing. */}
        {cart.length === 0 ? (
          <div className={`rounded-2xl border p-4 mb-4 text-center border-white/10 bg-black/30`}>
            <p className="text-xs font-black text-zinc-300 uppercase tracking-wider">Cart is empty</p>
            <p className="text-[11px] text-zinc-500 font-bold mt-1">Add items on the Sell screen, then open this to see the profit before you charge.</p>
          </div>
        ) : (
          <div className={`rounded-2xl border p-4 mb-4 ${isLoss ? 'border-rose-600/50 bg-rose-950/20' : 'border-emerald-800/40 bg-emerald-950/15'}`}>
            <div className="flex items-center gap-2 mb-2">
              {isLoss ? <TrendingDown className="w-4 h-4 text-rose-400" /> : <TrendingUp className="w-4 h-4 text-emerald-400" />}
              <p className="text-xs font-black text-white uppercase tracking-widest">This sale will {isLoss ? 'LOSE' : 'MAKE'}</p>
              <p className={`text-xl font-black font-display tabular-nums ml-auto ${isLoss ? 'text-rose-400' : 'text-emerald-400'}`}>
                {isLoss ? '−' : '+'}{formatCurrency(Math.abs(profit))}
              </p>
            </div>
            <div className="space-y-1 text-[11px] font-bold tabular-nums">
              <div className="flex justify-between gap-2"><span className="text-zinc-500 uppercase">Selling for</span><span className="text-zinc-100">+{formatCurrency(revenue)}</span></div>
              <div className="flex justify-between gap-2"><span className="text-zinc-500 uppercase">Ingredients cost</span><span className="text-amber-300">−{formatCurrency(cost)}</span></div>
              {orderDiscount > 0 && (
                <div className="flex justify-between gap-2"><span className="text-zinc-500 uppercase">Cart discount</span><span className="text-purple-300">−{formatCurrency(orderDiscount)}</span></div>
              )}
              <div className="flex justify-between gap-2 pt-1 border-t border-white/5">
                <span className="text-zinc-300 uppercase">Margin</span>
                <span className={isLoss ? 'text-rose-400' : margin < 20 ? 'text-amber-300' : 'text-emerald-400'}>{margin.toFixed(0)}%</span>
              </div>
            </div>
            {isLoss && (
              <p className="text-[11px] font-bold text-rose-300 uppercase mt-2">Do not charge yet — raise a price or cut a discount first.</p>
            )}
          </div>
        )}

        <div className="space-y-3">
          <p className="text-xs text-zinc-500 font-bold uppercase tracking-wider">Per-Product Breakdown (auto from recipes)</p>
          {eateryProducts.length > 0 ? eateryProducts.map(product => {
            const calc = calculateRecipe(product.recipe, product.price);
            const cogs = effectiveCost(product);
            const variants = product.variants || [];
            if (variants.length > 0) {
              return (
                <div key={product.id} className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <ChefHat className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <h4 className="text-sm font-bold text-white uppercase truncate">{product.name}</h4>
                      <span className="text-[10px] text-zinc-500 shrink-0">{product.category}</span>
                    </div>
                  </div>
                  {calc && <IngredientLines calc={calc} product={product} formatCurrency={formatCurrency} />}
                  <div className="space-y-1.5 mt-2">
                    {variants.map(v => {
                      const vCost = v.cost ?? cogs;
                      const profitPerUnit = v.price - vCost;
                      const marginPct = v.price > 0 ? (profitPerUnit / v.price) * 100 : 0;
                      const vLoss = profitPerUnit <= 0;
                      const totalSold = cart.filter(c => c.productId === product.id && (c.variantId || '') === v.id).reduce((s, c) => s + c.qty, 0);
                      return (
                        <div key={v.id} className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl px-3 py-2 ${vLoss ? 'bg-rose-950/10 border border-rose-500/30' : 'bg-zinc-950 border border-white/5'}`}>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${vLoss ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}`}></span>
                            <span className="text-xs font-bold text-white uppercase truncate">{v.label}</span>
                            {totalSold > 0 && <span className="text-[10px] text-gold-brand font-bold shrink-0">{totalSold} in cart</span>}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] text-zinc-500 font-bold uppercase">Cost {formatCurrency(vCost)}</span>
                            <span className="text-xs font-black text-gold-brand tabular-nums">{formatCurrency(v.price)}</span>
                            <span className={`text-xs font-black tabular-nums ${vLoss ? 'text-rose-400' : 'text-emerald-400'}`}>{vLoss ? '-' : '+'}{formatCurrency(Math.abs(profitPerUnit))}</span>
                            <span className={`text-[10px] font-black ${vLoss ? 'text-rose-400' : marginPct < 20 ? 'text-amber-400' : 'text-emerald-400'}`}>{marginPct.toFixed(0)}%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }
            const profitPerUnit = product.price - cogs;
            const marginPct = product.price > 0 ? (profitPerUnit / product.price) * 100 : 0;
            const isLossRow = profitPerUnit <= 0;
            const totalSold = cart.filter(c => c.productId === product.id).reduce((s, c) => s + c.qty, 0);
            return (
              <div key={product.id} className={`bg-zinc-900/50 border rounded-2xl p-4 ${isLossRow ? 'border-rose-500/30 bg-rose-950/10' : 'border-zinc-800'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${isLossRow ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}`}></span>
                    <h4 className="text-sm font-bold text-white uppercase truncate">{product.name}</h4>
                    <span className="text-[10px] text-zinc-500 shrink-0">{product.category}</span>
                  </div>
                  {totalSold > 0 && (
                    <span className="text-[10px] text-gold-brand font-bold shrink-0">{totalSold} in cart</span>
                  )}
                </div>
                {calc ? (
                  <IngredientLines calc={calc} product={product} formatCurrency={formatCurrency} />
                ) : (
                  <p className="text-[10px] text-zinc-600 font-bold uppercase mb-2">No recipe set — cost is the typed-in value. Add ingredients in Sell → Pricing &amp; Recipes for auto costing.</p>
                )}
                <div className="grid grid-cols-4 gap-3">
                  <div><p className="text-[10px] text-zinc-500 uppercase font-bold">Cost</p><p className="text-xs font-black text-zinc-300 tabular-nums">{formatCurrency(cogs)}</p></div>
                  <div><p className="text-[10px] text-zinc-500 uppercase font-bold">Price</p><p className="text-xs font-black text-gold-brand tabular-nums">{formatCurrency(product.price)}</p></div>
                  <div><p className="text-[10px] text-zinc-500 uppercase font-bold">Profit</p><p className={`text-xs font-black tabular-nums ${isLossRow ? 'text-rose-400' : 'text-emerald-400'}`}>{isLossRow ? '-' : '+'}{formatCurrency(Math.abs(profitPerUnit))}</p></div>
                  <div><p className="text-[10px] text-zinc-500 uppercase font-bold">Profit %</p><p className={`text-xs font-black ${isLossRow ? 'text-rose-400' : marginPct < 20 ? 'text-amber-400' : 'text-emerald-400'}`}>{marginPct.toFixed(0)}%</p></div>
                </div>
                {calc && calc.isUnderpriced && (
                  <p className="text-[10px] text-amber-400 font-bold mt-2 uppercase tracking-wider">Underpriced — recipe suggests {formatCurrency(calc.suggestedPrice)} for your {product.recipe?.targetMarginPct || 60}% target.</p>
                )}
                {isLossRow && <p className="text-[10px] text-rose-400 font-bold mt-2 uppercase tracking-wider">Selling at a loss! Increase price or reduce ingredient cost.</p>}
                {!isLossRow && marginPct < 20 && <p className="text-[10px] text-amber-400 font-bold mt-2 uppercase tracking-wider">Low margin — consider raising price or reducing costs.</p>}
              </div>
            );
          }) : (
            <div className="text-center py-8">
              <ChefHat className="w-10 h-10 text-zinc-600 mx-auto mb-2" />
              <p className="text-xs text-zinc-500 font-bold uppercase">No eatery or drinks products found</p>
              <p className="text-[10px] text-zinc-600 mt-1">Add products with category "Eatery" or "Drinks" in Stock to see profit analysis</p>
            </div>
          )}
        </div>

        <div className="mt-6 pt-4 border-t border-white/5">
          <p className="text-[10px] text-zinc-600 leading-relaxed">
            <strong className="text-zinc-400">Auto:</strong> costs come from each dish's recipe (ingredients + waste + overhead ÷ yield), prices from your catalog — nothing to type here.
          </p>
        </div>
      </div>
    </div>
  );
}

// Auto ingredient lines: what the dish uses, at what cost — straight from
// the saved recipe, waste-adjusted exactly like the till costs it.
function IngredientLines({ calc, product, formatCurrency }: {
  calc: NonNullable<ReturnType<typeof calculateRecipe>>;
  product: Product;
  formatCurrency: (val: number) => string;
}) {
  const ings = product.recipe?.ingredients || [];
  return (
    <div className="bg-zinc-950 border border-white/5 rounded-xl px-3 py-2 mb-1">
      <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-1">
        Recipe auto-cost • {ings.length} ingredient{ings.length !== 1 ? 's' : ''} → {product.recipe?.yield || 1} serving{(product.recipe?.yield || 1) !== 1 ? 's' : ''}
        {(product.recipe?.overhead || 0) > 0 && <> • overhead {formatCurrency(product.recipe?.overhead || 0)}</>}
      </p>
      <div className="space-y-0.5">
        {ings.map((ing, i) => (
          <div key={ing.id || i} className="flex items-center justify-between gap-2 text-[11px] font-bold">
            <span className="text-zinc-400 truncate min-w-0">{ing.name || 'Unnamed'} <span className="text-zinc-600">×{ing.qty} {ing.unit}{ing.wastePct ? ` (+${ing.wastePct}% waste)` : ''}</span></span>
            <span className="text-zinc-300 shrink-0 tabular-nums">{formatCurrency(ingredientCost(ing))}</span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-2 text-[11px] font-black pt-0.5 border-t border-white/5">
          <span className="text-zinc-300 uppercase">Cost each</span>
          <span className="text-amber-300 tabular-nums">{formatCurrency(calc.cogsPerUnit)}</span>
        </div>
      </div>
    </div>
  );
}
