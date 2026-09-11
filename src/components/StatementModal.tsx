// Per-customer credit statement: every open book line, what is paid, what
// is still owed. Printable for the customer to take home (no phone number
// is stored on credit lines, so there is no WhatsApp share here).
import { X, Printer } from 'lucide-react';
import type { CreditEat } from '../types';

interface StatementModalProps {
  customerName: string;
  entries: CreditEat[];
  shopName: string;
  formatCurrency: (val: number) => string;
  onClose: () => void;
}

export default function StatementModal({ customerName, entries, shopName, formatCurrency, onClose }: StatementModalProps) {
  const open = entries.filter(e => !e.paid);
  const total = open.reduce((s, e) => s + e.total, 0);
  const paid = open.reduce((s, e) => s + e.paidAmount, 0);
  const date = new Date().toISOString().slice(0, 10);

  return (
    <div className="fixed inset-0 z-[80] flex flex-col">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #print-statement, #print-statement * { visibility: visible; }
          #print-statement { position: absolute; left: 0; top: 0; width: 100%; margin: 0; box-shadow: none; }
        }
      `}</style>
      <div className="relative mt-auto sm:m-auto sm:my-6 w-full sm:max-w-md mx-auto bg-white text-zinc-900 rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[92vh]" id="print-statement">
        <div className="px-6 py-5 border-b-2 border-gold-brand" style={{ background: 'linear-gradient(135deg,#0A0A0A 0%,#1A1A1A 100%)' }}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-black text-gold-brand uppercase font-display tracking-wide">{shopName}</h3>
              <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest mt-0.5">Customer statement</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">Date</p>
              <p className="text-sm font-black text-white font-mono">{date}</p>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
          <div>
            <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest mb-1">Customer</p>
            <p className="text-sm font-black">{customerName}</p>
          </div>

          <div className="border border-zinc-200 rounded-xl overflow-hidden">
            <div className="grid grid-cols-[1fr_auto] gap-2 px-4 py-2 bg-zinc-100 text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
              <span>Taken</span><span className="text-right">Still owed (UGX)</span>
            </div>
            <div className="divide-y divide-zinc-100 text-xs">
              {open.map(e => (
                <div key={e.id} className="grid grid-cols-[1fr_auto] gap-2 px-4 py-2.5">
                  <span className="font-bold">{e.date} • {e.qty}× {e.item}
                    {e.paidAmount > 0 && <span className="block text-[10px] text-emerald-600 font-bold">paid {formatCurrency(e.paidAmount)} of {formatCurrency(e.total)}</span>}
                  </span>
                  <span className="text-right font-black tabular-nums">{formatCurrency(Math.max(0, e.total - e.paidAmount))}</span>
                </div>
              ))}
              {open.length === 0 && (
                <p className="px-4 py-3 text-xs text-zinc-500 font-bold">Nothing owed — books clear.</p>
              )}
              <div className="grid grid-cols-2 gap-2 px-4 py-3 bg-gold-brand/10 text-sm font-black">
                <span>BALANCE DUE</span>
                <span className="text-right tabular-nums">{formatCurrency(Math.max(0, total - paid))}</span>
              </div>
            </div>
          </div>

          <p className="text-center text-[10px] text-zinc-400 font-bold">Please clear your balance soon. Thank you!</p>
        </div>

        <div className="print:hidden p-5 pt-3 border-t border-zinc-200 bg-white rounded-b-3xl pb-[max(1.25rem,env(safe-area-inset-bottom))] flex gap-2">
          <button onClick={() => window.print()}
            className="flex-1 h-12 border border-zinc-800 text-zinc-800 font-bold text-xs rounded-xl uppercase tracking-wider hover:bg-zinc-100 transition-all cursor-pointer flex items-center justify-center gap-2">
            <Printer className="w-4 h-4" /> Print
          </button>
          <button onClick={onClose}
            className="h-12 w-12 border border-zinc-300 text-zinc-400 hover:text-zinc-800 rounded-xl flex items-center justify-center transition-all cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
