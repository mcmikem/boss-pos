import { useState } from 'react';
import { X, Search, FileText, MessageCircle, ShoppingCart } from 'lucide-react';
import type { Quote } from '../types';
import { buildQuoteText } from '../utils/quotes';
import { supplierWhatsAppUrl } from '../utils/suppliers';

interface QuotesProps {
  quotes: Quote[];
  shopName: string;
  formatCurrency: (val: number) => string;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  onConvert: (q: Quote) => void;
  onDelete: (id: string) => void;
}

// Contractor quotations: priced cart snapshots that are not sales. Convert
// brings the items back into the cart to ring the real sale.
export default function Quotes({ quotes, shopName, formatCurrency, triggerToast, onConvert, onDelete }: QuotesProps) {
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const q = search.toLowerCase().trim();
  const filtered = quotes.filter(x =>
    !q || x.customerName.toLowerCase().includes(q) ||
    x.items.some(i => i.productName.toLowerCase().includes(q)),
  );

  const share = (quote: Quote) => {
    const url = supplierWhatsAppUrl(quote.customerPhone, buildQuoteText(shopName, quote));
    if (!url) { triggerToast('Add the customer phone number first', 'error'); return; }
    window.open(url, '_blank', 'noopener');
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer or item"
          className="w-full bg-[#0A0A0A] border border-white/5 text-sm pl-9 pr-3 rounded-xl text-white font-bold focus:border-gold-brand outline-none h-11" />
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-xs text-zinc-600 font-bold uppercase py-8">
          No quotes yet — fill the cart, then Save as quote
        </p>
      )}

      {filtered.map(quote => (
        <div key={quote.id} className="boss-card p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-black text-white truncate flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-gold-brand shrink-0" />
                {quote.customerName || 'Walk-in quote'}
              </p>
              <p className="text-[11px] text-zinc-500 font-bold tabular-nums">
                {(quote.createdAt || '').slice(0, 10)} · {quote.items.reduce((a, i) => a + i.qty, 0)} items
              </p>
            </div>
            <p className="text-sm font-black text-gold-brand tabular-nums shrink-0">{formatCurrency(quote.total)}</p>
          </div>
          <p className="text-[11px] text-zinc-500 mt-2 truncate">
            {quote.items.map(i => `${i.productName}×${i.qty}`).join(', ')}
          </p>
          <div className="flex gap-2 mt-3">
            <button onClick={() => onConvert(quote)}
              className="flex-1 h-9 bg-gold-brand text-black rounded-xl text-[11px] font-black uppercase flex items-center justify-center gap-1 cursor-pointer">
              <ShoppingCart className="w-3.5 h-3.5" /> Sell
            </button>
            <button onClick={() => share(quote)}
              className="flex-1 h-9 bg-emerald-950/40 border border-emerald-800/50 text-emerald-300 rounded-xl text-[11px] font-black uppercase flex items-center justify-center gap-1 cursor-pointer">
              <MessageCircle className="w-3.5 h-3.5" /> Send
            </button>
            {confirmDelete === quote.id ? (
              <button onClick={() => { onDelete(quote.id); setConfirmDelete(null); }}
                className="h-9 px-4 bg-rose-600 text-white rounded-xl text-[11px] font-black uppercase cursor-pointer">
                Sure?
              </button>
            ) : (
              <button onClick={() => setConfirmDelete(quote.id)}
                className="h-9 px-3 text-zinc-600 hover:text-rose-400 cursor-pointer" aria-label="Delete quote">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
