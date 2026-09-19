import type { ReactNode } from 'react';
import { Coins, Smartphone, BookOpen } from 'lucide-react';
import type { Sale } from '../types';

interface SettleSheetProps {
  customerName: string;
  balance: number;
  paid: number;
  pickupLabel?: string;
  onPick: (method: Sale['paymentMethod']) => void;
  onClose: () => void;
  formatCurrency: (val: number) => string;
}

// Handover settle sheet shared by Tailoring / Design / Repairs / Bookings:
// HOW was the balance paid? Cash/MoMo rings a sale now, Book tracks the debt.
export default function SettleSheet({
  customerName, balance, paid, pickupLabel = 'is picking up',
  onPick, onClose, formatCurrency,
}: SettleSheetProps) {
  const methods: { key: Sale['paymentMethod']; label: string; icon: ReactNode; cls: string }[] = [
    { key: 'Cash', label: 'Cash', icon: <Coins className="w-4 h-4" />, cls: 'bg-emerald-950/40 border-emerald-800/40 text-emerald-300 hover:bg-emerald-950/60' },
    { key: 'MTN MoMo', label: 'MTN', icon: <Smartphone className="w-4 h-4" />, cls: 'bg-amber-950/40 border-amber-800/40 text-amber-300 hover:bg-amber-950/60' },
    { key: 'Airtel Money', label: 'Airtel', icon: <Smartphone className="w-4 h-4" />, cls: 'bg-rose-950/40 border-rose-800/40 text-rose-300 hover:bg-rose-950/60' },
    { key: 'Credit / Book', label: 'Book it', icon: <BookOpen className="w-4 h-4" />, cls: 'bg-blue-950/40 border-blue-800/40 text-blue-300 hover:bg-blue-950/60' },
  ];
  return (
    <div className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-sm flex items-end justify-center" onClick={onClose}>
      <div className="bg-[#141414] w-full max-w-md rounded-t-3xl border border-white/10 p-5 animate-slide-up"
        onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-black text-white uppercase tracking-wider text-center">{customerName} {pickupLabel}</h3>
        <p className="text-xs text-zinc-400 font-bold text-center mt-1 mb-4">
          Balance <span className="text-gold-brand font-black text-base">{formatCurrency(balance)}</span>
          {paid > 0 && <span className="text-zinc-500"> ({formatCurrency(paid)} already paid)</span>}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {methods.map(m => (
            <button key={m.key} onClick={() => onPick(m.key)}
              className={`h-12 rounded-2xl border text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 active:scale-95 transition-all cursor-pointer ${m.cls}`}>
              {m.icon} {m.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-zinc-600 font-bold uppercase text-center mt-3">
          Cash/MoMo rings a sale now • Book it tracks the debt for collection
        </p>
        <button onClick={onClose}
          className="mt-3 w-full h-11 border border-zinc-800 hover:bg-zinc-900 text-zinc-400 font-bold uppercase tracking-wider text-xs rounded-xl cursor-pointer">
          Not yet
        </button>
      </div>
    </div>
  );
}
