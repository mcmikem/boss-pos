import { useState } from 'react';
import { X, Trash2, Tag, CalendarDays, User, Hash, Link2 } from 'lucide-react';
import type { Expense } from '../types';
import { t } from '../utils/i18n';

interface Props {
  expense: Expense | null;
  formatCurrency: (v: number) => string;
  onClose: () => void;
  onDelete?: (id: string) => void;
  lang?: unknown;
}

// Full receipt view for one expense — exactly as it was sent: amount,
// category, date/time, id, source drawer, linked dish, staff, note.
export default function ExpenseDetailModal({ expense, formatCurrency, onClose, onDelete, lang }: Props) {
  // Two-tap delete so a receipt can't vanish on one stray tap.
  const [confirming, setConfirming] = useState(false);
  if (!expense) return null;
  const ext = expense as Expense & {
    source?: string; staffName?: string; note?: string; linkedProductId?: string; linkedProductName?: string;
  };
  const d = new Date(expense.timestamp);
  const rows: { icon: React.ReactNode; label: string; value: string }[] = [
    { icon: <Tag className="w-3.5 h-3.5 text-rose-400" />, label: 'Category', value: expense.category },
    {
      icon: <CalendarDays className="w-3.5 h-3.5 text-zinc-500" />, label: 'Recorded',
      value: isNaN(d.getTime()) ? expense.timestamp : `${d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} • ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    },
    { icon: <Hash className="w-3.5 h-3.5 text-zinc-500" />, label: 'Receipt ID', value: expense.id },
    { icon: <User className="w-3.5 h-3.5 text-zinc-500" />, label: 'Paid from', value: ext.source ? ext.source.toUpperCase() : 'DRAWER (default)' },
  ];
  if (ext.staffName) rows.push({ icon: <User className="w-3.5 h-3.5 text-gold-brand" />, label: 'Recorded by', value: ext.staffName });
  if (ext.linkedProductName || ext.linkedProductId)
    rows.push({ icon: <Link2 className="w-3.5 h-3.5 text-amber-400" />, label: 'Linked dish', value: ext.linkedProductName || ext.linkedProductId || '' });

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[110] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-md p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start pb-4 border-b border-white/5 mb-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black text-rose-400 uppercase tracking-widest">Expense receipt</p>
            <h3 className="text-base font-black text-white leading-snug mt-1 break-words">{expense.description}</h3>
            <p className="text-2xl font-black text-rose-400 font-display mt-2">-{formatCurrency(expense.amount)}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 cursor-pointer shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-2">
          {expense.items && expense.items.length > 0 && (
            <div className="bg-black/30 border border-white/5 rounded-xl px-3 py-2.5">
              <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">
                Breakdown • {expense.items.length} item{expense.items.length !== 1 ? 's' : ''}
              </p>
              <div className="space-y-1">
                {expense.items.map((it, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-zinc-100 break-words min-w-0">{it.name}</span>
                    <span className="text-xs font-black text-rose-300 tabular-nums shrink-0">{formatCurrency(it.amount)}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 pt-1.5 mt-1.5 border-t border-white/5">
                <span className="text-[10px] font-black text-zinc-400 uppercase">Total</span>
                <span className="text-sm font-black text-rose-400 tabular-nums">{formatCurrency(expense.amount)}</span>
              </div>
            </div>
          )}
          {rows.map((r) => (
            <div key={r.label} className="flex items-center gap-3 bg-black/30 border border-white/5 rounded-xl px-3 py-2.5">
              <span className="shrink-0">{r.icon}</span>
              <div className="min-w-0">
                <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">{r.label}</p>
                <p className="text-xs font-bold text-zinc-100 break-words">{r.value}</p>
              </div>
            </div>
          ))}
          {ext.note && (
            <div className="bg-amber-950/20 border border-amber-800/30 rounded-xl px-3 py-2.5">
              <p className="text-[9px] font-bold text-amber-500 uppercase tracking-widest">Note</p>
              <p className="text-xs font-bold text-amber-100 mt-0.5 break-words">{ext.note}</p>
            </div>
          )}
        </div>
        <div className="flex gap-2 mt-5">
          {onDelete && (
            confirming ? (
              <div className="flex-1 flex gap-2">
                <button
                  onClick={() => setConfirming(false)}
                  className="flex-1 h-11 border border-zinc-700 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer"
                >
                  {t(lang, 'keep')}
                </button>
                <button
                  onClick={() => { onDelete(expense.id); onClose(); }}
                  className="flex-1 h-11 bg-rose-600 text-white rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Trash2 className="w-4 h-4" /> {t(lang, 'delete')}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                className="flex-1 h-11 bg-rose-950/30 border border-rose-800/40 text-rose-400 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-rose-950/60 transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" /> {t(lang, 'delete')}
              </button>
            )
          )}
          <button
            onClick={onClose}
            className="flex-1 h-11 bg-gold-brand text-black font-black uppercase tracking-widest text-xs rounded-xl hover:opacity-90 cursor-pointer"
          >
            {t(lang, 'done')}
          </button>
        </div>
      </div>
    </div>
  );
}
