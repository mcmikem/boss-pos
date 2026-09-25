import { useEffect, useState } from 'react';
import { X, ShieldCheck, Wallet, TrendingUp } from 'lucide-react';
import type { MomoTransfer } from '../types';
import type { HandoverSummary } from '../api';

interface HandoverPromptProps {
  pending: MomoTransfer[];
  summary: HandoverSummary | null;
  currentStaffName?: string;
  formatCurrency: (val: number) => string;
  onConfirm: (id: string) => void;
  onDismiss: () => void;
}

const destinationLabel = (t: MomoTransfer): string => {
  if (t.to === 'manager') return `Given to Manager${t.recipientName ? ` · ${t.recipientName}` : ''}`;
  if (t.to === 'owner') return 'Given to Owner';
  if (t.to === 'float') return 'Put on Float';
  if (t.to === 'bank') return 'Banked';
  return 'Taken as cash';
};

export default function HandoverPrompt({
  pending, summary, currentStaffName, formatCurrency, onConfirm, onDismiss,
}: HandoverPromptProps) {
  const [note, setNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    setBusyId(null);
  }, [pending.length]);

  const visible = pending.filter(p => !dismissed.includes(p.id));
  const current = visible[0];
  if (!current) return null;

  const handleConfirm = (id: string) => {
    setBusyId(id);
    onConfirm(id);
    setNote('');
  };

  const fmt = (v: number) => formatCurrency(v || 0);
  const totals = summary?.totals || {};
  const board = [
    { label: 'On float', value: totals.float || 0, tone: 'text-emerald-300' },
    { label: 'To owner', value: totals.owner || 0, tone: 'text-amber-300' },
    { label: 'To managers', value: totals.manager || 0, tone: 'text-amber-300' },
    { label: 'Banked', value: totals.bank || 0, tone: 'text-sky-300' },
  ];

  return (
    <div className="fixed inset-0 z-[130] bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog" aria-modal="true" aria-labelledby="handover-title">
      <div className="w-full max-w-md bg-[#141414] border border-gold-brand/40 rounded-3xl p-5 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black text-gold-brand uppercase tracking-widest">
              Money handed to you
            </p>
            <h2 id="handover-title" className="text-lg font-black text-white uppercase tracking-tight font-display mt-1">
              Confirm you received it
            </h2>
          </div>
          <button onClick={() => { setDismissed(prev => [...prev, current.id]); onDismiss(); }}
            aria-label="Close for now"
            className="p-2 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 cursor-pointer shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-[#0A0A0A] border border-white/5 rounded-2xl p-4 mb-3">
          <p className="text-2xl font-black text-gold-brand font-display tabular-nums leading-none">
            {fmt(current.amount)}
          </p>
          <p className="text-xs font-black text-zinc-200 uppercase tracking-wider mt-2">
            {destinationLabel(current)}
          </p>
          <p className="text-[11px] text-zinc-500 font-bold uppercase mt-1">
            {current.category} · sent by {current.sentBy || 'the till'}
            {current.createdAt ? ` · ${new Date(current.createdAt).toLocaleString()}` : ''}
          </p>
          {current.comment && (
            <p className="text-[11px] text-zinc-400 mt-2 leading-snug">{current.comment}</p>
          )}
        </div>

        <div className="mb-3">
          <label htmlFor="handover-note" className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
            Add a note (optional)
          </label>
          <input id="handover-note" type="text" value={note} onChange={e => setNote(e.target.value)}
            placeholder="e.g. counted and correct"
            className="mt-1 w-full h-12 bg-zinc-900 border border-zinc-800 text-white rounded-xl px-3 text-sm font-bold focus:border-gold-brand outline-none" />
        </div>

        <button onClick={() => handleConfirm(current.id)} disabled={busyId === current.id}
          className="w-full h-14 bg-gold-brand text-black rounded-2xl text-sm font-black uppercase tracking-widest hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-60 flex items-center justify-center gap-2">
          <ShieldCheck className="w-5 h-5" />
          {busyId === current.id ? 'Confirming…' : `Yes, I received ${fmt(current.amount)}`}
        </button>
        <p className="text-[10px] text-zinc-500 font-bold uppercase text-center mt-2">
          This records your name and the time against the handover
        </p>

        {summary && (
          <div className="mt-4 pt-4 border-t border-white/5">
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-1.5 mb-2">
              <TrendingUp className="w-3.5 h-3.5 text-gold-brand" /> Money so far
            </p>
            <div className="grid grid-cols-2 gap-2">
              {board.map(b => (
                <div key={b.label} className="bg-black/30 rounded-xl p-2.5">
                  <p className="text-[9px] font-black text-zinc-500 uppercase">{b.label}</p>
                  <p className={`text-sm font-black tabular-nums mt-0.5 ${b.tone}`}>{fmt(b.value)}</p>
                </div>
              ))}
            </div>
            {summary.awaitingConfirmation > 0 && (
              <p className="text-[10px] font-black text-amber-300 uppercase mt-2 flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5" /> {fmt(summary.awaitingConfirmation)} still waiting to be confirmed
              </p>
            )}
            {currentStaffName && (
              <p className="text-[10px] text-zinc-600 font-bold uppercase mt-2">
                Signed in as {currentStaffName}
              </p>
            )}
          </div>
        )}

        {visible.length > 1 && (
          <p className="text-[10px] text-zinc-500 font-bold uppercase text-center mt-3">
            +{visible.length - 1} more waiting
          </p>
        )}
      </div>
    </div>
  );
}
