import { useState, useMemo, type FormEvent } from 'react';
import { 
  Coins, 
  Smartphone, 
  BookOpen, 
  TrendingUp, 
  Receipt, 
  ArrowUpRight, 
  AlertCircle, 
  Zap,
  ArrowRight,
  X,
  Plus,
  Printer
} from 'lucide-react';
import type { Sale, Expense, Product, StoreSettings } from '../types';
import { t } from '../utils/i18n';
import { localDayKey, todayLocalKey } from '../utils/dates';
import { eateryDayClose } from '../utils/eateryClose';
import ReceiptModal from './ReceiptModal';
import { CATEGORY_VISUALS, DEFAULT_CATEGORY_VISUAL } from '../data/categoryVisuals';

interface DashboardProps {
  sales: Sale[];
  expenses: Expense[];
  products: Product[];
  formatCurrency: (val: number) => string;
  onNavigate: (tab: 'sales' | 'inventory' | 'analytics' | 'registers') => void;
  onRepeatLastSale: () => void;
  onRefundSale: (saleId: string) => void;
  settings: StoreSettings;
  onAddExpense: (expense: Expense) => void;
  expenseCategories: string[];
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export default function Dashboard({ 
  sales, 
  expenses, 
  products, 
  formatCurrency, 
  onNavigate,
  onRepeatLastSale,
  onRefundSale,
  settings,
  onAddExpense,
  expenseCategories,
  triggerToast
}: DashboardProps) {
  const [selectedSaleForModal, setSelectedSaleForModal] = useState<Sale | null>(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [quickExpenseDesc, setQuickExpenseDesc] = useState('');
  const [quickExpenseAmt, setQuickExpenseAmt] = useState('');
  const [quickExpenseCat, setQuickExpenseCat] = useState(expenseCategories[0] || 'Stock Purchase');
  const [showQuickExpense, setShowQuickExpense] = useState(false);
  const [showRepeatConfirm, setShowRepeatConfirm] = useState(false);

  const todayStr = todayLocalKey();

  const todayAllSales = sales.filter(s => localDayKey(s.timestamp) === todayStr);
  const todaySales = todayAllSales.filter(s => !s.refunded);
  const todaySalesSum = todaySales.reduce((acc, s) => acc + s.total, 0);

  const cashCollected = todaySales
    .filter(s => s.paymentMethod === 'Cash')
    .reduce((acc, s) => acc + s.total, 0);

  const momoCollected = todaySales
    .filter(s => s.paymentMethod === 'MTN MoMo' || s.paymentMethod === 'Airtel Money')
    .reduce((acc, s) => acc + s.total, 0);

  const creditIssued = todaySales
    .filter(s => s.paymentMethod === 'Credit / Book')
    .reduce((acc, s) => acc + s.total, 0);

  const todayCostSum = todaySales.reduce((acc, s) => {
    return acc + s.items.reduce((itemAcc, item) => itemAcc + (item.unitCost * item.qty), 0);
  }, 0);
  
  const todayExpensesSum = expenses
    .filter(e => localDayKey(e.timestamp) === todayStr)
    .reduce((acc, e) => acc + e.amount, 0);

  const todayExpenses = expenses.filter(e => localDayKey(e.timestamp) === todayStr);

  const grossProfit = todaySalesSum - todayCostSum;
  const netProfit = grossProfit - todayExpensesSum;

  const lowStockItems = products.filter(p => p.stockQty <= p.lowStockThreshold && !p.isService);

  const hourlySales = Array(13).fill(0);
  todaySales.forEach(sale => {
    const hour = new Date(sale.timestamp).getHours();
    if (hour >= 8 && hour <= 20) {
      hourlySales[hour - 8] += sale.total;
    }
  });
  
  const maxHourlySale = Math.max(...hourlySales, 10);

  // Eatery end-of-day: food sold → ingredients cost → dish profit → minus
  // today's spending = kept or lost. Only shown when the shop sells food.
  const eatery = useMemo(
    () => eateryDayClose(todayStr, sales, products, expenses),
    [todayStr, sales, products, expenses],
  );
  const hasEatery = products.some(p => p.category === 'Eatery') || eatery.saleCount > 0;

  // Evening nudge (#19): after 9pm, once a day, turn today's numbers into the
  // habit of closing the books — while the day is still fresh.
  const [closeNudgeDismissed, setCloseNudgeDismissed] = useState(() => {
    try { return localStorage.getItem(`boss_pos_closenudge_${todayStr}`) === '1'; } catch { return false; }
  });
  const showCloseNudge =
    !closeNudgeDismissed && new Date().getHours() >= 21 && todayAllSales.length > 0;
  const dismissCloseNudge = () => {
    try { localStorage.setItem(`boss_pos_closenudge_${todayStr}`, '1'); } catch {}
    setCloseNudgeDismissed(true);
  };

  // Top 5 products by qty sold today
  const productSales = useMemo(() => {
    const map: Record<string, { qty: number; total: number }> = {};
    todaySales.forEach(sale => {
      sale.items.forEach(item => {
        const key = item.productId;
        if (!map[key]) map[key] = { qty: 0, total: 0 };
        map[key].qty += item.qty;
        map[key].total += item.lineTotal;
      });
    });
    return Object.entries(map)
      .sort((a, b) => b[1].qty - a[1].qty)
      .slice(0, 5);
  }, [todaySales]);

  const handleQuickExpense = (e: FormEvent) => {
    e.preventDefault();
    if (!quickExpenseDesc.trim()) { return; }
    const amt = parseFloat(quickExpenseAmt) || 0;
    if (amt <= 0) { return; }
    onAddExpense({
      id: `exp-${Date.now()}`,
      timestamp: new Date().toISOString(),
      description: quickExpenseDesc,
      amount: amt,
      category: quickExpenseCat,
    });
    setQuickExpenseDesc('');
    setQuickExpenseAmt('');
    setShowQuickExpense(false);
  };

  return (
    <div className="space-y-6 animate-fade-in" id="dashboard-tab-content">
      <section className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <p className="text-xs font-bold text-gold-brand uppercase tracking-widest mb-1 font-display">
            {settings.shopName || 'My Shop'}
          </p>
          <h2 className="text-3xl font-black text-white uppercase tracking-tight font-display">
            {t(settings.language, 'todaysSummary')}
          </h2>
        </div>
        
        {sales.length > 0 && (
          <button 
            onClick={() => setShowRepeatConfirm(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#141414] border border-white/5 hover:border-gold-brand/40 text-gold-light rounded-2xl text-xs font-black tracking-widest uppercase transition-all active:scale-95 cursor-pointer"
            id="repeat-last-sale-btn"
          >
            <Zap className="w-3.5 h-3.5 text-gold-brand" />
            Repeat Last Sale
          </button>
        )}
      </section>

      {showCloseNudge && (
        <section aria-label="Close today" className="boss-card p-5 border border-gold-brand/30 bg-gold-brand/5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-gold-brand/15 border border-gold-brand/30 flex items-center justify-center shrink-0">
              <Receipt className="w-5 h-5 text-gold-brand" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-xs font-black text-white uppercase tracking-widest">Day done?</h3>
              <p className="text-xs text-zinc-300 font-bold mt-1 leading-relaxed">
                Today: {todayAllSales.length} sale{todayAllSales.length !== 1 ? 's' : ''} · {formatCurrency(todaySalesSum)}.
                {netProfit >= 0 ? ` ${t(settings.language, 'youKept')} ${formatCurrency(netProfit)}.` : ` ${t(settings.language, 'youLost')} ${formatCurrency(-netProfit)}.`} Close the books while it's fresh.
              </p>
              <div className="flex gap-2 mt-3">
                <button type="button" onClick={() => onNavigate('registers')}
                  className="h-11 px-5 bg-gold-brand text-black font-black uppercase tracking-widest text-xs rounded-xl hover:opacity-90 active:scale-95 transition-all cursor-pointer">
                  {t(settings.language, 'closeDayCta')}
                </button>
                <button type="button" onClick={dismissCloseNudge}
                  className="h-11 px-4 border border-zinc-700 text-zinc-400 font-bold uppercase tracking-wider text-xs rounded-xl hover:text-zinc-200 active:scale-95 transition-all cursor-pointer">
                  Not yet
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        
        <button
          type="button"
          onClick={() => onNavigate('sales')}
          aria-label={`Cash box ${formatCurrency(cashCollected)}. Cash in drawer. Go to sell screen.`}
          className="boss-card border-t-4 border-t-emerald-500 p-4 flex flex-col justify-between min-h-36 min-w-0 w-full text-left cursor-pointer active:scale-98 transition-all hover:border-emerald-500/30 group focus-visible:outline-2 focus-visible:outline-gold-brand"
          id="kpi-cash-box"
        >
          <div className="flex justify-between items-start gap-2">
            <span className="text-xs font-bold text-emerald-400 bg-emerald-950/40 px-2 py-1 border border-emerald-800/30 rounded-lg uppercase tracking-wider truncate">Cash Box</span>
            <Coins className="w-5 h-5 text-emerald-400 shrink-0" />
          </div>
          <div className="mt-2 min-w-0">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Sente Enkalu</p>
            <p className="text-lg sm:text-xl font-black text-white font-display truncate tabular-nums" title={formatCurrency(cashCollected)}>{formatCurrency(cashCollected)}</p>
            <p className="text-xs text-zinc-400 mt-1 uppercase tracking-wide group-hover:text-zinc-300 truncate">Cash in drawer</p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('sales')}
          aria-label={`Mobile money received ${formatCurrency(momoCollected)}. MTN and Airtel. Go to sell screen.`}
          className="boss-card border-t-4 border-t-yellow-500 p-4 flex flex-col justify-between min-h-36 min-w-0 w-full text-left cursor-pointer active:scale-98 transition-all hover:border-yellow-500/30 group focus-visible:outline-2 focus-visible:outline-gold-brand"
          id="kpi-momo-collected"
        >
          <div className="flex justify-between items-start gap-2">
            <span className="text-xs font-bold text-yellow-400 bg-yellow-950/45 px-2 py-1 border border-yellow-800/30 rounded-lg uppercase tracking-wider truncate">MoMo Received</span>
            <Smartphone className="w-5 h-5 text-yellow-400 shrink-0" />
          </div>
          <div className="mt-2 min-w-0">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Sente z'Esimu</p>
            <p className="text-lg sm:text-xl font-black text-white font-display truncate tabular-nums" title={formatCurrency(momoCollected)}>{formatCurrency(momoCollected)}</p>
            <p className="text-xs text-zinc-400 mt-1 uppercase tracking-wide group-hover:text-zinc-300 truncate">MTN & Airtel</p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('sales')}
          aria-label={`Credit given ${formatCurrency(creditIssued)}. To collect from customers. Go to sell screen.`}
          className="boss-card border-t-4 border-t-blue-500 p-4 flex flex-col justify-between min-h-36 min-w-0 w-full text-left cursor-pointer active:scale-98 transition-all hover:border-blue-500/30 group focus-visible:outline-2 focus-visible:outline-gold-brand"
          id="kpi-credit-book"
        >
          <div className="flex justify-between items-start gap-2">
            <span className="text-xs font-bold text-blue-400 bg-blue-950/40 px-2 py-1 border border-blue-800/30 rounded-lg uppercase tracking-wider truncate">Credit Given</span>
            <BookOpen className="w-5 h-5 text-blue-400 shrink-0" />
          </div>
          <div className="mt-2 min-w-0">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Amabanja</p>
            <p className="text-lg sm:text-xl font-black text-white font-display truncate tabular-nums" title={formatCurrency(creditIssued)}>{formatCurrency(creditIssued)}</p>
            <p className="text-xs text-zinc-400 mt-1 uppercase tracking-wide group-hover:text-zinc-300 truncate">To collect from customers</p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('analytics')}
          aria-label={`Today's profit ${formatCurrency(netProfit)}. After costs and expenses. Go to reports.`}
          className="boss-card border-t-4 border-t-gold-brand p-4 flex flex-col justify-between min-h-36 min-w-0 w-full text-left cursor-pointer active:scale-98 transition-all hover:border-gold-brand/30 group focus-visible:outline-2 focus-visible:outline-gold-brand"
          id="kpi-magoba-profit"
        >
          <div className="flex justify-between items-start gap-2">
            <span className="text-xs font-bold text-gold-brand bg-gold-brand/10 px-2 py-1 border border-gold-brand/20 rounded-lg uppercase tracking-wider truncate">Today's Profit</span>
            <TrendingUp className="w-5 h-5 text-gold-brand shrink-0" />
          </div>
          <div className="mt-2 min-w-0">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Magoba</p>
            <p className={`text-lg sm:text-xl font-black font-display truncate tabular-nums ${netProfit >= 0 ? 'text-gold-brand' : 'text-rose-400'}`} title={formatCurrency(netProfit)}>{formatCurrency(netProfit)}</p>
            {/* Profit in words (#17): beginners read "You kept X", not signs. */}
            <p className="text-xs text-zinc-400 mt-1 uppercase tracking-wide group-hover:text-zinc-300 truncate">
              {netProfit >= 0 ? `${t(settings.language, 'youKept')} ${formatCurrency(netProfit)}` : `${t(settings.language, 'youLost')} ${formatCurrency(-netProfit)}`}
            </p>
          </div>
        </button>

      </section>

      {/* Loss/profit drill-down: a bare "Lost 20,000" means nothing without the
          maths. Expandable so beginners see exactly how today added up. */}
      <details className="boss-card p-4" id="profit-breakdown">
        <summary className="text-xs font-black text-gold-brand uppercase tracking-widest cursor-pointer hover:text-gold-light touch-target">
          How did today add up?
        </summary>
        <div className="mt-2 space-y-1 text-xs font-bold tabular-nums">
          <div className="flex justify-between gap-2">
            <span className="text-zinc-500 uppercase">Sales in</span>
            <span className="text-zinc-100">+{formatCurrency(todaySalesSum)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-zinc-500 uppercase">Ingredient cost</span>
            <span className="text-amber-300">−{formatCurrency(todayCostSum)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-zinc-500 uppercase">Spending ({todayExpenses.length})</span>
            <span className="text-rose-300">−{formatCurrency(todayExpensesSum)}</span>
          </div>
          <div className="flex justify-between gap-2 pt-1 border-t border-white/5">
            <span className="text-zinc-300 uppercase">= {netProfit >= 0 ? t(settings.language, 'youKept') : t(settings.language, 'youLost')}</span>
            <span className={netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{formatCurrency(netProfit >= 0 ? netProfit : -netProfit)}</span>
          </div>
          {[...todayExpenses].sort((a, b) => b.amount - a.amount).slice(0, 3).map(e => (
            <div key={e.id} className="flex justify-between gap-2 text-[11px]">
              <span className="text-zinc-500 truncate min-w-0">{e.description}</span>
              <span className="text-zinc-400 shrink-0">−{formatCurrency(e.amount)}</span>
            </div>
          ))}
        </div>
      </details>

      {hasEatery && (
        <section aria-label="Eatery profit today" id="eatery-day-close"
          className={`boss-card p-5 border-t-4 ${eatery.verdict === 'lost' ? 'border-t-rose-500' : eatery.verdict === 'kept' ? 'border-t-emerald-500' : 'border-t-gold-brand'}`}>
          <div className="flex justify-between items-center gap-2 mb-3">
            <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest">Eatery — today</h3>
            {eatery.saleCount > 0 && (
              <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wider bg-black/30 border border-white/5 rounded-full px-2.5 py-1">
                {eatery.saleCount} order{eatery.saleCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {eatery.verdict === 'none' ? (
            <p className="text-sm text-zinc-400 font-bold text-center py-4">
              No food sold yet today — tonight's profit will show here.
            </p>
          ) : (
            <>
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">End of day</p>
              <p className={`text-3xl font-black font-display tabular-nums mt-1 ${eatery.verdict === 'kept' ? 'text-emerald-400' : eatery.verdict === 'lost' ? 'text-rose-400' : 'text-gold-brand'}`}
                title={formatCurrency(eatery.left)}>
                {eatery.verdict === 'kept' && `You kept ${formatCurrency(eatery.left)}`}
                {eatery.verdict === 'lost' && `Lost ${formatCurrency(-eatery.left)} today`}
                {eatery.verdict === 'flat' && 'Broke even today'}
              </p>
              <p className="text-xs text-zinc-500 font-bold uppercase mt-1 tabular-nums">
                from {formatCurrency(eatery.revenue)} of food sold
              </p>

              <div className="mt-4 space-y-1.5 border-t border-white/5 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-400 uppercase">Food sold</span>
                  <span className="text-sm font-black text-white tabular-nums">{formatCurrency(eatery.revenue)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-400 uppercase">Ingredients cost</span>
                  <span className="text-sm font-black text-amber-300 tabular-nums">−{formatCurrency(eatery.foodCost)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-400 uppercase">Dish profit</span>
                  <span className={`text-sm font-black tabular-nums ${eatery.dishProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {formatCurrency(eatery.dishProfit)}
                    <span className="text-[10px] text-zinc-500 font-bold"> · {Math.round(eatery.marginPct)}%</span>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-400 uppercase">Spending today</span>
                  <span className="text-sm font-black text-rose-400 tabular-nums">−{formatCurrency(eatery.expenses)}</span>
                </div>
                <p className="text-[10px] text-zinc-600 font-bold uppercase">Spending covers the whole shop (charcoal, stock, rent…)</p>
              </div>

              {eatery.dishes.length > 0 && (
                <div className="mt-3 space-y-1.5 border-t border-white/5 pt-3">
                  <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Best dishes</p>
                  {eatery.dishes.slice(0, 4).map(d => (
                    <div key={d.productId} className="flex items-center justify-between bg-black/30 rounded-lg px-3 py-2 min-w-0">
                      <p className="text-xs font-bold text-white uppercase truncate min-w-0">
                        {d.name} <span className="text-zinc-500 tabular-nums">×{d.qty}</span>
                      </p>
                      <p className={`text-xs font-black tabular-nums shrink-0 ml-2 ${d.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {d.profit >= 0 ? '+' : '−'}{formatCurrency(Math.abs(d.profit))}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <button type="button" onClick={() => onNavigate('analytics')}
                className="mt-4 w-full h-11 rounded-2xl text-xs font-black uppercase tracking-wider border border-white/10 text-zinc-400 hover:border-gold-brand/50 hover:text-gold-brand transition-all active:scale-[0.98] cursor-pointer">
                Full reports
              </button>
            </>
          )}
        </section>
      )}

      {lowStockItems.length > 0 && (
        <section className="bg-amber-950/25 border border-amber-500/20 p-4 rounded-3xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5 animate-pulse" />
          <div>
            <h4 className="text-xs font-black text-amber-400 uppercase tracking-wider font-display">
              Running Low on Stock! ({lowStockItems.length} items)
            </h4>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Reorder soon: <span className="text-zinc-200 font-semibold">
                {lowStockItems.slice(0, 3).map(p => `${p.name} (${p.stockQty} left)`).join(', ')}
              </span>
            </p>
            <button onClick={() => onNavigate('inventory')} className="text-xs text-gold-brand hover:underline font-bold mt-2 uppercase tracking-wider flex items-center gap-1 cursor-pointer">
              Go to Stock <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </section>
      )}

      <section className="boss-card p-5">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest">
            {showQuickExpense ? 'Quick Expense' : "Today's Spending"}
          </h3>
          <div className="flex items-center gap-2">
            <p className="text-xs font-black text-rose-400 font-display">-{formatCurrency(todayExpensesSum)}</p>
            <button onClick={() => setShowQuickExpense(!showQuickExpense)}
              className="p-1.5 text-zinc-500 hover:text-gold-brand rounded-lg hover:bg-white/5 transition-all">
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
        {showQuickExpense ? (
          <form onSubmit={handleQuickExpense} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input type="text" placeholder="e.g. Flour" value={quickExpenseDesc}
                onChange={(e) => setQuickExpenseDesc(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
              <input type="number" placeholder="Amount" value={quickExpenseAmt}
                onChange={(e) => setQuickExpenseAmt(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 text-gold-brand rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none font-bold" />
            </div>
            <div className="flex gap-2">
              <select value={quickExpenseCat} onChange={(e) => setQuickExpenseCat(e.target.value)}
                className="flex-1 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl h-10 px-2 text-xs focus:border-gold-brand focus:outline-none font-bold">
                {expenseCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
              <button type="submit" className="h-10 px-4 bg-rose-600 hover:bg-rose-500 text-white font-black uppercase tracking-widest text-xs rounded-xl shadow-lg">
                Log
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-1.5 max-h-36 overflow-y-auto">
            {todayExpenses.length > 0 ? todayExpenses.map(exp => (
              <div key={exp.id} className="flex items-center justify-between bg-black/30 rounded-lg px-3 py-2">
                <div>
                  <p className="text-xs font-bold text-white uppercase">{exp.description}</p>
                  <p className="text-[10px] text-zinc-500 font-bold uppercase">{exp.category}</p>
                </div>
                <p className="text-xs font-black text-rose-400">-{formatCurrency(exp.amount)}</p>
              </div>
            )) : (
              <p className="text-xs text-zinc-500 font-bold uppercase text-center py-4">No expenses today</p>
            )}
          </div>
        )}
      </section>

      <section className="boss-card p-5">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest">Hourly Sales</h3>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-gold-brand"></span>
            <span className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Revenue</span>
          </div>
        </div>

        <div className="w-full h-32 flex items-end justify-between gap-1.5 pt-4 border-b border-white/5">
          {hourlySales.map((salesVal, idx) => {
            const pct = maxHourlySale > 0 ? (salesVal / maxHourlySale) * 100 : 0;
            const hourLabel = idx + 8;
            const isPeak = pct > 75;

            return (
              <div key={idx} className="flex-1 flex flex-col items-center h-full justify-end group relative">
                <div className="absolute -top-7 bg-[#141414] border border-white/5 text-xs text-gold-brand px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity z-20 pointer-events-none font-bold whitespace-nowrap">
                  {formatCurrency(salesVal)}
                </div>
                <div className={`w-full rounded-t transition-all duration-500 ${
                  isPeak ? 'bg-gradient-to-t from-gold-medium to-gold-brand shadow-[0_-4px_10px_rgba(255,204,0,0.35)]' : 'bg-zinc-800 group-hover:bg-zinc-700'
                }`} style={{ height: `${Math.max(pct, 5)}%` }}></div>
                <span className="text-xs text-zinc-500 font-bold mt-2">{hourLabel === 12 ? '12:00' : `${hourLabel}:00`}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="boss-card p-5">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest">Top Products Today</h3>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-gold-brand"></span>
            <span className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Units</span>
          </div>
        </div>

        <div className="space-y-2">
{productSales.length > 0 ? productSales.map(([productId, { qty, total }]) => {
            const product = products.find(p => p.id === productId) || { name: 'Unknown', category: 'Graphics' };
            const catVis = CATEGORY_VISUALS[product.category] || DEFAULT_CATEGORY_VISUAL;
            const Icon = catVis.icon;
            return (
              <div key={productId} className="flex items-center justify-between bg-black/30 rounded-lg px-3 py-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 border border-white/5 bg-[#0A0A0A] rounded-xl flex items-center justify-center text-zinc-400">
                    <Icon className="w-5 h-5 text-gold-light" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white uppercase tracking-wider group-hover:text-gold-light transition-colors">{product.name}</p>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase">{qty} × sold</p>
                  </div>
                  <span className="text-gold-light font-black">{formatCurrency(total)}</span>
                </div>
              </div>
            );
          }) : (
            <p className="text-xs text-zinc-500 font-bold uppercase text-center py-4">No sales today</p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest">Recent Sales</h3>
          <button onClick={() => onNavigate('analytics')} className="text-xs text-gold-brand hover:underline font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer">
            All Reports <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="space-y-2">
          {todayAllSales.slice(0, 5).map((sale) => {
            let paymentBadge = null;
            if (sale.paymentMethod === 'Cash') {
              paymentBadge = <span className="text-[10px] font-bold bg-emerald-950/40 text-emerald-400 px-2 py-0.5 border border-emerald-800/30 rounded uppercase tracking-wider">Cash</span>;
            } else if (sale.paymentMethod === 'MTN MoMo') {
              paymentBadge = <span className="text-[10px] font-bold bg-amber-950/40 text-yellow-400 px-2 py-0.5 border border-yellow-800/30 rounded uppercase tracking-wider">MTN</span>;
            } else if (sale.paymentMethod === 'Airtel Money') {
              paymentBadge = <span className="text-[10px] font-bold bg-rose-950/40 text-red-400 px-2 py-0.5 border border-rose-800/30 rounded uppercase tracking-wider">Airtel</span>;
            } else if (sale.paymentMethod === 'Credit / Book') {
              paymentBadge = <span className="text-[10px] font-bold bg-blue-950/40 text-blue-400 px-2 py-0.5 border border-blue-800/30 rounded uppercase tracking-wider">Credit</span>;
            }

            return (
              <div key={sale.id} onClick={() => setSelectedSaleForModal(sale)}
                className="boss-card flex items-center justify-between p-4 hover:border-gold-brand/20 transition-all active:scale-[0.99] cursor-pointer group">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 border border-white/5 bg-[#0A0A0A] group-hover:border-gold-brand/30 rounded-xl flex items-center justify-center text-zinc-400 transition-colors">
                    <Receipt className="w-5 h-5 text-gold-light group-hover:text-gold-brand transition-colors" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-bold text-white uppercase tracking-wider group-hover:text-gold-light transition-colors">{sale.orderNumber}</p>
                      {paymentBadge}
                      {sale.refunded && <span className="text-[10px] font-bold bg-rose-950/40 text-rose-400 px-2 py-0.5 border border-rose-800/30 rounded uppercase tracking-wider">Refunded</span>}
                    </div>
                    <p className="text-xs text-zinc-500 font-bold mt-0.5">
                      {new Date(sale.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {sale.items.length} items{sale.customerName ? ` • ${sale.customerName}` : ''}
                    </p>
                  </div>
                </div>
                <p className="text-sm font-black text-gold-brand font-display">+{formatCurrency(sale.total)}</p>
              </div>
            );
          })}
          
          {sales.length === 0 && (
            <div className="boss-card p-8 text-center">
              <Receipt className="w-10 h-10 text-zinc-600 mx-auto mb-2" />
              <p className="text-sm text-zinc-400 font-bold uppercase tracking-wider">No Sales Today</p>
              <button onClick={() => onNavigate('sales')} className="mt-3 text-xs text-gold-brand font-black uppercase tracking-widest hover:underline">+ Start a Sale</button>
            </div>
          )}
        </div>
      </section>

      {/* RECEIPT MODAL */}
      {selectedSaleForModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-sm p-6 shadow-2xl relative overflow-x-hidden overflow-y-auto animate-in fade-in zoom-in-95 duration-150 max-h-[92vh]">
            <div className="absolute -right-16 -top-16 w-36 h-36 rounded-full bg-gold-brand/10 blur-2xl pointer-events-none"></div>

            <div className="flex justify-between items-center pb-3 border-b border-white/5 mb-4">
              <div className="flex items-center gap-2">
                <Receipt className="w-4 h-4 text-gold-brand" />
                <h3 className="text-xs font-black text-white uppercase tracking-widest font-display">Receipt</h3>
              </div>
              <button onClick={() => setSelectedSaleForModal(null)} className="p-1.5 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors cursor-pointer"><X className="w-4.5 h-4.5" /></button>
            </div>

              <div className="bg-black/45 border border-white/5 rounded-2xl p-4 font-mono text-xs text-zinc-300 space-y-3 shadow-inner relative">
                <div className="text-center pb-2 border-b border-dashed border-zinc-800">
                  <p className="text-white font-bold uppercase tracking-widest text-sm font-display">{settings.shopName}</p>
                  <p className="text-xs text-zinc-500 uppercase font-sans mt-0.5">Uganda • POS</p>
                  <p className="text-xs text-zinc-600 mt-1 uppercase">{new Date(selectedSaleForModal.timestamp).toLocaleString()}</p>
                </div>

                <div className="space-y-1.5 py-1">
                  {selectedSaleForModal.items.map((item, i) => (
                    <div key={i} className="flex justify-between items-start gap-3 py-0.5">
                      <span className="truncate flex-1">
                        <span className="uppercase text-zinc-200">{item.productName}</span>
                        {item.variantLabel && <span className="block text-[10px] text-zinc-500 uppercase">{item.variantLabel}</span>}
                      </span>
                      <span className="text-zinc-500 shrink-0">x{item.qty}</span>
                      <span className="text-gold-light shrink-0">{formatCurrency(item.lineTotal)}</span>
                    </div>
                  ))}
                </div>

                <div className="pt-2 border-t border-dashed border-zinc-800 space-y-1">
                  <div className="flex justify-between text-white font-bold text-sm pt-1 border-t border-zinc-900 font-sans">
                    <span className="uppercase tracking-wider">TOTAL</span>
                    <span className="text-gold-brand font-black font-display text-lg">{formatCurrency(selectedSaleForModal.total)}</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-zinc-900 flex justify-between items-center text-xs text-zinc-400 font-sans uppercase">
                  <span>PAYMENT:</span>
                  <span className="font-bold text-zinc-200">{selectedSaleForModal.paymentMethod}{selectedSaleForModal.customerName ? ` • ${selectedSaleForModal.customerName}` : ''}</span>
                </div>
              </div>

            {selectedSaleForModal.refunded && (
              <div className="mt-3 bg-rose-950/25 border border-rose-800/30 rounded-xl py-2 text-center text-xs font-black text-rose-400 uppercase tracking-widest">
                Refunded {selectedSaleForModal.refundedAt ? `• ${new Date(selectedSaleForModal.refundedAt).toLocaleDateString()}` : ''}
              </div>
            )}

            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowReceiptModal(true)}
                className="flex-1 h-11 bg-zinc-800 hover:bg-zinc-700 text-white font-black uppercase text-xs tracking-widest rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2">
                <Printer className="w-4 h-4" /> Receipt
              </button>
            </div>
            <div className="flex gap-2 mt-2">
              {!selectedSaleForModal.refunded && (
                <button onClick={() => {
                  if (confirm('Refund this sale? Stock will be restored.')) {
                    onRefundSale(selectedSaleForModal.id);
                    setSelectedSaleForModal(null);
                  }
                }} className="flex-1 h-11 bg-rose-600 hover:bg-rose-700 text-white font-black uppercase text-xs tracking-widest rounded-xl transition-all active:scale-95">
                  Refund
                </button>
              )}
              <button onClick={() => setSelectedSaleForModal(null)} className="flex-1 h-11 bg-gold-brand text-black font-black uppercase text-xs tracking-widest rounded-xl transition-all active:scale-95 shadow-[0_4px_12px_rgba(255,204,0,0.15)]">Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Repeat Last Sale Confirmation */}
      {showRepeatConfirm && sales.length > 0 && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-sm p-6 shadow-2xl">
            <h3 className="text-sm font-black text-white uppercase tracking-wider text-center mb-2">Repeat Last Sale?</h3>
            <p className="text-xs text-zinc-400 text-center mb-1">Load items from</p>
            <p className="text-sm font-black text-gold-brand text-center mb-4">{sales[0].orderNumber} ({sales[0].items.length} items)</p>
            <div className="flex gap-2">
              <button onClick={() => setShowRepeatConfirm(false)}
                className="flex-1 h-11 border border-zinc-800 text-zinc-400 font-bold text-xs rounded-xl uppercase tracking-wider">Cancel</button>
              <button onClick={() => { setShowRepeatConfirm(false); onRepeatLastSale(); }}
                className="flex-1 h-11 bg-gold-brand text-black font-black text-xs rounded-xl uppercase tracking-widest">Load Items</button>
            </div>
          </div>
        </div>
      )}

      {showReceiptModal && selectedSaleForModal && (
        <ReceiptModal
          sale={selectedSaleForModal}
          settings={settings}
          formatCurrency={formatCurrency}
          onClose={() => setShowReceiptModal(false)}
          triggerToast={triggerToast}
          onFiscalUpdate={(updated) => setSelectedSaleForModal(updated)}
        />
      )}
    </div>
  );
}