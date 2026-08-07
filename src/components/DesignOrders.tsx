import { useState, useMemo, useEffect, useRef } from 'react';
import { Palette, Plus, Calendar, X, Search, User, Layers, Ruler, Calculator, ChevronRight, RotateCcw } from 'lucide-react';
import type { DesignOrder } from '../types';
import { designOrderApi } from '../api';

const WORK_PRESETS: Record<string, string[]> = {
  logo: ['Logo Design', 'Brand Identity', 'Letterhead', 'Business Card + Logo', 'Full Branding Pack'],
  flyer: ['Flyer (A5)', 'Flyer (A4)', 'Poster', 'Brochure / Menu', 'Invitation Card'],
  banner: ['PVC Banner (per sq m)', 'Roll-Up Banner', 'Fleet / Store Front Branding'],
  cards: ['Business Cards (100pcs)', 'Business Cards (250pcs)', 'Business Cards (500pcs)'],
  print: ['Black & White Print', 'Color Print', 'Lamination', 'Spiral Binding', 'Photocopy'],
  branding: ['Label / Sticker', 'Clothing / T-Shirt Print', 'Packaging / Box', 'Uniform Branding'],
  other: ['Other Design Work'],
};

const STATUS_CFG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  pending:     { label: 'Pending',      color: 'text-amber-400',   bg: 'bg-amber-950/30',   dot: 'bg-amber-400' },
  in_progress: { label: 'In Progress',  color: 'text-blue-400',    bg: 'bg-blue-950/30',    dot: 'bg-blue-400' },
  review:      { label: 'Client Review', color: 'text-purple-400', bg: 'bg-purple-950/30',  dot: 'bg-purple-400' },
  completed:   { label: 'Completed',    color: 'text-emerald-400', bg: 'bg-emerald-950/30', dot: 'bg-emerald-400' },
  delivered:   { label: 'Delivered',    color: 'text-zinc-500',    bg: 'bg-zinc-900/50',    dot: 'bg-zinc-500' },
};

const TYPE_CFG: Record<string, { label: string; icon: string }> = {
  logo:     { label: 'Logo / Brand', icon: '🎨' },
  flyer:    { label: 'Flyer / Poster', icon: '📄' },
  banner:   { label: 'Banner', icon: '🖼️' },
  cards:    { label: 'Business Cards', icon: '💳' },
  print:    { label: 'Printing', icon: '🖨️' },
  branding: { label: 'Branding', icon: '🏷️' },
  other:    { label: 'Other', icon: '📋' },
};

const STATUS_ORDER = ['pending', 'in_progress', 'review', 'completed', 'delivered'];

interface DesignOrdersProps {
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export default function DesignOrders({ triggerToast }: DesignOrdersProps) {
  const [orders, setOrders] = useState<DesignOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showPanel, setShowPanel] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [f, setF] = useState({
    customerName: '', customerPhone: '', orderType: 'logo' as string,
    designBrief: '', qty: '1', size: '', materialCost: '', laborCost: '',
    unitPrice: '', totalAmount: '', depositPaid: '', targetMarginPct: '50',
    expectedDate: '', notes: '',
  });

  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    designOrderApi.list()
      .then(setOrders)
      .catch(() => triggerToast('Failed to load design orders', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const allCustomers = useMemo(() => {
    const seen = new Set<string>();
    return orders.filter(o => {
      const key = o.customerName.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(o => ({ name: o.customerName, phone: o.customerPhone })).sort((a, b) => a.name.localeCompare(b.name));
  }, [orders]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return orders.filter(o => {
      if (filter !== 'all' && o.status !== filter) return false;
      if (!q) return true;
      return o.customerName.toLowerCase().includes(q) ||
             o.customerPhone.includes(q) ||
             o.designBrief.toLowerCase().includes(q) ||
             o.id.toLowerCase().includes(q);
    });
  }, [orders, filter, search]);

  const pendingCount = orders.filter(o => o.status === 'pending').length;
  const activeCount = orders.filter(o => o.status === 'in_progress' || o.status === 'review').length;
  const completedToday = orders.filter(o => o.status === 'completed' && o.completedDate?.startsWith(today)).length;
  const deliveredToday = orders.filter(o => o.status === 'delivered' && o.createdAt.startsWith(today)).length;
  const revenueToday = orders.filter(o => o.status === 'delivered' && o.createdAt.startsWith(today))
    .reduce((acc, o) => acc + o.totalAmount, 0);

  // Live pricing calculator (material + labor vs. target margin).
  const calc = useMemo(() => {
    const material = parseFloat(f.materialCost) || 0;
    const labor = parseFloat(f.laborCost) || 0;
    const qty = Math.max(1, parseFloat(f.qty) || 1);
    const margin = Math.min(95, Math.max(0, parseFloat(f.targetMarginPct) || 0));
    const totalCost = material + labor;
    const suggested = totalCost > 0 && margin < 100 ? totalCost / (1 - margin / 100) : 0;
    const unit = qty > 0 ? suggested / qty : 0;
    const actualTotal = parseFloat(f.totalAmount) || 0;
    const actualProfit = actualTotal > 0 ? actualTotal - totalCost : 0;
    return { totalCost, suggested, unit, actualTotal, actualProfit };
  }, [f.materialCost, f.laborCost, f.qty, f.targetMarginPct, f.totalAmount]);

  function resetForm() {
    setF({ customerName: '', customerPhone: '', orderType: 'logo', designBrief: '', qty: '1', size: '', materialCost: '', laborCost: '', unitPrice: '', totalAmount: '', depositPaid: '', targetMarginPct: '50', expectedDate: '', notes: '' });
  }

  function openCreate() {
    setEditId(null);
    resetForm();
    setShowPanel(true);
  }

  function openEdit(order: DesignOrder) {
    setEditId(order.id);
    setF({
      customerName: order.customerName, customerPhone: order.customerPhone,
      orderType: order.orderType, designBrief: order.designBrief,
      qty: String(order.qty), size: order.size,
      materialCost: String(order.materialCost), laborCost: String(order.laborCost),
      unitPrice: String(order.unitPrice), totalAmount: String(order.totalAmount),
      depositPaid: String(order.depositPaid), targetMarginPct: String(order.targetMarginPct),
      expectedDate: order.expectedDate, notes: order.notes,
    });
    setShowPanel(true);
  }

  function pickCustomer(c: { name: string; phone: string }) {
    setF(f => ({ ...f, customerName: c.name, customerPhone: c.phone }));
  }

  function applySuggested() {
    if (calc.suggested <= 0) { triggerToast('Enter material/labor cost first', 'error'); return; }
    const total = Math.round(calc.suggested);
    setF(p => ({ ...p, totalAmount: String(total), unitPrice: String(Math.round(calc.unit)) }));
    triggerToast('Price applied from calculator', 'success');
  }

  async function handleSave() {
    if (!f.customerName.trim()) { triggerToast('Enter customer name', 'error'); return; }
    const total = parseFloat(f.totalAmount);
    if (!total || total <= 0) { triggerToast('Enter a valid amount', 'error'); return; }

    const now = new Date().toISOString();
    const existing = editId ? orders.find(o => o.id === editId) : null;
    const qty = Math.max(1, parseFloat(f.qty) || 1);
    const order: DesignOrder = {
      id: editId || `dorder-${Date.now()}`,
      customerName: f.customerName.trim(),
      customerPhone: f.customerPhone.trim(),
      orderDate: existing?.orderDate || today,
      expectedDate: f.expectedDate || today,
      orderType: f.orderType as DesignOrder['orderType'],
      designBrief: f.designBrief.trim() || TYPE_CFG[f.orderType]?.label || f.orderType,
      qty,
      size: f.size.trim(),
      materialCost: parseFloat(f.materialCost) || 0,
      laborCost: parseFloat(f.laborCost) || 0,
      unitPrice: parseFloat(f.unitPrice) || 0,
      totalAmount: total,
      depositPaid: parseFloat(f.depositPaid) || 0,
      targetMarginPct: Math.min(95, Math.max(0, parseFloat(f.targetMarginPct) || 50)),
      status: existing?.status || 'pending',
      notes: f.notes.trim(),
      completedDate: existing?.completedDate,
      createdAt: existing?.createdAt || now,
    };

    try {
      if (editId) {
        const updated = await designOrderApi.update(order);
        setOrders(prev => prev.map(o => o.id === editId ? updated : o));
        triggerToast('Order updated', 'success');
      } else {
        const created = await designOrderApi.create(order);
        setOrders(prev => [created, ...prev]);
        triggerToast('Order created', 'success');
      }
      setShowPanel(false);
    } catch { triggerToast('Failed to save order', 'error'); }
  }

  async function advanceStatus(order: DesignOrder) {
    const idx = STATUS_ORDER.indexOf(order.status);
    if (idx === -1 || idx === STATUS_ORDER.length - 1) return;
    const next = STATUS_ORDER[idx + 1];
    const updated: DesignOrder = {
      ...order,
      status: next as DesignOrder['status'],
      completedDate: next === 'completed' ? new Date().toISOString() : order.completedDate,
    };
    try {
      const result = await designOrderApi.update(updated);
      setOrders(prev => prev.map(o => o.id === order.id ? result : o));
      triggerToast(`${order.customerName} → ${STATUS_CFG[next]?.label}`, 'success');
    } catch { triggerToast('Failed to update status', 'error'); }
  }

  async function revertStatus(order: DesignOrder) {
    const idx = STATUS_ORDER.indexOf(order.status);
    if (idx <= 0) return;
    const prev = STATUS_ORDER[idx - 1];
    const updated: DesignOrder = {
      ...order,
      status: prev as DesignOrder['status'],
      completedDate: prev !== 'completed' ? undefined : order.completedDate,
    };
    try {
      const result = await designOrderApi.update(updated);
      setOrders(prev => prev.map(o => o.id === order.id ? result : o));
      triggerToast(`Reverted to ${STATUS_CFG[prev]?.label}`, 'info');
    } catch { triggerToast('Failed to revert', 'error'); }
  }

  async function handleDelete(id: string) {
    try {
      await designOrderApi.remove(id);
      setOrders(prev => prev.filter(o => o.id !== id));
      triggerToast('Order deleted', 'info');
    } catch { triggerToast('Failed to delete', 'error'); }
    setConfirmDelete(null);
  }

  function statusCount(s: string) {
    if (s === 'all') return orders.length;
    return orders.filter(o => o.status === s).length;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-gold-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-28">
      {/* ===== HEADER ===== */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-950/30 border border-cyan-800/40 flex items-center justify-center">
            <Palette className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-lg font-black text-white uppercase tracking-tight font-display">Design & Print</h2>
            <p className="text-xs text-zinc-500 font-bold">{orders.length} orders</p>
          </div>
        </div>
        <button onClick={openCreate}
          className="h-10 px-4 bg-gold-brand text-black font-black uppercase tracking-wider rounded-xl text-xs hover:opacity-90 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer">
          <Plus className="w-4 h-4" /> New
        </button>
      </div>

      {/* ===== LIVE STATS ===== */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Pending', count: pendingCount, color: 'text-amber-400', border: 'border-l-amber-500' },
          { label: 'Active', count: activeCount, color: 'text-blue-400', border: 'border-l-blue-500' },
          { label: 'Done', count: completedToday, color: 'text-emerald-400', border: 'border-l-emerald-500' },
          { label: 'Sold', count: deliveredToday, color: 'text-cyan-400', border: 'border-l-cyan-500' },
        ].map(s => (
          <div key={s.label} className={`boss-card p-2.5 border-l-4 ${s.border}`}>
            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">{s.label}</p>
            <p className={`text-lg font-black ${s.color} mt-0.5`}>{s.count}</p>
          </div>
        ))}
      </div>
      {revenueToday > 0 && (
        <div className="boss-card p-3 border-l-4 border-l-gold-brand flex items-center justify-between">
          <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Delivered today</span>
          <span className="text-sm font-black text-gold-brand">{revenueToday.toLocaleString()} UGX</span>
        </div>
      )}

      {/* ===== SEARCH ===== */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input ref={searchRef} type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by customer, phone, brief, or order ID..."
          className="w-full bg-[#141414] border border-white/5 text-gold-light h-11 pl-11 pr-4 rounded-xl text-sm focus:border-gold-brand focus:outline-none transition-all" />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ===== FILTER TABS ===== */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {[
          { key: 'all', label: 'All' },
          ...STATUS_ORDER.map(s => ({ key: s, label: STATUS_CFG[s].label })),
        ].map(t => (
          <button key={t.key} onClick={() => setFilter(t.key)}
            className={`flex items-center gap-1.5 py-2 px-4 rounded-xl border text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap cursor-pointer active:scale-95 shrink-0 min-h-[38px] ${
              filter === t.key
                ? 'bg-gold-brand border-gold-brand text-black'
                : 'bg-zinc-900/30 border-zinc-800/30 text-zinc-500 hover:border-zinc-600'
            }`}>
            {t.label}
            <span className={`text-[10px] ${filter === t.key ? 'text-black/50' : 'text-zinc-700'}`}>{statusCount(t.key)}</span>
          </button>
        ))}
      </div>

      {/* ===== ORDER LIST ===== */}
      {filtered.length === 0 ? (
        <div className="boss-card p-12 flex flex-col items-center justify-center text-center">
          <Palette className="w-12 h-12 text-zinc-700 mb-3" />
          <p className="text-sm text-zinc-500 font-bold uppercase tracking-wider">
            {search ? 'No orders match your search' : 'No design orders yet'}
          </p>
          <button onClick={openCreate}
            className="mt-4 h-10 px-5 bg-gold-brand text-black font-black text-xs rounded-xl uppercase tracking-wider cursor-pointer">
            New Order
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(order => {
            const sc = STATUS_CFG[order.status];
            const tc = TYPE_CFG[order.orderType] || { label: order.orderType, icon: '📋' };
            const balance = order.totalAmount - order.depositPaid;
            const isOverdue = order.expectedDate < today && order.status !== 'delivered';
            const profit = order.totalAmount - order.materialCost - order.laborCost;

            return (
              <div key={order.id} className="boss-card p-4 hover:bg-[#1C1C1C] transition-all">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-white truncate">{order.customerName}</h3>
                      {order.customerPhone && (
                        <span className="text-[10px] text-zinc-500 shrink-0 hidden sm:inline">{order.customerPhone}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 font-bold uppercase">
                        {tc.icon} {tc.label}
                      </span>
                      {order.qty > 1 && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 font-bold uppercase flex items-center gap-1">
                          <Layers className="w-3 h-3" /> {order.qty}×
                        </span>
                      )}
                      {order.size && (
                        <span className="text-[10px] text-zinc-600 font-bold flex items-center gap-1">
                          <Ruler className="w-3 h-3" /> {order.size}
                        </span>
                      )}
                      <span className={`text-[10px] px-2 py-0.5 rounded ${sc.bg} ${sc.color} font-bold uppercase flex items-center gap-1`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                        {sc.label}
                      </span>
                      <span className="text-[10px] text-zinc-600 font-bold flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {order.expectedDate}
                      </span>
                      {isOverdue && (
                        <span className="text-[10px] text-rose-400 font-bold">OVERDUE</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-black text-gold-brand">{order.totalAmount.toLocaleString()}</p>
                    {order.unitPrice > 0 && order.qty > 1 && (
                      <p className="text-[10px] text-zinc-600 font-bold">{order.unitPrice.toLocaleString()}/pc</p>
                    )}
                    {order.depositPaid > 0 && (
                      <p className="text-[10px] text-emerald-400 font-bold">Paid: {order.depositPaid.toLocaleString()}</p>
                    )}
                    {balance > 0 && order.status !== 'delivered' && (
                      <p className="text-[10px] text-rose-400 font-bold">Bal: {balance.toLocaleString()}</p>
                    )}
                  </div>
                </div>

                {order.designBrief && (
                  <p className="text-xs text-zinc-400 leading-relaxed mb-2">{order.designBrief}</p>
                )}

                {order.status === 'delivered' && (order.materialCost > 0 || order.laborCost > 0) && (
                  <p className="text-[10px] text-emerald-400/80 font-bold mb-2">Profit: {profit.toLocaleString()} UGX</p>
                )}

                {order.notes && (
                  <p className="text-[10px] text-zinc-500 italic mb-2 line-clamp-2">📝 {order.notes}</p>
                )}

                <div className="flex items-center gap-1.5 pt-2.5 border-t border-white/5">
                  {order.status !== 'delivered' && (
                    <button onClick={() => advanceStatus(order)}
                      className="flex-1 h-9 bg-gold-brand/20 text-gold-light border border-gold-brand/30 rounded-xl text-[10px] font-bold uppercase tracking-wider hover:bg-gold-brand/30 active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-1">
                      <ChevronRight className="w-3 h-3" />
                      {order.status === 'pending' ? 'Start' : order.status === 'in_progress' ? 'Send to Review' : order.status === 'review' ? 'Complete' : 'Deliver'}
                    </button>
                  )}
                  {order.status !== 'pending' && order.status !== 'delivered' && (
                    <button onClick={() => revertStatus(order)}
                      className="h-9 w-9 bg-zinc-800/30 text-zinc-500 hover:text-zinc-300 rounded-xl flex items-center justify-center active:scale-95 transition-all cursor-pointer"
                      title="Revert to previous status">
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button onClick={() => openEdit(order)}
                    className="h-9 px-3 bg-zinc-800/30 text-zinc-400 hover:text-white border border-zinc-800/50 rounded-xl text-[10px] font-bold uppercase tracking-wider hover:bg-zinc-800 active:scale-95 transition-all cursor-pointer">
                    Edit
                  </button>
                  {confirmDelete === order.id ? (
                    <div className="flex gap-1">
                      <button onClick={() => handleDelete(order.id)}
                        className="h-9 px-3 bg-rose-600 text-white rounded-xl text-[10px] font-bold cursor-pointer">Delete</button>
                      <button onClick={() => setConfirmDelete(null)}
                        className="h-9 px-3 bg-zinc-800 text-zinc-400 rounded-xl text-[10px] font-bold cursor-pointer">No</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDelete(order.id)}
                      className="h-9 w-9 bg-zinc-800/20 text-zinc-600 hover:text-rose-400 rounded-xl flex items-center justify-center active:scale-95 transition-all cursor-pointer">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ===== CREATE/EDIT PANEL (slide-up) ===== */}
      {showPanel && (
        <div className="fixed inset-0 z-50 flex flex-col">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowPanel(false)} />
          <div className="relative mt-auto bg-[#141414] border-t border-zinc-800 rounded-t-3xl max-h-[92vh] flex flex-col shadow-2xl animate-slide-up">
            <div className="flex justify-center pt-2 pb-1">
              <div className="w-10 h-1 rounded-full bg-zinc-700" />
            </div>

            <div className="flex items-center justify-between px-5 pb-3 border-b border-white/5">
              <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                <Palette className="w-4 h-4 text-cyan-400" />
                {editId ? 'Edit Order' : 'New Design Order'}
              </h3>
              <button onClick={() => setShowPanel(false)}
                className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 transition-all cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* CUSTOMER */}
              <section>
                <h4 className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <User className="w-3 h-3" /> Customer
                </h4>
                <div className="space-y-2.5">
                  <div className="relative">
                    <input type="text" value={f.customerName} onChange={e => setF(p => ({ ...p, customerName: e.target.value }))}
                      placeholder="Customer name *"
                      className="w-full bg-[#0A0A0A] border border-white/5 text-white rounded-xl h-12 px-4 text-sm focus:border-gold-brand focus:outline-none" autoFocus />
                    {f.customerName && allCustomers.filter(c => c.name.toLowerCase().includes(f.customerName.toLowerCase()) && c.name !== f.customerName).length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-[#1A1A1A] border border-zinc-800 rounded-xl overflow-hidden z-10 shadow-xl">
                        {allCustomers.filter(c => c.name.toLowerCase().includes(f.customerName.toLowerCase()) && c.name !== f.customerName).slice(0, 5).map(c => (
                          <button key={c.name} onClick={() => pickCustomer(c)}
                            className="w-full px-4 py-2.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 font-bold flex items-center gap-2 transition-all cursor-pointer">
                            <User className="w-3 h-3 text-zinc-500 shrink-0" />
                            <span>{c.name}</span>
                            {c.phone && <span className="text-zinc-600 font-normal">{c.phone}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <input type="text" value={f.customerPhone} onChange={e => setF(p => ({ ...p, customerPhone: e.target.value }))}
                    placeholder="Phone (optional)"
                    className="w-full bg-[#0A0A0A] border border-white/5 text-white rounded-xl h-12 px-4 text-sm focus:border-gold-brand focus:outline-none" />
                </div>
              </section>

              {/* ORDER TYPE */}
              <section>
                <h4 className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <Palette className="w-3 h-3" /> Job Type
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(TYPE_CFG).map(([value, t]) => (
                    <button key={value} onClick={() => setF(p => ({ ...p, orderType: value, designBrief: '' }))}
                      className={`p-3 rounded-xl border text-left transition-all active:scale-95 cursor-pointer ${
                        f.orderType === value
                          ? 'bg-gold-brand/10 border-gold-brand/50 text-white'
                          : 'bg-[#0A0A0A] border-white/5 text-zinc-400 hover:border-white/20'
                      }`}>
                      <div className="text-sm font-bold">{t.icon} {t.label}</div>
                    </button>
                  ))}
                </div>
              </section>

              {/* DESIGN BRIEF */}
              <section>
                <h4 className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-3">Design / Job</h4>
                <div className="flex flex-wrap gap-1.5 mb-2.5">
                  {(WORK_PRESETS[f.orderType] || []).map(p => (
                    <button key={p} onClick={() => setF(pr => ({ ...pr, designBrief: p }))}
                      className={`px-3 py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-wider transition-all active:scale-95 cursor-pointer ${
                        f.designBrief === p
                          ? 'bg-gold-brand/20 border-gold-brand/50 text-gold-light'
                          : 'bg-[#0A0A0A] border-white/5 text-zinc-500 hover:border-white/20'
                      }`}>
                      {p}
                    </button>
                  ))}
                </div>
                <input type="text" value={f.designBrief} onChange={e => setF(p => ({ ...p, designBrief: e.target.value }))}
                  placeholder="Or type custom description..."
                  className="w-full bg-[#0A0A0A] border border-white/5 text-white rounded-xl h-11 px-4 text-sm focus:border-gold-brand focus:outline-none" />
              </section>

              {/* QTY + SIZE */}
              <section className="grid grid-cols-2 gap-3">
                <div>
                  <h4 className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-3 flex items-center gap-1.5">
                    <Layers className="w-3 h-3" /> Quantity
                  </h4>
                  <input type="number" min="1" value={f.qty} onChange={e => setF(p => ({ ...p, qty: e.target.value }))}
                    placeholder="e.g. 250"
                    className="w-full bg-[#0A0A0A] border border-white/5 text-white rounded-xl h-12 px-4 text-sm focus:border-gold-brand focus:outline-none" />
                </div>
                <div>
                  <h4 className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-3 flex items-center gap-1.5">
                    <Ruler className="w-3 h-3" /> Size
                  </h4>
                  <input type="text" value={f.size} onChange={e => setF(p => ({ ...p, size: e.target.value }))}
                    placeholder="A4, 2×3 ft, 3×4..."
                    className="w-full bg-[#0A0A0A] border border-white/5 text-white rounded-xl h-12 px-4 text-sm focus:border-gold-brand focus:outline-none" />
                </div>
              </section>

              {/* PRICING CALCULATOR */}
              <section>
                <h4 className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <Calculator className="w-3 h-3 text-gold-brand" /> Pricing Calculator
                </h4>
                <div className="bg-zinc-900/40 border border-gold-brand/20 rounded-xl p-3 space-y-2.5">
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] text-zinc-600 font-bold uppercase mb-1 block">Materials (UGX)</label>
                      <input type="number" value={f.materialCost} onChange={e => setF(p => ({ ...p, materialCost: e.target.value }))}
                        placeholder="Paper, ink..."
                        className="w-full bg-[#0A0A0A] border border-white/5 text-amber-400 font-black rounded-lg h-11 px-3 text-sm focus:border-gold-brand focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-600 font-bold uppercase mb-1 block">Labor / Design (UGX)</label>
                      <input type="number" value={f.laborCost} onChange={e => setF(p => ({ ...p, laborCost: e.target.value }))}
                        placeholder="Design fee"
                        className="w-full bg-[#0A0A0A] border border-white/5 text-amber-400 font-black rounded-lg h-11 px-3 text-sm focus:border-gold-brand focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-600 font-bold uppercase mb-1 block">Target Margin %</label>
                      <input type="number" min="0" max="95" value={f.targetMarginPct} onChange={e => setF(p => ({ ...p, targetMarginPct: e.target.value }))}
                        className="w-full bg-[#0A0A0A] border border-white/5 text-gold-brand font-black rounded-lg h-11 px-3 text-sm focus:border-gold-brand focus:outline-none" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-[#0A0A0A] border border-white/5 rounded-lg px-3 py-2 flex justify-between items-center">
                      <span className="text-[10px] text-zinc-500 font-bold uppercase">Total cost</span>
                      <span className="text-sm font-black text-zinc-300">{calc.totalCost.toLocaleString()}</span>
                    </div>
                    <div className="bg-[#0A0A0A] border border-white/5 rounded-lg px-3 py-2 flex justify-between items-center">
                      <span className="text-[10px] text-zinc-500 font-bold uppercase">Per unit</span>
                      <span className="text-sm font-black text-cyan-300">{calc.unit ? Math.round(calc.unit).toLocaleString() : '—'}</span>
                    </div>
                    <div className="bg-[#0A0A0A] border border-white/5 rounded-lg px-3 py-2 flex justify-between items-center">
                      <span className="text-[10px] text-zinc-500 font-bold uppercase">Suggested price</span>
                      <span className="text-sm font-black text-gold-brand">{calc.suggested ? Math.round(calc.suggested).toLocaleString() : '—'}</span>
                    </div>
                    <div className="bg-[#0A0A0A] border border-white/5 rounded-lg px-3 py-2 flex justify-between items-center">
                      <span className="text-[10px] text-zinc-500 font-bold uppercase">Est. profit</span>
                      <span className="text-sm font-black text-emerald-400">{calc.suggested ? Math.round(calc.suggested - calc.totalCost).toLocaleString() : '—'}</span>
                    </div>
                  </div>
                  <button onClick={applySuggested} disabled={calc.suggested <= 0}
                    className="w-full h-10 bg-gold-brand hover:bg-gold-medium disabled:opacity-40 disabled:cursor-not-allowed text-black font-black uppercase tracking-widest text-xs rounded-lg transition-colors cursor-pointer">
                    Apply Suggested Price
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-3 mt-3">
                  <div>
                    <label className="text-[10px] text-zinc-600 font-bold uppercase mb-1 block">Total (UGX) *</label>
                    <input type="number" value={f.totalAmount} onChange={e => setF(p => ({ ...p, totalAmount: e.target.value }))}
                      placeholder="e.g. 150000"
                      className="w-full bg-[#0A0A0A] border border-white/5 text-gold-brand font-black rounded-xl h-12 px-4 text-sm focus:border-gold-brand focus:outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-600 font-bold uppercase mb-1 block">Unit Price</label>
                    <input type="number" value={f.unitPrice} onChange={e => setF(p => ({ ...p, unitPrice: e.target.value }))}
                      placeholder="Auto"
                      className="w-full bg-[#0A0A0A] border border-white/5 text-cyan-400 font-black rounded-xl h-12 px-4 text-sm focus:border-gold-brand focus:outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-600 font-bold uppercase mb-1 block">Deposit</label>
                    <input type="number" value={f.depositPaid} onChange={e => setF(p => ({ ...p, depositPaid: e.target.value }))}
                      placeholder="e.g. 50000"
                      className="w-full bg-[#0A0A0A] border border-white/5 text-emerald-400 font-black rounded-xl h-12 px-4 text-sm focus:border-gold-brand focus:outline-none" />
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {f.totalAmount && calc.actualTotal > 0 && (
                    <div className="bg-[#0A0A0A] border border-white/5 rounded-xl px-4 py-3 flex justify-between items-center">
                      <span className="text-xs text-zinc-500 font-bold uppercase">Profit</span>
                      <span className="text-sm font-black text-amber-400">{calc.actualProfit.toLocaleString()} UGX</span>
                    </div>
                  )}
                  {f.totalAmount && f.depositPaid && parseFloat(f.depositPaid) > 0 && (
                    <div className="bg-[#0A0A0A] border border-white/5 rounded-xl px-4 py-3 flex justify-between items-center">
                      <span className="text-xs text-zinc-500 font-bold uppercase">Balance Due</span>
                      <span className="text-sm font-black text-rose-400">{(calc.actualTotal - (parseFloat(f.depositPaid) || 0)).toLocaleString()} UGX</span>
                    </div>
                  )}
                </div>
              </section>

              {/* DATE + NOTES */}
              <section className="grid grid-cols-2 gap-3">
                <div>
                  <h4 className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-3 flex items-center gap-1.5">
                    <Calendar className="w-3 h-3" /> Expected
                  </h4>
                  <input type="date" value={f.expectedDate} onChange={e => setF(p => ({ ...p, expectedDate: e.target.value }))}
                    className="w-full bg-[#0A0A0A] border border-white/5 text-white rounded-xl h-12 px-4 text-sm focus:border-gold-brand focus:outline-none" />
                </div>
                <div>
                  <h4 className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-3">Notes</h4>
                  <input type="text" value={f.notes} onChange={e => setF(p => ({ ...p, notes: e.target.value }))}
                    placeholder="Colors, files, requests..."
                    className="w-full bg-[#0A0A0A] border border-white/5 text-white rounded-xl h-12 px-4 text-sm focus:border-gold-brand focus:outline-none" />
                </div>
              </section>
            </div>

            <div className="p-5 pt-3 border-t border-white/5 flex gap-2">
              <button onClick={() => setShowPanel(false)}
                className="flex-1 h-12 border border-zinc-800 text-zinc-400 font-bold text-xs rounded-xl uppercase tracking-wider hover:bg-zinc-900 transition-all cursor-pointer">
                Cancel
              </button>
              <button onClick={handleSave}
                className="flex-1 h-12 bg-gold-brand text-black font-black text-xs rounded-xl uppercase tracking-widest hover:opacity-90 active:scale-95 transition-all cursor-pointer">
                {editId ? 'Update' : 'Create Order'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FAB */}
      <button onClick={openCreate}
        className="fixed bottom-20 right-4 z-40 w-14 h-14 rounded-2xl bg-gold-brand text-black shadow-2xl border-2 border-black/20 flex items-center justify-center active:scale-90 transition-all cursor-pointer">
        <Plus className="w-6 h-6" />
      </button>
    </div>
  );
}
