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

  const products = [
    { id:'prod-1',name:'Oppo A78 (Used)',category:'Electronics',cost:350000,price:450000,stockQty:5,lowStockThreshold:2,supplierId:'sup-4' },
    { id:'prod-2',name:'Samsung Galaxy A14',category:'Electronics',cost:380000,price:480000,stockQty:4,lowStockThreshold:1,supplierId:'sup-4' },
    { id:'prod-3',name:'Phone Charger (Micro USB)',category:'Electronics',cost:5000,price:12000,stockQty:40,lowStockThreshold:8,supplierId:'sup-4' },
    { id:'prod-4',name:'Phone Charger (USB-C)',category:'Electronics',cost:6000,price:15000,stockQty:35,lowStockThreshold:8,supplierId:'sup-4' },
    { id:'prod-5',name:'Phone Charger (Lightning)',category:'Electronics',cost:8000,price:20000,stockQty:15,lowStockThreshold:4,supplierId:'sup-4' },
    { id:'prod-6',name:'Wired Earphones (In-Ear)',category:'Electronics',cost:5000,price:15000,stockQty:30,lowStockThreshold:6,supplierId:'sup-4' },
    { id:'prod-7',name:'Bluetooth Earphones (TWS)',category:'Electronics',cost:25000,price:55000,stockQty:15,lowStockThreshold:3,supplierId:'sup-4' },
    { id:'prod-8',name:'Power Bank (10000mAh)',category:'Electronics',cost:30000,price:65000,stockQty:12,lowStockThreshold:3,supplierId:'sup-4' },
    { id:'prod-9',name:'Screen Protector (Tempered Glass)',category:'Electronics',cost:2000,price:8000,stockQty:80,lowStockThreshold:15,supplierId:'sup-4' },
    { id:'prod-10',name:'Phone Case (Silicone)',category:'Electronics',cost:4000,price:12000,stockQty:50,lowStockThreshold:10,supplierId:'sup-4' },
    { id:'prod-11',name:'USB Cable (Braided 2m)',category:'Electronics',cost:6000,price:15000,stockQty:30,lowStockThreshold:6,supplierId:'sup-4' },
    { id:'prod-12',name:'Memory Card (64GB)',category:'Electronics',cost:25000,price:55000,stockQty:20,lowStockThreshold:4,supplierId:'sup-4' },
    { id:'prod-13',name:'Bluetooth Speaker',category:'Electronics',cost:30000,price:70000,stockQty:10,lowStockThreshold:2,supplierId:'sup-4' },
    { id:'prod-14',name:'Flash Disk (32GB)',category:'Electronics',cost:20000,price:45000,stockQty:15,lowStockThreshold:3,supplierId:'sup-4' },
    { id:'prod-20',name:'Double Egg Rolex',category:'Eatery',cost:1800,price:3500,stockQty:50,lowStockThreshold:10,supplierId:'sup-5' },
    { id:'prod-21',name:'Single Egg Rolex',category:'Eatery',cost:1200,price:2500,stockQty:40,lowStockThreshold:10,supplierId:'sup-5' },
    { id:'prod-22',name:'Plain Chapati',category:'Eatery',cost:500,price:1500,stockQty:80,lowStockThreshold:15,supplierId:'sup-5' },
    { id:'prod-23',name:'Samosa (Beef, 3pcs)',category:'Eatery',cost:1200,price:3000,stockQty:40,lowStockThreshold:8,supplierId:'sup-5' },
    { id:'prod-24',name:'Soda (Glass Bottle)',category:'Eatery',cost:1200,price:2000,stockQty:60,lowStockThreshold:15,supplierId:'sup-5' },
    { id:'prod-25',name:'Bottled Water (500ml)',category:'Eatery',cost:700,price:1500,stockQty:100,lowStockThreshold:20,supplierId:'sup-5' },
    { id:'prod-26',name:'African Milk Tea',category:'Eatery',cost:700,price:2000,stockQty:40,lowStockThreshold:8,supplierId:'sup-5' },
    { id:'prod-27',name:'Fresh Juice (Passion)',category:'Eatery',cost:2000,price:4000,stockQty:25,lowStockThreshold:5,supplierId:'sup-5' },
    { id:'prod-28',name:'Crisps (Packet)',category:'Eatery',cost:1500,price:3000,stockQty:50,lowStockThreshold:10,supplierId:'sup-5' },
    { id:'prod-29',name:'Biscuits (Assorted)',category:'Eatery',cost:500,price:1500,stockQty:60,lowStockThreshold:12,supplierId:'sup-5' },
    { id:'prod-30',name:'Exercise Book (200pg)',category:'Stationery',cost:2000,price:4000,stockQty:100,lowStockThreshold:20,supplierId:'sup-2' },
    { id:'prod-31',name:'BIC Pen (Blue/Black)',category:'Stationery',cost:500,price:1500,stockQty:200,lowStockThreshold:30,supplierId:'sup-2' },
    { id:'prod-32',name:'Pencil (HB)',category:'Stationery',cost:300,price:1000,stockQty:150,lowStockThreshold:25,supplierId:'sup-2' },
    { id:'prod-33',name:'Ruler (30cm)',category:'Stationery',cost:1000,price:3000,stockQty:40,lowStockThreshold:8,supplierId:'sup-2' },
    { id:'prod-34',name:'Glue Stick',category:'Stationery',cost:1500,price:4000,stockQty:30,lowStockThreshold:6,supplierId:'sup-2' },
    { id:'prod-35',name:'Notebook (A5)',category:'Stationery',cost:3000,price:7000,stockQty:50,lowStockThreshold:10,supplierId:'sup-2' },
    { id:'prod-36',name:'Marker Pen (Permanent)',category:'Stationery',cost:1500,price:4000,stockQty:35,lowStockThreshold:7,supplierId:'sup-2' },
    { id:'prod-40',name:'Photocopy (B&W Page)',category:'Printing',cost:50,price:300,stockQty:500,lowStockThreshold:100,supplierId:'sup-2' },
    { id:'prod-41',name:'Color Printing (A4)',category:'Printing',cost:500,price:1500,stockQty:200,lowStockThreshold:30,supplierId:'sup-2' },
    { id:'prod-42',name:'Lamination (A4)',category:'Printing',cost:1000,price:3000,stockQty:40,lowStockThreshold:8,supplierId:'sup-2' },
    { id:'prod-43',name:'Spiral Binding',category:'Printing',cost:2000,price:5000,stockQty:30,lowStockThreshold:5,supplierId:'sup-2' },
    { id:'prod-44',name:'Passport Photos',category:'Printing',cost:1500,price:5000,stockQty:9999,lowStockThreshold:0,isService:1,supplierId:'sup-2' },
    { id:'prod-50',name:'Trouser Hemming',category:'Tailoring',cost:2000,price:8000,stockQty:9999,lowStockThreshold:0,isService:1,supplierId:'sup-3' },
    { id:'prod-51',name:'Zip Replacement',category:'Tailoring',cost:2000,price:7000,stockQty:9999,lowStockThreshold:0,isService:1,supplierId:'sup-3' },
    { id:'prod-52',name:'Kitenge Dress (Custom)',category:'Tailoring',cost:18000,price:45000,stockQty:10,lowStockThreshold:2,supplierId:'sup-3' },
    { id:'prod-53',name:'School Uniform (Full)',category:'Tailoring',cost:20000,price:35000,stockQty:8,lowStockThreshold:2,supplierId:'sup-3' },
    { id:'prod-54',name:"Men's Shirt (Fitted)",category:'Tailoring',cost:15000,price:35000,stockQty:8,lowStockThreshold:2,supplierId:'sup-3' },
    { id:'prod-60',name:'Movie Download',category:'Library',cost:3000,price:7000,stockQty:9999,lowStockThreshold:0,isService:1,supplierId:'sup-5' },
    { id:'prod-61',name:'Music Download',category:'Library',cost:1000,price:3000,stockQty:9999,lowStockThreshold:0,isService:1,supplierId:'sup-5' },
    { id:'prod-62',name:'Software Install',category:'Library',cost:5000,price:15000,stockQty:9999,lowStockThreshold:0,isService:1,supplierId:'sup-5' },
    { id:'prod-63',name:'Karaoke Track',category:'Library',cost:1000,price:3000,stockQty:9999,lowStockThreshold:0,isService:1,supplierId:'sup-5' },
    { id:'prod-64',name:'Audio Recording (per hr)',category:'Library',cost:25000,price:60000,stockQty:9999,lowStockThreshold:0,isService:1,supplierId:'sup-5' },
    { id:'prod-70',name:'Soccer Ball (Size 5)',category:'Sports',cost:28000,price:50000,stockQty:8,lowStockThreshold:2,supplierId:'sup-1' },
    { id:'prod-71',name:'Skipping Rope',category:'Sports',cost:5000,price:12000,stockQty:15,lowStockThreshold:3,supplierId:'sup-1' },
    { id:'prod-72',name:'Whistle (Referee)',category:'Sports',cost:3000,price:8000,stockQty:20,lowStockThreshold:4,supplierId:'sup-1' },
    { id:'prod-80',name:'Logo Design (Basic)',category:'Graphics',cost:30000,price:80000,stockQty:9999,lowStockThreshold:0,isService:1,supplierId:'sup-2' },
    { id:'prod-81',name:'Flyer Design (A5)',category:'Graphics',cost:15000,price:45000,stockQty:9999,lowStockThreshold:0,isService:1,supplierId:'sup-2' },
    { id:'prod-82',name:'Business Cards (100pcs)',category:'Graphics',cost:15000,price:40000,stockQty:20,lowStockThreshold:3,supplierId:'sup-2' },
    { id:'prod-83',name:'PVC Banner (per sq m)',category:'Graphics',cost:12000,price:25000,stockQty:30,lowStockThreshold:5,supplierId:'sup-2' },
  ];
  const insertProd = db.prepare('INSERT INTO products (id,name,category,cost,price,stockQty,lowStockThreshold,supplierId,isService,imei,barcode) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  for (const p of products) insertProd.run(p.id,p.name,p.category,p.cost,p.price,p.stockQty,p.lowStockThreshold,p.supplierId||null,p.isService||0,p.imei||null,p.barcode||null);

  const expenses = [
    { id:'exp-1',timestamp:'2026-07-15T08:30:00Z',description:'Phone accessories restock',amount:85000,category:'Stock Purchase' },
    { id:'exp-2',timestamp:'2026-07-15T10:15:00Z',description:'Electricity (Yaka tokens)',amount:15000,category:'Utilities' },
    { id:'exp-3',timestamp:'2026-07-14T14:00:00Z',description:'Food supplies for eatery',amount:45000,category:'Stock Purchase' },
    { id:'exp-4',timestamp:'2026-07-15T12:00:00Z',description:'Shop rent (monthly)',amount:200000,category:'Rent' },
    { id:'exp-5',timestamp:'2026-07-14T09:15:00Z',description:'Printer ink refill',amount:25000,category:'Supplies' },
  ];
  const insertExp = db.prepare('INSERT INTO expenses (id,timestamp,description,amount,category) VALUES (?,?,?,?,?)');
  for (const e of expenses) insertExp.run(e.id,e.timestamp,e.description,e.amount,e.category);

  const sales = [
    { id:'sale-1',orderNumber:'Order #8492',timestamp:'2026-07-15T11:10:00+03:00',items:JSON.stringify([{productId:'prod-4',productName:'Phone Charger (USB-C)',qty:1,unitPrice:15000,unitCost:6000,lineTotal:15000},{productId:'prod-7',productName:'Bluetooth Earphones (TWS)',qty:1,unitPrice:55000,unitCost:25000,lineTotal:55000}]),subtotal:70000,tax:0,total:70000,paymentMethod:'MTN MoMo' },
    { id:'sale-2',orderNumber:'Order #8491',timestamp:'2026-07-15T09:45:00+03:00',items:JSON.stringify([{productId:'prod-20',productName:'Double Egg Rolex',qty:2,unitPrice:3500,unitCost:1800,lineTotal:7000},{productId:'prod-24',productName:'Soda (Glass Bottle)',qty:2,unitPrice:2000,unitCost:1200,lineTotal:4000}]),subtotal:11000,tax:0,total:11000,paymentMethod:'Cash' },
    { id:'sale-3',orderNumber:'Order #8490',timestamp:'2026-07-15T08:30:00+03:00',items:JSON.stringify([{productId:'prod-10',productName:'Phone Case (Silicone)',qty:2,unitPrice:12000,unitCost:4000,lineTotal:24000},{productId:'prod-62',productName:'Charging Port Repair',qty:1,unitPrice:30000,unitCost:10000,lineTotal:30000}]),subtotal:54000,tax:0,total:54000,paymentMethod:'Cash' },
  ];
  const insertSale = db.prepare('INSERT INTO sales (id,orderNumber,timestamp,items,subtotal,tax,total,paymentMethod,customerName,discount,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  for (const s of sales) insertSale.run(s.id,s.orderNumber,s.timestamp,s.items,s.subtotal,s.tax,s.total,s.paymentMethod,s.customerName||null,s.discount||null,s.notes||null);

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
