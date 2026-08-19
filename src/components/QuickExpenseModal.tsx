import { useState } from 'react';
import { Wallet, X, ChefHat, Plus, Trash2, TrendingUp, ChevronDown } from 'lucide-react';
import { Product, Expense } from '../types';

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
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseAmt, setExpenseAmt] = useState('');
  const [expenseCat, setExpenseCat] = useState(expenseCategories[0] || 'Stock Purchase');
  const [expenseBatchMode, setExpenseBatchMode] = useState(false);
  const [expenseBatchProductId, setExpenseBatchProductId] = useState('');
  const [expenseBatchUnits, setExpenseBatchUnits] = useState('');
  const [expenseIngredients, setExpenseIngredients] = useState<{ id: string; name: string; cost: string }[]>([]);
  const [expenseShowProfit, setExpenseShowProfit] = useState(false);

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
  const batchProduct = products.find(p => p.id === expenseBatchProductId);

  const handleSubmit = () => {
    if (!expenseDesc.trim() && !expenseBatchMode) {
      triggerToast('Enter the expense name', 'error');
      return;
    }
    let amtNum = parseFloat(expenseAmt) || 0;
    if (expenseBatchMode) {
      if (expenseIngredients.length === 0 || !expenseIngredients.some(i => i.name.trim() && (parseFloat(i.cost) || 0) > 0)) {
        triggerToast('Add at least one ingredient with a name and cost', 'error');
        return;
      }
      if (expenseShowProfit && !expenseBatchProductId) {
        triggerToast('Select the product made', 'error');
        return;
      }
      if (expenseShowProfit && parseInt(expenseBatchUnits, 10) <= 0) {
        triggerToast('Enter units produced', 'error');
        return;
      }
      amtNum = ingredientsTotal;
      if (amtNum <= 0) {
        triggerToast('Ingredient costs must be positive', 'error');
        return;
      }
    } else if (amtNum <= 0) {
      triggerToast('Amount must be positive', 'error');
      return;
    }
    const ingredientNames = expenseIngredients.map(i => i.name.trim()).filter(Boolean);
    const newExpense: Expense = {
      id: `exp-${Date.now()}`,
      timestamp: new Date().toISOString(),
      description: expenseBatchMode
        ? expenseShowProfit && batchProduct
          ? `Batch: ${batchProduct.name}${ingredientNames.length ? ` — ${ingredientNames.join(', ')}` : ''}`
          : `Ingredients: ${ingredientNames.length ? ingredientNames.join(', ') : 'Eatery supplies'}`
        : expenseDesc,
      amount: amtNum,
      category: expenseCat,
    };
    onAddExpense(newExpense);

    if (expenseBatchMode && expenseShowProfit && expenseBatchProductId) {
      const unitsNum = parseInt(expenseBatchUnits, 10) || 0;
      if (unitsNum > 0) {
        const costPerUnit = Math.round(amtNum / unitsNum);
        const product = batchProduct;
        if (product) {
          triggerToast(`Batch: ${unitsNum} units × ${costPerUnit.toLocaleString()} UGX each`, 'success');
          if (costPerUnit >= product.price) {
            triggerToast(`WARNING: Cost (${formatCurrency(costPerUnit)}) >= Price (${formatCurrency(product.price)}) — you're losing money!`, 'error');
          } else {
            const profitPct = Math.round(((product.price - costPerUnit) / product.price) * 100);
            triggerToast(`Profit margin: ${profitPct}% per unit`, 'success');
          }
        }
      }
    }

    triggerToast(`Expense logged: ${formatCurrency(amtNum)}`, 'success');
    setExpenseDesc('');
    setExpenseAmt('');
setExpenseBatchMode(false);
    setExpenseShowProfit(false);
    setExpenseBatchProductId('');
    setExpenseBatchUnits('');
    setExpenseIngredients([]);
    onClose();
  };

  const quickAmounts = [2000, 5000, 10000, 20000, 50000, 100000];

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4">
          <h3 className="text-sm font-black text-white uppercase tracking-wider font-display flex items-center gap-2">
            <Wallet className="w-4 h-4 text-emerald-400" /> Quick Expense
          </h3>
          <button onClick={() => { setExpenseBatchMode(false); onClose(); }} className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          {!expenseBatchMode ? (
            <>
              <div>
                <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">Expense Name</label>
                <input type="text" placeholder="e.g. Flour, fuel, rent..." value={expenseDesc}
                  onChange={(e) => setExpenseDesc(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-11 px-3 text-xs focus:border-emerald-500 outline-none" />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <span className="text-[10px] text-zinc-600 font-bold uppercase self-center">Quick add:</span>
                  {['Stock Purchase', 'Transport', 'Utilities', 'Labor', 'Supplies', 'Rent'].map(s => (
                    <button key={s} onClick={() => setExpenseDesc(s)}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer active:scale-95 ${expenseDesc === s ? 'bg-emerald-600 text-black border-emerald-500' : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-600'}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">Category</label>
                <select value={expenseCat} onChange={(e) => setExpenseCat(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl h-11 px-2 text-xs outline-none font-bold">
                  {expenseCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="bg-amber-950/20 border border-amber-500/20 rounded-xl p-3">
                <label className="text-xs text-amber-400 font-bold uppercase mb-1.5 block">Ingredients — Eatery Supplies</label>
                <p className="text-[10px] text-zinc-500">List what you bought (e.g. Flour 30000, Oil 15000). One ingredient feeds many products — chapati AND samosa — so this logs the purchase once, not per dish.</p>
              </div>
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
                {ingredientsTotal > 0 && (
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-zinc-800">
                    <span className="text-xs text-zinc-400 font-bold uppercase">Total ingredient cost</span>
                    <span className="text-sm font-black text-gold-brand">{formatCurrency(ingredientsTotal)}</span>
                  </div>
                )}
              </div>

              <button onClick={() => setExpenseShowProfit(!expenseShowProfit)}
                className="flex items-center justify-between w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 h-11 text-xs font-bold uppercase tracking-wider text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 transition-colors cursor-pointer">
                <span className="flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5 text-amber-400" /> Profit check on one batch (optional)
                </span>
                <ChevronDown className={`w-4 h-4 transition-transform ${expenseShowProfit ? 'rotate-180' : ''}`} />
              </button>

              {expenseShowProfit && (
                <div className="space-y-3 bg-black/20 border border-white/5 rounded-xl p-3">
                  <p className="text-[10px] text-zinc-600 font-bold uppercase">Used all these ingredients for ONE dish? Pick it to see cost per unit.</p>
                  <div>
                    <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">Product Made</label>
                    <select value={expenseBatchProductId} onChange={(e) => setExpenseBatchProductId(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 text-gold-brand rounded-xl h-10 px-2 text-xs outline-none font-bold">
                      <option value="">Select product...</option>
                      {products.filter(p => ['Eatery', 'Custom', 'Uncategorized'].includes(p.category)).map(p => (
                        <option key={p.id} value={p.id}>{p.name} — Sell: {formatCurrency(p.price)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">Units Produced</label>
                    <input type="number" placeholder="e.g. 100" value={expenseBatchUnits}
                      onChange={(e) => setExpenseBatchUnits(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs outline-none focus:border-emerald-500" />
                  </div>
                  {expenseBatchProductId && ingredientsTotal > 0 && parseInt(expenseBatchUnits) > 0 && (
                    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2">
                      {(() => {
                        const totalCost = ingredientsTotal;
                        const units = parseInt(expenseBatchUnits);
                        const perUnit = Math.round(totalCost / units);
                        const sellPrice = batchProduct?.price || 0;
                        const profitPerUnit = sellPrice - perUnit;
                        const marginPct = sellPrice > 0 ? Math.round((profitPerUnit / sellPrice) * 100) : 0;
                        return (
                          <>
                            <div className="flex justify-between text-xs">
                              <span className="text-zinc-400">Cost per unit</span>
                              <span className="font-bold text-white">{formatCurrency(perUnit)}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-zinc-400">Selling price</span>
                              <span className="font-bold text-gold-brand">{formatCurrency(sellPrice)}</span>
                            </div>
                            <div className="border-t border-zinc-800 pt-2 flex justify-between text-xs">
                              <span className="text-zinc-400">Profit per unit</span>
                              <span className={`font-black ${profitPerUnit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {profitPerUnit >= 0 ? '+' : ''}{formatCurrency(profitPerUnit)}
                              </span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-zinc-400">Margin</span>
                              <span className={`font-black ${marginPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {profitPerUnit >= 0 ? '+' : ''}{marginPct}%
                              </span>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">{expenseBatchMode ? 'Total Ingredient Cost (auto)' : 'Amount (UGX)'}</label>
            {expenseBatchMode ? (
              <div className="w-full bg-zinc-900 border border-zinc-800 text-gold-brand font-black text-right rounded-xl h-12 px-4 text-sm flex items-center justify-end">
                {formatCurrency(ingredientsTotal)}
              </div>
            ) : (
              <input type="number" placeholder="0" value={expenseAmt} onChange={(e) => setExpenseAmt(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 text-gold-brand font-black text-right rounded-xl h-12 px-4 text-sm outline-none focus:border-emerald-500" />
            )}
            {!expenseBatchMode && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {quickAmounts.map(amt => (
                  <button key={amt} onClick={() => setExpenseAmt(String(amt))}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer active:scale-95 ${expenseAmt === String(amt) ? 'bg-emerald-600 text-black border-emerald-500' : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-600'}`}>
                    {amt >= 1000 ? `${(amt/1000).toFixed(0)}K` : amt}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/5">
            <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider flex items-center gap-1.5">
              <ChefHat className="w-3 h-3 text-amber-400" /> Eatery ingredients
            </span>
            <button
              role="switch"
              aria-checked={expenseBatchMode}
              onClick={() => setExpenseBatchMode(!expenseBatchMode)}
              className={`w-12 h-7 rounded-full transition-colors relative cursor-pointer shrink-0 ${
                expenseBatchMode ? 'bg-amber-500' : 'bg-zinc-800'
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${expenseBatchMode ? 'translate-x-5' : ''}`} />
            </button>
          </div>

          <button onClick={handleSubmit}
            className="w-full h-12 bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest text-sm rounded-xl transition-all active:scale-95 shadow-lg flex items-center justify-center gap-2 cursor-pointer">
            <Wallet className="w-4 h-4" /> Log Expense
          </button>
        </div>
      </div>
    </div>
  );
}
