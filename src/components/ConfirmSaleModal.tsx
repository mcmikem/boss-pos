import { SaleItem } from '../types';
import { t } from '../utils/i18n';

interface ConfirmSaleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => boolean | void | Promise<boolean | void>;
  isCompleting?: boolean;
  cart: SaleItem[];
  total: number;
  discountNum: number;
  paymentMethod: string;
  cashReceived?: string;
  formatCurrency: (val: number) => string;
  lang?: unknown;
}

export default function ConfirmSaleModal({ isOpen, onClose, onConfirm, isCompleting = false, cart, total, discountNum, paymentMethod, cashReceived, formatCurrency, lang }: ConfirmSaleModalProps) {
  if (!isOpen) return null;
  const tendered = parseFloat(cashReceived || '');
  const showTender = paymentMethod === 'Cash' && cashReceived !== undefined && cashReceived !== '' && !isNaN(tendered);

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-sm p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
        <h3 className="text-sm font-black text-white uppercase tracking-wider text-center mb-2">{t(lang, 'confirmSale')}</h3>
        {/* Receipt preview: exactly what the customer gets, so Confirm never
            feels like a leap of faith for a new cashier. */}
        <div className="bg-[#0A0A0A] border border-white/5 rounded-xl p-3 mb-2 max-h-40 overflow-y-auto">
          {cart.slice(0, 6).map(item => (
            <div key={`${item.productId}::${item.variantId || ''}`} className="flex items-center justify-between gap-2 py-1">
              <span className="text-xs text-zinc-200 truncate min-w-0">
                {item.productName}
                <span className="text-zinc-500"> ×{item.qty}</span>
              </span>
              <span className="text-xs font-bold text-gold-light tabular-nums shrink-0">{formatCurrency(item.lineTotal)}</span>
            </div>
          ))}
          {cart.length > 6 && (
            <p className="text-[10px] text-zinc-500 font-bold uppercase pt-1">+{cart.length - 6} more item{cart.length - 6 !== 1 ? 's' : ''}</p>
          )}
        </div>
        <div className="bg-[#0A0A0A] border border-white/5 rounded-xl p-4 space-y-2 mb-4">
          <div className="flex justify-between text-xs">
            <span className="text-zinc-400">{t(lang, 'itemsLabel')}</span>
            <span className="font-bold text-white">{cart.reduce((s, i) => s + i.qty, 0)} {t(lang, 'items')}</span>
          </div>
          {discountNum > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">{t(lang, 'discount')}</span>
              <span className="font-bold text-emerald-400">{formatCurrency(discountNum)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm pt-2 border-t border-white/5">
            <span className="font-black text-white uppercase">{t(lang, 'total')}</span>
            <span className="font-black text-gold-brand">{formatCurrency(total)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-zinc-400">{t(lang, 'payment')}</span>
            <span className="font-bold text-white">{paymentMethod}</span>
          </div>
          {showTender && (
            <>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">{t(lang, 'cashReceived')}</span>
                <span className="font-bold text-white tabular-nums">{formatCurrency(tendered)}</span>
              </div>
              {tendered >= total ? (
                <div className="flex justify-between text-sm pt-2 border-t border-white/5">
                  <span className="font-black text-emerald-400 uppercase">{t(lang, 'change')}</span>
                  <span className="font-black text-emerald-400 tabular-nums">{formatCurrency(tendered - total)}</span>
                </div>
              ) : (
                <div className="flex justify-between text-sm pt-2 border-t border-white/5">
                  <span className="font-black text-amber-400 uppercase">{t(lang, 'stillNeed')}</span>
                  <span className="font-black text-amber-400 tabular-nums">{formatCurrency(total - tendered)}</span>
                </div>
              )}
            </>
          )}
        </div>
        {(paymentMethod === 'MTN MoMo' || paymentMethod === 'Airtel Money') && (
          <p className="text-[11px] font-bold text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded-xl px-3 py-2 mb-4 leading-snug">
            Check the {paymentMethod === 'MTN MoMo' ? 'MTN' : 'Airtel'} SMS on your phone matches {formatCurrency(total)} before confirming — the till can't verify phone money itself.
          </p>
        )}
        <div className="flex gap-2">
          <button onClick={onClose} disabled={isCompleting}
            className="flex-1 h-11 border border-zinc-800 text-zinc-400 font-bold text-xs rounded-xl uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed">{t(lang, 'cancel')}</button>
          {/* Only dismiss on success: handleCompleteSale returns false when it
              blocks the sale (e.g. underpaid cash) so the cashier can fix the
              tender instead of re-opening the modal. */}
          <button onClick={async () => { const ok = await onConfirm(); if (ok !== false) onClose(); }} disabled={isCompleting}
            className="flex-1 h-11 bg-gold-brand text-black font-black text-xs rounded-xl uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed">
            {isCompleting ? t(lang, 'saving') : t(lang, 'confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
