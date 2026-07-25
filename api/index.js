import express from 'express';
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json({ limit: '10mb' }));

const isVercel = !!process.env.VERCEL;
const dbPath = isVercel ? join('/tmp', 'pos.db') : join(__dirname, '..', 'pos.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
    cost REAL DEFAULT 0, price REAL DEFAULT 0, stockQty INTEGER DEFAULT 0,
    lowStockThreshold INTEGER DEFAULT 5, supplierId TEXT,
    isService INTEGER DEFAULT 0, imei TEXT, barcode TEXT
  );
  CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    contactPerson TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY, orderNumber TEXT NOT NULL, timestamp TEXT NOT NULL,
    items TEXT NOT NULL, subtotal REAL DEFAULT 0, tax REAL DEFAULT 0,
    total REAL DEFAULT 0, paymentMethod TEXT DEFAULT 'Cash',
    customerName TEXT, discount REAL, notes TEXT
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, description TEXT NOT NULL,
    amount REAL DEFAULT 0, category TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL
  );
`);

function seedDatabase() {
  const count = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  if (count > 0) return;

  const suppliers = [
    { id: 'sup-1', name: 'Kampala Wholesalers Ltd', contactPerson: 'Kato James', phone: '+256 772 123456', email: 'kato@kwl.com' },
    { id: 'sup-2', name: 'City Printing Hub', contactPerson: 'Sarah Nakato', phone: '+256 701 987654', email: 'sarah@cityprint.com' },
    { id: 'sup-3', name: 'Prime Textiles', contactPerson: 'Emmanuel Okeke', phone: '+256 703 111 2222', email: 'emmanuel@primetextiles.com' },
    { id: 'sup-4', name: 'Megatech Electronics', contactPerson: 'Peter Wasswa', phone: '+256 755 333444', email: 'peter@megatech.co.ug' },
    { id: 'sup-5', name: 'Fresh Foods Supply', contactPerson: 'Grace Nambi', phone: '+256 782 555666', email: 'grace@freshfoods.ug' },
  ];
  const insertSup = db.prepare('INSERT INTO suppliers (id,name,contactPerson,phone,email) VALUES (?,?,?,?,?)');
  for (const s of suppliers) insertSup.run(s.id, s.name, s.contactPerson, s.phone, s.email);

  const defaultSettings = { shopName:'IMAC Enterprises', themeId:'gold', vibe:'General Store', defaultPaymentMethod:'Cash', dailyGoalNum:'10' };
  const insertSetting = db.prepare('INSERT INTO settings (key,value) VALUES (?,?)');
  for (const [k,v] of Object.entries(defaultSettings)) insertSetting.run(k,v);
}
seedDatabase();

// === PRODUCTS API ===
app.get('/api/products', (req, res) => {
  const rows = db.prepare('SELECT * FROM products').all();
  res.json(rows.map(r => ({ ...r, isService: !!r.isService })));
});

app.post('/api/products', (req, res) => {
  const p = req.body;
  db.prepare('INSERT INTO products (id,name,category,cost,price,stockQty,lowStockThreshold,supplierId,isService,imei,barcode) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(p.id,p.name,p.category,p.cost||0,p.price||0,p.stockQty||0,p.lowStockThreshold||5,p.supplierId||null,p.isService?1:0,p.imei||null,p.barcode||null);
  res.json({ ...p, isService: !!p.isService });
});

app.put('/api/products/:id', (req, res) => {
  const p = req.body;
  db.prepare('UPDATE products SET name=?,category=?,cost=?,price=?,stockQty=?,lowStockThreshold=?,supplierId=?,isService=?,imei=?,barcode=? WHERE id=?')
    .run(p.name,p.category,p.cost||0,p.price||0,p.stockQty||0,p.lowStockThreshold||5,p.supplierId||null,p.isService?1:0,p.imei||null,p.barcode||null,req.params.id);
  res.json({ ...p, isService: !!p.isService });
});

app.delete('/api/products/:id', (req, res) => {
  db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// === SUPPLIERS API ===
app.get('/api/suppliers', (req, res) => {
  res.json(db.prepare('SELECT * FROM suppliers').all());
});

app.post('/api/suppliers', (req, res) => {
  const s = req.body;
  db.prepare('INSERT INTO suppliers (id,name,contactPerson,phone,email) VALUES (?,?,?,?,?)')
    .run(s.id,s.name,s.contactPerson||'',s.phone||'',s.email||'');
  res.json(s);
});

app.put('/api/suppliers/:id', (req, res) => {
  const s = req.body;
  db.prepare('UPDATE suppliers SET name=?,contactPerson=?,phone=?,email=? WHERE id=?')
    .run(s.name,s.contactPerson||'',s.phone||'',s.email||'',req.params.id);
  res.json(s);
});

app.delete('/api/suppliers/:id', (req, res) => {
  db.prepare('DELETE FROM suppliers WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// === SALES API ===
app.get('/api/sales', (req, res) => {
  const rows = db.prepare('SELECT * FROM sales ORDER BY timestamp DESC').all();
  res.json(rows.map(r => ({ ...r, items: JSON.parse(r.items) })));
});

app.post('/api/sales', (req, res) => {
  const s = req.body;
  const itemsJson = JSON.stringify(s.items);
  db.prepare('INSERT INTO sales (id,orderNumber,timestamp,items,subtotal,tax,total,paymentMethod,customerName,discount,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(s.id,s.orderNumber,s.timestamp,itemsJson,s.subtotal||0,s.tax||0,s.total||0,s.paymentMethod||'Cash',s.customerName||null,s.discount||null,s.notes||null);
  for (const item of s.items) {
    const prod = db.prepare('SELECT * FROM products WHERE id=?').get(item.productId);
    if (prod && !prod.isService) db.prepare('UPDATE products SET stockQty = MAX(0, stockQty - ?) WHERE id=?').run(item.qty, item.productId);
  }
  res.json(s);
});

app.delete('/api/sales/:id', (req, res) => {
  const sale = db.prepare('SELECT * FROM sales WHERE id=?').get(req.params.id);
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  const items = JSON.parse(sale.items);
  for (const item of items) {
    const prod = db.prepare('SELECT * FROM products WHERE id=?').get(item.productId);
    if (prod && !prod.isService) db.prepare('UPDATE products SET stockQty = stockQty + ? WHERE id=?').run(item.qty, item.productId);
  }
  db.prepare('DELETE FROM sales WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// === EXPENSES API ===
app.get('/api/expenses', (req, res) => {
  res.json(db.prepare('SELECT * FROM expenses ORDER BY timestamp DESC').all());
});

app.post('/api/expenses', (req, res) => {
  const e = req.body;
  db.prepare('INSERT INTO expenses (id,timestamp,description,amount,category) VALUES (?,?,?,?,?)')
    .run(e.id,e.timestamp,e.description,e.amount,e.category||'');
  res.json(e);
});

app.delete('/api/expenses/:id', (req, res) => {
  db.prepare('DELETE FROM expenses WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// === SETTINGS API ===
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const obj = {};
  for (const r of rows) {
    try { obj[r.key] = JSON.parse(r.value); } catch { obj[r.key] = r.value; }
  }
  res.json(obj);
});

app.put('/api/settings', (req, res) => {
  const upsert = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  for (const [k, v] of Object.entries(req.body)) upsert.run(k, typeof v === 'string' ? v : JSON.stringify(v));
  res.json({ success: true });
});

export default app;
