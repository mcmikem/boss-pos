// Printable branded Quotation / Invoice for a saved quote. Same print
// pattern as the design-orders invoice: window.print with a print-only CSS
// gate on #print-quote-doc, plus WhatsApp share of the matching text.
import { useState } from 'react';
import { X, Printer, MessageCircle } from 'lucide-react';
import type { Quote } from '../types';
import { buildQuoteText, buildInvoiceText, quoteDocRef } from '../utils/quotes';
import { supplierWhatsAppUrl } from '../utils/suppliers';

interface QuoteDocumentProps {
  quote: Quote;
  shopName: string;
  formatCurrency: (val: number) => string;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  onClose: () => void;
}

export default function QuoteDocument({ quote, shopName, formatCurrency, triggerToast, onClose }: QuoteDocumentProps) {
  const [kind, setKind] = useState<'quote' | 'invoice'>('quote');
  const subtotal = quote.items.reduce((s, i) => s + (i.lineTotal || 0), 0);
  const ref = quoteDocRef(quote);
  const date = (quote.createdAt || '').slice(0, 10);
  const title = kind === 'quote' ? 'Quotation' : 'Invoice';

  const share = () => {
    const text = kind === 'quote' ? buildQuoteText(shopName, quote) : buildInvoiceText(shopName, quote);
    const url = supplierWhatsAppUrl(quote.customerPhone, text);
    if (!url) { triggerToast('Add the customer phone number first', 'error'); return; }
    window.open(url, '_blank', 'noopener');
  };

  return (
    <div className="fixed inset-0 z-[80] flex flex-col">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #print-quote-doc, #print-quote-doc * { visibility: visible; }
          #print-quote-doc { position: absolute; left: 0; top: 0; width: 100%; margin: 0; box-shadow: none; }
        }
      `}</style>
      <div className="relative mt-auto sm:m-auto sm:my-6 w-full sm:max-w-md mx-auto bg-white text-zinc-900 rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[92vh]" id="print-quote-doc">
        <div className="px-6 py-5 border-b-2 border-gold-brand" style={{ background: 'linear-gradient(135deg,#0A0A0A 0%,#1A1A1A 100%)' }}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-black text-gold-brand uppercase font-display tracking-wide">{shopName}</h3>
              <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest mt-0.5">Priced {title.toLowerCase()}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">{title}</p>
              <p className="text-sm font-black text-white font-mono">{ref}</p>
            </div>
          </div>
          <div className="flex gap-1.5 mt-3 print:hidden">
            {(['quote', 'invoice'] as const).map(k => (
              <button key={k} onClick={() => setKind(k)}
                className={`flex-1 h-9 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer ${
                  kind === k ? 'bg-gold-brand text-black' : 'bg-white/10 text-zinc-300 hover:bg-white/20'
                }`}>
                {k === 'quote' ? 'Quotation' : 'Invoice'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest mb-1">Bill To</p>
              <p className="text-sm font-black">{quote.customerName || 'Walk-in customer'}</p>
              {quote.customerPhone && (
                <p className="text-xs text-zinc-500 font-bold">{quote.customerPhone}</p>
              )}
            </div>
            <div className="text-right">
              <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest mb-1">Date</p>
              <p className="text-sm font-black">{date}</p>
            </div>
          </div>

          <div className="border border-zinc-200 rounded-xl overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-4 py-2 bg-zinc-100 text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
              <span>Item</span><span className="text-right">Qty</span><span className="text-right">Amount (UGX)</span>
            </div>
            <div className="divide-y divide-zinc-100 text-xs">
              {quote.items.map((i, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_auto_auto] gap-2 px-4 py-2.5">
                  <span className="font-bold">{i.productName}{i.variantLabel ? ` (${i.variantLabel})` : ''}</span>
                  <span className="text-right tabular-nums">{i.qty}</span>
                  <span className="text-right font-black tabular-nums">{formatCurrency(i.lineTotal)}</span>
                </div>
              ))}
              <div className="grid grid-cols-2 gap-2 px-4 py-2 text-zinc-500 font-bold">
                <span>Subtotal</span>
                <span className="text-right tabular-nums">{formatCurrency(subtotal)}</span>
              </div>
              {quote.discount > 0 && (
                <div className="grid grid-cols-2 gap-2 px-4 py-2 text-emerald-600 font-bold">
                  <span>Discount</span>
                  <span className="text-right tabular-nums">-{formatCurrency(quote.discount)}</span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 px-4 py-3 bg-gold-brand/10 text-sm font-black">
                <span>TOTAL</span>
                <span className="text-right tabular-nums">{formatCurrency(quote.total)}</span>
              </div>
            </div>
          </div>

          <div className="text-center pt-1">
            <p className="text-xs font-black uppercase tracking-widest">
              {kind === 'quote' ? 'Valid 7 days. Prices may change after.' : 'Payment due on receipt. Thank you!'}
            </p>
            <p className="text-[10px] text-zinc-400 font-bold mt-1">{shopName}</p>
          </div>
        </div>

        <div className="print:hidden p-5 pt-3 border-t border-zinc-200 flex gap-2 bg-white rounded-b-3xl pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <button onClick={() => window.print()}
            className="flex-1 h-12 border border-zinc-800 text-zinc-800 font-bold text-xs rounded-xl uppercase tracking-wider hover:bg-zinc-100 transition-all cursor-pointer flex items-center justify-center gap-2">
            <Printer className="w-4 h-4" /> Print
          </button>
          <button onClick={share}
            className="flex-1 h-12 bg-emerald-500 text-white font-black text-xs rounded-xl uppercase tracking-widest hover:bg-emerald-600 transition-all cursor-pointer flex items-center justify-center gap-2">
            <MessageCircle className="w-4 h-4" /> WhatsApp
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
