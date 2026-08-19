import { useState, useMemo } from 'react';
import { Wallet, X, ChefHat, Plus, Trash2 } from 'lucide-react';
import { Product, Expense } from '../types';

const SHOP_CATEGORY_ORDER = ['Electronics', 'Eatery', 'Stationery', 'Printing', 'Tailoring', 'Library', 'Sports', 'Graphics'];

interface QuickExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddExpense: (expense: Expense) => void;
  products: Product[];
  expenseCategories: string[];
  formatCurrency: (val: number) => string;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export default function QuickExpenseModal({ isOpen, onClose, onAddExpense, products, expenseCategories, formatCurrency, triggerToast }: QuickExpenseModalProps) {
  const [expenseTab, setExpenseTab] = useState('General');
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseAmt, setExpenseAmt] = useState('');
  const [expenseCat, setExpenseCat] = useState(expenseCategories[0] || 'Stock Purchase');
  const [expenseIngredients, setExpenseIngredients] = useState<{ id: string; name: string; cost: string }[]>([]);
  const [expenseEateryMode, setExpenseEateryMode] = useState<'stock' | 'dish'>('stock');
  const [expenseDishId, setExpenseDishId] = useState('');
  const [dishIngs, setDishIngs] = useState<{ id: string; name: string; recipeQty: number; unit: string; bought: string; price: string }[]>([]);

  // Tabs = General (default) + every department the shop actually has products
  // for, so a cost gets mapped straight to that department's category.
  const tabs = useMemo(() => {
    const present = Array.from(new Set(products.map(p => p.category).filter((c): c is string => Boolean(c))));
    const ordered = SHOP_CATEGORY_ORDER.filter(c => present.includes(c));
    const extra = present.filter(c => !SHOP_CATEGORY_ORDER.includes(c));
    return ['General', ...ordered, ...extra];
  }, [products]);

  const isEatery = expenseTab === 'Eatery';

  // Dishes that have a recipe (ingredients + yield) can auto-fill the log.
  const recipeDishes = useMemo(() => {
    return products.filter(p =>
      p.category === 'Eatery' &&
      p.recipe && Array.isArray(p.recipe.ingredients) &&
      p.recipe.ingredients.some(i => i.name.trim()) &&
      p.recipe.yield > 0
    );
  }, [products]);

  if (!isOpen) return null;

  const addIngredient = () => {
    setExpenseIngredients(prev => [...prev, { id: `ing-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: '', cost: '' }]);
  };
  const updateIngredient = (id: string, patch: Partial<{ name: string; cost: string }>) => {
    setExpenseIngredients(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
  };
  const removeIngredient = (id: string) => {
    setExpenseIngredients(prev => prev.filter(i => i.id !== id));
  };
  const ingredientsTotal = expenseIngredients.reduce((sum, i) => sum + (parseFloat(i.cost) || 0), 0);

  const selectDish = (id: string) => {
    setExpenseDishId(id);
    const p = products.find(x => x.id === id);
    const ings = (p?.recipe?.ingredients || []).filter(i => i.name.trim());
    setDishIngs(ings.map(i => ({
      id: i.id,
      name: i.name.trim(),
      recipeQty: Math.max(0, i.qty || 0),
      unit: i.unit || 'pcs',
      bought: String(Math.max(0, i.qty || 0)),
      price: String(Math.round(Math.max(0, (i.qty || 0) * (i.unitCost || 0)))),
    })));
  };

  const dishProduct = products.find(p => p.id === expenseDishId);
  const dishYield = dishProduct?.recipe?.yield || 0;
  const sellPrice = dishProduct?.price || 0;
  const dishIngRs = dishIngs.map(ing => {
    const bought = parseFloat(ing.bought) || 0;
    const price = parseFloat(ing.price) || 0;
    return { ...ing, bought, price, total: Math.round(bought * price) };
  });
  const dishSpent = dishIngRs.reduce((s, i) => s + i.total, 0);

  // Pieces you can make = how far the most-used-up ingredient stretches.
  const dishCalc: { pieces: number; limiter: { name: string; bought: number; per: number; unit: string } | null } = (() => {
    let min = Infinity;
    let limiter: { name: string; bought: number; per: number; unit: string } | null = null;
    for (const i of dishIngRs) {
      if (i.bought > 0 && i.recipeQty > 0) {
        const batches = i.bought / i.recipeQty;
        if (batches < min) {
          min = batches;
          limiter = { name: i.name, bought: i.bought, per: i.recipeQty, unit: i.unit };
        }
      }
    }
    const pieces = dishYield > 0 && min !== Infinity ? Math.floor(min * dishYield) : 0;
    return { pieces, limiter };
  })();
  const dishPieces = dishCalc.pieces;
  const dishLimiter = dishCalc.limiter;
  const dishCostPerPiece = dishPieces > 0 ? dishSpent / dishPieces : 0;
  const profitPerPiece = sellPrice - dishCostPerPiece;

  const clearExpenseFields = () => {
    setExpenseDesc('');
    setExpenseAmt('');
    setExpenseIngredients([]);
    setExpenseDishId('');
    setDishIngs([]);
  };

  const handleSubmit = () => {
    let amtNum = 0;
    let description = '';
    let category = expenseCat;

    if (expenseTab === 'General') {
      if (!expenseDesc.trim()) {
        triggerToast('Enter the expense name', 'error');
        return;
      }
      amtNum = parseFloat(expenseAmt) || 0;
      if (amtNum <= 0) {
        triggerToast('Amount must be positive', 'error');
        return;
      }
      description = expenseDesc;
      category = expenseCat;
    } else if (isEatery) {
      if (expenseEateryMode === 'dish') {
        if (!dishProduct) {
          triggerToast('Select the snack you made', 'error');
          return;
        }
        if (!dishIngRs.some(i => i.bought > 0 && i.price > 0)) {
          triggerToast('Enter how much you bought and the cost', 'error');
          return;
        }
        amtNum = dishSpent;
        if (amtNum <= 0) {
          triggerToast('Ingredient costs must be positive', 'error');
          return;
        }
        const names = dishIngRs.filter(i => i.bought > 0 && i.name).map(i => i.name);
        description = names.length ? `Making ${dishProduct.name}: ${names.join(', ')}` : `Making ${dishProduct.name}`;
        category = 'Eatery';
      } else {
        if (expenseIngredients.length === 0 || !expenseIngredients.some(i => i.name.trim() && (parseFloat(i.cost) || 0) > 0)) {
          triggerToast('Add at least one ingredient with a name and cost', 'error');
          return;
        }
        amtNum = ingredientsTotal;
        if (amtNum <= 0) {
          triggerToast('Ingredient costs must be positive', 'error');
          return;
        }
        const ingredientNames = expenseIngredients.map(i => i.name.trim()).filter(Boolean);
        description = `Ingredients: ${ingredientNames.length ? ingredientNames.join(', ') : 'Eatery supplies'}`;
        category = 'Eatery';
      }
    } else {
      amtNum = parseFloat(expenseAmt) || 0;
      if (amtNum <= 0) {
        triggerToast('Amount must be positive', 'error');
        return;
      }
      description = expenseDesc.trim() || expenseTab;
      category = expenseTab;
    }

    const newExpense: Expense = {
      id: `exp-${Date.now()}`,
      timestamp: new Date().toISOString(),
      description,
      amount: amtNum,
      category,
    };
    onAddExpense(newExpense);

    if (isEatery && expenseEateryMode === 'dish' && dishPieces > 0) {
      triggerToast(`About ${dishPieces.toLocaleString()} pieces • ${formatCurrency(Math.round(dishCostPerPiece))} each`, 'success');
    }

    triggerToast(`Expense logged: ${formatCurrency(amtNum)}`, 'success');
    clearExpenseFields();
    onClose();
  };

  const quickAmounts = [2000, 5000, 10000, 20000, 50000, 100000];

  const amountField = (
    <div>
      <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">Amount (UGX)</label>
      <input type="number" placeholder="0" value={expenseAmt} onChange={(e) => setExpenseAmt(e.target.value)}
        className="w-full bg-zinc-900 border border-zinc-800 text-gold-brand font-black text-right rounded-xl h-12 px-4 text-sm outline-none focus:border-emerald-500" />
      <div className="flex flex-wrap gap-1.5 mt-2">
        {quickAmounts.map(amt => (
          <button key={amt} onClick={() => setExpenseAmt(String(amt))}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer active:scale-95 ${expenseAmt === String(amt) ? 'bg-emerald-600 text-black border-emerald-500' : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-600'}`}>
            {amt >= 1000 ? `${(amt / 1000).toFixed(0)}K` : amt}
          </button>
        ))}
      </div>
    </div>
  );

  const dishSpentShown = expenseEateryMode === 'dish' ? dishSpent : ingredientsTotal;

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-md p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4">
          <h3 className="text-sm font-black text-white uppercase tracking-wider font-display flex items-center gap-2">
            <Wallet className="w-4 h-4 text-emerald-400" /> Quick Expense
          </h3>
          <button onClick={() => { setExpenseTab('General'); setExpenseEateryMode('stock'); clearExpenseFields(); onClose(); }} className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-3">
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
            {tabs.map(tab => (
              <button key={tab} onClick={() => setExpenseTab(tab)}
                className={`flex items-center gap-1.5 px-4 h-9 rounded-full font-bold text-xs uppercase tracking-wider whitespace-nowrap transition-all cursor-pointer active:scale-95 ${
                  expenseTab === tab
                    ? 'bg-emerald-500 text-black font-black'
                    : tab === 'Eatery'
                      ? 'border border-amber-500/40 text-amber-400 hover:bg-amber-950/20'
                      : 'border border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
                }`}>
                {tab === 'Eatery' && <ChefHat className="w-3.5 h-3.5" />}
                {tab}
              </button>
            ))}
          </div>

          {expenseTab === 'General' && (
            <>
              <div>
                <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">Expense Name</label>
                <input type="text" placeholder="e.g. Electricity bill, rent, fuel..." value={expenseDesc}
                  onChange={(e) => setExpenseDesc(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-11 px-3 text-xs focus:border-emerald-500 outline-none" />
              </div>
              <div>
                <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">Category</label>
                <select value={expenseCat} onChange={(e) => setExpenseCat(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl h-11 px-2 text-xs outline-none font-bold">
                  {expenseCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              {amountField}
            </>
          )}

          {expenseTab !== 'General' && !isEatery && (
            <>
              <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-xl px-3 py-2 flex items-center gap-2">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Logs to:</span>
                <span className="text-xs font-black text-emerald-400 uppercase">{expenseTab}</span>
              </div>
              <div>
                <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">Note (optional)</label>
                <input type="text" placeholder={`e.g. Stock bought for ${expenseTab}...`} value={expenseDesc}
                  onChange={(e) => setExpenseDesc(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-11 px-3 text-xs focus:border-emerald-500 outline-none" />
              </div>
              {amountField}
            </>
          )}

          {isEatery && (
            <>
              <div className="bg-amber-950/20 border border-amber-500/20 rounded-xl p-3">
                <label className="text-xs text-amber-400 font-bold uppercase mb-1.5 block flex items-center gap-1.5">
                  <ChefHat className="w-3.5 h-3.5" /> Eatery Costs
                </label>
                <p className="text-[10px] text-zinc-500">Log what you bought — the app works out the cost and your profit.</p>
              </div>

              <div className="grid grid-cols-2 gap-1 p-1 bg-zinc-900/80 rounded-xl">
                <button onClick={() => setExpenseEateryMode('stock')}
                  className={`h-10 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${expenseEateryMode === 'stock' ? 'bg-emerald-500 text-black' : 'text-zinc-400 hover:text-zinc-200'}`}>
                  Buying Stock
                </button>
                <button onClick={() => setExpenseEateryMode('dish')}
                  className={`h-10 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${expenseEateryMode === 'dish' ? 'bg-amber-500 text-black' : 'text-zinc-400 hover:text-zinc-200'}`}>
                  Made a Snack
                </button>
              </div>

              {expenseEateryMode === 'stock' ? (
                <div>
                  <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">What did you buy? (name & cost)</label>
                  <div className="space-y-2">
                    {expenseIngredients.length === 0 && (
                      <p className="text-[10px] text-zinc-600 font-bold uppercase">Add each ingredient you bought, e.g. Flour 30000, Oil 15000.</p>
                    )}
                    {expenseIngredients.map(ing => (
                      <div key={ing.id} className="flex gap-2">
                        <input type="text" placeholder="Ingredient name" value={ing.name}
                          onChange={(e) => updateIngredient(ing.id, { name: e.target.value })}
                          className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs outline-none focus:border-emerald-500" />
                        <input type="number" placeholder="Cost" value={ing.cost}
                          onChange={(e) => updateIngredient(ing.id, { cost: e.target.value })}
                          className="w-24 bg-zinc-900 border border-zinc-800 text-gold-brand rounded-xl h-10 px-3 text-xs outline-none focus:border-emerald-500 font-bold text-right" />
                        <button onClick={() => removeIngredient(ing.id)}
                          className="h-10 w-10 shrink-0 flex items-center justify-center text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 rounded-xl transition-colors cursor-pointer">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    <button onClick={addIngredient}
                      className="flex items-center gap-1 text-xs text-emerald-400 font-bold hover:text-emerald-300 transition-colors cursor-pointer">
                      <Plus className="w-3.5 h-3.5" /> Add ingredient
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {recipeDishes.length === 0 ? (
                    <div className="bg-zinc-900/60 border border-dashed border-zinc-700 rounded-xl p-4 text-center">
                      <p className="text-xs font-bold text-zinc-400 uppercase">No recipes yet</p>
                      <p className="text-[10px] text-zinc-500 mt-1 leading-relaxed">Go to <span className="text-gold-brand font-bold">Sell → Eatery Pricing &amp; Recipes</span> and add the ingredients for each snack. Then they will auto-fill here.</p>
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">Which snack did you make?</label>
                        <select value={expenseDishId} onChange={(e) => selectDish(e.target.value)}
                          className="w-full bg-zinc-900 border border-zinc-800 text-gold-brand rounded-xl h-11 px-2 text-xs outline-none font-bold">
                          <option value="">Pick a snack...</option>
                          {recipeDishes.map(p => (
                            <option key={p.id} value={p.id}>{p.name} — sells {formatCurrency(p.price)}</option>
                          ))}
                        </select>
                      </div>

                      {dishProduct && dishIngs.length > 0 && (
                        <>
                          <div className="bg-black/30 border border-white/5 rounded-xl p-3 space-y-2">
                            <div className="grid grid-cols-[1fr_3.5rem_2.25rem_5rem] gap-1.5 text-[9px] text-zinc-500 font-bold uppercase mb-1 items-center">
                              <span>Ingredient</span>
                              <span className="text-center">Bought</span>
                              <span className="text-center">Unit</span>
                              <span className="text-right">Cost Paid</span>
                            </div>
                            {dishIngRs.map(ing => (
                              <div key={ing.id}>
                                <div className="grid grid-cols-[1fr_3.5rem_2.25rem_5rem] gap-1.5 items-center">
                                  <span className="min-w-0 truncate text-xs font-bold text-white uppercase">{ing.name}</span>
                                  <input type="number" min="0" step="any" placeholder="0" value={ing.bought}
                                    onChange={(e) => setDishIngs(prev => prev.map(x => x.id === ing.id ? { ...x, bought: e.target.value } : x))}
                                    className="min-w-0 bg-zinc-950 border border-zinc-800 text-gold-light rounded-lg h-9 px-2 text-xs outline-none focus:border-amber-500 text-right" />
                                  <span className="text-[10px] text-zinc-500 font-bold text-center uppercase">{ing.unit}</span>
                                  <input type="number" min="0" step="any" placeholder="0" value={ing.price}
                                    onChange={(e) => setDishIngs(prev => prev.map(x => x.id === ing.id ? { ...x, price: e.target.value } : x))}
                                    className="min-w-0 bg-zinc-950 border border-zinc-800 text-gold-brand rounded-lg h-9 px-2 text-xs outline-none focus:border-amber-500 text-right font-bold" />
                                </div>
                                <p className="text-[9px] text-zinc-600 mt-0.5 pl-1 font-bold">Recipe: {ing.recipeQty} {ing.unit} per batch</p>
                              </div>
                            ))}
                            <p className="text-[9px] text-zinc-600 font-bold pt-1">Leave "Bought" empty if you already had some — it won't count in the cost.</p>
                          </div>

                          {dishPieces > 0 && (
                            <div className="bg-zinc-900 border border-amber-500/20 rounded-xl p-4 space-y-1.5 text-xs">
                              <div className="flex justify-between items-center pb-1.5 border-b border-zinc-800">
                                <span className="text-[10px] text-zinc-500 font-bold uppercase">You can make</span>
                                <span className="text-base font-black text-white">~{dishPieces.toLocaleString()} pieces</span>
                              </div>
                              {dishLimiter && (
                                <p className="text-[10px] text-amber-400 font-bold">Runs out first: {dishLimiter.name} ({dishLimiter.bought} {dishLimiter.unit} ÷ {dishLimiter.per} per batch)</p>
                              )}
                              <div className="flex justify-between pt-1.5">
                                <span className="text-zinc-400">Cost for the pieces</span>
                                <span className="font-black text-white">{formatCurrency(dishSpent)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-zinc-400">Cost per piece</span>
                                <span className="font-black text-amber-400">{formatCurrency(Math.round(dishCostPerPiece))}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-zinc-400">Sell price</span>
                                <span className="font-black text-gold-brand">{formatCurrency(sellPrice)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-zinc-400">Profit per piece</span>
                                <span className={`font-black ${profitPerPiece >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {profitPerPiece >= 0 ? '+' : ''}{formatCurrency(Math.round(profitPerPiece))}
                                </span>
                              </div>
                            </div>
                          )}
                          {dishSpent > 0 && dishPieces === 0 && (
                            <p className="text-[10px] text-amber-400 font-bold">Enter how much you bought of each ingredient to see how many pieces you can make.</p>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
              )}

              {dishSpentShown > 0 && (
                <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
                  <span className="text-xs text-zinc-400 font-bold uppercase">Total (auto)</span>
                  <span className="text-sm font-black text-gold-brand">{formatCurrency(dishSpentShown)}</span>
                </div>
              )}
            </>
          )}

          <button onClick={handleSubmit}
            className="w-full h-12 bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest text-sm rounded-xl transition-all active:scale-95 shadow-lg flex items-center justify-center gap-2 cursor-pointer">
            <Wallet className="w-4 h-4" /> Log Expense
          </button>
        </div>
      </div>
    </div>
  );
}