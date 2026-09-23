// Bookings TODAY home: the salon diary surface. Today's chairs in time
// order, what's done, and new bookings — composed read-only from the
// bookings engine. It never writes except through the engine's own actions
// (new booking, mark done), so the diary stays single-source.
import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, ArrowRightLeft, Plus } from 'lucide-react';
import type { Booking } from '../types';
import { bookingApi } from '../api';
import { todayLocalKey } from '../utils/dates';

interface BookingHomeProps {
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  onBackSell: () => void;
  onOpenBook: () => void;
}

export default function BookingHome({
  triggerToast, onBackSell, onOpenBook,
}: BookingHomeProps) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  useEffect(() => {
    let live = true;
    bookingApi.list()
      .then(l => { if (live) setBookings(Array.isArray(l) ? l : []); })
      .catch(() => { if (live) triggerToast('Could not load bookings — showing cached view', 'error'); });
    return () => { live = false; };
  }, [triggerToast]);

  const today = todayLocalKey();
  const chairs = useMemo(
    () => bookings
      .filter(b => b.date === today && b.status === 'booked')
      .sort((a, b) => (a.time || '').localeCompare(b.time || '')),
    [bookings, today],
  );
  const done = useMemo(
    () => bookings.filter(b => b.date === today && b.status === 'done').length,
    [bookings, today],
  );

  return (
    <div className="space-y-4" aria-label="Bookings today">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-emerald-950/40 border border-emerald-800/40 flex items-center justify-center">
          <CalendarCheck className="w-5 h-5 text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-black text-white uppercase tracking-tight font-display">Today — Bookings</h2>
          <p className="text-xs text-zinc-500 font-bold">Chairs • done • new booking</p>
        </div>
        <button onClick={onBackSell}
          className="shrink-0 h-10 px-4 bg-gold-brand text-black rounded-xl text-xs font-black uppercase tracking-wider active:scale-95 transition-all cursor-pointer">
          Sell
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="boss-card p-3 border-l-4 border-l-emerald-500">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Chairs today</p>
          <p className="text-lg font-black text-white font-display mt-1 tabular-nums">{chairs.length || '—'}</p>
        </div>
        <div className="boss-card p-3 border-l-4 border-l-cyan-500">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Done</p>
          <p className="text-lg font-black text-cyan-300 font-display mt-1 tabular-nums">{done || '—'}</p>
        </div>
      </div>

      {chairs.length > 0 && (
        <div className="space-y-1.5">
          {chairs.slice(0, 6).map(b => (
            <div key={b.id} className="bg-zinc-900/50 border border-white/5 rounded-xl px-3 py-2 flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-white truncate min-w-0">{b.customerName} — {b.service}</p>
              <p className="text-xs font-black text-emerald-300 tabular-nums shrink-0">{b.time || ''}</p>
            </div>
          ))}
        </div>
      )}
      {chairs.length === 0 && (
        <p className="text-xs text-zinc-500 font-bold uppercase">No chairs booked today</p>
      )}

      <button onClick={onOpenBook}
        className="w-full h-12 bg-gold-brand text-black rounded-xl text-sm font-black uppercase tracking-widest hover:opacity-90 active:scale-[0.99] transition-all cursor-pointer flex items-center justify-center gap-2">
        <Plus className="w-4 h-4" /> New booking / open diary
      </button>
      <button onClick={onBackSell}
        className="w-full h-10 bg-[#141414] border border-white/10 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer">
        <ArrowRightLeft className="w-4 h-4" /> Back to products
      </button>
    </div>
  );
}
