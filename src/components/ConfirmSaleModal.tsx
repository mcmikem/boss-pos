import { useEffect, useRef } from 'react';
import { Sale, SaleItem, SplitTender } from '../types';
import { t } from '../utils/i18n';
import { splitLegs } from '../utils/serviceSale';

export type ConfirmSaleResult = boolean | void | { status: 'saved' | 'queued'; sale?: Sale };

interface ConfirmSaleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => ConfirmSaleResult | Promise<ConfirmSaleResult>;
  isCompleting?: boolean;
  saveState?: 'idle' | 'saving' | 'queued' | 'saved' | 'error';
  cart: SaleItem[];
  total: number;
  discountNum: number;
  paymentMethod: string;
  cashReceived?: string;
  sellerName?: string;
  splitTenders?: SplitTender[];
  formatCurrency: (val: number) => string;
  lang?: unknown;
}

export default function ConfirmSaleModal({
  isOpen,
  onClose,
  onConfirm,
  isCompleting = false,
  saveState = 'idle',
  cart,
  total,
  discountNum,
  paymentMethod,
  cashReceived,
  sellerName,
  splitTenders,
  formatCurrency,
  lang,
}: ConfirmSaleModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(isCompleting);
  onCloseRef.current = onClose;
  busyRef.current = isCompleting;

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => dialogRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!busyRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
      window.setTimeout(() => previous?.focus(), 0);
    };
  }, [isOpen]);

  if (!isOpen) return null;
  const tendered = parseFloat(cashReceived || '');
  const showTender = paymentMethod === 'Cash' && cashReceived !== undefined && cashReceived !== '' && !isNaN(tendered);
  const finished = saveState === 'saved' || saveState === 'queued';
  const statusText = saveState === 'saving'
    ? 'Saving sale…'
    : saveState === 'queued'
      ? 'Queued on this till. It will sync when the connection returns.'
      : saveState === 'saved'
        ? 'Saved. This sale is recorded.'
        : saveState === 'error'
          ? 'Not saved. Your cart is still here — try again.'
          : '';
  const statusClass = saveState === 'error'
    ? 'text-rose-300 border-rose-800/50 bg-rose-950/30'
    : saveState === 'queued'
      ? 'text-amber-200 border-amber-800/50 bg-amber-950/30'
      : 'text-emerald-200 border-emerald-800/50 bg-emerald-950/30';

  const handleConfirm = async () => {
    const result = await onConfirm();
    if (result === false) return;
    if (result && typeof result === 'object') return;
    onCloseRef.current();
  };

  return (
    <div
      className="fixed inset-0 bg-black/85 backdrop-blur-md z-[100] flex items-center justify-center p-4"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !busyRef.current) onCloseRef.current();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-sale-title"
        aria-describedby="confirm-sale-summary"
        aria-busy={isCompleting}
        tabIndex={-1}
        className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-sm p-6 shadow-2xl max-h-[92vh] overflow-y-auto focus:outline-none"
      >
        <h3 id="confirm-sale-title" className="text-sm font-black text-white uppercase tracking-wider text-center mb-2">{t(lang, 'confirmSale')}</h3>
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
          {cart.length > 6 && <p className="text-[10px] text-zinc-500 font-bold uppercase pt-1">+{cart.length - 6} more item{cart.length - 6 !== 1 ? 's' : ''}</p>}
        </div>
        <div id="confirm-sale-summary" className="bg-[#0A0A0A] border border-white/5 rounded-xl p-4 space-y-2 mb-4">
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
          {paymentMethod === 'Split' && splitLegs({ paymentMethod: 'Split', splitTenders }).map((leg, i) => (
            <div key={i} className="flex justify-between text-xs">
              <span className="text-zinc-400">{leg.method === 'MTN MoMo' ? 'MTN' : leg.method === 'Airtel Money' ? 'Airtel' : leg.method}</span>
              <span className="font-bold text-white tabular-nums">{formatCurrency(leg.amount)}</span>
            </div>
          ))}
          {sellerName && (
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Seller</span>
              <span className="font-bold text-white">{sellerName}</span>
            </div>
          )}
          {showTender && (
            <>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">{t(lang, 'cashReceived')}</span>
                <span className="font-bold text-white tabular-nums">{formatCurrency(tendered)}</span>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t border-white/5">
                <span className="font-black uppercase">{tendered >= total ? t(lang, 'change') : t(lang, 'stillNeed')}</span>
                <span className={`font-black tabular-nums ${tendered >= total ? 'text-emerald-400' : 'text-amber-400'}`}>{formatCurrency(Math.abs(tendered - total))}</span>
              </div>
            </>
          )}
        </div>
        {(paymentMethod === 'MTN MoMo' || paymentMethod === 'Airtel Money') && (
          <p className="text-[11px] font-bold text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded-xl px-3 py-2 mb-4 leading-snug">
            Check the {paymentMethod === 'MTN MoMo' ? 'MTN' : 'Airtel'} SMS on your phone matches {formatCurrency(total)} before confirming — the till can't verify phone money itself.
          </p>
        )}
        {statusText && (
          <div role="status" aria-live="polite" className={`text-[11px] font-bold border rounded-xl px-3 py-2 mb-4 leading-snug ${statusClass}`}>
            {statusText}
          </div>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onCloseRef.current} disabled={isCompleting}
            className="flex-1 h-11 border border-zinc-800 text-zinc-400 font-bold text-xs rounded-xl uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed">
            {finished ? 'Done' : saveState === 'error' ? 'Close' : t(lang, 'cancel')}
          </button>
          <button type="button" onClick={finished ? onCloseRef.current : handleConfirm} disabled={isCompleting || finished} id="tour-confirm-btn"
            className="flex-1 h-11 bg-gold-brand text-black font-black text-xs rounded-xl uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed">
            {isCompleting ? 'Saving…' : saveState === 'queued' ? 'Queued' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Try again' : t(lang, 'confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
