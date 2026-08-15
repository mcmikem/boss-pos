import { X, Printer, Share2, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import type { Sale, StoreSettings } from '../types';

interface ReceiptModalProps {
  sale: Sale;
  settings: StoreSettings;
  formatCurrency: (val: number) => string;
  onClose: () => void;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Print via a popup window. On old Android WebViews window.open can no-op
// (no onCreateWindow handler); detect that and report so the user can fall
// back to Copy / WhatsApp.
function printViaPopup(html: string): boolean {
  const win = window.open('', '_blank', 'width=380,height=600');
  if (!win) return false;
  try {
    win.document.write(html);
    win.document.close();
    win.focus();
    return true;
  } catch {
    return false;
  }
}

export default function ReceiptModal({ sale, settings, formatCurrency, onClose, triggerToast }: ReceiptModalProps) {
  const [copied, setCopied] = useState(false);

  const items = sale.items
    .map(i => {
      const label = i.variantLabel ? ` (${i.variantLabel})` : '';
      return `<tr><td style="padding:2px 0">${escapeHtml(i.productName + label)} x${i.qty}</td><td style="text-align:right;white-space:nowrap">${formatCurrency(i.lineTotal)}</td></tr>`;
    })
    .join('');
  const discountRow =
    sale.discount && sale.discount > 0
      ? `<tr><td style="padding:2px 0">Discount</td><td style="text-align:right;white-space:nowrap">-${formatCurrency(sale.discount)}</td></tr>`
      : '';

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Receipt ${escapeHtml(sale.orderNumber)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Courier New', monospace; color: #111; margin: 0; padding: 24px; width: 80mm; }
  @media print { body { padding: 0; width: 80mm; } }
  .center { text-align: center; }
  h1 { font-size: 16px; margin: 0 0 2px; text-transform: uppercase; letter-spacing: 1px; }
  .muted { color: #555; font-size: 11px; }
  .divider { border-top: 1px dashed #888; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  td { vertical-align: top; }
  .total { font-size: 15px; font-weight: bold; }
  .right { text-align: right; }
</style>
</head>
<body>
  <div class="center">
    <h1>${escapeHtml(settings.shopName || 'My Shop')}</h1>
    <div class="muted">Uganda • POS</div>
    <div class="muted">${escapeHtml(sale.orderNumber)}</div>
    <div class="muted">${new Date(sale.timestamp).toLocaleString()}</div>
  </div>
  <div class="divider"></div>
  <table>
    ${items}
    ${discountRow}
  </table>
  <div class="divider"></div>
  <table>
    <tr>
      <td class="total">TOTAL</td>
      <td class="right total">${formatCurrency(sale.total)}</td>
    </tr>
    <tr>
      <td class="muted" style="padding-top:4px">PAYMENT</td>
      <td class="right muted" style="padding-top:4px">${escapeHtml(sale.paymentMethod)}${sale.customerName ? ' • ' + escapeHtml(sale.customerName) : ''}</td>
    </tr>
  </table>
  <div class="divider"></div>
  <div class="center muted">Thank you for your business!</div>
  <script>
    window.onload = function () { setTimeout(function () { window.print(); }, 150); };
  <\/script>
</body>
</html>`;

  // Plain-text version for copy / WhatsApp (works even when window.open no-ops).
  const text = [
    settings.shopName || 'My Shop',
    sale.orderNumber,
    new Date(sale.timestamp).toLocaleString(),
    '',
    ...sale.items.map(i => `${i.productName}${i.variantLabel ? ` (${i.variantLabel})` : ''} x${i.qty} = ${formatCurrency(i.lineTotal)}`),
    ...(sale.discount && sale.discount > 0 ? [`Discount: -${formatCurrency(sale.discount)}`] : []),
    '',
    `TOTAL: ${formatCurrency(sale.total)}`,
    `PAYMENT: ${sale.paymentMethod}${sale.customerName ? ` • ${sale.customerName}` : ''}`,
  ].join('\n');

  const handlePrint = () => {
    if (printViaPopup(html)) return;
    triggerToast('Popup blocked on this device — use Copy to share the receipt', 'error');
  };

  const handleWhatsApp = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    const win = window.open(url, '_blank');
    if (!win) triggerToast('Could not open WhatsApp — receipt copied instead', 'info');
    try { navigator.clipboard?.writeText(text); } catch {}
  };

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      triggerToast('Copy failed', 'error');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[110] flex items-center justify-center p-4">
      <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-sm p-6 shadow-2xl max-h-[92vh] flex flex-col">
        <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4">
          <h3 className="text-sm font-black text-white uppercase tracking-wider font-display">Receipt</h3>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-white text-black font-mono rounded-xl p-4 overflow-y-auto min-h-[240px]">
          <div className="text-center">
            <h1 className="text-sm font-black uppercase tracking-wider">{settings.shopName || 'My Shop'}</h1>
            <p className="text-[10px] text-zinc-600">Uganda • POS</p>
            <p className="text-[10px] text-zinc-600">{sale.orderNumber}</p>
            <p className="text-[10px] text-zinc-600">{new Date(sale.timestamp).toLocaleString()}</p>
          </div>
          <div className="border-t border-dashed border-zinc-400 my-2" />
          {sale.items.map((i, idx) => (
            <div key={idx} className="flex justify-between text-[11px] py-0.5">
              <span>{i.productName}{i.variantLabel ? ` (${i.variantLabel})` : ''} x{i.qty}</span>
              <span className="whitespace-nowrap">{formatCurrency(i.lineTotal)}</span>
            </div>
          ))}
          {sale.discount && sale.discount > 0 && (
            <div className="flex justify-between text-[11px] py-0.5">
              <span>Discount</span>
              <span className="whitespace-nowrap">-{formatCurrency(sale.discount)}</span>
            </div>
          )}
          <div className="border-t border-dashed border-zinc-400 my-2" />
          <div className="flex justify-between text-sm font-black">
            <span>TOTAL</span>
            <span>{formatCurrency(sale.total)}</span>
          </div>
          <div className="flex justify-between text-[11px] text-zinc-700 mt-1">
            <span>PAYMENT</span>
            <span>{sale.paymentMethod}{sale.customerName ? ` • ${sale.customerName}` : ''}</span>
          </div>
          <div className="border-t border-dashed border-zinc-400 my-2" />
          <div className="text-center text-[10px] text-zinc-600">Thank you for your business!</div>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-4">
          <button onClick={handlePrint}
            className="h-11 bg-zinc-800 hover:bg-zinc-700 text-white font-black uppercase text-[10px] tracking-widest rounded-xl transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer">
            <Printer className="w-3.5 h-3.5" /> Print
          </button>
          <button onClick={handleWhatsApp}
            className="h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase text-[10px] tracking-widest rounded-xl transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer">
            <Share2 className="w-3.5 h-3.5" /> WhatsApp
          </button>
          <button onClick={handleCopy}
            className="h-11 bg-zinc-800 hover:bg-zinc-700 text-white font-black uppercase text-[10px] tracking-widest rounded-xl transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
}
