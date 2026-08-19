import { useState, useMemo, useEffect, type FormEvent } from 'react';
import { 
  TrendingUp, Plus, Coins, User, Phone, Mail,
  AlertOctagon, Truck, Edit, Trash2, X, Save,
  Settings2, Hash, Check, Edit2, ChevronDown,
  CalendarDays, Receipt, LayoutGrid
} from 'lucide-react';
import type { Sale, Expense, Product, Supplier, CreditPayment, StoreSettings, DesignOrder, SaleItem } from '../types';
import CreditsLedger from './CreditsLedger';
import Dashboard from './Dashboard';
import { designOrderApi, summaryApi, type SummaryResult } from '../api';
import { downloadBlob } from '../utils/download';
import { localDayKey, localMonthKey, todayLocalKey } from '../utils/dates';

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
  onNavigate: (tab: 'sales' | 'inventory' | 'analytics' | 'registers') => void;
  onRepeatLastSale: () => void;
  onRefundSale: (saleId: string) => void;
  onVoidSale?: (saleId: string) => void;
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
  onVoidSale,
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

  const DAY_VIEW_LIMIT = 6;
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [showAllDays, setShowAllDays] = useState(false);
  useEffect(() => {
    setExpandedDays(new Set());
    setShowAllDays(false);
  }, [timeFilter]);

  const timeRange = useMemo(() => {
    const now = new Date();
    if (timeFilter === 'Daily') {
      const day = todayLocalKey();
      return { prefix: day, filter: (ts: string) => localDayKey(ts) === day };
    }
    if (timeFilter === 'Weekly') {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return { prefix: '', filter: (ts: string) => new Date(ts) >= weekAgo };
    }
    const month = localMonthKey(now.toISOString());
    return { prefix: month, filter: (ts: string) => localMonthKey(ts) === month };
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
  // For Weekly/Monthly the same trick gives exact totals + per-day buckets, so a
  // busy shop with more than the in-memory 2000-sale cap doesn't undercount.
  const [serverWindowSummary, setServerWindowSummary] = useState<SummaryResult | null>(null);

  const netProfit = grossProfit - totalExpenses;

  // Weekly/Monthly: the server window totals are authoritative (they scan the
  // whole table, not the in-memory 2000-row cap), so prefer them when loaded.
  const displayIncome = serverWindowSummary ? serverWindowSummary.revenue : totalIncome;
  const displayDesignRevenue = serverWindowSummary ? (serverWindowSummary.designRevenue || 0) : designRevenue;
  const displayNetProfit = serverWindowSummary ? serverWindowSummary.netProfit : netProfit;

  const dailySeries = useMemo(() => {
    if (serverWindowSummary?.daily && serverWindowSummary.daily.length > 0) {
      return serverWindowSummary.daily.map(d => ({ label: d.date.slice(5), val: d.revenue }));
    }
    const map = new Map<string, number>();
    filteredSales.forEach(s => {
      const k = localDayKey(s.timestamp);
      map.set(k, (map.get(k) || 0) + s.total);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, val]) => ({ label: label.slice(5), val }));
  }, [serverWindowSummary, filteredSales]);

  // Actual sales & expenses grouped by the day they were made, newest first.
  const dailyBreakdown = useMemo(() => {
    const map = new Map<string, { sales: Sale[]; expenses: Expense[] }>();
    filteredSales.forEach(s => {
      const k = localDayKey(s.timestamp);
      if (!map.has(k)) map.set(k, { sales: [], expenses: [] });
      map.get(k)!.sales.push(s);
    });
    filteredExpenses.forEach(e => {
      const k = localDayKey(e.timestamp);
      if (!map.has(k)) map.set(k, { sales: [], expenses: [] });
      map.get(k)!.expenses.push(e);
    });
    return Array.from(map.entries())
      .map(([date, data]) => ({
        date,
        sales: data.sales,
        expenses: data.expenses,
        revenue: data.sales.reduce((a, s) => a + s.total, 0),
        expenseTotal: data.expenses.reduce((a, e) => a + e.amount, 0)
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [filteredSales, filteredExpenses]);

  const visibleDays = useMemo(() => {
    return showAllDays ? dailyBreakdown : dailyBreakdown.slice(0, DAY_VIEW_LIMIT);
  }, [dailyBreakdown, showAllDays]);

  const toggleDay = (date: string) => {
    setExpandedDays(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const formatDayLabel = (dateKey: string) => {
    const d = new Date(dateKey + 'T12:00:00');
    const full = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    return todayLocalKey() === dateKey ? `${full} • Today` : full;
  };

  // "Chapati ×2, Fresh Juice" with a truncation for long orders.
  const itemSummary = (items: SaleItem[]): string => {
    if (items.length === 0) return '';
    const shown = items.slice(0, 3).map(i => i.qty > 1 ? `${i.productName} ×${i.qty}` : i.productName);
    const rest = items.length - shown.length;
    return shown.join(', ') + (rest > 0 ? ` +${rest} more` : '');
  };

  // Department(s) the sale came from, via the live product list.
  const saleCategories = (sale: Sale): string => {
    const set = new Set<string>();
    sale.items.forEach(i => {
      const p = products.find(x => x.id === i.productId);
      if (p?.category) set.add(p.category);
    });
    return Array.from(set).join(', ');
  };

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

  // Server-computed hourly buckets (08:00–20:00, one per hour) for the Daily
  // view — the server aggregates without shipping every sale row to the phone,
  // which keeps the 3G payload small even after the client stops loading the
  // full 2000-sale history. Falls back to the client-side scan if the server
  // doesn't return buckets (older API) or we're offline.
  const [serverHourly, setServerHourly] = useState<number[] | null>(null);
  useEffect(() => {
    if (timeFilter !== 'Daily') { setServerHourly(null); return; }
    let active = true;
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    summaryApi.list(dayStart.toISOString(), dayEnd.toISOString(), 'hourly')
      .then(r => { if (active && r.hourly && r.hourly.length > 0) setServerHourly(r.hourly); })
      .catch(() => {});
    return () => { active = false; };
  }, [timeFilter]);

  useEffect(() => {
    if (timeFilter === 'Daily') { setServerWindowSummary(null); return; }
    let active = true;
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - (timeFilter === 'Weekly' ? 7 : 31));
    from.setHours(0, 0, 0, 0);
    summaryApi.list(from.toISOString(), now.toISOString(), 'daily')
      .then(r => { if (active) setServerWindowSummary(r); })
      .catch(() => {});
    return () => { active = false; };
  }, [timeFilter]);

  const hourlyValues = useMemo(() => {
    if (serverHourly && serverHourly.length === 13) {
      // Merge the 13 one-hour buckets into the chart's 7 two-hour slots.
      return Array.from({ length: 7 }, (_, i) => (serverHourly[i * 2] || 0) + (serverHourly[i * 2 + 1] || 0));
    }
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
  }, [serverHourly, filteredSales]);

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

  const sellerBreakdown = useMemo(() => {
    const map = new Map<string, { name: string; count: number; total: number }>();
    for (const s of filteredSales) {
      const key = (s.staffName || '').trim();
      if (!key) continue;
      const cur = map.get(key) || { name: key, count: 0, total: 0 };
      cur.count += 1;
      cur.total += s.total;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filteredSales]);

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
            <button onClick={async () => {
              const salesCsv = [
                ['Order', 'Date', 'Payment', 'Items', 'Total', 'Customer'].join(','),
                ...filteredSales.map(s => `"${s.orderNumber}","${new Date(s.timestamp).toLocaleDateString()}","${s.paymentMethod}",${s.items.reduce((a,i) => a + i.qty, 0)},${s.total},"${s.customerName || ''}"`),
              ].join('\n');
              const expensesCsv = [
                ['Date', 'Description', 'Category', 'Amount'].join(','),
                ...filteredExpenses.map(e => `"${new Date(e.timestamp).toLocaleDateString()}","${e.description}","${e.category}",${e.amount}`),
              ].join('\n');
              const blob = new Blob([salesCsv + '\n\nEXPENSES\n' + expensesCsv], { type: 'text/csv' });
              const filename = `reports-${new Date().toISOString().split('T')[0]}.csv`;
              const nav = navigator as any;
              const file = new File([blob], filename, { type: 'text/csv' });
              if (nav.canShare && nav.canShare({ files: [file] })) {
                try {
                  await nav.share({ title: 'Boss POS report', text: 'Sales & expenses', files: [file] });
                  triggerToast('Report ready to share', 'success');
                } catch { /* user cancelled share */ }
              } else {
                const ok = downloadBlob(blob, filename);
                triggerToast(ok ? 'Report exported as CSV' : 'Download failed on this device', ok ? 'success' : 'error');
              }
            }}
              className="px-4 py-2 bg-zinc-900 border border-zinc-800 hover:border-emerald-500 text-emerald-400 rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer">
              Export CSV
            </button>
          )}
          {!showSuppliers && (
            <button onClick={() => onNavigate('registers')}
              className="px-4 py-2 bg-zinc-900 border border-zinc-800 hover:border-amber-500 text-amber-400 rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer flex items-center gap-1.5">
              <LayoutGrid className="w-3.5 h-3.5" /> Daily Close-out
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
            triggerToast={triggerToast}
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
              <h3 className="text-2xl font-black text-white font-display mt-2">{formatCurrency(displayIncome)}</h3>
              <p className="text-xs text-zinc-500 font-bold uppercase">
                Money in{displayDesignRevenue > 0 ? ` • Design ${formatCurrency(displayDesignRevenue)}` : ''}
              </p>
            </div>
            <div className="boss-card p-5 flex flex-col justify-between h-32">
              <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Profit</span>
              <h3 className={`text-2xl font-black font-display mt-2 ${displayNetProfit >= 0 ? 'text-gold-brand' : 'text-rose-400'}`}>{formatCurrency(displayNetProfit)}</h3>
              <p className="text-xs text-zinc-500 font-bold uppercase">After all costs</p>
            </div>
          </div>

          <section className="boss-card p-5">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest">Sales Over Time</h3>
              <TrendingUp className="w-4 h-4 text-gold-brand" />
            </div>
            {timeFilter === 'Daily' ? (
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
            ) : (
              <div className="relative h-44 w-full bg-[#0A0A0A] p-4 border border-white/5 rounded-2xl overflow-hidden">
                <div className="flex items-end justify-between gap-1 h-full">
                  {(() => {
                    const dailyMax = Math.max(...dailySeries.map(x => x.val), 1000);
                    return dailySeries.map((d, idx) => {
                    const pct = dailyMax > 0 ? (d.val / dailyMax) * 100 : 0;
                    const isPeak = d.val === dailyMax;
                    return (
                      <div key={idx} className="flex-1 flex flex-col items-center h-full justify-end group relative">
                        <div className="absolute -top-7 bg-[#141414] border border-white/5 text-xs text-gold-brand px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity z-20 pointer-events-none font-bold whitespace-nowrap">
                          {d.label}: {formatCurrency(d.val)}
                        </div>
                        <div className={`w-full rounded-t transition-all duration-500 ${isPeak ? 'bg-gradient-to-t from-gold-medium to-gold-brand' : 'bg-zinc-800 group-hover:bg-zinc-700'}`}
                          style={{ height: `${Math.max(pct, 4)}%` }}></div>
                        <span className="text-[9px] text-zinc-500 font-bold mt-1.5 truncate max-w-full">{d.label}</span>
                      </div>
                    );
                    });
                  })()}
                </div>
              </div>
            )}
          </section>

          <section className="boss-card p-5">
            <div className="flex justify-between items-center mb-1">
              <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-gold-brand" /> Daily Breakdown ({timeFilter})
              </h3>
              <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider">
                {dailyBreakdown.length} {dailyBreakdown.length === 1 ? 'day' : 'days'}
              </span>
            </div>
            <p className="text-xs text-zinc-500 font-bold uppercase mb-4">Actual sales & expenses as they were made</p>

            <div className="space-y-2">
              {visibleDays.map(day => {
                const isExpanded = expandedDays.has(day.date);
                const net = day.revenue - day.expenseTotal;
                return (
                  <div key={day.date} className="bg-black/30 border border-white/5 rounded-xl overflow-hidden">
                    <button onClick={() => toggleDay(day.date)}
                      className="w-full flex items-center justify-between gap-3 px-4 py-3 cursor-pointer hover:bg-white/[0.03] transition-colors text-left">
                      <div className="flex items-center gap-3 min-w-0">
                        <ChevronDown className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        <div className="min-w-0">
                          <p className="text-xs font-black text-white uppercase tracking-wider truncate">
                            {formatDayLabel(day.date)}
                          </p>
                          <p className="text-[10px] font-bold text-zinc-500 uppercase mt-0.5">
                            {day.sales.length} sale{day.sales.length !== 1 ? 's' : ''}
                            {day.expenses.length > 0 && ` • ${day.expenses.length} expense${day.expenses.length !== 1 ? 's' : ''}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 shrink-0">
                        <div className="text-right">
                          <p className="text-[10px] font-bold text-zinc-500 uppercase">Balance</p>
                          <p className={`text-sm font-black font-display ${net >= 0 ? 'text-gold-brand' : 'text-rose-400'}`}>
                            {formatCurrency(net)}
                          </p>
                        </div>
                        <div className="text-right hidden sm:block">
                          <p className="text-[10px] font-bold text-zinc-500 uppercase">Sales</p>
                          <p className="text-sm font-black text-white">{formatCurrency(day.revenue)}</p>
                        </div>
                        <div className="text-right hidden sm:block">
                          <p className="text-[10px] font-bold text-zinc-500 uppercase">Expenses</p>
                          <p className="text-sm font-black text-rose-400">-{formatCurrency(day.expenseTotal)}</p>
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-white/5 pt-3 space-y-3">
                        {day.sales.length > 0 && (
                          <div>
                            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Sales</p>
                            <div className="space-y-1.5">
                              {day.sales.map(sale => (
                                <div key={sale.id} className="flex items-center justify-between gap-2 bg-[#0A0A0A] border border-white/5 rounded-lg px-3 py-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <Receipt className="w-3.5 h-3.5 text-gold-light shrink-0" />
                                    <div className="min-w-0">
                                      <p className="text-xs font-bold text-white uppercase truncate">{sale.orderNumber}</p>
                                      <p className="text-[10px] text-gold-light font-bold truncate">{itemSummary(sale.items)}</p>
                                      <p className="text-[10px] text-zinc-500 font-bold uppercase">
                                        {new Date(sale.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        {sale.paymentMethod ? ` • ${sale.paymentMethod}` : ''}
                                        {sale.staffName ? ` • ${sale.staffName}` : ''}
                                        {saleCategories(sale) ? ` • ${saleCategories(sale)}` : ''}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <p className="text-xs font-black text-white">{formatCurrency(sale.total)}</p>
                                    {onVoidSale && (
                                      <button onClick={async (e) => { e.stopPropagation(); onVoidSale!(sale.id); }}
                                        className="p-1.5 bg-rose-950/20 hover:bg-rose-950/60 rounded-lg text-rose-400 cursor-pointer transition-colors"
                                        title="Delete this order (PIN required)">
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {day.expenses.length > 0 && (
                          <div>
                            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Expenses</p>
                            <div className="space-y-1.5">
                              {day.expenses.map(exp => (
                                <div key={exp.id} className="flex items-center justify-between gap-2 bg-[#0A0A0A] border border-white/5 rounded-lg px-3 py-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <Coins className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                                    <div className="min-w-0">
                                      <p className="text-xs font-bold text-white uppercase truncate">{exp.description}</p>
                                      <p className="text-[10px] text-zinc-500 font-bold uppercase">{exp.category}</p>
                                    </div>
                                  </div>
                                  <p className="text-xs font-black text-rose-400 shrink-0">-{formatCurrency(exp.amount)}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {dailyBreakdown.length === 0 && (
                <div className="p-6 text-center text-zinc-500 text-xs font-bold uppercase">No sales or expenses in this period.</div>
              )}
            </div>

            {dailyBreakdown.length > DAY_VIEW_LIMIT && (
              <button onClick={() => {
                if (showAllDays) {
                  setShowAllDays(false);
                  setExpandedDays(new Set());
                } else {
                  setShowAllDays(true);
                  setExpandedDays(new Set([dailyBreakdown[0]?.date].filter(Boolean) as string[]));
                }
              }}
                className="mt-3 w-full h-11 border border-zinc-800 hover:border-gold-brand/40 hover:bg-white/[0.03] text-gold-brand font-black uppercase tracking-widest text-xs rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer">
                {showAllDays ? 'Show Recent Reports' : `View All Reports (${dailyBreakdown.length} days)`} <ChevronDown className={`w-4 h-4 transition-transform ${showAllDays ? 'rotate-180' : ''}`} />
              </button>
            )}
          </section>

          {sellerBreakdown.length > 0 && (
            <section className="boss-card p-5">
              <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest mb-3 flex items-center gap-2">
                <User className="w-4 h-4 text-gold-brand" /> Sales by Seller ({timeFilter})
              </h3>
              <div className="space-y-1.5">
                {sellerBreakdown.map((s, i) => (
                  <div key={s.name} className={`flex items-center justify-between gap-2 rounded-xl px-4 py-3 ${i === 0 ? 'bg-gold-brand/5 border border-gold-brand/20' : 'bg-[#0A0A0A] border border-white/5'}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black ${i === 0 ? 'bg-gold-brand text-black' : 'bg-zinc-800 text-zinc-300'}`}>
                        {i + 1}
                      </span>
                      <span className="text-xs font-black text-white uppercase truncate">{s.name}</span>
                      {i === 0 && <span className="text-[9px] font-black text-gold-brand uppercase tracking-wider border border-gold-brand/30 bg-gold-brand/10 rounded-full px-2 py-0.5">Top</span>}
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase">{s.count} sale{s.count !== 1 ? 's' : ''}</span>
                      <span className="text-xs font-black text-gold-brand">{formatCurrency(s.total)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

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