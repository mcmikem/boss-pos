import { useState, useMemo } from 'react';
import { Wallet, Coins, Plus, Trash2, X, Settings2, Hash, Check, Edit2, TrendingDown, LayoutGrid } from 'lucide-react';
import type { Expense, Product, Sale, CreditEat, ProductionRegister, WastageLog, MomoTransfer } from '../types';
import QuickExpenseModal from './QuickExpenseModal';
import CategoryRegister from './CategoryRegister';
import { localDayKey, localMonthKey, todayLocalKey } from '../utils/dates';

interface ExpensesProps {
  expenses: Expense[];
  expenseCategories: string[];
  products: Product[];
  sales: Sale[];
  creditEats: CreditEat[];
  productionRegisters: ProductionRegister[];
  wastageLogs: WastageLog[];
  momoTransfers: MomoTransfer[];
  onAddExpense: (expense: Expense) => void;
  onDeleteExpense: (expenseId: string) => void;
  onAddExpenseCategory: (name: string) => void;
  onUpdateExpenseCategory: (oldName: string, newName: string) => void;
  onDeleteExpenseCategory: (name: string) => void;
  onAddCreditEat: (e: CreditEat) => void;
  onPayCreditEat: (id: string, amount: number) => void;
  onAddProduction: (p: ProductionRegister) => void;
  onDeleteProduction: (id: string) => void;
  onAddWastage: (w: WastageLog) => void;
  onDeleteWastage: (id: string) => void;
  onAddMomoTransfer: (t: MomoTransfer) => void;
  onDeleteMomoTransfer: (id: string) => void;
  formatCurrency: (val: number) => string;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

type TimeFilter = 'today' | 'week' | 'month' | 'all';

const FILTERS: { key: TimeFilter; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: '7 Days' },
  { key: 'month', label: 'This Month' },
  { key: 'all', label: 'All' },
];

const BREAKDOWN_COLORS = [
  'bg-rose-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-blue-500',
  'bg-violet-500',
  'bg-cyan-500',
  'bg-pink-500',
  'bg-lime-500',
];

export default function Expenses({
  expenses, expenseCategories, products, sales,
  creditEats, productionRegisters, wastageLogs, momoTransfers,
  onAddExpense, onDeleteExpense,
  onAddExpenseCategory, onUpdateExpenseCategory, onDeleteExpenseCategory,
  onAddCreditEat, onPayCreditEat, onAddProduction, onDeleteProduction,
  onAddWastage, onDeleteWastage,
  onAddMomoTransfer, onDeleteMomoTransfer,
  formatCurrency, triggerToast,
}: ExpensesProps) {
  const [segment, setSegment] = useState<'general' | 'registers'>('general');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [showQuickExpense, setShowQuickExpense] = useState(false);
  const [showCatManager, setShowCatManager] = useState(false);
  const [catNew, setCatNew] = useState('');
  const [editingCat, setEditingCat] = useState<string | null>(null);
  const [editingCatVal, setEditingCatVal] = useState('');
  const [deleteCatConfirm, setDeleteCatConfirm] = useState<string | null>(null);

  const timeRange = useMemo(() => {
    switch (timeFilter) {
      case 'today': {
        const today = todayLocalKey();
        return { label: 'Today', filter: (ts: string) => localDayKey(ts) === today };
      }
      case 'week': {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 7);
        return { label: 'Last 7 days', filter: (ts: string) => new Date(ts) >= cutoff };
      }
      case 'month': {
        const month = localMonthKey(new Date().toISOString());
        return { label: 'This month', filter: (ts: string) => localMonthKey(ts) === month };
      }
      default:
        return { label: 'All time', filter: () => true };
    }
  }, [timeFilter]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter(e => timeRange.filter(e.timestamp));
  }, [expenses, timeRange]);

  const totalSpent = useMemo(() => {
    return filteredExpenses.reduce((acc, e) => acc + e.amount, 0);
  }, [filteredExpenses]);

  const registerSegments = useMemo(() => {
    const cats = new Set<string>();
    products.forEach(p => { if (p.category) cats.add(p.category); });
    cats.add('Eatery');
    return Array.from(cats).sort();
  }, [products]);

  // Today's collected cash per category (excludes credit/book — that money
  // isn't in hand yet). Money from each buz is sent to Mobile Money.
  const todayCollectedByCategory = useMemo(() => {
    const map: { [key: string]: number } = {};
    const today = todayLocalKey();
    sales.forEach(s => {
      if (s.refunded) return;
      if (s.paymentMethod === 'Credit / Book') return;
      if (localDayKey(s.timestamp) !== today) return;
      s.items.forEach(item => {
        const prod = products.find(p => p.id === item.productId);
        const cat = prod?.category || 'Eatery';
        map[cat] = (map[cat] || 0) + (item.lineTotal || 0);
      });
    });
    return map;
  }, [sales, products]);

  const categoryBreakdown = useMemo(() => {
    const map: { [key: string]: { total: number; count: number } } = {};
    filteredExpenses.forEach(e => {
      if (!map[e.category]) map[e.category] = { total: 0, count: 0 };
      map[e.category].total += e.amount;
      map[e.category].count += 1;
    });
    return Object.entries(map)
      .map(([category, data]) => ({ category, ...data }))
      .sort((a, b) => b.total - a.total);
  }, [filteredExpenses]);

  const topCategory = categoryBreakdown[0] || null;
  const maxCategoryTotal = categoryBreakdown[0]?.total || 1;

  const handleAddCat = () => {
    const name = catNew.trim();
    if (!name) { triggerToast('Category name is required', 'error'); return; }
    if (expenseCategories.includes(name)) { triggerToast('Category already exists', 'error'); return; }
    onAddExpenseCategory(name);
    setCatNew('');
    triggerToast(`Added "${name}" category`, 'success');
  };

  const handleSaveEditCat = () => {
    if (!editingCat) return;
    const name = editingCatVal.trim();
    if (!name) { triggerToast('Category name is required', 'error'); return; }
    if (name !== editingCat && expenseCategories.includes(name)) { triggerToast('Category already exists', 'error'); return; }
    onUpdateExpenseCategory(editingCat, name);
    setEditingCat(null);
  };

  const handleDeleteCat = (name: string) => {
    onDeleteExpenseCategory(name);
    setDeleteCatConfirm(null);
    triggerToast(`Deleted "${name}"`, 'info');
  };

  return (
    <div className="space-y-5" id="expenses-tab-content">
      {/* Segment switch */}
      <div className="flex gap-2">
        <button onClick={() => setSegment('general')}
          className={`flex-1 h-11 rounded-xl text-xs font-black uppercase tracking-wider border transition-all cursor-pointer active:scale-95 ${segment === 'general' ? 'bg-gold-brand border-gold-brand text-black' : 'bg-[#141414]/60 border-white/5 text-zinc-400 hover:text-zinc-200'}`}>
          Expenses
        </button>
        <button onClick={() => setSegment('registers')}
          className={`flex-1 h-11 rounded-xl text-xs font-black uppercase tracking-wider border transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 ${segment === 'registers' ? 'bg-gold-brand border-gold-brand text-black' : 'bg-[#141414]/60 border-white/5 text-zinc-400 hover:text-zinc-200'}`}>
          <LayoutGrid className="w-4 h-4" /> Registers
        </button>
      </div>

      {segment === 'registers' ? (
        <CategoryRegister
          segments={registerSegments}
          products={products}
          creditEats={creditEats}
          productionRegisters={productionRegisters}
          wastageLogs={wastageLogs}
          momoTransfers={momoTransfers}
          todayCollectedByCategory={todayCollectedByCategory}
          onAddCreditEat={onAddCreditEat}
          onPayCreditEat={onPayCreditEat}
          onAddProduction={onAddProduction}
          onDeleteProduction={onDeleteProduction}
          onAddWastage={onAddWastage}
          onDeleteWastage={onDeleteWastage}
          onAddMomoTransfer={onAddMomoTransfer}
          onDeleteMomoTransfer={onDeleteMomoTransfer}
          formatCurrency={formatCurrency}
          triggerToast={triggerToast}
        />
      ) : (
      <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-rose-950/40 border border-rose-800/40 flex items-center justify-center">
            <Wallet className="w-5 h-5 text-rose-400" />
          </div>
          <div>
            <h2 className="text-lg font-black text-white uppercase tracking-tight font-display">Expenses</h2>
            <p className="text-xs text-zinc-500 font-bold">{timeRange.label} • {filteredExpenses.length} entries</p>
          </div>
        </div>
        <button onClick={() => setShowQuickExpense(true)}
          className="h-11 px-4 bg-gold-brand text-black font-black uppercase tracking-wider rounded-xl text-xs hover:opacity-90 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer touch-target">
          <Plus className="w-4 h-4" /> Log Expense
        </button>
      </div>

      {/* Time filter */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setTimeFilter(f.key)}
            className={`py-2.5 px-4 rounded-xl text-xs font-black uppercase tracking-wider transition-all border whitespace-nowrap cursor-pointer active:scale-95 shrink-0 min-h-[44px] ${
              timeFilter === f.key
                ? 'bg-gold-brand border-gold-brand text-black'
                : 'bg-[#141414]/60 border-white/5 text-zinc-400 hover:text-zinc-200'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Summary */}
      <section className="grid grid-cols-2 gap-3">
        <div className="boss-card p-4 border-l-4 border-l-rose-500 flex flex-col justify-between">
          <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Total Spent</p>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-black text-rose-400 font-display">{formatCurrency(totalSpent)}</span>
          </div>
        </div>
        <div className="boss-card p-4 border-l-4 border-l-amber-500 flex flex-col justify-between">
          <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Top Expense</p>
          {topCategory ? (
            <>
              <p className="text-sm font-black text-white font-display truncate mt-2">{topCategory.category}</p>
              <p className="text-[10px] text-zinc-500 font-bold uppercase">{formatCurrency(topCategory.total)} • {topCategory.count}×</p>
            </>
          ) : (
            <p className="text-xs text-zinc-500 font-bold uppercase mt-2">—</p>
          )}
        </div>
      </section>

      {/* What's taking most */}
      <section className="boss-card p-5 rounded-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-rose-400" /> Where the money goes
          </h3>
          <button onClick={() => setShowCatManager(true)}
            className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-gold-brand font-bold uppercase tracking-wider transition-colors cursor-pointer">
            <Settings2 className="w-3.5 h-3.5" /> Manage Categories
          </button>
        </div>
        {categoryBreakdown.length === 0 ? (
          <div className="text-center py-8">
            <Coins className="w-10 h-10 text-zinc-700 mx-auto mb-2" />
            <p className="text-xs text-zinc-500 font-bold uppercase">No expenses in this period</p>
          </div>
        ) : (
          <div className="space-y-3">
            {categoryBreakdown.map((cat, idx) => {
              const pct = totalSpent > 0 ? Math.round((cat.total / totalSpent) * 100) : 0;
              const barPct = Math.max(6, Math.round((cat.total / maxCategoryTotal) * 100));
              const color = BREAKDOWN_COLORS[idx % BREAKDOWN_COLORS.length];
              return (
                <div key={cat.category}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2.5 h-2.5 rounded-full ${color} shrink-0`}></span>
                      <span className="text-xs font-bold text-white uppercase truncate">{cat.category}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-black text-zinc-300 font-mono">{pct}%</span>
                      <span className="text-xs font-black text-rose-400 font-display">{formatCurrency(cat.total)}</span>
                    </div>
                  </div>
                  <div className="h-2 bg-zinc-900 rounded-full overflow-hidden">
                    <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${barPct}%` }} />
                  </div>
                  <p className="text-[10px] text-zinc-600 font-bold mt-0.5 uppercase">{cat.count} entry{cat.count !== 1 ? 's' : ''}</p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* History */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest">Expense History ({timeFilter === 'all' ? 'all' : timeRange.label})</h3>
        {filteredExpenses.length === 0 ? (
          <div className="boss-card p-6 text-center text-zinc-500 text-xs font-bold uppercase">No expenses recorded.</div>
        ) : (
          <div className="space-y-2">
            {filteredExpenses.slice(0, 100).map(exp => (
              <div key={exp.id} className="boss-card flex items-center justify-between p-4 rounded-xl group">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 border border-rose-900/40 bg-rose-950/20 rounded flex items-center justify-center text-rose-400 shrink-0">
                    <Coins className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white uppercase truncate">{exp.description}</p>
                    <p className="text-xs text-zinc-500 font-bold mt-0.5 uppercase truncate">
                      {exp.category} • {new Date(exp.timestamp).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <p className="text-sm font-black text-rose-400 font-display">-{formatCurrency(exp.amount)}</p>
                  <button onClick={() => { onDeleteExpense(exp.id); triggerToast('Deleted expense', 'info'); }}
                    className="p-1.5 text-zinc-600 hover:text-rose-400 transition-all rounded-lg hover:bg-rose-950/30 cursor-pointer touch-target">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Category manager */}
      {showCatManager && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="boss-card w-full max-w-md p-6 bg-zinc-950 border border-white/5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-3 border-b border-white/5">
              <h3 className="text-sm font-black text-white uppercase tracking-wider font-display flex items-center gap-2">
                <Hash className="w-5 h-5 text-gold-brand" /> Expense Categories
              </h3>
              <button onClick={() => setShowCatManager(false)} className="p-1 text-zinc-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex gap-2">
              <input type="text" value={catNew} onChange={(e) => setCatNew(e.target.value)}
                placeholder="New category..." onKeyDown={(e) => e.key === 'Enter' && handleAddCat()}
                className="flex-1 bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
              <button onClick={handleAddCat}
                className="h-10 px-4 bg-gold-brand hover:bg-gold-medium text-black font-black uppercase tracking-widest text-xs rounded-xl flex items-center gap-1.5 shadow-lg cursor-pointer">
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {expenseCategories.map(cat => (
                <div key={cat}
                  className="flex items-center justify-between bg-zinc-900/50 border border-zinc-800/60 rounded-xl px-3 py-2.5 group hover:border-zinc-700 transition-colors">
                  {editingCat === cat ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input type="text" value={editingCatVal} onChange={(e) => setEditingCatVal(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveEditCat()}
                        className="flex-1 bg-zinc-950 border border-gold-brand/40 text-gold-light rounded-lg h-8 px-2 text-xs focus:outline-none" autoFocus />
                      <button onClick={handleSaveEditCat} className="p-1 text-emerald-400 hover:text-emerald-300 cursor-pointer"><Check className="w-4 h-4" /></button>
                      <button onClick={() => setEditingCat(null)} className="p-1 text-zinc-500 hover:text-zinc-300 cursor-pointer"><X className="w-4 h-4" /></button>
                    </div>
                  ) : deleteCatConfirm === cat ? (
                    <div className="flex items-center justify-between flex-1">
                      <span className="text-xs font-bold text-rose-400 uppercase">Delete "{cat}"?</span>
                      <div className="flex gap-1.5">
                        <button onClick={() => setDeleteCatConfirm(null)}
                          className="px-2.5 h-7 text-[10px] font-bold border border-zinc-800 text-zinc-400 rounded-lg hover:bg-zinc-900 cursor-pointer">Cancel</button>
                        <button onClick={() => handleDeleteCat(cat)}
                          className="px-2.5 h-7 text-[10px] font-black bg-rose-600 text-white rounded-lg hover:bg-rose-500 uppercase cursor-pointer">Delete</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="text-xs font-bold text-zinc-300 uppercase tracking-wide">{cat}</span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => { setEditingCat(cat); setEditingCatVal(cat); }}
                          className="p-1.5 text-zinc-500 hover:text-gold-brand rounded-lg hover:bg-zinc-800/50 transition-all cursor-pointer">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setDeleteCatConfirm(cat)}
                          className="p-1.5 text-zinc-500 hover:text-rose-400 rounded-lg hover:bg-zinc-800/50 transition-all cursor-pointer">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
            <div className="pt-2">
              <button onClick={() => setShowCatManager(false)}
                className="w-full h-11 border border-zinc-800 hover:bg-zinc-900 text-zinc-400 font-bold uppercase tracking-wider text-xs rounded-xl cursor-pointer">Done</button>
            </div>
          </div>
        </div>
      )}

      <QuickExpenseModal
        isOpen={showQuickExpense}
        onClose={() => setShowQuickExpense(false)}
        onAddExpense={onAddExpense}
        products={products}
        expenseCategories={expenseCategories}
        formatCurrency={formatCurrency}
        triggerToast={triggerToast}
      />
      </>
      )}
    </div>
  );
}
