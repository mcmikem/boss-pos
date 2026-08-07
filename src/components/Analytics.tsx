import { useState, useMemo, useEffect, type FormEvent } from 'react';
import { 
  TrendingUp, Plus, Coins, User, Phone, Mail,
  AlertOctagon, Truck, Edit, Trash2, X, Save,
  Settings2, Hash, Check, Edit2
} from 'lucide-react';
import type { Sale, Expense, Product, Supplier, CreditPayment, StoreSettings, DesignOrder } from '../types';
import CreditsLedger from './CreditsLedger';
import Dashboard from './Dashboard';
import { designOrderApi } from '../api';
import { downloadBlob } from '../utils/download';

interface AnalyticsProps {
  sales: Sale[];
  expenses: Expense[];
  products: Product[];
  suppliers: Supplier[];
  creditPayments: CreditPayment[];
  expenseCategories: string[];
  onAddExpense: (expense: Expense) => void;
  onDeleteExpense: (expenseId: string) => void;
  onAddExpenseCategory: (name: string) => void;
  onUpdateExpenseCategory: (oldName: string, newName: string) => void;
  onDeleteExpenseCategory: (name: string) => void;
  onAddSupplier: (supplier: Supplier) => void;
  onUpdateSupplier: (supplier: Supplier) => void;
  onDeleteSupplier: (supplierId: string) => void;
  onPayCredit: (saleId: string, amount: number) => void;
  formatCurrency: (val: number) => string;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  showSuppliers: boolean;
  setShowSuppliers: (show: boolean) => void;
  onNavigate: (tab: 'sales' | 'inventory' | 'analytics') => void;
  onRepeatLastSale: () => void;
  onRefundSale: (saleId: string) => void;
  settings: StoreSettings;
}

export default function Analytics({
  sales,
  expenses,
  products,
  suppliers,
  creditPayments,
  expenseCategories,
  onAddExpense,
  onDeleteExpense,
  onAddExpenseCategory,
  onUpdateExpenseCategory,
  onDeleteExpenseCategory,
  onAddSupplier,
  onUpdateSupplier,
  onDeleteSupplier,
  onPayCredit,
  formatCurrency,
  triggerToast,
  showSuppliers,
  setShowSuppliers,
  onNavigate,
  onRepeatLastSale,
  onRefundSale,
  settings
}: AnalyticsProps) {
  const [timeFilter, setTimeFilter] = useState<'Daily' | 'Weekly' | 'Monthly'>('Daily');

  // Design & print orders contribute realized revenue when delivered. Fetched
  // here (not via props) so Reports always shows fresh numbers.
  const [designOrders, setDesignOrders] = useState<DesignOrder[]>([]);
  useEffect(() => {
    let active = true;
    designOrderApi.list()
      .then(list => { if (active) setDesignOrders(list); })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseAmt, setExpenseAmt] = useState('');
  const [expenseCat, setExpenseCat] = useState(expenseCategories[0] || 'Stock Purchase');

  const [showExpenseCatManager, setShowExpenseCatManager] = useState(false);
  const [expenseCatNew, setExpenseCatNew] = useState('');
  const [editingExpCat, setEditingExpCat] = useState<string | null>(null);
  const [editingExpCatVal, setEditingExpCatVal] = useState('');
  const [deleteExpCatConfirm, setDeleteExpCatConfirm] = useState<string | null>(null);

  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [supName, setSupName] = useState('');
  const [supContact, setSupContact] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supEmail, setSupEmail] = useState('');
  const [confirmDeleteSupplier, setConfirmDeleteSupplier] = useState<string | null>(null);

  const timeRange = useMemo(() => {
    const now = new Date();
    if (timeFilter === 'Daily') {
      const day = now.toISOString().split('T')[0];
      return { prefix: day, filter: (ts: string) => ts.startsWith(day) };
    }
    if (timeFilter === 'Weekly') {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return { prefix: '', filter: (ts: string) => new Date(ts) >= weekAgo };
    }
    const month = now.toISOString().slice(0, 7);
    return { prefix: month, filter: (ts: string) => ts.startsWith(month) };
  }, [timeFilter]);

  const filteredSales = useMemo(() => {
    return sales.filter(s => !s.refunded && timeRange.filter(s.timestamp));
  }, [sales, timeRange]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter(e => timeRange.filter(e.timestamp));
  }, [expenses, timeRange]);

  const revenue = useMemo(() => {
    return filteredSales.reduce((acc, s) => acc + s.total, 0);
  }, [filteredSales]);

  const cogs = useMemo(() => {
    return filteredSales.reduce((acc, s) => {
      return acc + s.items.reduce((itemAcc, item) => itemAcc + (item.unitCost * item.qty), 0);
    }, 0);
  }, [filteredSales]);

  const totalExpenses = useMemo(() => {
    return filteredExpenses.reduce((acc, e) => acc + e.amount, 0);
  }, [filteredExpenses]);

  // Delivered design & print orders count as realized revenue + profit.
  const designOrdersInWindow = useMemo(() => {
    return designOrders.filter(o => o.status === 'delivered' && timeRange.filter(o.createdAt));
  }, [designOrders, timeRange]);

  const designRevenue = useMemo(() => {
    return designOrdersInWindow.reduce((acc, o) => acc + o.totalAmount, 0);
  }, [designOrdersInWindow]);

  const designProfit = useMemo(() => {
    return designOrdersInWindow.reduce((acc, o) => acc + (o.totalAmount - o.materialCost - o.laborCost - (o.transportCost || 0)), 0);
  }, [designOrdersInWindow]);

  const totalIncome = revenue + designRevenue;
  const grossProfit = (revenue - cogs) + designProfit;
  const netProfit = grossProfit - totalExpenses;

  const categoryBreakdown = useMemo(() => {
    const categoriesSum: { [key: string]: number } = {};

    filteredSales.forEach(sale => {
      sale.items.forEach(item => {
        const prod = products.find(p => p.id === item.productId);
        const cat = prod ? prod.category : 'Other';
        categoriesSum[cat] = (categoriesSum[cat] || 0) + item.lineTotal;
      });
    });

    return categoriesSum;
  }, [filteredSales, products]);

  const topCategory = useMemo(() => {
    let topName = 'N/A';
    let topVal = -1;
    Object.entries(categoryBreakdown).forEach(([cat, val]) => {
      const numericVal = val as number;
      if (numericVal > topVal) {
        topVal = numericVal;
        topName = cat;
      }
    });
    return { name: topName, amount: topVal };
  }, [categoryBreakdown]);

  const productProfitability = useMemo(() => {
    return products.map(p => {
      const isLossProduct = p.price < p.cost;
      const profitMarginPct = p.price > 0 ? ((p.price - p.cost) / p.price) * 100 : 0;
      return { product: p, isLossProduct, margin: profitMarginPct };
    });
  }, [products]);

  const lossProducts = useMemo(() => {
    return productProfitability.filter(item => item.isLossProduct);
  }, [productProfitability]);

  const handleAddExpense = (e: FormEvent) => {
    e.preventDefault();
    if (!expenseDesc.trim()) {
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
      description: expenseDesc,
      amount: amtNum,
      category: expenseCat
    };

    onAddExpense(newExpense);
    setExpenseDesc('');
    setExpenseAmt('');
    triggerToast(`Logged expense: ${newExpense.description}`, 'success');
  };

  const handleAddExpCat = () => {
    const name = expenseCatNew.trim();
    if (!name) { triggerToast('Category name is required', 'error'); return; }
    if (expenseCategories.includes(name)) { triggerToast('Category already exists', 'error'); return; }
    onAddExpenseCategory(name);
    setExpenseCatNew('');
    triggerToast(`Added "${name}" category`, 'success');
  };

  const handleStartEditExpCat = (name: string) => {
    setEditingExpCat(name);
    setEditingExpCatVal(name);
  };

  const handleSaveEditExpCat = () => {
    if (!editingExpCat) return;
    const name = editingExpCatVal.trim();
    if (!name) { triggerToast('Category name is required', 'error'); return; }
    if (name !== editingExpCat && expenseCategories.includes(name)) { triggerToast('Category already exists', 'error'); return; }
    onUpdateExpenseCategory(editingExpCat, name);
    if (expenseCat === editingExpCat) setExpenseCat(name);
    setEditingExpCat(null);
    triggerToast(`Renamed to "${name}"`, 'success');
  };

  const handleDeleteExpCat = (name: string) => {
    onDeleteExpenseCategory(name);
    setDeleteExpCatConfirm(null);
    if (expenseCat === name) setExpenseCat(expenseCategories.filter(c => c !== name)[0] || 'Miscellaneous');
    triggerToast(`Deleted "${name}" category`, 'info');
  };

  const openAddSupplier = () => {
    setEditingSupplier(null);
    setSupName(''); setSupContact(''); setSupPhone(''); setSupEmail('');
    setShowSupplierModal(true);
  };

  const openEditSupplier = (sup: Supplier) => {
    setEditingSupplier(sup);
    setSupName(sup.name); setSupContact(sup.contactPerson); setSupPhone(sup.phone); setSupEmail(sup.email);
    setShowSupplierModal(true);
  };

  const handleSaveSupplier = () => {
    if (!supName.trim()) { triggerToast('Supplier name is required', 'error'); return; }
    if (editingSupplier) {
      const updated: Supplier = { ...editingSupplier, name: supName, contactPerson: supContact, phone: supPhone, email: supEmail };
      onUpdateSupplier(updated);
      triggerToast(`Updated "${updated.name}"`, 'success');
    } else {
      const newSup: Supplier = { id: `sup-${Date.now()}`, name: supName, contactPerson: supContact, phone: supPhone, email: supEmail };
      onAddSupplier(newSup);
      triggerToast(`Added "${newSup.name}"`, 'success');
    }
    setShowSupplierModal(false);
    setEditingSupplier(null);
  };

  const hourlyValues = useMemo(() => {
    const values = Array(7).fill(0);
    filteredSales.forEach(sale => {
      const hour = new Date(sale.timestamp).getHours();
      if (hour < 10) values[0] += sale.total;
      else if (hour < 12) values[1] += sale.total;
      else if (hour < 14) values[2] += sale.total;
      else if (hour < 16) values[3] += sale.total;
      else if (hour < 18) values[4] += sale.total;
      else if (hour < 20) values[5] += sale.total;
      else values[6] += sale.total;
    });
    return values;
  }, [filteredSales]);

  const maxVal = useMemo(() => Math.max(...hourlyValues, 1000), [hourlyValues]);

  const chartPoints = useMemo(() => {
    return hourlyValues.map((val, idx) => {
      const x = (idx / 6) * 400;
      const y = 140 - (val / maxVal) * 110; 
      return { x, y, val };
    });
  }, [hourlyValues, maxVal]);

  const linePath = useMemo(() => {
    if (chartPoints.length === 0) return '';
    return chartPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  }, [chartPoints]);

  const areaPath = useMemo(() => {
    if (chartPoints.length === 0) return '';
    return `${linePath} L400,140 L0,140 Z`;
  }, [linePath, chartPoints]);

const colorsMap: { [key: string]: string } = {
    'Electronics': '#f1c100',
    'Eatery': '#f59e0b',
    'Stationery': '#60a5fa',
    'Printing': '#f472b6',
    'Tailoring': '#a78bfa',
    'Library': '#38bdf8',
    'Sports': '#fb923c',
    'Graphics': '#ffffff',
  };

  const donutSegments = useMemo(() => {
    let accumulatedPercent = 0;
    return Object.entries(categoryBreakdown).map(([cat, val]) => {
      const numericVal = val as number;
      const pct = revenue > 0 ? (numericVal / revenue) * 100 : 0;
      const strokeDash = `${pct.toFixed(1)} 100`;
      const strokeOffset = -accumulatedPercent;
      accumulatedPercent += pct;
      return {
        category: cat,
        percentage: pct,
        color: colorsMap[cat] || '#3f3f46',
        strokeDash,
        strokeOffset
      };
    }).filter(s => s.percentage > 0);
  }, [categoryBreakdown, revenue]);

  return (
    <div className="space-y-6 animate-fade-in pb-4" id="analytics-tab-content">
      <section className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-black text-white uppercase tracking-tight font-display">
            {showSuppliers ? 'Suppliers' : 'Reports'}
          </h2>
          <p className="text-sm text-zinc-400 mt-1 font-bold tracking-wider">
            {showSuppliers ? 'Manage your suppliers' : 'Sales, profit & expenses'}
          </p>
        </div>
        <div className="flex gap-2">
          {!showSuppliers && (
            <button onClick={() => {
              const salesCsv = [
                ['Order', 'Date', 'Payment', 'Items', 'Total', 'Customer'].join(','),
                ...filteredSales.map(s => `"${s.orderNumber}","${new Date(s.timestamp).toLocaleDateString()}","${s.paymentMethod}",${s.items.reduce((a,i) => a + i.qty, 0)},${s.total},"${s.customerName || ''}"`),
              ].join('\n');
              const expensesCsv = [
                ['Date', 'Description', 'Category', 'Amount'].join(','),
                ...filteredExpenses.map(e => `"${new Date(e.timestamp).toLocaleDateString()}","${e.description}","${e.category}",${e.amount}`),
              ].join('\n');
              const blob = new Blob([salesCsv + '\n\nEXPENSES\n' + expensesCsv], { type: 'text/csv' });
              const ok = downloadBlob(blob, `reports-${new Date().toISOString().split('T')[0]}.csv`);
              triggerToast(ok ? 'Report exported as CSV' : 'Download failed on this device', ok ? 'success' : 'error');
            }}
              className="px-4 py-2 bg-zinc-900 border border-zinc-800 hover:border-emerald-500 text-emerald-400 rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer">
              Export CSV
            </button>
          )}
          <button onClick={() => setShowSuppliers(!showSuppliers)}
            className="px-4 py-2 bg-zinc-900 border border-zinc-800 hover:border-gold-brand text-gold-brand rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer">
            {showSuppliers ? '← Back to Reports' : 'View Suppliers →'}
          </button>
        </div>
      </section>

      {showSuppliers ? (
        <section className="space-y-4">
          <button onClick={openAddSupplier}
            className="w-full sm:w-auto px-4 h-10 bg-gold-brand text-black font-black uppercase tracking-widest text-xs rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-all">
            <Plus className="w-4 h-4" /> Add Supplier
          </button>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {suppliers.map(sup => (
              <div key={sup.id} className="boss-card p-5 rounded-2xl border border-zinc-800 flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-gold-brand" />
                      <h3 className="text-sm font-black text-white uppercase tracking-wider">{sup.name}</h3>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEditSupplier(sup)} className="p-1.5 text-zinc-500 hover:text-gold-brand hover:bg-white/5 rounded-lg transition-all" title="Edit">
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setConfirmDeleteSupplier(sup.id)} className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-rose-950/30 rounded-lg transition-all" title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500 font-bold uppercase">Contact: {sup.contactPerson}</p>
                  {products.filter(p => p.supplierId === sup.id).length > 0 && (
                    <p className="text-[10px] text-zinc-600 font-bold uppercase mt-1">
                      {products.filter(p => p.supplierId === sup.id).length} product(s)
                    </p>
                  )}
                </div>
                <div className="space-y-2 pt-2 border-t border-zinc-900">
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <Phone className="w-3.5 h-3.5 text-zinc-600" />
                    <span>{sup.phone}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <Mail className="w-3.5 h-3.5 text-zinc-600" />
                    <span className="truncate">{sup.email}</span>
                  </div>
                </div>
                {confirmDeleteSupplier === sup.id && (
                  <div className="bg-rose-950/20 border border-rose-500/30 rounded-xl p-3 space-y-2">
                    <p className="text-[10px] font-bold text-rose-400 text-center uppercase">Delete "{sup.name}"?</p>
                    <div className="flex gap-2">
                      <button onClick={() => setConfirmDeleteSupplier(null)} className="flex-1 h-8 border border-zinc-800 text-zinc-400 font-bold text-[10px] rounded-lg">Cancel</button>
                      <button onClick={() => { onDeleteSupplier(sup.id); setConfirmDeleteSupplier(null); triggerToast(`Deleted "${sup.name}"`, 'info'); }}
                        className="flex-1 h-8 bg-rose-600 hover:bg-rose-500 text-white font-black text-[10px] rounded-lg uppercase">Delete</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <>
          <Dashboard
            sales={sales} expenses={expenses} products={products}
            formatCurrency={formatCurrency} onNavigate={onNavigate}
            onRepeatLastSale={onRepeatLastSale} onRefundSale={onRefundSale}
            settings={settings}
            onAddExpense={onAddExpense}
            expenseCategories={expenseCategories}
          />
          <nav className="flex gap-2 pb-2 overflow-x-auto no-scrollbar">
            {['Daily', 'Weekly', 'Monthly'].map(filter => (
              <button key={filter} onClick={() => setTimeFilter(filter as any)}
                className={`px-6 h-10 rounded-full font-bold text-xs uppercase tracking-wider transition-all cursor-pointer ${
                  timeFilter === filter ? 'bg-gold-brand text-black shadow-[0_4px_10px_rgba(255,204,0,0.2)] font-black' : 'border border-zinc-800 hover:border-zinc-700 text-zinc-500 hover:text-zinc-400'
                }`}>
                {filter}
              </button>
            ))}
          </nav>

          {lossProducts.length > 0 && (
            <section className="bg-rose-950/20 border border-rose-500/20 p-4 rounded-2xl flex items-start gap-3">
              <AlertOctagon className="w-5 h-5 text-rose-500 shrink-0 mt-0.5 animate-pulse" />
              <div>
                <h4 className="text-sm font-black text-rose-400 uppercase tracking-wider font-display">
                  Selling at a Loss! ({lossProducts.length} items)
                </h4>
                <p className="text-xs text-zinc-400 mt-1">These items cost more than their selling price:</p>
                <div className="mt-2 space-y-1">
                  {lossProducts.map(item => (
                    <div key={item.product.id} className="text-xs text-zinc-300">
                      • <span className="text-white font-bold uppercase">{item.product.name}</span>: Cost {formatCurrency(item.product.cost)} {'>'} Price {formatCurrency(item.product.price)}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Credits Ledger */}
          <div className="lg:col-span-1">
            <CreditsLedger 
              sales={sales}
              creditPayments={creditPayments}
              formatCurrency={formatCurrency}
              onPayCredit={onPayCredit}
              triggerToast={triggerToast}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2 boss-card border-l-4 border-l-gold-brand p-5 flex flex-col justify-between h-32">
              <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Best Selling ({timeFilter})</span>
              <div className="flex items-center justify-between mt-1">
                <h3 className="text-2xl font-black text-gold-brand uppercase font-display">{topCategory.name}</h3>
                <TrendingUp className="w-6 h-6 text-gold-brand" />
              </div>
              <p className="text-xs text-zinc-400 font-bold uppercase">Sales: {formatCurrency(topCategory.amount)}</p>
            </div>
            <div className="boss-card p-5 flex flex-col justify-between h-32">
              <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Total Sales</span>
              <h3 className="text-2xl font-black text-white font-display mt-2">{formatCurrency(totalIncome)}</h3>
              <p className="text-xs text-zinc-500 font-bold uppercase">
                Money in{designRevenue > 0 ? ` • Design ${formatCurrency(designRevenue)}` : ''}
              </p>
            </div>
            <div className="boss-card p-5 flex flex-col justify-between h-32">
              <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Profit</span>
              <h3 className={`text-2xl font-black font-display mt-2 ${netProfit >= 0 ? 'text-gold-brand' : 'text-rose-400'}`}>{formatCurrency(netProfit)}</h3>
              <p className="text-xs text-zinc-500 font-bold uppercase">After all costs</p>
            </div>
          </div>

          <section className="boss-card p-5">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest">Sales Over Time</h3>
              <TrendingUp className="w-4 h-4 text-gold-brand" />
            </div>
            <div className="relative h-44 w-full bg-[#0A0A0A] p-4 border border-white/5 rounded-2xl overflow-hidden">
              <svg className="w-full h-full" viewBox="0 0 400 150" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="glowingChart" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#f1c100" stopOpacity="0.25"></stop>
                    <stop offset="100%" stopColor="#f1c100" stopOpacity="0"></stop>
                  </linearGradient>
                </defs>
                {areaPath && <path d={areaPath} fill="url(#glowingChart)"></path>}
                {linePath && <path d={linePath} fill="none" stroke="#f1c100" strokeWidth="3.5" className="chart-glow"></path>}
                {chartPoints.map((pt, i) => (
                  <circle key={i} cx={pt.x} cy={pt.y} fill="#0f0f0f" r="4.5" stroke="#f1c100" strokeWidth="2">
                    <title>{`${8 + i * 2}:00: ${formatCurrency(pt.val)}`}</title>
                  </circle>
                ))}
              </svg>
              <div className="absolute bottom-2 inset-x-4 flex justify-between text-xs text-zinc-500 font-black">
                <span>08:00</span><span>10:00</span><span>12:00</span><span>14:00</span><span>16:00</span><span>18:00</span><span>20:00</span>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="boss-card p-5 rounded-2xl flex flex-col justify-between">
              <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest mb-3">Sales by Category</h3>
              <div className="flex flex-col sm:flex-row items-center gap-6">
                <div className="relative w-28 h-28 shrink-0">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="16" fill="none" stroke="#2a2a2a" strokeWidth="4"></circle>
                    {donutSegments.map((seg, idx) => (
                      <circle key={idx} cx="18" cy="18" r="16" fill="none" stroke={seg.color} strokeWidth="4" strokeDasharray={seg.strokeDash} strokeDashoffset={seg.strokeOffset} className="transition-all duration-300"></circle>
                    ))}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xs text-zinc-500 font-bold uppercase">Total</span>
                    <span className="text-xs font-black text-white">{revenue > 0 ? '100%' : '0%'}</span>
                  </div>
                </div>
                <div className="space-y-2 flex-1 w-full">
                  {Object.entries(categoryBreakdown).map(([cat, val]) => {
                    const numericVal = val as number;
                    const pct = revenue > 0 ? (numericVal / revenue) * 100 : 0;
                    const catColor = colorsMap[cat] || '#3f3f46';
                    return (
                      <div key={cat} className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: catColor }}></span>
                          <span className="text-xs text-zinc-400 font-bold uppercase">{cat}</span>
                        </div>
                        <span className="text-xs font-black text-zinc-200">
                          {formatCurrency(numericVal)} <span className="text-zinc-500 text-xs font-bold">({pct.toFixed(0)}%)</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="boss-card p-5 rounded-2xl flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest mb-1">Log an Expense</h3>
                <p className="text-xs text-zinc-500 font-bold uppercase mb-4">Rent, stock, electricity, etc.</p>
              </div>
              <form onSubmit={handleAddExpense} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-zinc-500 font-bold uppercase mb-1">What for?</label>
                    <input type="text" placeholder="e.g. Phone cases restock" value={expenseDesc} onChange={(e) => setExpenseDesc(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500 font-bold uppercase mb-1">Amount</label>
                    <input type="number" placeholder="Amount" value={expenseAmt} onChange={(e) => setExpenseAmt(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 text-gold-brand rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none font-bold" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 font-bold uppercase mb-1 flex items-center gap-1">
                    Category
                    <button onClick={() => setShowExpenseCatManager(true)}
                      className="p-0.5 text-zinc-500 hover:text-gold-brand transition-colors" title="Manage Categories">
                      <Settings2 className="w-3 h-3" />
                    </button>
                  </label>
                  <select value={expenseCat} onChange={(e) => setExpenseCat(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl h-10 px-2 text-xs focus:border-gold-brand focus:outline-none font-bold">
                    {expenseCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
                <button type="submit" className="w-full h-10 bg-gold-brand/10 hover:bg-gold-brand text-gold-brand hover:text-black border border-gold-brand/20 font-black uppercase tracking-widest text-xs rounded-xl transition-all">Log Expense</button>
              </form>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest">Expense History ({timeFilter})</h3>
            <div className="space-y-2">
              {filteredExpenses.map(exp => (
                <div key={exp.id} className="boss-card flex items-center justify-between p-4 rounded-xl group">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 border border-rose-900/40 bg-rose-950/20 rounded flex items-center justify-center text-rose-400">
                      <Coins className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white uppercase">{exp.description}</p>
                      <p className="text-xs text-zinc-500 font-bold mt-0.5 uppercase">{exp.category} • {new Date(exp.timestamp).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-black text-rose-400 font-display">-{formatCurrency(exp.amount)}</p>
                    <button onClick={() => { onDeleteExpense(exp.id); triggerToast(`Deleted expense`, 'info'); }}
                      className="p-1.5 text-zinc-600 hover:text-rose-400 lg:opacity-0 lg:group-hover:opacity-100 transition-all rounded-lg hover:bg-rose-950/30">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              {filteredExpenses.length === 0 && (
                <div className="boss-card p-6 text-center text-zinc-500 text-xs font-bold uppercase">No expenses recorded.</div>
              )}
            </div>
          </section>
        </>
      )}

      {showExpenseCatManager && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="boss-card w-full max-w-md p-6 bg-zinc-950 border border-white/5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-3 border-b border-white/5">
              <h3 className="text-sm font-black text-white uppercase tracking-wider font-display flex items-center gap-2">
                <Hash className="w-5 h-5 text-gold-brand" /> Expense Categories
              </h3>
              <button onClick={() => setShowExpenseCatManager(false)} className="text-zinc-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex gap-2">
              <input type="text" value={expenseCatNew} onChange={(e) => setExpenseCatNew(e.target.value)}
                placeholder="New category..." onKeyDown={(e) => e.key === 'Enter' && handleAddExpCat()}
                className="flex-1 bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
              <button onClick={handleAddExpCat}
                className="h-10 px-4 bg-gold-brand hover:bg-gold-medium text-black font-black uppercase tracking-widest text-xs rounded-xl flex items-center gap-1.5 shadow-lg">
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {expenseCategories.map(cat => (
                <div key={cat}
                  className="flex items-center justify-between bg-zinc-900/50 border border-zinc-800/60 rounded-xl px-3 py-2.5 group hover:border-zinc-700 transition-colors">
                  {editingExpCat === cat ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input type="text" value={editingExpCatVal} onChange={(e) => setEditingExpCatVal(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveEditExpCat()}
                        className="flex-1 bg-zinc-950 border border-gold-brand/40 text-gold-light rounded-lg h-8 px-2 text-xs focus:outline-none" autoFocus />
                      <button onClick={handleSaveEditExpCat} className="p-1 text-emerald-400 hover:text-emerald-300"><Check className="w-4 h-4" /></button>
                      <button onClick={() => setEditingExpCat(null)} className="p-1 text-zinc-500 hover:text-zinc-300"><X className="w-4 h-4" /></button>
                    </div>
                  ) : deleteExpCatConfirm === cat ? (
                    <div className="flex items-center justify-between flex-1">
                      <span className="text-xs font-bold text-rose-400 uppercase">Delete "{cat}"?</span>
                      <div className="flex gap-1.5">
                        <button onClick={() => setDeleteExpCatConfirm(null)}
                          className="px-2.5 h-7 text-[10px] font-bold border border-zinc-800 text-zinc-400 rounded-lg hover:bg-zinc-900">Cancel</button>
                        <button onClick={() => handleDeleteExpCat(cat)}
                          className="px-2.5 h-7 text-[10px] font-black bg-rose-600 text-white rounded-lg hover:bg-rose-500 uppercase">Delete</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="text-xs font-bold text-zinc-300 uppercase tracking-wide">{cat}</span>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => handleStartEditExpCat(cat)}
                          className="p-1.5 text-zinc-500 hover:text-gold-brand rounded-lg hover:bg-zinc-800/50 transition-all">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setDeleteExpCatConfirm(cat)}
                          className="p-1.5 text-zinc-500 hover:text-rose-400 rounded-lg hover:bg-zinc-800/50 transition-all">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
            <div className="pt-2">
              <button onClick={() => setShowExpenseCatManager(false)}
                className="w-full h-11 border border-zinc-800 hover:bg-zinc-900 text-zinc-400 font-bold uppercase tracking-wider text-xs rounded-xl">Done</button>
            </div>
          </div>
        </div>
      )}

      {showSupplierModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="boss-card w-full max-w-md p-6 bg-zinc-950 border border-white/5 space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-white/5">
              <h3 className="text-sm font-black text-white uppercase tracking-wider font-display flex items-center gap-2">
                <Truck className="w-5 h-5 text-gold-brand" /> {editingSupplier ? 'Edit' : 'Add'} Supplier
              </h3>
              <button onClick={() => setShowSupplierModal(false)} className="text-zinc-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">Supplier Name</label>
                <input type="text" placeholder="e.g. Kampala Wholesalers" value={supName} onChange={(e) => setSupName(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">Contact Person</label>
                <input type="text" placeholder="e.g. John Doe" value={supContact} onChange={(e) => setSupContact(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">Phone</label>
                  <input type="text" placeholder="+256 700 000000" value={supPhone} onChange={(e) => setSupPhone(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">Email</label>
                  <input type="email" placeholder="email@example.com" value={supEmail} onChange={(e) => setSupEmail(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
                </div>
              </div>
            </div>
            <div className="pt-4 flex gap-3">
              <button onClick={() => setShowSupplierModal(false)} className="flex-1 h-11 border border-zinc-800 hover:bg-zinc-900 text-zinc-400 font-bold uppercase tracking-wider text-xs rounded-xl">Cancel</button>
              <button onClick={handleSaveSupplier} className="flex-1 h-11 bg-gold-brand hover:bg-gold-medium text-black font-black uppercase tracking-widest text-xs rounded-xl shadow-lg flex items-center justify-center gap-2">
                <Save className="w-4 h-4" /> {editingSupplier ? 'Update' : 'Add'} Supplier
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}