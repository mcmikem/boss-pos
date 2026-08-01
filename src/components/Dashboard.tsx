import { useState, type FormEvent } from 'react';
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
  Share2,
  Plus,
  Printer
} from 'lucide-react';
import type { Sale, Expense, Product, StoreSettings } from '../types';
import { printReceipt } from '../utils/receipt';

interface DashboardProps {
  sales: Sale[];
  expenses: Expense[];
  products: Product[];
  formatCurrency: (val: number) => string;
  onNavigate: (tab: 'sales' | 'inventory' | 'analytics') => void;
  onRepeatLastSale: () => void;
  onRefundSale: (saleId: string) => void;
  settings: StoreSettings;
  onAddExpense: (expense: Expense) => void;
  expenseCategories: string[];
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
  expenseCategories
}: DashboardProps) {
  const [selectedSaleForModal, setSelectedSaleForModal] = useState<Sale | null>(null);
  const [quickExpenseDesc, setQuickExpenseDesc] = useState('');
  const [quickExpenseAmt, setQuickExpenseAmt] = useState('');
  const [quickExpenseCat, setQuickExpenseCat] = useState(expenseCategories[0] || 'Stock Purchase');
  const [showQuickExpense, setShowQuickExpense] = useState(false);
  const [showRepeatConfirm, setShowRepeatConfirm] = useState(false);

  const todayStr = new Date().toISOString().split('T')[0];
  
  const todayAllSales = sales.filter(s => s.timestamp.startsWith(todayStr));
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
    .filter(e => e.timestamp.startsWith(todayStr))
    .reduce((acc, e) => acc + e.amount, 0);

  const todayExpenses = expenses.filter(e => e.timestamp.startsWith(todayStr));

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

  const shareReceiptViaWhatsApp = (sale: Sale) => {
    const itemsList = sale.items.map(i => `${i.productName} x${i.qty} = ${formatCurrency(i.lineTotal)}`).join('\n');
    const msg = `*${settings.shopName}*\n${sale.orderNumber}\n${new Date(sale.timestamp).toLocaleString()}\n\n${itemsList}\n\nTotal: ${formatCurrency(sale.total)}\nPayment: ${sale.paymentMethod}${sale.customerName ? `\nCustomer: ${sale.customerName}` : ''}`;
    const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-6 animate-fade-in" id="dashboard-tab-content">
      <section className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <p className="text-xs font-bold text-gold-brand uppercase tracking-widest mb-1 font-display">
            {settings.shopName || 'My Shop'}
          </p>
          <h2 className="text-3xl font-black text-white uppercase tracking-tight font-display">
            Today's Summary
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

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        
        <div 
          onClick={() => onNavigate('sales')}
          className="boss-card border-t-4 border-t-emerald-500 p-4 flex flex-col justify-between h-36 cursor-pointer active:scale-98 transition-all hover:border-emerald-500/30 group"
          id="kpi-cash-box"
        >
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold text-emerald-400 bg-emerald-950/40 px-2 py-1 border border-emerald-800/30 rounded-lg uppercase tracking-wider">Cash Box</span>
            <Coins className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="mt-2">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Sente Enkalu</p>
            <p className="text-xl font-black text-white font-display truncate">{formatCurrency(cashCollected)}</p>
            <p className="text-xs text-zinc-400 mt-1 uppercase tracking-wide group-hover:text-zinc-300">Cash in drawer</p>
          </div>
        </div>

        <div 
          onClick={() => onNavigate('sales')}
          className="boss-card border-t-4 border-t-yellow-500 p-4 flex flex-col justify-between h-36 cursor-pointer active:scale-98 transition-all hover:border-yellow-500/30 group"
          id="kpi-momo-collected"
        >
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold text-yellow-400 bg-yellow-950/45 px-2 py-1 border border-yellow-800/30 rounded-lg uppercase tracking-wider">MoMo Received</span>
            <Smartphone className="w-5 h-5 text-yellow-400" />
          </div>
          <div className="mt-2">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Sente z'Esimu</p>
            <p className="text-xl font-black text-white font-display truncate">{formatCurrency(momoCollected)}</p>
            <p className="text-xs text-zinc-400 mt-1 uppercase tracking-wide group-hover:text-zinc-300">MTN & Airtel</p>
          </div>
        </div>

        <div 
          onClick={() => onNavigate('sales')}
          className="boss-card border-t-4 border-t-blue-500 p-4 flex flex-col justify-between h-36 cursor-pointer active:scale-98 transition-all hover:border-blue-500/30 group"
          id="kpi-credit-book"
        >
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold text-blue-400 bg-blue-950/40 px-2 py-1 border border-blue-800/30 rounded-lg uppercase tracking-wider">Credit Given</span>
            <BookOpen className="w-5 h-5 text-blue-400" />
          </div>
          <div className="mt-2">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Amabanja</p>
            <p className="text-xl font-black text-white font-display truncate">{formatCurrency(creditIssued)}</p>
            <p className="text-xs text-zinc-400 mt-1 uppercase tracking-wide group-hover:text-zinc-300">To collect from customers</p>
          </div>
        </div>

        <div 
          onClick={() => onNavigate('analytics')}
          className="boss-card border-t-4 border-t-gold-brand p-4 flex flex-col justify-between h-36 cursor-pointer active:scale-98 transition-all hover:border-gold-brand/30 group"
          id="kpi-magoba-profit"
        >
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold text-gold-brand bg-gold-brand/10 px-2 py-1 border border-gold-brand/20 rounded-lg uppercase tracking-wider">Today's Profit</span>
            <TrendingUp className="w-5 h-5 text-gold-brand" />
          </div>
          <div className="mt-2">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Magoba</p>
            <p className={`text-xl font-black font-display truncate ${netProfit >= 0 ? 'text-gold-brand' : 'text-rose-400'}`}>{formatCurrency(netProfit)}</p>
            <p className="text-xs text-zinc-400 mt-1 uppercase tracking-wide group-hover:text-zinc-300">After costs & expenses</p>
          </div>
        </div>

      </section>

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
          <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-sm p-6 shadow-2xl relative overflow-hidden animate-in fade-in zoom-in-95 duration-150">
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
              <button onClick={() => printReceipt(selectedSaleForModal, settings, formatCurrency)}
                className="flex-1 h-11 bg-zinc-800 hover:bg-zinc-700 text-white font-black uppercase text-xs tracking-widest rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2">
                <Printer className="w-4 h-4" /> Print
              </button>
              <button onClick={() => shareReceiptViaWhatsApp(selectedSaleForModal)}
                className="flex-1 h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase text-xs tracking-widest rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2">
                <Share2 className="w-4 h-4" /> Share
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
    </div>
  );
}