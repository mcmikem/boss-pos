import { Sale, StoreSettings } from '../types';

// Opens a printable receipt in a new window (works on desktop + Chrome Android,
// which offers print-to-PDF / thermal printer output).
export function printReceipt(
  sale: Sale,
  settings: StoreSettings,
  formatCurrency: (val: number) => string,
): void {
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

  const win = window.open('', '_blank', 'width=380,height=600');
  if (!win) {
    alert('Popup blocked — allow popups to print receipts.');
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
