// EFRIS (URA Electronic Fiscal Receipting and Invoicing Solution) adapter.
//
// BOSS is multi-shop: every shop carries its OWN URA identity (TIN +
// device registration), so all credentials live per-deployment in settings,
// never in code. Two modes:
//
//   sandbox  — no credentials needed. Builds the exact production payload and
//              returns a simulated URA response so a shop can rehearse the
//              whole flow (issue → FDN on receipt) before touching URA.
//   provider — POSTs the payload to a configured fiscalisation endpoint
//              (URA S2S directly or an aggregator) with a bearer token.
//
// Production honesty notes (also mirrored on the landing page):
//  - URA must approve each shop's device (~1-2 days) before live invoices.
//  - Goods sold must be registered in EFRIS; goodsCode here must match the
//    code URA holds for that item (configure goodsPrefix to match).
//  - BOSS till prices are VAT-inclusive (counter reality). The builder
//    extracts the VAT portion arithmetically; see pricesIncludeVat.

export const EFRIS_MODES = ['off', 'sandbox', 'provider'];

export function defaultEfrisConfig() {
  return {
    enabled: false,
    mode: 'off', // off | sandbox | provider
    tin: '',
    deviceNo: '',
    branchCode: '00',
    vatRate: 18, // Uganda standard VAT %
    pricesIncludeVat: true,
    autoIssue: false, // file every sale automatically once live
    goodsPrefix: 'BOSS',
    providerBase: '', // e.g. https://fiscal.example.com/api/URA_TIN — no trailing slash
  };
}

const clean = (v, n) => String(v || '').slice(0, n);

export function sanitizeEfrisConfig(input) {
  const d = defaultEfrisConfig();
  const src = input && typeof input === 'object' ? input : {};
  const mode = EFRIS_MODES.includes(src.mode) ? src.mode : 'off';
  const vatRate = Math.min(100, Math.max(0, Number(src.vatRate ?? d.vatRate) || 0));
  return {
    enabled: src.enabled === true && mode !== 'off',
    mode,
    tin: clean(src.tin, 20).replace(/\s+/g, ''),
    deviceNo: clean(src.deviceNo, 40),
    branchCode: clean(src.branchCode || d.branchCode, 10),
    vatRate,
    pricesIncludeVat: src.pricesIncludeVat !== false,
    autoIssue: src.autoIssue === true,
    goodsPrefix: clean(src.goodsPrefix || d.goodsPrefix, 12).replace(/[^A-Za-z0-9-]/g, '') || 'BOSS',
    providerBase: clean(src.providerBase, 200).replace(/\/+$/, ''),
  };
}

export function goodsCodeFor(productId, prefix) {
  const p = (prefix || 'BOSS').replace(/[^A-Za-z0-9-]/g, '').slice(0, 12) || 'BOSS';
  const id = String(productId || 'item').replace(/[^A-Za-z0-9-]/g, '').slice(-18) || 'item';
  return `${p}-${id}`.slice(0, 30);
}

// Split a VAT-inclusive line total into net + VAT. All money rounded to whole
// UGX (the till never prices in cents).
export function splitVat(gross, vatRate, pricesIncludeVat) {
  const g = Math.round(Number(gross) || 0);
  const rate = Math.min(100, Math.max(0, Number(vatRate) || 0));
  if (!rate || !g) return { net: g, tax: 0 };
  if (pricesIncludeVat) {
    const net = Math.round(g / (1 + rate / 100));
    return { net, tax: g - net };
  }
  const tax = Math.round((g * rate) / 100);
  return { net: g, tax };
}

// Map one BOSS sale to a fiscal invoice payload. Pure function — unit tested.
export function buildInvoicePayload(sale, shop, cfg) {
  if (!sale || !Array.isArray(sale.items) || sale.items.length === 0) {
    throw new Error('Cannot fiscalise a sale with no items');
  }
  const lines = sale.items.map((it) => {
    const qty = Math.max(0, Number(it.qty) || 0);
    const gross = Math.round(Number(it.lineTotal) || 0);
    const { net, tax } = splitVat(gross, cfg.vatRate, cfg.pricesIncludeVat);
    const desc = it.variantLabel ? `${it.productName} — ${it.variantLabel}` : String(it.productName || 'Item');
    return {
      code: goodsCodeFor(it.productId, cfg.goodsPrefix),
      desc: desc.slice(0, 120),
      qty,
      unitPrice: qty ? Math.round(gross / qty) : gross,
      gross,
      net,
      tax,
      taxRate: cfg.vatRate,
    };
  });
  const grossTotal = lines.reduce((a, l) => a + l.gross, 0);
  const netTotal = lines.reduce((a, l) => a + l.net, 0);
  const taxTotal = lines.reduce((a, l) => a + l.tax, 0);
  const discount = Math.max(0, Math.round(Number(sale.discount) || 0));
  return {
    currency: 'UGX',
    mode: cfg.mode,
    seller: {
      tin: cfg.tin,
      name: clean(shop?.shopName, 120) || 'Shop',
      branch: cfg.branchCode,
      deviceNo: cfg.deviceNo,
    },
    invoice: {
      ref: String(sale.orderNumber || sale.id),
      saleId: sale.id,
      issuedAt: new Date().toISOString(),
    },
    buyer: sale.customerName ? { name: clean(sale.customerName, 120) } : null,
    lines,
    totals: {
      gross: grossTotal,
      discount,
      net: Math.max(0, netTotal - discount),
      tax: taxTotal,
      payable: Math.max(0, (sale.total ?? grossTotal - discount)),
    },
    payment: sale.paymentMethod || 'Cash',
    staff: sale.staffName || null,
  };
}

function hashRef(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).toUpperCase().padStart(7, '0');
}

// Total VAT across sale lines at the configured rate. Used to stamp
// sale.tax automatically so tax balances itself — no till math needed.
export function saleVatTotal(items, cfg) {
  if (!cfg || !(Number(cfg.vatRate) > 0)) return 0;
  return (items || []).reduce(
    (a, it) => a + splitVat(Number(it.lineTotal) || 0, cfg.vatRate, cfg.pricesIncludeVat).tax,
    0,
  );
}

// Simulated URA response for sandbox mode. Shape mirrors what a provider
// returns so switching to live changes nothing downstream.
export function simulateSandbox(payload) {
  const ref = payload?.invoice?.ref || 'sale';
  const stamp = hashRef(`${ref}|${payload?.totals?.payable}|${payload?.seller?.tin}`);
  return {
    invoiceNo: `TEST-${stamp}`,
    fdn: `FDN-SANDBOX-${stamp}`,
    verifyCode: `VFY-${stamp.slice(0, 4)}-${stamp.slice(4)}`,
    qr: `EFRIS-SANDBOX|${stamp}|${payload?.totals?.payable ?? 0}|UGX`,
  };
}

// POST the payload to the shop's fiscalisation endpoint. Providers differ,
// so we accept several common response shapes and normalise them.
export async function sendToProvider(payload, { base, token, timeoutMs = 12000 }) {
  if (!base) throw new Error('EFRIS provider URL is not configured');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    let body = {};
    try {
      body = await res.json();
    } catch {
      throw new Error(`Provider returned non-JSON (HTTP ${res.status})`);
    }
    if (!res.ok) {
      const msg = body?.status?.returnMessage || body?.error || body?.message || `HTTP ${res.status}`;
      throw new Error(`Provider rejected invoice: ${msg}`);
    }
    const d = body?.data || body || {};
    const invoiceNo = d.invoiceNo || d.invoiceNumber || d.fiscalInvoiceNo;
    const fdn = d.fdn || d.fiscalDocumentNumber || d.fiscalCode;
    if (!invoiceNo || !fdn) throw new Error('Provider response missing invoice number / fiscal number');
    return {
      invoiceNo: String(invoiceNo),
      fdn: String(fdn),
      verifyCode: String(d.verifyCode || d.verificationCode || ''),
      qr: String(d.qr || d.qrCode || d.qrPayload || ''),
    };
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('Provider timed out — invoice kept as failed, retry later');
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(t);
  }
}
