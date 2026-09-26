import { useState } from 'react';
import { X, MailOpen, Share2, CheckCheck } from 'lucide-react';
import type { CloseSummary } from '../api';

interface CloseSummaryInboxProps {
  summaries: CloseSummary[];
  formatCurrency: (val: number) => string;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  onRead: (id: string) => void;
  onShare: (id: string) => void;
  onClose: () => void;
}

export default function CloseSummaryInbox({
  summaries, formatCurrency, triggerToast, onRead, onShare, onClose,
}: CloseSummaryInboxProps) {
  const [openId, setOpenId] = useState<string | null>(summaries.length === 1 ? summaries[0].id : null);

  const openRow = (id: string) => {
    setOpenId(prev => (prev === id ? null : id));
    onRead(id);
  };

  const copyBody = async (body: string) => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(body);
      else throw new Error('no clipboard');
      triggerToast('Summary copied', 'success');
    } catch {
      triggerToast('Copy not available on this device', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-[130] bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog" aria-modal="true" aria-labelledby="close-summaries-title">
      <div className="w-full max-w-md bg-[#141414] border border-gold-brand/40 rounded-3xl p-5 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="min-w-0">
            <p className="text-[10px] font-black text-gold-brand uppercase tracking-widest">
              Evening briefings
            </p>
            <h2 id="close-summaries-title" className="text-lg font-black text-white uppercase tracking-tight font-display mt-1">
              Close summaries
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close summaries"
            className="p-2 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 cursor-pointer shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-[11px] text-zinc-500 font-bold uppercase mb-4">
          What the tills filed at close — newest first
        </p>

        {summaries.length === 0 ? (
          <div className="text-center py-10">
            <MailOpen className="w-10 h-10 text-zinc-700 mx-auto mb-2" />
            <p className="text-xs text-zinc-500 font-bold uppercase">No summaries yet</p>
            <p className="text-[11px] text-zinc-600 font-bold mt-1">They land here automatically when a day is closed.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {summaries.map(s => {
              const open = openId === s.id;
              const unread = s.deliveryStatus !== 'read';
              return (
                <div key={s.id} className={`rounded-2xl border overflow-hidden ${unread ? 'border-gold-brand/40 bg-gold-brand/5' : 'border-white/5 bg-black/30'}`}>
                  <button onClick={() => openRow(s.id)}
                    className="w-full text-left px-4 py-3 flex items-center gap-3 cursor-pointer">
                    <span aria-hidden="true" className={`w-2 h-2 rounded-full shrink-0 ${unread ? 'bg-gold-brand' : 'bg-zinc-700'}`} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-black text-white truncate">{s.headline}</span>
                      <span className="block text-[10px] text-zinc-500 font-bold uppercase mt-0.5">
                        {s.businessDate}{s.branch ? ` · ${s.branch}` : ''} · by {s.sentByName || 'the till'}
                        {s.sharedVia ? ' · shared' : ''}
                      </span>
                    </span>
                    {unread
                      ? <span className="text-[9px] font-black uppercase text-gold-brand shrink-0">New</span>
                      : <CheckCheck className="w-4 h-4 text-zinc-600 shrink-0" />}
                  </button>
                  {open && (
                    <div className="px-4 pb-4">
                      <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-zinc-300 bg-black/40 rounded-xl p-3">
                        {s.body}
                      </pre>
                      {s.totals?.unassigned != null && Number(s.totals.unassigned) > 0 && (
                        <p className="text-[10px] font-black text-amber-300 uppercase mt-2">
                          Still unassigned that night: {formatCurrency(Number(s.totals.unassigned))}
                        </p>
                      )}
                      <div className="grid grid-cols-2 gap-2 mt-3">
                        <button onClick={() => onShare(s.id)}
                          className="h-11 bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase text-[10px] tracking-widest rounded-xl transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer">
                          <Share2 className="w-3.5 h-3.5" /> WhatsApp
                        </button>
                        <button onClick={() => copyBody(s.body)}
                          className="h-11 bg-zinc-900 border border-zinc-800 text-zinc-300 font-black uppercase text-[10px] tracking-widest rounded-xl hover:border-gold-brand/40 transition-all active:scale-95 cursor-pointer">
                          Copy
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
