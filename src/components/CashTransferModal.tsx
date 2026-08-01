import { useState, useEffect } from 'react';
import { ArrowRightLeft, X } from 'lucide-react';
import { CashTransfer } from '../types';
import { cashTransferApi } from '../api';

interface CashTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  formatCurrency: (val: number) => string;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  categories: string[];
}

export default function CashTransferModal({ isOpen, onClose, formatCurrency, triggerToast, categories }: CashTransferModalProps) {
  const [transferFrom, setTransferFrom] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [transferAmt, setTransferAmt] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [transfers, setTransfers] = useState<CashTransfer[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    cashTransferApi.list().then(setTransfers).catch(() => triggerToast('Failed to load transfers', 'error'));
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRecordTransfer = async () => {
    if (!transferFrom || !transferTo) {
      triggerToast('Select both drawers', 'error');
      return;
    }
    if (transferFrom === transferTo) {
      triggerToast('Cannot transfer to same drawer', 'error');
      return;
    }
    const amtNum = parseFloat(transferAmt) || 0;
    if (amtNum <= 0) {
      triggerToast('Enter a valid amount', 'error');
      return;
    }
    const newTransfer: CashTransfer = {
      id: `ct-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fromCategory: transferFrom,
      toCategory: transferTo,
      amount: amtNum,
      reason: transferReason.trim() || 'Change / borrow',
      createdAt: new Date().toISOString(),
      settledAt: null,
    };
    setTransfers(prev => [newTransfer, ...prev]);
    try {
      await cashTransferApi.create(newTransfer);
      triggerToast(`Recorded: ${formatCurrency(amtNum)} from ${transferFrom} → ${transferTo}`, 'info');
    } catch {
      setTransfers(prev => prev.filter(t => t.id !== newTransfer.id));
      triggerToast('Failed to save transfer', 'error');
    }
    setTransferAmt('');
    setTransferReason('');
  };

  const handleSettleTransfer = async (id: string) => {
    const settledAt = new Date().toISOString();
    setTransfers(prev => prev.map(t => t.id === id ? { ...t, settledAt } : t));
    try {
      await cashTransferApi.settle(id);
      triggerToast('Marked as settled', 'success');
    } catch {
      setTransfers(prev => prev.map(t => t.id === id ? { ...t, settledAt: null } : t));
      triggerToast('Failed to settle transfer', 'error');
    }
  };

  const quickAmounts = [500, 1000, 2000, 5000, 10000, 20000];

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 shadow-2xl">
        <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-sky-400" />
            <h3 className="text-sm font-black text-white uppercase tracking-wider font-display">Cash Transfers</h3>
          </div>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-3 mb-6">
          <p className="text-xs text-zinc-500 font-bold uppercase tracking-wider">Record a transfer</p>
          <p className="text-[10px] text-zinc-600">Borrowed change from another drawer? Log it here so you remember to pay it back.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">From (lender)</label>
              <select value={transferFrom} onChange={(e) => setTransferFrom(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl h-11 px-2 text-xs outline-none font-bold">
                <option value="">Select drawer...</option>
                {categories.filter(c => c !== transferTo).map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">To (borrower)</label>
              <select value={transferTo} onChange={(e) => setTransferTo(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl h-11 px-2 text-xs outline-none font-bold">
                <option value="">Select drawer...</option>
                {categories.filter(c => c !== transferFrom).map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">Amount</label>
            <input type="number" placeholder="e.g. 600" value={transferAmt}
              onChange={(e) => setTransferAmt(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 text-gold-brand font-black rounded-xl h-11 px-3 text-sm outline-none focus:border-sky-500" />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {quickAmounts.map(amt => (
                <button key={amt} onClick={() => setTransferAmt(String(amt))}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all cursor-pointer active:scale-95 ${transferAmt === String(amt) ? 'bg-sky-600 text-black border-sky-500' : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-600'}`}>
                  {amt >= 1000 ? `${(amt/1000).toFixed(0)}K` : amt}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-400 font-bold uppercase mb-1.5 block">Reason</label>
            <input type="text" placeholder="e.g. Change for customer" value={transferReason}
              onChange={(e) => setTransferReason(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-11 px-3 text-xs outline-none focus:border-sky-500" />
          </div>
          <button onClick={handleRecordTransfer}
            className="w-full h-12 bg-sky-600 hover:bg-sky-500 text-white font-black uppercase tracking-widest text-xs rounded-xl transition-all active:scale-95 shadow-lg flex items-center justify-center gap-2 cursor-pointer">
            <ArrowRightLeft className="w-4 h-4" /> Record Transfer
          </button>
        </div>

        <div className="border-t border-white/5 pt-4 space-y-3">
          <div className="flex justify-between items-center">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Outstanding Transfers</p>
            <span className="text-xs font-black text-sky-400">
              {formatCurrency(transfers.filter(t => !t.settledAt).reduce((s, t) => s + t.amount, 0))}
            </span>
          </div>
          {transfers.filter(t => !t.settledAt).length === 0 ? (
            <p className="text-xs text-zinc-500 text-center py-4 font-bold uppercase tracking-wider">All settled — no outstanding transfers</p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {(() => {
                const grouped: Record<string, CashTransfer[]> = {};
                transfers.filter(t => !t.settledAt).forEach(t => {
                  if (!grouped[t.toCategory]) grouped[t.toCategory] = [];
                  grouped[t.toCategory].push(t);
                });
                return Object.entries(grouped).map(([cat, items]) => {
                  const totalOwed = items.reduce((s, t) => s + t.amount, 0);
                  return (
                    <div key={cat}>
                      <div className="flex justify-between items-center px-1 py-1.5">
                        <span className="text-xs font-black text-white uppercase">{cat} owes</span>
                        <span className="text-xs font-black text-rose-400">{formatCurrency(totalOwed)}</span>
                      </div>
                      {items.map(t => (
                        <div key={t.id} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3 flex items-center justify-between ml-3 mb-1.5">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-sky-400">{formatCurrency(t.amount)}</span>
                              <span className="text-[10px] text-zinc-500">from {t.fromCategory}</span>
                            </div>
                            <p className="text-[10px] text-zinc-500 mt-0.5 truncate">
                              {t.reason} • {new Date(t.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                          <button onClick={() => handleSettleTransfer(t.id)}
                            className="ml-2 px-3 py-1.5 bg-emerald-600/20 text-emerald-400 border border-emerald-600/30 rounded-lg text-[10px] font-bold hover:bg-emerald-600/30 active:scale-95 transition-all shrink-0 cursor-pointer">
                            Settle
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                });
              })()}
            </div>
          )}
          {transfers.filter(t => t.settledAt).length > 0 && (
            <details className="border-t border-white/5 pt-3">
              <summary className="text-[10px] text-zinc-600 font-bold uppercase tracking-wider cursor-pointer hover:text-zinc-400">
                Settled ({transfers.filter(t => t.settledAt).length})
              </summary>
              <div className="space-y-1.5 mt-2">
                {transfers.filter(t => t.settledAt).slice(0, 10).map(t => (
                  <div key={t.id} className="flex justify-between items-center text-[10px] text-zinc-600 px-1">
                    <span>{formatCurrency(t.amount)} {t.fromCategory}→{t.toCategory}</span>
                    <span className="text-emerald-600">Settled</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
