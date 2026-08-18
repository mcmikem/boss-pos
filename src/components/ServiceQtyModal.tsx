import { useState } from 'react';
import { X, FileText } from 'lucide-react';
import { Product } from '../types';
import { unitLabel } from '../utils/units';

interface ServiceQtyModalProps {
  product: Product | null;
  formatCurrency: (val: number) => string;
  onAdd: (qty: number) => void;
  onClose: () => void;
}

const QUICK_QTYS = [1, 5, 10, 20, 50, 100];

export default function ServiceQtyModal({ product, formatCurrency, onAdd, onClose }: ServiceQtyModalProps) {
  const [qtyValue, setQtyValue] = useState('');

  if (!product) return null;

  const unit = product.saleUnit || '';
  const qty = parseInt(qtyValue, 10) || 0;
  const total = qty * (product.price || 0);

  const handleConfirm = () => {
    const n = parseInt(qtyValue, 10);
    if (!n || n <= 0) return;
    onAdd(n);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4">
          <h3 className="text-sm font-black text-white uppercase tracking-wider font-display flex items-center gap-2">
            <FileText className="w-4 h-4 text-gold-brand" /> Add {product.name}
          </h3>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-zinc-500 font-bold uppercase tracking-wider mb-1.5">
          How many {unit ? `${unit}s` : ''}? • {formatCurrency(product.price)} / {unit || 'unit'}
        </p>

        <input type="number" min="1" autoFocus placeholder={`e.g. 20 ${unit || 'units'}`} value={qtyValue}
          onChange={(e) => setQtyValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
          className="w-full bg-[#0A0A0A] border border-white/5 text-gold-brand font-black focus:border-gold-brand h-14 px-4 rounded-xl text-lg outline-none text-center" />

        <div className="flex flex-wrap gap-1.5 mt-3">
          {QUICK_QTYS.map(v => (
            <button key={v} type="button" onClick={() => setQtyValue(String(v))}
              className={`min-h-[40px] px-4 text-sm font-black rounded-lg border transition-all active:scale-95 cursor-pointer touch-target ${
                qtyValue === String(v)
                  ? 'bg-gold-brand text-black border-gold-brand'
                  : 'bg-[#0A0A0A] text-zinc-400 border-white/5 hover:border-gold-brand/40 hover:text-gold-brand'
              }`}>
              {v}
            </button>
          ))}
        </div>

        {qtyValue !== '' && qty > 0 && (
          <div className="mt-3 bg-[#0A0A0A] border border-white/5 rounded-xl px-4 py-3 flex justify-between items-center">
            <span className="text-xs text-zinc-400 font-bold uppercase tracking-wider">
              {unitLabel(qty, unit)} × {formatCurrency(product.price)}
            </span>
            <span className="text-sm font-black text-gold-brand font-display">{formatCurrency(total)}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mt-4">
          <button onClick={onClose}
            className="h-12 border border-zinc-800 hover:bg-zinc-900 text-zinc-400 font-bold uppercase tracking-wider text-xs rounded-xl cursor-pointer">
            Cancel
          </button>
          <button onClick={handleConfirm} disabled={!qty || qty <= 0}
            className="h-12 bg-gold-brand hover:bg-gold-medium text-black font-black uppercase tracking-widest text-xs rounded-xl shadow-lg transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed">
            Add {qtyValue && qty > 0 ? unitLabel(qty, unit) : ''}
          </button>
        </div>
      </div>
    </div>
  );
}