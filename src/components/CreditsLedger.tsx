import { useState, useMemo } from 'react';
import type { Sale, CreditPayment } from '../types';
import { X, Check, AlertCircle } from 'lucide-react';

interface CreditsLedgerProps {
  sales: Sale[];
  creditPayments: CreditPayment[];
  formatCurrency: (val: number) => string;
  onPayCredit: (saleId: string, amount: number) => void;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export default function CreditsLedger({
  sales,
  creditPayments,
  formatCurrency,
  onPayCredit,
  triggerToast
}: CreditsLedgerProps) {
  const [paymentSaleId, setPaymentSaleId] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<string>('');

  const creditRecords = useMemo(() => {
    const creditTotals: Record<string, number> = {};
    creditPayments.forEach(p => {
      creditTotals[p.saleId] = (creditTotals[p.saleId] || 0) + p.amount;
    });

    return sales
      .filter(s => s.paymentMethod === 'Credit / Book' && s.customerName)
      .map(s => {
        const paid = creditTotals[s.id] || 0;
        return {
          saleId: s.id,
          orderNumber: s.orderNumber,
          customerName: s.customerName || 'Unknown',
          total: s.total,
          paidAmount: paid,
          remaining: Math.max(0, s.total - paid),
          createdAt: new Date(s.timestamp).toLocaleDateString()
        };
      })
      .filter(r => r.remaining > 0)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [sales, creditPayments]);

  const totalOutstanding = creditRecords.reduce((sum, r) => sum + r.remaining, 0);

  const handleRecordPayment = () => {
    if (!paymentSaleId) return;
    const amtNum = parseFloat(paymentAmount);
    if (isNaN(amtNum) || amtNum <= 0) {
      triggerToast('Enter valid payment amount', 'error');
      return;
    }

    const record = creditRecords.find(r => r.saleId === paymentSaleId);
    if (!record || amtNum > record.remaining) {
      triggerToast(`Cannot exceed outstanding amount (${formatCurrency(record?.remaining || 0)})`, 'error');
      return;
    }

    triggerToast(`Payment recorded: ${formatCurrency(amtNum)}`, 'success');
    setPaymentSaleId(null);
    setPaymentAmount('');
    onPayCredit(paymentSaleId, amtNum);
  };

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
            <p className="text-xs text-zinc-400 mt-1">{creditRecords.length} customers</p>
          </div>
        </div>
      </div>

      {creditRecords.length === 0 ? (
        <div className="boss-card p-8 flex flex-col items-center justify-center text-center">
          <Check className="w-12 h-12 text-green-500 mb-3 opacity-50" />
          <p className="text-sm text-zinc-400">No outstanding credits!</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {creditRecords.map(record => (
            <div key={record.saleId} className="boss-card p-3 flex items-center justify-between hover:bg-[#1C1C1C]">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-bold text-sm text-white truncate">{record.customerName}</p>
                  <span className="text-[8px] text-zinc-500">{record.orderNumber}</span>
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
              <button
                onClick={() => setPaymentSaleId(record.saleId)}
                className="ml-2 px-3 py-2 bg-green-600/20 text-green-400 border border-green-600/40 rounded-lg text-xs font-bold hover:bg-green-600/30 active:scale-95 transition-all whitespace-nowrap shrink-0"
              >
                Record Payment
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Payment Modal */}
      {paymentSaleId && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#141414] border border-white/10 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4">
              <h3 className="text-sm font-black text-white uppercase tracking-wider">Record Payment</h3>
              <button
                onClick={() => {
                  setPaymentSaleId(null);
                  setPaymentAmount('');
                }}
                className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {creditRecords.find(r => r.saleId === paymentSaleId) && (
              <>
                <div className="bg-[#0A0A0A] border border-white/5 rounded-xl p-3 mb-4 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Customer:</span>
                    <span className="font-bold text-white">
                      {creditRecords.find(r => r.saleId === paymentSaleId)?.customerName}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Outstanding:</span>
                    <span className="font-bold text-red-400">
                      {formatCurrency(creditRecords.find(r => r.saleId === paymentSaleId)?.remaining || 0)}
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
