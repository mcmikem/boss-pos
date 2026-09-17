// Products CSV import: a shop's stock list already exists in Excel, a
// supplier sheet, or a previous export — typing it row by row is the biggest
// onboarding tax. Accepts our own export header plus common aliases; every
// rejected row is reported with its line number instead of silently dropped.

export interface ImportProduct {
  name: string;
  category: string;
  cost: number;
  price: number;
  stockQty: number;
  lowStockThreshold: number;
  expiryDate?: string;
  barcode?: string;
}

export interface ImportResult {
  products: ImportProduct[];
  errors: string[];
  totalRows: number;
}

export const MAX_IMPORT_ROWS = 2000;
const MAX_ERRORS = 20;

export const PRODUCTS_TEMPLATE =
  'name,category,cost,price,stock,low_threshold,expiry,barcode\n' +
  'Sugar 1kg,Groceries,4500,5000,20,5,,\n' +
  'Chapati,Eatery,500,1000,0,5,,\n';

// Minimal RFC-4180 reader: quoted fields, "" escapes, commas and newlines
// inside quotes, CRLF line endings. Never throws — returns what it can.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let hasData = false;
  const src = String(text || '').replace(/^\uFEFF/, '');
  const pushField = () => { row.push(field); field = ''; hasData = true; };
  const pushRow = () => {
    if (hasData) rows.push(row);
    row = [];
    hasData = false;
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
      hasData = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\r') {
      // wait for \n
    } else if (c === '\n') {
      pushField();
      pushRow();
    } else field += c;
  }
  pushField();
  pushRow();
  // Drop fully-blank rows (trailing newline, spacer lines in Excel).
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

function norm(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

const HEADER_ALIASES: Record<string, string> = {
  name: 'name', item: 'name', product: 'name', productname: 'name', description: 'name',
  category: 'category', cat: 'category', dept: 'category', department: 'category', group: 'category',
  cost: 'cost', unitcost: 'cost', buy: 'cost', buyprice: 'cost', costprice: 'cost',
  price: 'price', unitprice: 'price', sell: 'price', sellprice: 'price', retail: 'price',
  retailprice: 'price', sellingprice: 'price', selling: 'price',
  stock: 'stock', stockqty: 'stock', qty: 'stock', quantity: 'stock', balance: 'stock', onhand: 'stock',
  lowthreshold: 'low_threshold', threshold: 'low_threshold', reorder: 'low_threshold',
  reorderlevel: 'low_threshold', min: 'low_threshold', minimum: 'low_threshold',
  expiry: 'expiry', expirydate: 'expiry', exp: 'expiry', expires: 'expiry',
  barcode: 'barcode', bar: 'barcode', code: 'barcode', sku: 'barcode',
};

function num(v: string | undefined): number {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function parseProductsCsv(text: string, fallbackCategory: string): ImportResult {
  const errors: string[] = [];
  const products: ImportProduct[] = [];
  const rows = parseCsv(text);
  if (rows.length === 0) return { products, errors: ['File is empty — download the template to see the format.'], totalRows: 0 };

  const head = rows[0].map(norm);
  const col: Record<string, number> = {};
  head.forEach((h, i) => {
    const key = HEADER_ALIASES[h];
    if (key && col[key] === undefined) col[key] = i;
  });
  if (col.name === undefined || (col.price === undefined && col.cost === undefined && col.stock === undefined)) {
    return {
      products,
      errors: ['First row should be headings like: name,category,cost,price,stock,low_threshold — download the template.'],
      totalRows: rows.length - 1,
    };
  }

  const dataRows = rows.slice(1, MAX_IMPORT_ROWS + 1);
  if (rows.length - 1 > MAX_IMPORT_ROWS) {
    errors.push(`Only the first ${MAX_IMPORT_ROWS.toLocaleString()} rows were read — split bigger lists.`);
  }
  dataRows.forEach((r, idx) => {
    const line = idx + 2;
    const name = (r[col.name] || '').trim();
    if (!name) {
      if (errors.length < MAX_ERRORS) errors.push(`Row ${line}: no name — skipped.`);
      return;
    }
    const price = num(r[col.price]);
    const cost = num(r[col.cost]);
    if (price <= 0 && cost <= 0) {
      if (errors.length < MAX_ERRORS) errors.push(`Row ${line} ("${name.slice(0, 30)}"): no price or cost — skipped.`);
      return;
    }
    const expiryRaw = (r[col.expiry] || '').trim();
    const item: ImportProduct = {
      name: name.slice(0, 120),
      category: ((r[col.category] || '').trim() || fallbackCategory || 'General').slice(0, 60),
      cost: Math.round(cost * 100) / 100,
      price: Math.round((price > 0 ? price : cost) * 100) / 100,
      stockQty: Math.round(num(r[col.stock]) * 1000) / 1000,
      lowStockThreshold: Math.round(num(r[col.low_threshold] ?? '5') * 1000) / 1000 || 5,
    };
    if (/^\d{4}-\d{2}-\d{2}$/.test(expiryRaw)) item.expiryDate = expiryRaw;
    const barcode = (r[col.barcode] || '').trim();
    if (barcode) item.barcode = barcode.slice(0, 60);
    products.push(item);
  });
  return { products, errors: errors.slice(0, MAX_ERRORS), totalRows: rows.length - 1 };
}
