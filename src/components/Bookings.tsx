import { useState, useMemo, useEffect } from 'react';
import { CalendarCheck, Plus, X, Search, ChevronRight, RotateCcw } from 'lucide-react';
import SettleSheet from './SettleSheet';
import type { Booking, Sale } from '../types';
import { bookingApi } from '../api';
import { ringServiceSale } from '../utils/serviceSale';
import { todayLocalKey } from '../utils/dates';
import { DEFAULT_BOOKING_MIN, findOverlap } from '../utils/bookings';

const STATUS_CFG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  booked:    { label: 'Booked',    color: 'text-amber-400',    bg: 'bg-amber-950/30',    dot: 'bg-amber-400' },
  done:      { label: 'Done',      color: 'text-emerald-400',  bg: 'bg-emerald-950/30',  dot: 'bg-emerald-400' },
  cancelled: { label: 'Cancelled', color: 'text-zinc-500',     bg: 'bg-zinc-900/50',     dot: 'bg-zinc-500' },
};

interface BookingsProps {
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  onAddSale?: (sale: Sale) => void;
  staffName?: string;
  tillBranch?: string;
  formatCurrency?: (val: number) => string;
}

// Salon / barbershop appointment book. Who is coming, when, for what, and
// what is already paid — the till still rings the actual sale at the chair.
export default function Bookings({ triggerToast, onAddSale, staffName, tillBranch, formatCurrency }: BookingsProps) {
  const [settleId, setSettleId] = useState<string | null>(null);
  const fmt = (n: number) => formatCurrency ? formatCurrency(n) : n.toLocaleString();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('today');
  const [search, setSearch] = useState('');
  const [showPanel, setShowPanel] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const [f, setF] = useState({
    customerName: '', customerPhone: '', service: '', staffName: '',
    date: '', time: '', duration: String(DEFAULT_BOOKING_MIN), price: '', deposit: '', notes: '',
  });

  const today = todayLocalKey();

  useEffect(() => {
    bookingApi.list()
      .then(setBookings)
      .catch(() => triggerToast('Failed to load bookings', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return bookings.filter(b => {
      if (filter === 'today' && (b.date !== today || b.status === 'cancelled')) return false;
      if (filter === 'upcoming' && (b.date < today || b.status !== 'booked')) return false;
      if ((filter === 'done' || filter === 'cancelled') && b.status !== filter) return false;
      if (!q) return true;
      return b.customerName.toLowerCase().includes(q) ||
             b.customerPhone.includes(q) ||
             b.service.toLowerCase().includes(q);
    }).sort((a, b) => (`${a.date} ${a.time}` < `${b.date} ${b.time}` ? -1 : 1));
  }, [bookings, filter, search, today]);

  const todayCount = bookings.filter(b => b.date === today && b.status === 'booked').length;
  const upcomingCount = bookings.filter(b => b.date > today && b.status === 'booked').length;

  function resetForm() {
    setF({ customerName: '', customerPhone: '', service: '', staffName: '', date: today, time: '', duration: String(DEFAULT_BOOKING_MIN), price: '', deposit: '', notes: '' });
  }

  function openCreate() {
    setEditId(null);
    resetForm();
    setShowPanel(true);
  }

  function openEdit(b: Booking) {
    setEditId(b.id);
    setF({
      customerName: b.customerName, customerPhone: b.customerPhone,
      service: b.service, staffName: b.staffName || '',
      date: b.date, time: b.time || '',
      duration: String(b.durationMin || DEFAULT_BOOKING_MIN),
      price: String(b.price), deposit: String(b.deposit), notes: b.notes,
    });
    setShowPanel(true);
  }

  async function handleSave() {
    if (!f.customerName.trim()) { triggerToast('Enter customer name', 'error'); return; }
    if (!f.service.trim()) { triggerToast('Enter the service (e.g. braids, fade)', 'error'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) { triggerToast('Pick a date', 'error'); return; }
    const price = parseFloat(f.price) || 0;
    const durationMin = Math.max(5, Math.round(parseFloat(f.duration) || DEFAULT_BOOKING_MIN));

    // Double-booking guard: same chair can't serve two heads at once.
    const clash = findOverlap(
      { id: editId || `bk-${Date.now()}`, date: f.date, time: f.time, durationMin, status: 'booked' },
      bookings,
    );
    if (clash) {
      triggerToast(`Clash: ${clash.customerName} (${clash.service}) at ${clash.time || 'that time'}`, 'error');
      return;
    }

    const now = new Date().toISOString();
    const existing = editId ? bookings.find(b => b.id === editId) : null;
    const booking: Booking = {
      id: editId || `bk-${Date.now()}`,
      customerName: f.customerName.trim(),
      customerPhone: f.customerPhone.trim(),
      service: f.service.trim(),
      staffName: f.staffName.trim() || undefined,
      date: f.date,
      time: f.time,
      durationMin,
      price,
      deposit: Math.min(parseFloat(f.deposit) || 0, price),
      status: existing?.status || 'booked',
      notes: f.notes.trim(),
      createdAt: existing?.createdAt || now,
      clientWriteId: existing?.clientWriteId || `bk-${Date.now()}`,
    };

    try {
      if (editId) {
        const updated = await bookingApi.update(booking);
        setBookings(prev => prev.map(b => b.id === editId ? updated : b));
        triggerToast('Booking updated', 'success');
      } else {
        const created = await bookingApi.create(booking);
        setBookings(prev => [created, ...prev]);
        if (created.deposit > 0 && onAddSale) {
          await ringServiceSale({
            onAddSale, staffName, tillBranch,
            productId: 'booking-service',
            label: `Booking: ${created.service}`,
            amount: created.deposit, method: 'Cash',
            customerName: created.customerName,
          });
          triggerToast(`Deposit ${fmt(created.deposit)} rung as a cash sale`, 'success');
        } else {
          triggerToast('Booking added', 'success');
        }
      }
      setShowPanel(false);
    } catch { triggerToast('Failed to save booking', 'error'); }
  }

  async function setStatus(b: Booking, status: Booking['status']) {
    const balance = Math.max(0, Math.round(b.price - (b.deposit || 0)));
    if (status === 'done' && balance > 0 && onAddSale) {
      setSettleId(b.id);
      return;
    }
    try {
      const result = await bookingApi.update({ ...b, status });
      setBookings(prev => prev.map(x => x.id === b.id ? result : x));
      triggerToast(`${b.customerName} → ${STATUS_CFG[status]?.label}`, status === 'done' ? 'success' : 'info');
    } catch { triggerToast('Failed to update booking', 'error'); }
  }

  async function settleAndDone(b: Booking, method: Sale['paymentMethod']) {
    const balance = Math.max(0, Math.round(b.price - (b.deposit || 0)));
    setSettleId(null);
    if (balance > 0 && onAddSale) {
      await ringServiceSale({
        onAddSale, staffName, tillBranch,
        productId: 'booking-service',
        label: `Booking: ${b.service}`,
        amount: balance, method,
        customerName: b.customerName,
      });
      triggerToast(
        method === 'Credit / Book'
          ? `${fmt(balance)} booked as credit — collect from ${b.customerName}`
          : `Service ${fmt(balance)} rung`,
        method === 'Credit / Book' ? 'info' : 'success',
      );
    }
    try {
      const result = await bookingApi.update({ ...b, status: 'done' });
      setBookings(prev => prev.map(x => x.id === b.id ? result : x));
    } catch { triggerToast('Sale recorded, but status failed to save — retry Done', 'error'); }
  }

  async function handleDelete(id: string) {
    try {
      await bookingApi.remove(id);
      setBookings(prev => prev.filter(b => b.id !== id));
      setConfirmDelete(null);
      triggerToast('Booking deleted', 'info');
    } catch { triggerToast('Failed to delete booking', 'error'); }
  }

  const inputCls = 'w-full bg-[#0A0A0A] border border-white/5 text-sm px-3 rounded-xl text-white font-bold focus:border-gold-brand outline-none h-11';

  if (loading) return <div className="py-10 text-center text-xs text-zinc-500 font-bold uppercase">Loading bookings…</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex-1 grid grid-cols-2 gap-2">
          <div className="boss-card px-3 py-2 text-center">
            <p className="text-lg font-black text-gold-brand tabular-nums">{todayCount}</p>
            <p className="text-[9px] text-zinc-500 font-bold uppercase">Today</p>
          </div>
          <div className="boss-card px-3 py-2 text-center">
            <p className="text-lg font-black text-zinc-200 tabular-nums">{upcomingCount}</p>
            <p className="text-[9px] text-zinc-500 font-bold uppercase">Upcoming</p>
          </div>
        </div>
        <button onClick={openCreate}
          className="h-11 px-4 bg-gold-brand text-black rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 cursor-pointer touch-target">
          <Plus className="w-4 h-4" /> Book
        </button>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, service"
          className="w-full bg-[#0A0A0A] border border-white/5 text-sm pl-9 pr-3 rounded-xl text-white font-bold focus:border-gold-brand outline-none h-11" />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {['today', 'upcoming', 'all', 'done', 'cancelled'].map(k => (
          <button key={k} onClick={() => setFilter(k)}
            className={`px-4 h-9 rounded-full text-[11px] font-black uppercase tracking-wider shrink-0 cursor-pointer ${filter === k ? 'bg-gold-brand text-black' : 'bg-[#141414] text-zinc-400 border border-white/5'}`}>
            {k}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-xs text-zinc-600 font-bold uppercase py-8">No bookings here yet</p>
      )}

      {filtered.map(b => {
        const cfg = STATUS_CFG[b.status] || STATUS_CFG.booked;
        const balance = Math.max(0, b.price - b.deposit);
        return (
          <div key={b.id} className="boss-card p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-black text-white truncate">{b.customerName}</p>
                <p className="text-[11px] text-zinc-500 font-bold truncate">{b.service}{b.staffName ? ` · ${b.staffName}` : ''}</p>
              </div>
              <span className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${cfg.bg} ${cfg.color}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />{cfg.label}
              </span>
            </div>
            <p className="text-xs text-zinc-400 font-bold mt-2 tabular-nums">
              {b.date}{b.time ? ` · ${b.time}` : ''}{b.durationMin ? ` (${b.durationMin} min)` : ''}{b.customerPhone ? ` · ${b.customerPhone}` : ''}
            </p>
            <p className="text-xs font-bold mt-1 tabular-nums">
              <span className="text-gold-brand">{b.price.toLocaleString()}</span>
              {b.deposit > 0 && <span className="text-emerald-400"> · paid {b.deposit.toLocaleString()}</span>}
              {balance > 0 && <span className="text-rose-400"> · owes {balance.toLocaleString()}</span>}
            </p>
            {b.notes && <p className="text-[11px] text-zinc-500 mt-1">{b.notes}</p>}
            <div className="flex gap-2 mt-3">
              {b.status === 'booked' ? (
                <>
                  <button onClick={() => setStatus(b, 'done')}
                    className="flex-1 h-9 bg-emerald-950/40 border border-emerald-800/50 text-emerald-300 rounded-xl text-[11px] font-black uppercase flex items-center justify-center gap-1 cursor-pointer">
                    Done <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setStatus(b, 'cancelled')}
                    className="flex-1 h-9 bg-[#0A0A0A] border border-white/5 text-zinc-500 rounded-xl text-[11px] font-black uppercase cursor-pointer">
                    Cancel
                  </button>
                </>
              ) : (
                <button onClick={() => setStatus(b, 'booked')}
                  className="flex-1 h-9 bg-[#0A0A0A] border border-white/5 text-zinc-400 rounded-xl text-[11px] font-black uppercase flex items-center justify-center gap-1 cursor-pointer">
                  <RotateCcw className="w-3.5 h-3.5" /> Re-book
                </button>
              )}
              <button onClick={() => openEdit(b)}
                className="h-9 px-4 bg-[#0A0A0A] border border-white/5 text-zinc-300 rounded-xl text-[11px] font-black uppercase cursor-pointer">
                Edit
              </button>
              {confirmDelete === b.id ? (
                <button onClick={() => handleDelete(b.id)}
                  className="h-9 px-4 bg-rose-600 text-white rounded-xl text-[11px] font-black uppercase cursor-pointer">
                  Sure?
                </button>
              ) : (
                <button onClick={() => setConfirmDelete(b.id)}
                  className="h-9 px-3 text-zinc-600 hover:text-rose-400 cursor-pointer" aria-label="Delete booking">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        );
      })}

      {showPanel && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-md p-6 max-h-[92vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4">
              <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                <CalendarCheck className="w-4 h-4 text-gold-brand" /> {editId ? 'Edit booking' : 'New booking'}
              </h3>
              <button onClick={() => setShowPanel(false)} className="p-1 text-zinc-500 hover:text-white cursor-pointer" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <input value={f.customerName} onChange={(e) => setF(p => ({ ...p, customerName: e.target.value }))} placeholder="Customer name" className={inputCls} />
              <input value={f.customerPhone} onChange={(e) => setF(p => ({ ...p, customerPhone: e.target.value }))} placeholder="Phone (optional)" inputMode="tel" className={inputCls} />
              <input value={f.service} onChange={(e) => setF(p => ({ ...p, service: e.target.value }))} placeholder="Service (e.g. braids, fade, facial)" className={inputCls} />
              <input value={f.staffName} onChange={(e) => setF(p => ({ ...p, staffName: e.target.value }))} placeholder="Stylist (optional)" className={inputCls} />
              <div className="grid grid-cols-2 gap-2">
                <input type="date" value={f.date} onChange={(e) => setF(p => ({ ...p, date: e.target.value }))} className={inputCls} />
                <input type="time" value={f.time} onChange={(e) => setF(p => ({ ...p, time: e.target.value }))} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-2 items-center">
                <input type="number" min="5" step="5" value={f.duration} onChange={(e) => setF(p => ({ ...p, duration: e.target.value }))} placeholder="Minutes" className={inputCls} />
                <p className="text-[11px] text-zinc-500 font-bold">Service length in minutes — clashes are blocked.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" min="0" value={f.price} onChange={(e) => setF(p => ({ ...p, price: e.target.value }))} placeholder="Price" className={inputCls} />
                <input type="number" min="0" value={f.deposit} onChange={(e) => setF(p => ({ ...p, deposit: e.target.value }))} placeholder="Deposit paid" className={inputCls} />
              </div>
              <input value={f.notes} onChange={(e) => setF(p => ({ ...p, notes: e.target.value }))} placeholder="Notes (optional)" className={inputCls} />
              <button onClick={handleSave} className="w-full h-12 bg-gold-brand text-black font-black uppercase tracking-widest text-xs rounded-xl cursor-pointer">
                {editId ? 'Save changes' : 'Add booking'}
              </button>
            </div>
          </div>
        </div>
      )}

      {settleId && (() => {
        const b = bookings.find(x => x.id === settleId);
        if (!b) return null;
        return (
          <SettleSheet
            customerName={b.customerName}
            balance={Math.max(0, Math.round(b.price - (b.deposit || 0)))}
            paid={b.deposit || 0}
            pickupLabel="is done — settle the chair"
            onPick={(method) => settleAndDone(b, method)}
            onClose={() => setSettleId(null)}
            formatCurrency={fmt}
          />
        );
      })()}
    </div>
  );
}
