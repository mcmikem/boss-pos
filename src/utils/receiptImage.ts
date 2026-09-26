import type { Sale, StoreSettings } from '../types';
import { unitLabel } from './units';
import { paymentLabel } from './serviceSale';

// Receipts customers can keep: a designed PNG (layout, logo, totals) instead
// of editable plain text. One line model feeds the canvas renderer; the same
// lines back the print HTML and the WhatsApp text so every channel agrees.
export type ReceiptLineStyle = 'shop' | 'item' | 'muted' | 'total' | 'center' | 'divider' | 'fiscal';

export interface ReceiptLine {
  left: string;
  right?: string;
  style: ReceiptLineStyle;
}

export interface ReceiptContent {
  shopName: string;
  lines: ReceiptLine[];
  footer?: string;
}

export function buildReceiptLines(
  sale: Sale,
  shopName: string,
  formatCurrency: (val: number) => string,
): ReceiptContent {
  const lines: ReceiptLine[] = [
    { left: sale.orderNumber, style: 'muted' },
    { left: new Date(sale.timestamp).toLocaleString(), style: 'muted' },
    { left: '', style: 'divider' },
  ];
  for (const i of sale.items) {
    const qtyLabel = i.saleUnit ? unitLabel(i.qty, i.saleUnit) : `x${i.qty}`;
    const name = i.variantLabel ? `${i.productName} (${i.variantLabel})` : i.productName;
    lines.push({ left: `${name} ${qtyLabel}`, right: formatCurrency(i.lineTotal), style: 'item' });
    if ((i.lineDiscount || 0) > 0) {
      lines.push({ left: '  discount', right: `-${formatCurrency(i.lineDiscount || 0)}`, style: 'muted' });
    }
  }
  if (sale.discount && sale.discount > 0) {
    lines.push({ left: 'Discount', right: `-${formatCurrency(sale.discount)}`, style: 'muted' });
  }
  lines.push({ left: '', style: 'divider' });
  lines.push({ left: 'TOTAL', right: formatCurrency(sale.total), style: 'total' });
  const payBits = [paymentLabel(sale)];
  if (sale.customerName) payBits.push(sale.customerName);
  lines.push({ left: `Paid: ${payBits.join(' • ')}`, style: 'muted' });
  if (sale.staffName) lines.push({ left: `Served by ${sale.staffName}`, style: 'muted' });
  lines.push({ left: 'Thank you for your business!', style: 'center' });
  if (sale.efrisStatus === 'issued' && sale.efrisFdn) {
    lines.push({ left: '', style: 'divider' });
    lines.push({ left: 'URA E-FISCAL RECEIPT', style: 'fiscal' });
    lines.push({ left: `FDN: ${sale.efrisFdn}`, style: 'fiscal' });
    if (sale.efrisInvoiceNo) lines.push({ left: `INV: ${sale.efrisInvoiceNo}`, style: 'fiscal' });
    if (sale.efrisVerify) lines.push({ left: `VERIFY: ${sale.efrisVerify}`, style: 'fiscal' });
  }
  return { shopName: shopName || 'My Shop', lines };
}

function loadLogo(url: string, timeoutMs = 3000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (img: HTMLImageElement | null) => {
      if (done) return;
      done = true;
      resolve(img);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { window.clearTimeout(timer); finish(img); };
    img.onerror = () => { window.clearTimeout(timer); finish(null); };
    try { img.src = url; } catch { window.clearTimeout(timer); finish(null); }
  });
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, base: string, size: number): number {
  let s = size;
  ctx.font = base.replace('{size}', String(s));
  while (s > 14 && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = base.replace('{size}', String(s));
  }
  return s;
}

// 80mm-style receipt at ~2x density: crisp on phones, light on ink, and the
// layout survives as pixels — nothing to edit afterwards.
export async function renderReceiptPng(
  sale: Sale,
  settings: StoreSettings,
  formatCurrency: (val: number) => string,
): Promise<Blob> {
  const content = buildReceiptLines(sale, settings.shopName || 'My Shop', formatCurrency);
  const width = 640;
  const pad = 36;
  const maxW = width - pad * 2;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable on this device');

  const mono = (size: number, weight: string) => `${weight} ${size}px "Courier New", Courier, monospace`;
  interface DrawOp { kind: 'text'; text: string; x: number; y: number; font: string; align: CanvasTextAlign; color: string }
  interface LogoOp { kind: 'logo'; img: HTMLImageElement; h: number }
  interface DividerOp { kind: 'divider' }
  const ops: Array<DrawOp | LogoOp | DividerOp> = [];
  let y = pad + 8;

  const logoUrl = (settings.receiptLogoUrl || '').trim();
  if (logoUrl) {
    const logo = await loadLogo(logoUrl);
    if (logo && logo.naturalWidth > 0) {
      const h = Math.min(150, Math.round((150 / logo.naturalWidth) * logo.naturalHeight) || 120);
      ops.push({ kind: 'logo', img: logo, h });
      y += h + 14;
    }
  }

  const titleSize = fitFont(ctx, content.shopName.toUpperCase(), maxW, `900 {size}px "Courier New", monospace`, 44);
  ops.push({ kind: 'text', text: content.shopName.toUpperCase(), x: width / 2, y, font: mono(titleSize, '900'), align: 'center', color: '#111' });
  y += titleSize + 18;

  for (const line of content.lines) {
    if (line.style === 'divider') {
      ops.push({ kind: 'divider' });
      y += 20;
      continue;
    }
    const size = line.style === 'total' ? 34 : line.style === 'shop' ? 40 : 24;
    const weight = line.style === 'total' || line.style === 'fiscal' ? '900' : '400';
    const color = line.style === 'muted' ? '#555' : '#111';
    if (line.style === 'center' || line.style === 'fiscal' || !line.right) {
      const useSize = fitFont(ctx, line.left, maxW, mono(0, weight).replace('0px', '{size}px'), size);
      ops.push({ kind: 'text', text: line.left, x: width / 2, y, font: mono(useSize, weight), align: 'center', color });
      y += useSize + 12;
    } else {
      const rightW = ctx.measureText(line.right).width + 24;
      const leftSize = fitFont(ctx, line.left, maxW - rightW, mono(0, weight).replace('0px', '{size}px'), size);
      ops.push({ kind: 'text', text: line.left, x: pad, y, font: mono(leftSize, weight), align: 'left', color });
      ops.push({ kind: 'text', text: line.right, x: width - pad, y, font: mono(size, weight), align: 'right', color });
      y += size + 12;
    }
  }
  if (settings.receiptFooter) {
    const useSize = fitFont(ctx, settings.receiptFooter, maxW, mono(0, '700').replace('0px', '{size}px'), 24);
    ops.push({ kind: 'text', text: settings.receiptFooter, x: width / 2, y, font: mono(useSize, '700'), align: 'center', color: '#111' });
    y += useSize + 12;
  }
  y += pad;

  canvas.width = width;
  canvas.height = Math.ceil(y);
  const c = canvas.getContext('2d');
  if (!c) throw new Error('Canvas unavailable on this device');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.textBaseline = 'top';
  let dy = pad + 8;
  for (const op of ops) {
    if (op.kind === 'logo') {
      const w = Math.round((op.h / op.img.naturalHeight) * op.img.naturalWidth);
      c.drawImage(op.img, Math.round((width - w) / 2), dy, w, op.h);
      dy += op.h + 14;
      continue;
    }
    // Divider rows draw the dashed rule.
    if (op.kind === 'divider') {
      c.strokeStyle = '#888';
      c.lineWidth = 2;
      c.setLineDash([10, 8]);
      c.beginPath();
      c.moveTo(pad, dy + 7);
      c.lineTo(width - pad, dy + 7);
      c.stroke();
      c.setLineDash([]);
      dy += 20;
      continue;
    }
    c.font = op.font;
    c.fillStyle = op.color;
    c.textAlign = op.align;
    c.fillText(op.text, op.x, dy);
    const sizeMatch = / (\d+)px/.exec(op.font);
    dy += (sizeMatch ? parseInt(sizeMatch[1], 10) : 24) + 12;
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not render the receipt image');
  return blob;
}
