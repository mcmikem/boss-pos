import { SaleItem } from '../types';

interface ConfirmSaleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  isCompleting?: boolean;
  cart: SaleItem[];
  total: number;
  discountNum: number;
  paymentMethod: string;
  formatCurrency: (val: number) => string;
}

export default function ConfirmSaleModal({ isOpen, onClose, onConfirm, isCompleting = false, cart, total, discountNum, paymentMethod, formatCurrency }: ConfirmSaleModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-sm p-6 shadow-2xl">
        <h3 className="text-sm font-black text-white uppercase tracking-wider text-center mb-2">Confirm Sale</h3>
        <div className="bg-[#0A0A0A] border border-white/5 rounded-xl p-4 space-y-2 mb-4">
          <div className="flex justify-between text-xs">
            <span className="text-zinc-400">Items</span>
            <span className="font-bold text-white">{cart.reduce((s, i) => s + i.qty, 0)} items</span>
          </div>
          {discountNum > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Discount</span>
              <span className="font-bold text-emerald-400">{formatCurrency(discountNum)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm pt-2 border-t border-white/5">
            <span className="font-black text-white uppercase">Total</span>
            <span className="font-black text-gold-brand">{formatCurrency(total)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-zinc-400">Payment</span>
            <span className="font-bold text-white">{paymentMethod}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} disabled={isCompleting}
            className="flex-1 h-11 border border-zinc-800 text-zinc-400 font-bold text-xs rounded-xl uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed">Cancel</button>
          <button onClick={() => { Promise.resolve(onConfirm()).finally(onClose); }} disabled={isCompleting}
            className="flex-1 h-11 bg-gold-brand text-black font-black text-xs rounded-xl uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed">
            {isCompleting ? 'Saving...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
