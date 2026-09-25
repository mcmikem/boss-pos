import { useState, useMemo } from 'react';
import type { Sale, CreditPayment, CreditEat } from '../types';
import { X, Check, AlertCircle } from 'lucide-react';

interface CreditsLedgerProps {
  sales: Sale[];
  creditPayments: CreditPayment[];
  creditEats?: CreditEat[];
  onPayCreditEat?: (id: string, amount: number) => void;
  formatCurrency: (val: number) => string;
  onPayCredit: (saleId: string, amount: number) => void;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

interface UnifiedRecord {
  key: string;
  kind: 'sale' | 'book';
  refId: string;
  orderNumber: string;
  customerName: string;
  total: number;
  paidAmount: number;
  remaining: number;
  createdAt: string;
  ts: number; // epoch ms — oldest debt collects first
}

export default function CreditsLedger({
  sales,
  creditPayments,
  creditEats = [],
  onPayCreditEat,
  formatCurrency,
  onPayCredit,
  triggerToast
}: CreditsLedgerProps) {
  const [paymentKey, setPaymentKey] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<string>('');

  const records = useMemo<UnifiedRecord[]>(() => {
    const creditTotals: Record<string, number> = {};
    creditPayments.forEach(p => {
      creditTotals[p.saleId] = (creditTotals[p.saleId] || 0) + p.amount;
    });

    const saleRecs: UnifiedRecord[] = sales
      .filter(s => s.paymentMethod === 'Credit / Book' && s.customerName)
      .map(s => {
        const paid = creditTotals[s.id] || 0;
        return {
          key: `sale:${s.id}`,
          kind: 'sale' as const,
          refId: s.id,
          orderNumber: s.orderNumber,
          customerName: s.customerName || 'Unknown',
          total: s.total,
          paidAmount: paid,
          remaining: Math.max(0, s.total - paid),
          createdAt: new Date(s.timestamp).toLocaleDateString(),
          ts: Date.parse(s.timestamp) || 0,
        };
      })
      .filter(r => r.remaining > 0);

    // Ababanjibwa Sente (Close-day book): manual credit lines live outside
    // sales, so without this merge Reports always read 0 even when the book
    // is full. Paid-off lines drop out the same way sale credits do.
    const bookRecs: UnifiedRecord[] = (creditEats || [])
      .filter(e => !e.paid)
      .map(e => ({
        key: `book:${e.id}`,
        kind: 'book' as const,
        refId: e.id,
        orderNumber: 'Book',
        customerName: e.customerName || 'Unknown',
        total: e.total,
        paidAmount: e.paidAmount || 0,
        remaining: Math.max(0, e.total - (e.paidAmount || 0)),
        createdAt: e.date,
        ts: Date.parse(e.date) || 0,
      }))
      .filter(r => r.remaining > 0);

    // Collect queue: oldest debt first — money rots with age.
    return [...saleRecs, ...bookRecs].sort((a, b) => a.ts - b.ts);
  }, [sales, creditPayments, creditEats]);

  const totalOutstanding = records.reduce((sum, r) => sum + r.remaining, 0);

  const handleRecordPayment = () => {
    if (!paymentKey) return;
    const amtNum = parseFloat(paymentAmount);
    if (isNaN(amtNum) || amtNum <= 0) {
      triggerToast('Enter valid payment amount', 'error');
      return;
    }

    const record = records.find(r => r.key === paymentKey);
    if (!record || amtNum > record.remaining) {
      triggerToast(`Cannot exceed outstanding amount (${formatCurrency(record?.remaining || 0)})`, 'error');
      return;
    }

    if (record.kind === 'book') {
      if (!onPayCreditEat) {
        triggerToast('Collect book payments in Close day', 'info');
        return;
      }
      triggerToast(`Payment recorded: ${formatCurrency(amtNum)}`, 'success');
      setPaymentKey(null);
      setPaymentAmount('');
      onPayCreditEat(record.refId, amtNum);
      return;
    }

    triggerToast(`Payment recorded: ${formatCurrency(amtNum)}`, 'success');
    setPaymentKey(null);
    setPaymentAmount('');
    onPayCredit(record.refId, amtNum);
  };

  // One card when clear (no header-0 + empty-message duplication), full
  // ledger when anything is owed.
  if (records.length === 0) {
    return (
      <div className="boss-card p-5 flex items-center gap-3 bg-gradient-to-br from-emerald-900/10 to-emerald-900/5 border-emerald-900/20">
        <Check className="w-8 h-8 text-emerald-500 shrink-0 opacity-60" />
        <div>
          <h3 className="text-sm font-black text-white uppercase tracking-wider">Books clear</h3>
          <p className="text-xs text-zinc-400 mt-0.5">No outstanding credits — till + book</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="boss-card p-4 bg-gradient-to-br from-red-900/10 to-red-900/5 border-red-900/20">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-5 h-5 text-red-500" />
              <h3 className="text-sm font-black text-white uppercase tracking-wider">Outstanding Credits</h3>
            </div>
            <p className="text-2xl font-black text-red-400">{formatCurrency(totalOutstanding)}</p>
            <p className="text-xs text-zinc-400 mt-1">{records.length} record{records.length !== 1 ? 's' : ''} • till + book</p>
          </div>
        </div>
      </div>

      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {records.map((record, idx) => {
          const ageD = Math.max(0, Math.floor((Date.now() - (record.ts || Date.now())) / 86400000));
          return (
          <div key={record.key} className="boss-card p-3 flex items-center justify-between hover:bg-[#1C1C1C]">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="font-bold text-sm text-white truncate">{record.customerName}</p>
                {idx === 0 && (
                  <span className="text-[8px] font-black uppercase text-gold-brand bg-gold-brand/10 border border-gold-brand/40 rounded px-1.5 py-0.5">Collect first</span>
                )}
                {ageD > 0 && (
                  <span className="text-[8px] font-bold uppercase text-zinc-500">{ageD}d</span>
                )}
                <span className="text-[8px] text-zinc-500">{record.orderNumber}</span>
                {record.kind === 'book' && (
                  <span className="text-[8px] font-black uppercase text-emerald-300 bg-emerald-950/40 border border-emerald-800/40 rounded px-1.5 py-0.5">Book</span>
                )}
              </div>
              <div className="flex items-center gap-4 text-xs">
                <div>
                  <span className="text-zinc-500">Total: </span>
                  <span className="font-bold text-white">{formatCurrency(record.total)}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Paid: </span>
                  <span className="font-bold text-green-400">{formatCurrency(record.paidAmount)}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Due: </span>
                  <span className="font-bold text-red-400">{formatCurrency(record.remaining)}</span>
                </div>
              </div>
            </div>
            <div className="ml-2 flex flex-col gap-1 shrink-0">
            <button
              onClick={() => { setPaymentKey(record.key); setPaymentAmount(String(record.remaining)); }}
              className="px-3 py-2 bg-green-600/20 text-green-400 border border-green-600/40 rounded-lg text-xs font-bold hover:bg-green-600/30 active:scale-95 transition-all whitespace-nowrap"
            >
              Record Payment
            </button>
            <button
              onClick={() => {
                const msg = `Hello ${record.customerName}, reminder: ${record.orderNumber} balance ${formatCurrency(record.remaining)} of ${formatCurrency(record.total)} (${record.createdAt}). Please clear it when you can. Thank you!`;
                // wa.me share link needs no saved number: WhatsApp opens with
                // the text prefilled and the cashier just picks the customer.
                const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
                const w = window.open(url, '_blank', 'noopener');
                if (w) triggerToast('Pick the customer in WhatsApp to send', 'success');
                else triggerToast('Could not open WhatsApp — copy manually', 'error');
              }}
              className="px-3 py-1.5 bg-emerald-950/30 text-emerald-300 border border-emerald-800/40 rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-emerald-950/50 active:scale-95 transition-all whitespace-nowrap"
            >
              WhatsApp
            </button>
            </div>
          </div>
          );
        })}
      </div>

      {/* Payment Modal */}
      {paymentKey && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#141414] border border-white/10 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4">
              <h3 className="text-sm font-black text-white uppercase tracking-wider">Record Payment</h3>
              <button
                onClick={() => {
                  setPaymentKey(null);
                  setPaymentAmount('');
                }}
                className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {records.find(r => r.key === paymentKey) && (
              <>
                <div className="bg-[#0A0A0A] border border-white/5 rounded-xl p-3 mb-4 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Customer:</span>
                    <span className="font-bold text-white">
                      {records.find(r => r.key === paymentKey)?.customerName}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Outstanding:</span>
                    <span className="font-bold text-red-400">
                      {formatCurrency(records.find(r => r.key === paymentKey)?.remaining || 0)}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 mb-4">
                  <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Payment Amount</label>
                  <input
                    type="number"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    placeholder="Enter amount"
                    className="w-full h-12 bg-[#0A0A0A] border border-white/5 text-white text-sm px-4 rounded-xl focus:border-gold-brand outline-none font-bold"
                    autoFocus
                  />
                </div>

                <button
                  onClick={handleRecordPayment}
                  className="w-full h-10 bg-green-600 text-white font-black uppercase tracking-widest rounded-xl text-xs hover:bg-green-700 active:scale-98 transition-all"
                >
                  Confirm Payment
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
