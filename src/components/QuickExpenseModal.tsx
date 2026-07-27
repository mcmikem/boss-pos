import { useState } from 'react';
import { Wallet, X, ChefHat } from 'lucide-react';
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

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!expenseDesc.trim() && !expenseBatchMode) {
      triggerToast('Enter a description', 'error');
      return;
    }
    const amtNum = parseFloat(expenseAmt) || 0;
    if (amtNum <= 0) {
      triggerToast('Amount must be positive', 'error');
      return;
    }
    const newExpense: Expense = {
      id: `exp-${Date.now()}`,
      timestamp: new Date().toISOString(),
      description: expenseBatchMode ? `Batch: ${products.find(p => p.id === expenseBatchProductId)?.name || 'Stock'}` : expenseDesc,
      amount: amtNum,
      category: expenseCat,
    };
    onAddExpense(newExpense);

    if (expenseBatchMode && expenseBatchProductId) {
      const unitsNum = parseInt(expenseBatchUnits, 10) || 0;
      if (unitsNum > 0) {
        const costPerUnit = Math.round(amtNum / unitsNum);
        const product = products.find(p => p.id === expenseBatchProductId);
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
    setExpenseBatchProductId('');
    setExpenseBatchUnits('');
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
                <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">What for?</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {['Stock Purchase', 'Transport', 'Utilities', 'Labor', 'Supplies', 'Rent'].map(s => (
                    <button key={s} onClick={() => setExpenseDesc(s)}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer active:scale-95 ${expenseDesc === s ? 'bg-emerald-600 text-black border-emerald-500' : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-600'}`}>
                      {s}
                    </button>
                  ))}
                  <button onClick={() => setExpenseDesc('')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer active:scale-95 ${expenseDesc && !['Stock Purchase', 'Transport', 'Utilities', 'Labor', 'Supplies', 'Rent'].includes(expenseDesc) ? 'bg-emerald-600 text-black border-emerald-500' : 'bg-zinc-900 text-zinc-400 border-zinc-800'}`}>
                    Other
                  </button>
                </div>
                <input type="text" placeholder="Custom description..." value={expenseDesc}
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
            </>
          ) : (
            <div className="space-y-3">
              <div className="bg-amber-950/20 border border-amber-500/20 rounded-xl p-3">
                <label className="text-xs text-amber-400 font-bold uppercase mb-1.5 block">Batch Costing — Eatery Items</label>
                <p className="text-[10px] text-zinc-500 mb-2">Log ingredient cost for a batch and see if you're making profit.</p>
              </div>
              <div>
                <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">Product Made</label>
                <select value={expenseBatchProductId} onChange={(e) => setExpenseBatchProductId(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-gold-brand rounded-xl h-11 px-2 text-xs outline-none font-bold">
                  <option value="">Select product...</option>
                  {products.filter(p => p.category === 'Eatery' || p.category === 'Custom').map(p => (
                    <option key={p.id} value={p.id}>{p.name} — Sell: {formatCurrency(p.price)}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">Total Ingredient Cost</label>
                  <input type="number" placeholder="e.g. 30000" value={expenseAmt}
                    onChange={(e) => setExpenseAmt(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-11 px-3 text-xs outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">Units Produced</label>
                  <input type="number" placeholder="e.g. 100" value={expenseBatchUnits}
                    onChange={(e) => setExpenseBatchUnits(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-11 px-3 text-xs outline-none focus:border-emerald-500" />
                </div>
              </div>
              {expenseBatchProductId && parseFloat(expenseAmt) > 0 && parseInt(expenseBatchUnits) > 0 && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2">
                  {(() => {
                    const totalCost = parseFloat(expenseAmt);
                    const units = parseInt(expenseBatchUnits);
                    const perUnit = Math.round(totalCost / units);
                    const product = products.find(p => p.id === expenseBatchProductId);
                    const sellPrice = product?.price || 0;
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

          <div>
            <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">Amount (UGX)</label>
            <input type="number" placeholder="0" value={expenseAmt} onChange={(e) => setExpenseAmt(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 text-gold-brand font-black text-right rounded-xl h-12 px-4 text-sm outline-none focus:border-emerald-500" />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {quickAmounts.map(amt => (
                <button key={amt} onClick={() => setExpenseAmt(String(amt))}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer active:scale-95 ${expenseAmt === String(amt) ? 'bg-emerald-600 text-black border-emerald-500' : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-600'}`}>
                  {amt >= 1000 ? `${(amt/1000).toFixed(0)}K` : amt}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            {!expenseBatchMode && (
              <button onClick={() => setExpenseBatchMode(true)}
                className="text-[10px] text-amber-400 font-bold uppercase tracking-wider hover:underline flex items-center gap-1 cursor-pointer">
                <ChefHat className="w-3 h-3" /> Batch costing for eatery?
              </button>
            )}
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
