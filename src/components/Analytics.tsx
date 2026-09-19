import { useState, useMemo, useEffect } from 'react';
import { 
  TrendingUp, Plus, Coins, User, Phone, Mail, MessageCircle,
  AlertOctagon, Truck, Edit, Trash2, X, Save,
  ChevronDown,
  CalendarDays, Receipt, Info
} from 'lucide-react';
import type { Sale, Expense, Product, Supplier, SupplierPrice, CreditPayment, StoreSettings, DesignOrder, SaleItem, MomoTransfer, CreditEat } from '../types';
import { t } from '../utils/i18n';
import { supplierDrift } from '../utils/cashflow';
import CreditsLedger from './CreditsLedger';
import ExpenseDetailModal from './ExpenseDetailModal';
import Dashboard from './Dashboard';
import { designOrderApi, summaryApi, type SummaryResult } from '../api';
import { restockQtyFor, buildRestockMessage, supplierTelUrl, supplierWhatsAppUrl } from '../utils/suppliers';
import { downloadBlob } from '../utils/download';
import { localDayKey, localMonthKey, todayLocalKey } from '../utils/dates';

interface AnalyticsProps {
  sales: Sale[];
  expenses: Expense[];
  products: Product[];
  suppliers: Supplier[];
  supplierPrices?: SupplierPrice[];
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
  creditEats?: CreditEat[];
  onPayCreditEat?: (id: string, amount: number) => void;
  momoTransfers?: MomoTransfer[];
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
  supplierPrices = [],
  creditPayments,
  expenseCategories,
  onAddExpense,
  onDeleteExpense,
  onAddSupplier,
  onUpdateSupplier,
  onDeleteSupplier,
  onPayCredit,
  creditEats = [],
  onPayCreditEat,
  momoTransfers = [],
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
  const [chartMetric, setChartMetric] = useState<'revenue' | 'profit'>('revenue');
  const [showHelp, setShowHelp] = useState(() => {
    try { return localStorage.getItem('boss_reports_help_seen') !== '1'; } catch { return true; }
  });

  // Design & print orders contribute realized revenue when delivered. Fetched
  // here (not via props) so Reports always shows fresh numbers.
  // Dedupe: handovers rung as real sales carry a `Design order <id>` note —
  // those orders must NOT also count via the legacy estimate below.
  const designLinkedIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of sales) {
      if (s.refunded) continue;
      const m = /Design order (\S+)/.exec(s.notes || '');
      if (m) set.add(m[1]);
    }
    return set;
  }, [sales]);
  const [designOrders, setDesignOrders] = useState<DesignOrder[]>([]);
  useEffect(() => {
    let active = true;
    designOrderApi.list()
      .then(list => { if (active) setDesignOrders(list); })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  


  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [supName, setSupName] = useState('');
  const [supContact, setSupContact] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supEmail, setSupEmail] = useState('');
  const [confirmDeleteSupplier, setConfirmDeleteSupplier] = useState<string | null>(null);

  const DAY_VIEW_LIMIT = 10;
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [showAllDays, setShowAllDays] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  // Two-tap delete: arm ("Sure?") before anything is removed.
  const [deleteExpConfirm, setDeleteExpConfirm] = useState<string | null>(null);
  const [expenseCatFilter, setExpenseCatFilter] = useState<string | null>(null);
  const [saleSearch, setSaleSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState<string>('All');
  const branchOptions = useMemo(() => {
    const fromSettings = (settings.branches || []).filter(Boolean);
    const fromSales = Array.from(new Set(sales.map(s => s.branch || '').filter(Boolean)));
    return Array.from(new Set([...fromSettings, ...fromSales]));
  }, [settings.branches, sales]);
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
      // Perf: single cutoff ms + numeric compare. The old `new Date(ts) >=
      // weekAgo` allocated 2 Dates per row per render — the weekly stall.
      const cutoffMs = now.getTime() - 7 * 86400000;
      return { prefix: '', filter: (ts: string) => Date.parse(ts) >= cutoffMs };
    }
    const month = localMonthKey(now.toISOString());
    return { prefix: month, filter: (ts: string) => localMonthKey(ts) === month };
  }, [timeFilter]);

  const filteredSales = useMemo(() => {
    return sales.filter(s =>
      !s.refunded && timeRange.filter(s.timestamp) &&
      (branchFilter === 'All' || (s.branch || '') === branchFilter));
  }, [sales, timeRange, branchFilter]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter(e => timeRange.filter(e.timestamp));
  }, [expenses, timeRange]);

  // Where-did-it-go: per-category expense totals for this window (e.g. Food
  // vs Electricity). Tap a row to filter the history below to that category.
  const expenseCategoryBreakdown = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const e of filteredExpenses) {
      const cur = map.get(e.category) || { total: 0, count: 0 };
      cur.total += e.amount || 0;
      cur.count += 1;
      map.set(e.category, cur);
    }
    return Array.from(map.entries())
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [filteredExpenses]);

  const visibleExpenses = useMemo(() => {
    const list = expenseCatFilter ? filteredExpenses.filter(e => e.category === expenseCatFilter) : filteredExpenses;
    return [...list].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 60);
  }, [filteredExpenses, expenseCatFilter]);

  const revenue = useMemo(() => {
    return filteredSales.reduce((acc, s) => acc + s.total, 0);
  }, [filteredSales]);

  // Previous-period comparison: same length window right before this one.
  const prevRevenue = useMemo(() => {
    const inBranch = (s: { branch?: string }) => branchFilter === 'All' || (s.branch || '') === branchFilter;
    if (timeFilter === 'Daily') {
      const y = localDayKey(new Date(Date.now() - 86400000).toISOString());
      return sales.filter(s => !s.refunded && localDayKey(s.timestamp) === y && inBranch(s)).reduce((a, s) => a + s.total, 0);
    }
    if (timeFilter === 'Weekly') {
      const now = Date.now();
      return sales.filter(s => {
        if (s.refunded || !inBranch(s)) return false;
        const ms = Date.parse(s.timestamp);
        return ms >= now - 14 * 86400000 && ms < now - 7 * 86400000;
      }).reduce((a, s) => a + s.total, 0);
    }
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    const prevMonth = localMonthKey(d.toISOString());
    return sales.filter(s => !s.refunded && localMonthKey(s.timestamp) === prevMonth && inBranch(s)).reduce((a, s) => a + s.total, 0);
  }, [sales, timeFilter, branchFilter]);
  const revenueDeltaPct = prevRevenue > 0 ? Math.round(((revenue - prevRevenue) / prevRevenue) * 100) : null;

  const cogs = useMemo(() => {
    return filteredSales.reduce((acc, s) => {
      return acc + s.items.reduce((itemAcc, item) => itemAcc + (item.unitCost * item.qty), 0);
    }, 0);
  }, [filteredSales]);

  const totalExpenses = useMemo(() => {
    return filteredExpenses.reduce((acc, e) => acc + e.amount, 0);
  }, [filteredExpenses]);

  // Discount leakage: money knocked off at the till in this window.
  const totalDiscounts = useMemo(() => {
    return filteredSales.reduce((acc, s) => acc + (s.discount || 0), 0);
  }, [filteredSales]);

  // Delivered design & print orders count as realized revenue + profit.
  const designOrdersInWindow = useMemo(() => {
    return designOrders.filter(o => o.status === 'delivered' && timeRange.filter(o.createdAt) && !designLinkedIds.has(o.id));
  }, [designOrders, timeRange, designLinkedIds]);

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
  // VAT collected inside these sales (server-stamped per sale). Falls back to
  // the in-memory rows when the server window hasn't loaded.
  const displayVat = serverWindowSummary && typeof serverWindowSummary.vatTotal === 'number'
    ? serverWindowSummary.vatTotal
    : filteredSales.reduce((a, s) => a + (s.tax || 0), 0);

  // Profit per day (sales revenue − ingredient cost) for the Profit chart
  // toggle. Client-side rows only — the server window has no per-day COGS.
  const dailyProfitSeries = useMemo(() => {
    const map = new Map<string, number>();
    filteredSales.forEach(s => {
      const k = localDayKey(s.timestamp);
      const profit = s.total - s.items.reduce((a, i) => a + ((i.unitCost || 0) * i.qty), 0);
      map.set(k, (map.get(k) || 0) + profit);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, val]) => ({ label: label.slice(5), val }));
  }, [filteredSales]);

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
        expenseTotal: data.expenses.reduce((a, e) => a + e.amount, 0),
        discountTotal: data.sales.reduce((a, s) => a + (s.discount || 0), 0),
        cashTotal: data.sales.filter(s => s.paymentMethod === 'Cash').reduce((a, s) => a + s.total, 0),
        momoTotal: data.sales.filter(s => s.paymentMethod === 'MTN MoMo' || s.paymentMethod === 'Airtel Money').reduce((a, s) => a + s.total, 0),
        creditTotal: data.sales.filter(s => s.paymentMethod === 'Credit / Book').reduce((a, s) => a + s.total, 0),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [filteredSales, filteredExpenses]);

  const visibleDays = useMemo(() => {
    return showAllDays ? dailyBreakdown : dailyBreakdown.slice(0, DAY_VIEW_LIMIT);
  }, [dailyBreakdown, showAllDays]);

  // Auto-open the most recent day so first-time users see how to tap
  useEffect(() => {
    if (dailyBreakdown.length > 0 && expandedDays.size === 0) {
      setExpandedDays(new Set([dailyBreakdown[0].date]));
    }
  }, [dailyBreakdown]);

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
    const map = new Map<string, { name: string; count: number; total: number; refunds: number; discount: number }>();
    for (const s of sales) {
      if (!timeRange.filter(s.timestamp)) continue;
      if (branchFilter !== 'All' && (s.branch || '') !== branchFilter) continue;
      const key = (s.staffName || '').trim();
      if (!key) continue;
      const cur = map.get(key) || { name: key, count: 0, total: 0, refunds: 0, discount: 0 };
      cur.count += 1;
      if (s.refunded) cur.refunds += 1;
      else cur.total += s.total;
      cur.discount += s.discount || 0;
      map.set(key, cur);
    }
    return Array.from(map.values())
      .map(r => ({
        ...r,
        risk: r.refunds >= 3 || (r.count > 0 && r.refunds / r.count >= 0.2) ? 'flag' as const
          : (r.total > 0 && r.discount / r.total >= 0.15) || (r.count > 0 && r.refunds / r.count >= 0.1) ? 'watch' as const
          : 'ok' as const,
      }))
      .sort((a, b) => b.total - a.total);
  }, [sales, timeRange, branchFilter]);

  return (
    <div className="space-y-6 animate-fade-in pb-4" id="analytics-tab-content">
      <section className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 sm:gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl sm:text-3xl font-black text-white uppercase tracking-tight font-display truncate">
            {showSuppliers ? 'Suppliers' : 'Reports'}
          </h2>
          <p className="text-sm text-zinc-400 mt-1 font-bold tracking-wider">
            {showSuppliers ? 'Manage your suppliers' : 'Sales, profit & expenses'}
          </p>
          {!showSuppliers && (
            <p className="text-[9px] text-zinc-600 font-mono mt-0.5">
              Build {typeof __BUILD_COMMIT__ === 'string' && __BUILD_COMMIT__ !== 'dev' ? __BUILD_COMMIT__.slice(0, 7) : 'dev'}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
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
              className="px-4 min-h-[44px] inline-flex items-center justify-center bg-zinc-900 border border-zinc-800 hover:border-emerald-500 text-emerald-400 rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer">
              Export CSV
            </button>
          )}
          <button onClick={() => setShowSuppliers(!showSuppliers)}
            className="px-4 min-h-[44px] inline-flex items-center justify-center bg-zinc-900 border border-zinc-800 hover:border-gold-brand text-gold-brand rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer">
            {showSuppliers ? '← Back to Reports' : 'View Suppliers →'}
          </button>
        </div>
      </section>

      {showSuppliers ? (
        <section className="space-y-4">
          {(() => {
            const drifts = supplierPrices.length ? supplierDrift(products, supplierPrices, 20).slice(0, 3) : [];
            if (!drifts.length) return null;
            return (
              <div className="boss-card p-4 rounded-2xl border border-amber-600/30 bg-amber-950/20">
                <p className="text-xs font-black text-amber-300 uppercase tracking-wider mb-1">Supplier price changed?</p>
                {drifts.map(d => (
                  <p key={d.productId} className="text-[11px] font-bold text-zinc-300">
                    {d.productName}: cost {formatCurrency(d.cost)} vs quote {formatCurrency(d.quote)} ({d.driftPct > 0 ? '+' : ''}{d.driftPct}%) — update cost or renegotiate.
                  </p>
                ))}
              </div>
            );
          })()}
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
                  {(() => {
                    const tel = supplierTelUrl(sup.phone);
                    const lowItems = products
                      .filter(p => p.supplierId === sup.id && !p.isService && p.stockQty <= (p.lowStockThreshold || 5))
                      .map(p => ({ name: p.name, qty: restockQtyFor(p) }));
                    const wa = supplierWhatsAppUrl(sup.phone, lowItems.length
                      ? buildRestockMessage(settings.shopName || 'My Shop', sup.name, lowItems)
                      : `Hello ${sup.name}! This is ${settings.shopName || 'my shop'} — saving your contact for restocks.`);
                    return (
                      <div className="flex gap-2 pt-1">
                        {tel ? (
                          <a href={tel} className="flex-1 h-9 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-[11px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5">
                            <Phone className="w-3.5 h-3.5" /> Call
                          </a>
                        ) : null}
                        {wa ? (
                          <a href={wa} target="_blank" rel="noopener noreferrer" className="flex-1 h-9 bg-emerald-950/40 border border-emerald-800/40 hover:bg-emerald-950/60 text-emerald-300 rounded-xl text-[11px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5">
                            <MessageCircle className="w-3.5 h-3.5" /> WhatsApp{lowItems.length ? ` (${lowItems.length})` : ''}
                          </a>
                        ) : (
                          <span className="flex-1 h-9 text-zinc-600 rounded-xl text-[10px] font-bold uppercase flex items-center justify-center">Add phone to contact</span>
                        )}
                      </div>
                    );
                  })()}
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
            momoTransfers={momoTransfers}
          />
          {showHelp && !showSuppliers && (
            <div className="boss-card bg-gold-brand/5 border border-gold-brand/20 p-4 flex items-start gap-3">
              <Info className="w-5 h-5 text-gold-brand mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-black text-white uppercase tracking-wider">How to read this</p>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed font-bold">Money In = all sales. Profit Left = after stock costs + expenses. Tap Daily / Weekly / Monthly above, then tap a day below to see its sales & expenses. Green = you kept money.</p>
              </div>
              <button onClick={() => { try { localStorage.setItem('boss_reports_help_seen','1'); } catch {}; setShowHelp(false); }} className="text-zinc-500 hover:text-white p-1.5 rounded-lg hover:bg-white/5 transition-colors" aria-label="Dismiss help"><X className="w-4 h-4" /></button>
            </div>
          )}
          <nav className="flex gap-2 pb-2 overflow-x-auto no-scrollbar">
            {['Daily', 'Weekly', 'Monthly'].map(filter => (
              <button key={filter} onClick={() => setTimeFilter(filter as any)}
                className={`px-6 h-10 rounded-full font-bold text-xs uppercase tracking-wider transition-all cursor-pointer ${
                  timeFilter === filter ? 'bg-gold-brand text-black shadow-[0_4px_10px_rgba(255,204,0,0.2)] font-black' : 'border border-zinc-800 hover:border-zinc-700 text-zinc-500 hover:text-zinc-400'
                }`}>
                {filter}
              </button>
            ))}
            {branchOptions.length > 0 && (
              <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} title="Filter by branch"
                className="px-4 h-10 rounded-full font-bold text-xs uppercase tracking-wider bg-[#0A0A0A] border border-zinc-800 text-zinc-300 focus:border-gold-brand outline-none cursor-pointer">
                <option value="All">All branches</option>
                {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            )}
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

          {(() => {
            // Thin ice: stocked items earning under 20% — one supplier hike
            // away from a loss. Worst first, top 8.
            const thin = productProfitability
              .filter(item => !item.isLossProduct && item.margin > 0 && item.margin < 20 && !item.product.isService && item.product.stockQty > 0)
              .sort((a, b) => a.margin - b.margin)
              .slice(0, 8);
            if (thin.length === 0) return null;
            return (
              <section className="bg-amber-950/20 border border-amber-600/25 p-4 rounded-2xl">
                <h4 className="text-sm font-black text-amber-300 uppercase tracking-wider font-display">
                  Thin margins ({thin.length})
                </h4>
                <p className="text-xs text-zinc-400 mt-1">Earning under 20% — review price or supplier:</p>
                <div className="mt-2 space-y-1">
                  {thin.map(item => (
                    <div key={item.product.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-zinc-300 truncate min-w-0"><span className="text-white font-bold uppercase">{item.product.name}</span></span>
                      <span className="text-amber-300 font-black shrink-0 tabular-nums">+{item.margin.toFixed(0)}% • {formatCurrency(item.product.price)}</span>
                    </div>
                  ))}
                </div>
              </section>
            );
          })()}

          {/* Credits Ledger — includes till credit sales AND Ababanjibwa Sente book */}
          <div className="lg:col-span-1">
            <CreditsLedger 
              sales={sales}
              creditPayments={creditPayments}
              creditEats={creditEats}
              onPayCreditEat={onPayCreditEat}
              formatCurrency={formatCurrency}
              onPayCredit={onPayCredit}
              triggerToast={triggerToast}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div className="sm:col-span-2 boss-card border-l-4 border-l-gold-brand p-5 flex flex-col justify-between min-h-32 min-w-0" title="Category that sold the most money in this period">
              <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-1">Top Category ({timeFilter}) <Info className="w-3 h-3 text-zinc-600" /></span>
              <div className="flex items-center justify-between gap-2 mt-1 min-w-0">
                <h3 className="text-2xl font-black text-gold-brand uppercase font-display truncate tabular-nums" title={topCategory.name}>{topCategory.name}</h3>
                <TrendingUp className="w-6 h-6 text-gold-brand shrink-0" />
              </div>
              <p className="text-xs text-zinc-400 font-bold uppercase truncate tabular-nums">Sales: {formatCurrency(topCategory.amount)}</p>
            </div>
            <div className="boss-card p-5 flex flex-col justify-between min-h-32 min-w-0" title="All money from sales in this period (before costs). Swipe Daily/Weekly/Monthly to change period.">
              <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-1">Money In <Info className="w-3 h-3 text-zinc-600" /></span>
              <h3 className="text-2xl font-black text-white font-display mt-1 truncate tabular-nums" title={formatCurrency(displayIncome)}>{formatCurrency(displayIncome)}</h3>
              <p className="text-xs text-zinc-500 font-bold uppercase truncate">
                Total sales{displayDesignRevenue > 0 ? ` • Design ${formatCurrency(displayDesignRevenue)}` : ''} • Tap Daily/Weekly/Monthly above
              </p>
              {revenueDeltaPct !== null && (
                <p className={`text-xs font-black uppercase mt-1 truncate tabular-nums ${revenueDeltaPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {revenueDeltaPct >= 0 ? '▲' : '▼'} {Math.abs(revenueDeltaPct)}% vs previous {timeFilter === 'Daily' ? 'day' : timeFilter === 'Weekly' ? 'week' : 'month'}
                </p>
              )}
              {displayVat > 0 && (
                <p className="text-xs text-emerald-400 font-bold uppercase mt-1 truncate tabular-nums">VAT inside: {formatCurrency(displayVat)}</p>
              )}
            </div>
            <div className="boss-card p-5 flex flex-col justify-between min-h-32 min-w-0" title="What's left after stock costs, expenses and design costs. Green = profit, red = loss.">
              <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-1">Profit Left <Info className="w-3 h-3 text-zinc-600" /></span>
              <h3 className={`text-2xl font-black font-display mt-1 truncate tabular-nums ${displayNetProfit >= 0 ? 'text-gold-brand' : 'text-rose-400'}`} title={formatCurrency(displayNetProfit)}>{formatCurrency(displayNetProfit)}</h3>
              <p className="text-xs text-zinc-500 font-bold uppercase truncate">{displayNetProfit >= 0 ? t(settings.language, 'youKept') : t(settings.language, 'youLost')} • after all costs</p>
              {timeFilter === 'Daily' && (
                <details className="mt-2">
                  <summary className="text-[10px] font-black text-gold-brand/80 uppercase tracking-wider cursor-pointer hover:text-gold-brand">How?</summary>
                  <div className="mt-1 space-y-0.5 text-[11px] font-bold tabular-nums">
                    <div className="flex justify-between gap-2"><span className="text-zinc-500 uppercase">Sales in</span><span className="text-zinc-100">+{formatCurrency(revenue)}</span></div>
                    <div className="flex justify-between gap-2"><span className="text-zinc-500 uppercase">Stock cost</span><span className="text-amber-300">−{formatCurrency(cogs)}</span></div>
                    <div className="flex justify-between gap-2"><span className="text-zinc-500 uppercase">Spending</span><span className="text-rose-300">−{formatCurrency(totalExpenses)}</span></div>
                    {totalDiscounts > 0 && (
                      <div className="flex justify-between gap-2"><span className="text-zinc-500 uppercase">Discounts given</span><span className="text-purple-300">−{formatCurrency(totalDiscounts)}</span></div>
                    )}
                    {expenseCategoryBreakdown.slice(0, 3).map(c => (
                      <div key={c.category} className="flex justify-between gap-2">
                        <span className="text-zinc-500 uppercase truncate min-w-0">{c.category}</span>
                        <span className="text-zinc-400 shrink-0">−{formatCurrency(c.total)}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>

          <section className="boss-card p-5">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest">Sales Over Time</h3>
              <div className="flex items-center gap-2">
                {timeFilter !== 'Daily' && (
                  <div className="flex bg-[#0A0A0A] rounded-lg border border-white/5 overflow-hidden">
                    {(['revenue', 'profit'] as const).map(m => (
                      <button key={m} onClick={() => setChartMetric(m)}
                        className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${chartMetric === m ? 'bg-gold-brand text-black' : 'text-zinc-500 hover:text-zinc-300'}`}>
                        {m === 'revenue' ? 'Sales' : 'Profit'}
                      </button>
                    ))}
                  </div>
                )}
                <TrendingUp className="w-4 h-4 text-gold-brand" />
              </div>
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
                    const chartSeries = chartMetric === 'profit' ? dailyProfitSeries : dailySeries;
                    const dailyMax = Math.max(...chartSeries.map(x => x.val), 1000);
                    const peakColor = chartMetric === 'profit' ? 'bg-gradient-to-t from-emerald-700 to-emerald-400' : 'bg-gradient-to-t from-gold-medium to-gold-brand';
                    return chartSeries.map((d, idx) => {
                    const pct = dailyMax > 0 ? (Math.max(0, d.val) / dailyMax) * 100 : 0;
                    const isPeak = d.val === dailyMax;
                    return (
                      <div key={idx} className="flex-1 flex flex-col items-center h-full justify-end group relative">
                        <div className="absolute -top-7 bg-[#141414] border border-white/5 text-xs text-gold-brand px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity z-20 pointer-events-none font-bold whitespace-nowrap">
                          {d.label}: {formatCurrency(d.val)}
                        </div>
                        <div className={`w-full rounded-t transition-all duration-500 ${isPeak ? peakColor : 'bg-zinc-800 group-hover:bg-zinc-700'}`}
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
                {dailyBreakdown.length} {dailyBreakdown.length === 1 ? 'day' : 'days'} • Tap a day to open
              </span>
            </div>
            <p className="text-xs text-zinc-500 font-bold uppercase mb-3 flex items-center gap-1"><Info className="w-3 h-3" /> Tap any day row to see its sales & expenses — Balance green = you kept money, red = you lost</p>
            <div className="relative mb-3">
              <input type="text" value={saleSearch} onChange={(e) => setSaleSearch(e.target.value)}
                placeholder="Search sales: customer, order #, item…"
                className="w-full bg-[#0A0A0A] border border-white/5 text-gold-light rounded-xl h-11 pl-4 pr-9 text-sm outline-none focus:border-gold-brand" />
              {saleSearch && (
                <button onClick={() => setSaleSearch('')} aria-label="Clear sales search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white p-1.5 cursor-pointer">✕</button>
              )}
            </div>

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
                            {day.discountTotal > 0 && ` • −${formatCurrency(day.discountTotal)} off`}
                          </p>
                          {(day.cashTotal > 0 || day.momoTotal > 0 || day.creditTotal > 0) && (
                            <p className="text-[10px] font-bold text-zinc-600 uppercase mt-0.5 truncate tabular-nums">
                              Cash {formatCurrency(day.cashTotal)} • MoMo {formatCurrency(day.momoTotal)} • Credit {formatCurrency(day.creditTotal)}
                            </p>
                          )}
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
                              {day.sales.filter(sale => {
                                const q = saleSearch.trim().toLowerCase();
                                if (!q) return true;
                                return (sale.customerName || '').toLowerCase().includes(q) ||
                                  sale.orderNumber.toLowerCase().includes(q) ||
                                  sale.items.some(i => i.productName.toLowerCase().includes(q));
                              }).map(sale => (
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
                                <button key={exp.id} onClick={() => setSelectedExpense(exp)}
                                  className="w-full flex items-center justify-between gap-2 bg-[#0A0A0A] border border-white/5 hover:border-rose-500/30 rounded-lg px-3 py-2 text-left transition-all cursor-pointer">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <Coins className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                                    <div className="min-w-0">
                                      <p className="text-xs font-bold text-white uppercase truncate">{exp.description}</p>
                                      <p className="text-[10px] text-zinc-500 font-bold uppercase">{exp.category} • tap for receipt</p>
                                    </div>
                                  </div>
                                  <p className="text-xs font-black text-rose-400 shrink-0">-{formatCurrency(exp.amount)}</p>
                                </button>
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
                // Empty reports that teach (#4): one action, not just "no data".
                <div className="p-6 text-center">
                  <p className="text-zinc-500 text-xs font-bold uppercase">No sales or expenses in this period.</p>
                  <button onClick={() => onNavigate('sales')}
                    className="mt-3 h-11 px-5 bg-gold-brand text-black font-black uppercase tracking-widest rounded-xl text-xs hover:opacity-90 active:scale-95 transition-all cursor-pointer">
                    + Start a Sale
                  </button>
                </div>
              )}
            </div>

            {dailyBreakdown.length > DAY_VIEW_LIMIT && (
              <button onClick={() => {
                if (showAllDays) {
                  setShowAllDays(false);
                  setExpandedDays(new Set());
                  triggerToast(`Showing recent ${Math.min(DAY_VIEW_LIMIT, dailyBreakdown.length)} day(s)`, 'info');
                } else {
                  setShowAllDays(true);
                  setExpandedDays(new Set([dailyBreakdown[0]?.date].filter(Boolean) as string[]));
                  triggerToast(`Showing all ${dailyBreakdown.length} days`, 'success');
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
                  <div key={s.name} className={`flex items-center justify-between gap-2 rounded-xl px-4 py-3 ${s.risk === 'flag' ? 'bg-rose-950/25 border border-rose-600/40' : i === 0 ? 'bg-gold-brand/5 border border-gold-brand/20' : 'bg-[#0A0A0A] border border-white/5'}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black ${i === 0 ? 'bg-gold-brand text-black' : 'bg-zinc-800 text-zinc-300'}`}>
                        {i + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="text-xs font-black text-white uppercase truncate block">{s.name}</span>
                        {s.refunds > 0 && <span className={`text-[9px] font-bold uppercase ${s.risk === 'flag' ? 'text-rose-300' : 'text-zinc-500'}`}>{s.refunds} refunded{s.risk !== 'ok' ? ' • check' : ''}</span>}
                      </span>
                      {i === 0 && <span className="text-[9px] font-black text-gold-brand uppercase tracking-wider border border-gold-brand/30 bg-gold-brand/10 rounded-full px-2 py-0.5 shrink-0">Top</span>}
                      {s.risk === 'flag' && <span className="text-[9px] font-black text-rose-300 uppercase tracking-wider border border-rose-600/40 bg-rose-950/40 rounded-full px-2 py-0.5 shrink-0">Flag</span>}
                      {s.risk === 'watch' && <span className="text-[9px] font-black text-amber-300 uppercase tracking-wider border border-amber-600/40 bg-amber-950/40 rounded-full px-2 py-0.5 shrink-0">Watch</span>}
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

          {(() => {
            // Regulars worth knowing: top named buyers + average basket.
            const byCust = new Map<string, { name: string; total: number; count: number }>();
            for (const s of filteredSales) {
              const name = (s.customerName || '').trim();
              if (!name) continue;
              const cur = byCust.get(name.toLowerCase()) || { name, total: 0, count: 0 };
              cur.total += s.total;
              cur.count += 1;
              byCust.set(name.toLowerCase(), cur);
            }
            const top = Array.from(byCust.values()).sort((a, b) => b.total - a.total).slice(0, 5);
            const avgBasket = filteredSales.length > 0 ? revenue / filteredSales.length : 0;
            if (top.length === 0 && avgBasket <= 0) return null;
            return (
              <section className="boss-card p-5">
                <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest mb-1 flex items-center gap-2">
                  <User className="w-4 h-4 text-gold-brand" /> Top Customers ({timeFilter})
                </h3>
                <p className="text-[10px] text-zinc-600 font-bold uppercase mb-3">
                  Avg basket <span className="text-gold-brand font-black">{formatCurrency(avgBasket)}</span> • name buyers at the till to grow this list
                </p>
                <div className="space-y-1.5">
                  {top.map((c, i) => (
                    <div key={c.name.toLowerCase()} className="flex items-center justify-between gap-2 rounded-xl px-4 py-2.5 bg-[#0A0A0A] border border-white/5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${i === 0 ? 'bg-gold-brand text-black' : 'bg-zinc-800 text-zinc-300'}`}>
                          {i + 1}
                        </span>
                        <span className="text-xs font-black text-white uppercase truncate">{c.name}</span>
                        <span className="text-[10px] font-bold text-zinc-500 uppercase shrink-0">{c.count} visit{c.count !== 1 ? 's' : ''}</span>
                      </div>
                      <span className="text-xs font-black text-gold-brand shrink-0 tabular-nums">{formatCurrency(c.total)}</span>
                    </div>
                  ))}
                </div>
              </section>
            );
          })()}

          {/* Spending is logged in the Spend tab — no duplicate form here. */}
          <section className="grid grid-cols-1 gap-6">
            <div className="boss-card p-5 rounded-2xl flex flex-col justify-between">
              <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest mb-3">Sales by Category</h3>
              <div className="flex flex-col sm:flex-row items-center gap-6">
                <div className="relative w-28 h-28 shrink-0">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36" role="img" aria-label={`Sales share by category, total ${formatCurrency(revenue)}`}>
                    <circle cx="18" cy="18" r="16" fill="none" stroke="#2a2a2a" strokeWidth="4" pathLength={100}></circle>
                    {donutSegments.map((seg, idx) => (
                      <circle key={idx} cx="18" cy="18" r="16" fill="none" stroke={seg.color} strokeWidth="4" pathLength={100} strokeLinecap="butt" strokeDasharray={seg.strokeDash} strokeDashoffset={seg.strokeOffset} className="transition-all duration-300"></circle>
                    ))}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center px-1 text-center">
                    <span className="text-[10px] text-zinc-500 font-bold uppercase">Total</span>
                    <span className="text-[11px] font-black text-white tabular-nums leading-tight" title={formatCurrency(revenue)}>{revenue > 0 ? formatCurrency(revenue) : '—'}</span>
                  </div>
                </div>
                <div className="space-y-2 flex-1 w-full min-w-0">
                  {Object.entries(categoryBreakdown).length === 0 && (
                    <p className="text-[11px] text-zinc-600 font-bold uppercase text-center py-4">No category sales in this period</p>
                  )}
                  {Object.entries(categoryBreakdown).map(([cat, val]) => {
                    const numericVal = val as number;
                    const pct = revenue > 0 ? (numericVal / revenue) * 100 : 0;
                    const catColor = colorsMap[cat] || '#3f3f46';
                    return (
                      <div key={cat} className="flex items-center justify-between gap-4 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: catColor }}></span>
                          <span className="text-xs text-zinc-400 font-bold uppercase truncate" title={cat}>{cat}</span>
                        </div>
                        <span className="text-xs font-black text-zinc-200 shrink-0 tabular-nums">
                          {formatCurrency(numericVal)} <span className="text-zinc-500 text-xs font-bold">({pct.toFixed(0)}%)</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          {expenseCategoryBreakdown.length > 0 && (
            <section className="boss-card p-5 rounded-2xl">
              <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest mb-1">Where the money went ({timeFilter})</h3>
              <p className="text-[10px] text-zinc-600 font-bold uppercase mb-3">Tap a row to filter receipts — e.g. Food vs Electricity</p>
              <div className="space-y-2">
                {expenseCategoryBreakdown.map(row => {
                  const pct = totalExpenses > 0 ? Math.round((row.total / totalExpenses) * 100) : 0;
                  const active = expenseCatFilter === row.category;
                  return (
                    <button
                      key={row.category}
                      onClick={() => setExpenseCatFilter(prev => (prev === row.category ? null : row.category))}
                      className={`w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 border transition-all cursor-pointer text-left ${active ? 'border-gold-brand/50 bg-gold-brand/5' : 'border-white/5 bg-black/30 hover:border-white/15'}`}
                    >
                      <span className="min-w-0">
                        <span className="block text-xs font-black text-white uppercase truncate">{row.category}{active ? ' ✓' : ''}</span>
                        <span className="block text-[10px] text-zinc-500 font-bold uppercase">{row.count} receipt{row.count !== 1 ? 's' : ''} • {pct}% of spend</span>
                      </span>
                      <span className="text-sm font-black text-rose-400 shrink-0">-{formatCurrency(row.total)}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest">
                Expense History ({expenseCatFilter || timeFilter}) • tap for receipt
              </h3>
              {expenseCatFilter && (
                <button onClick={() => setExpenseCatFilter(null)} className="text-[10px] font-black uppercase text-gold-brand cursor-pointer">Clear ✕</button>
              )}
            </div>
            <div className="space-y-2">
              {visibleExpenses.map(exp => (
                <button key={exp.id} onClick={() => setSelectedExpense(exp)}
                  className="w-full boss-card flex items-center justify-between p-4 rounded-xl group text-left hover:border-rose-500/30 transition-all cursor-pointer active:scale-[0.99]">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 border border-rose-900/40 bg-rose-950/20 rounded flex items-center justify-center text-rose-400 shrink-0">
                      <Coins className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white uppercase truncate">{exp.description}</p>
                      <p className="text-xs text-zinc-500 font-bold mt-0.5 uppercase truncate">{exp.category} • {new Date(exp.timestamp).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <p className="text-sm font-black text-rose-400 font-display">-{formatCurrency(exp.amount)}</p>
                    <span
                      role="button" tabIndex={0} aria-label={deleteExpConfirm === exp.id ? 'Tap again to confirm delete' : 'Delete expense'}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (deleteExpConfirm !== exp.id) { setDeleteExpConfirm(exp.id); return; }
                        setDeleteExpConfirm(null);
                        onDeleteExpense(exp.id); triggerToast(`Deleted expense`, 'info');
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.stopPropagation();
                        if (deleteExpConfirm !== exp.id) { setDeleteExpConfirm(exp.id); return; }
                        setDeleteExpConfirm(null);
                        onDeleteExpense(exp.id);
                      }}
                      className={`px-2 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all rounded-lg cursor-pointer ${
                        deleteExpConfirm === exp.id
                          ? 'bg-rose-600 text-white'
                          : 'text-zinc-600 hover:text-rose-400 lg:opacity-0 lg:group-hover:opacity-100 hover:bg-rose-950/30'
                      }`}>
                      {deleteExpConfirm === exp.id ? t(settings.language, 'sure') : <Trash2 className="w-3.5 h-3.5" />}
                    </span>
                  </div>
                </button>
              ))}
              {filteredExpenses.length === 0 && (
                <div className="boss-card p-6 text-center text-zinc-500 text-xs font-bold uppercase">No expenses recorded.</div>
              )}
              {filteredExpenses.length > visibleExpenses.length && (
                <p className="text-[10px] text-zinc-600 font-bold uppercase text-center">Showing {visibleExpenses.length} of {filteredExpenses.length} — use Spend tab filters for more.</p>
              )}
            </div>
          </section>
          <ExpenseDetailModal
            expense={selectedExpense}
            formatCurrency={formatCurrency}
            onClose={() => setSelectedExpense(null)}
            onDelete={(id) => { onDeleteExpense(id); triggerToast('Deleted expense', 'info'); }}
            lang={settings.language}
          />
        </>
      )}

      {showSupplierModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="boss-card w-full max-w-md p-6 bg-zinc-950 border border-white/5 space-y-4 max-h-[90vh] overflow-y-auto">
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