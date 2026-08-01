import express from 'express';
import { neon } from '@neondatabase/serverless';
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

const app = express();
app.use(express.json({ limit: '10mb' }));

const DATABASE_URL = process.env.DATABASE_URL;
const sql = neon(DATABASE_URL, { connectionTimeoutMillis: 30000 });

function asHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

async function initDB() {
  await sql`CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
    cost DOUBLE PRECISION DEFAULT 0, price DOUBLE PRECISION DEFAULT 0,
    stockqty INTEGER DEFAULT 0, lowstockthreshold INTEGER DEFAULT 5,
    supplierid TEXT, isservice BOOLEAN DEFAULT false,
    imei TEXT, barcode TEXT, imageurl TEXT, variants TEXT
  )`;
  try { await sql`ALTER TABLE products ADD COLUMN imageurl TEXT`; } catch {}
  try { await sql`ALTER TABLE products ADD COLUMN variants TEXT`; } catch {}
  await sql`CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    contactperson TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT ''
  )`;
  await sql`CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY, ordernumber TEXT NOT NULL, timestamp TEXT NOT NULL,
    items TEXT NOT NULL, subtotal DOUBLE PRECISION DEFAULT 0,
    tax DOUBLE PRECISION DEFAULT 0, total DOUBLE PRECISION DEFAULT 0,
    paymentmethod TEXT DEFAULT 'Cash', customername TEXT,
    discount DOUBLE PRECISION, notes TEXT
  )`;
  await sql`CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, description TEXT NOT NULL,
    amount DOUBLE PRECISION DEFAULT 0, category TEXT DEFAULT ''
  )`;
  await sql`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS credit_payments (
    id TEXT PRIMARY KEY, saleid TEXT NOT NULL,
    amount DOUBLE PRECISION NOT NULL,
    createdat TEXT NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS tailoring_orders (
    id TEXT PRIMARY KEY, customername TEXT NOT NULL, customerphone TEXT DEFAULT '',
    orderdate TEXT NOT NULL, expecteddate TEXT NOT NULL, completeddate TEXT,
    worktype TEXT NOT NULL, workdescription TEXT NOT NULL,
    totalamount DOUBLE PRECISION DEFAULT 0, depositpaid DOUBLE PRECISION DEFAULT 0,
    materialcost DOUBLE PRECISION DEFAULT 0,
    status TEXT DEFAULT 'pending', notes TEXT DEFAULT '',
    measurements TEXT DEFAULT '', createdat TEXT NOT NULL
  )`;
  try { await sql`ALTER TABLE tailoring_orders ADD COLUMN measurements TEXT DEFAULT ''`; } catch {}
  try { await sql`ALTER TABLE tailoring_orders ADD COLUMN materialcost DOUBLE PRECISION DEFAULT 0`; } catch {}
  await sql`CREATE TABLE IF NOT EXISTS cash_transfers (
    id TEXT PRIMARY KEY, fromcategory TEXT NOT NULL, tocategory TEXT NOT NULL,
    amount DOUBLE PRECISION NOT NULL, reason TEXT DEFAULT '', createdat TEXT NOT NULL,
    settledat TEXT
  )`;
  try { await sql`ALTER TABLE sales ADD COLUMN refunded BOOLEAN DEFAULT false`; } catch {}
  try { await sql`ALTER TABLE sales ADD COLUMN refundedat TEXT`; } catch {}
}

function escapeId(id) {
  return '"' + id.replace(/"/g, '""') + '"';
}

async function batchInsert(table, columns, rows) {
  if (rows.length === 0) return;
  const cols = columns.map(c => escapeId(c)).join(',');
  const vals = rows.map((_, i) =>
    '(' + columns.map((_, j) => '$' + (i * columns.length + j + 1)).join(',') + ')'
  ).join(',');
  const flat = rows.flatMap(r => columns.map(c => r[c] != null ? r[c] : null));
  await sql.query(`INSERT INTO ${escapeId(table)} (${cols}) VALUES ${vals}`, flat);
}

async function seedDatabase() {
  const result = await sql`SELECT COUNT(*)::int as count FROM products`;
  if (result[0].count > 0) return;

  const suppliers = [
    { id: 'sup-1', name: 'Kampala Wholesalers Ltd', contactPerson: 'Kato James', phone: '+256 772 123456', email: 'kato@kwl.com' },
    { id: 'sup-2', name: 'City Printing Hub', contactPerson: 'Sarah Nakato', phone: '+256 701 987654', email: 'sarah@cityprint.com' },
    { id: 'sup-3', name: 'Prime Textiles', contactPerson: 'Emmanuel Okeke', phone: '+256 703 111 2222', email: 'emmanuel@primetextiles.com' },
    { id: 'sup-4', name: 'Megatech Electronics', contactPerson: 'Peter Wasswa', phone: '+256 755 333444', email: 'peter@megatech.co.ug' },
    { id: 'sup-5', name: 'Fresh Foods Supply', contactPerson: 'Grace Nambi', phone: '+256 782 555666', email: 'grace@freshfoods.ug' },
  ];
  await batchInsert('suppliers', ['id','name','contactperson','phone','email'], suppliers);

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
    { id:'prod-44',name:'Passport Photos',category:'Printing',cost:1500,price:5000,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-2' },
    { id:'prod-50',name:'Trouser Hemming',category:'Tailoring',cost:2000,price:8000,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-3' },
    { id:'prod-51',name:'Zip Replacement',category:'Tailoring',cost:2000,price:7000,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-3' },
    { id:'prod-52',name:'Kitenge Dress (Custom)',category:'Tailoring',cost:18000,price:45000,stockQty:10,lowStockThreshold:2,supplierId:'sup-3' },
    { id:'prod-53',name:'School Uniform (Full)',category:'Tailoring',cost:20000,price:35000,stockQty:8,lowStockThreshold:2,supplierId:'sup-3' },
    { id:'prod-54',name:'Men\'s Shirt (Fitted)',category:'Tailoring',cost:15000,price:35000,stockQty:8,lowStockThreshold:2,supplierId:'sup-3' },
    { id:'prod-55',name:'Work/Corporate Uniform',category:'Tailoring',cost:25000,price:50000,stockQty:5,lowStockThreshold:2,supplierId:'sup-3' },
    { id:'prod-60',name:'Movie Download',category:'Library',cost:200,price:500,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-5' },
    { id:'prod-61',name:'Music Download (per song)',category:'Library',cost:100,price:250,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-5' },
    { id:'prod-62',name:'Android App (Basic)',category:'Library',cost:200,price:500,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-5' },
    { id:'prod-63',name:'Android App (Premium)',category:'Library',cost:400,price:1000,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-5' },
    { id:'prod-64',name:'Windows Software (Basic)',category:'Library',cost:1000,price:2000,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-5' },
    { id:'prod-65',name:'Windows Software (Pro)',category:'Library',cost:1500,price:3000,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-5' },
    { id:'prod-66',name:'Document Scanning (per page)',category:'Library',cost:200,price:500,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-5' },
    { id:'prod-67',name:'Internet Browsing (per 30min)',category:'Library',cost:300,price:1000,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-5' },
    { id:'prod-70',name:'Soccer Ball (Size 5)',category:'Sports',cost:28000,price:50000,stockQty:8,lowStockThreshold:2,supplierId:'sup-1' },
    { id:'prod-71',name:'Skipping Rope',category:'Sports',cost:5000,price:12000,stockQty:15,lowStockThreshold:3,supplierId:'sup-1' },
    { id:'prod-72',name:'Whistle (Referee)',category:'Sports',cost:3000,price:8000,stockQty:20,lowStockThreshold:4,supplierId:'sup-1' },
    { id:'prod-80',name:'Logo Design (Basic)',category:'Graphics',cost:30000,price:80000,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-2' },
    { id:'prod-81',name:'Flyer Design (A5)',category:'Graphics',cost:15000,price:45000,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-2' },
    { id:'prod-82',name:'Business Cards (100pcs)',category:'Graphics',cost:15000,price:40000,stockQty:20,lowStockThreshold:3,supplierId:'sup-2' },
    { id:'prod-83',name:'PVC Banner (per sq m)',category:'Graphics',cost:12000,price:25000,stockQty:30,lowStockThreshold:5,supplierId:'sup-2' },
    { id:'prod-90',name:'Jersey (Standard)',category:'Tailoring',cost:10000,price:15000,stockQty:20,lowStockThreshold:3,supplierId:'sup-1' },
    { id:'prod-91',name:'Jersey (Premium)',category:'Tailoring',cost:10000,price:17000,stockQty:15,lowStockThreshold:3,supplierId:'sup-1' },
    { id:'prod-92',name:'T-Shirt (Standard)',category:'Tailoring',cost:10000,price:15000,stockQty:25,lowStockThreshold:5,supplierId:'sup-1' },
    { id:'prod-93',name:'T-Shirt (Premium)',category:'Tailoring',cost:10000,price:17000,stockQty:20,lowStockThreshold:5,supplierId:'sup-1' },
    { id:'prod-94',name:'Name Branding (Jersey/Shirt)',category:'Tailoring',cost:1000,price:4000,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-3' },
    { id:'prod-100',name:'Chappati',category:'Eatery',cost:250,price:500,stockQty:100,lowStockThreshold:20,supplierId:'sup-5' },
    { id:'prod-101',name:'Samosa / Sumbusa',category:'Eatery',cost:120,price:300,stockQty:120,lowStockThreshold:20,supplierId:'sup-5',
      variants:[{id:'v-single',label:'Single',price:300,cost:120},{id:'v-couple',label:'Couple / Pair',price:500,cost:250},{id:'v-big',label:'Big Size',price:500,cost:300}] },
    { id:'prod-102',name:'Egg Roll',category:'Eatery',cost:500,price:1000,stockQty:50,lowStockThreshold:10,supplierId:'sup-5' },
    { id:'prod-103',name:'Coconut Cookies',category:'Eatery',cost:200,price:500,stockQty:80,lowStockThreshold:15,supplierId:'sup-5',
      variants:[{id:'v-pair',label:'Pair',price:500,cost:200},{id:'v-plate',label:'Plate',price:2500,cost:1200}] },
    { id:'prod-104',name:'Shortbread Cookies',category:'Eatery',cost:250,price:500,stockQty:80,lowStockThreshold:15,supplierId:'sup-5',
      variants:[{id:'v-pair',label:'Pair',price:500,cost:250},{id:'v-plate',label:'Plate',price:2500,cost:1300}] },
    { id:'prod-105',name:'Sausage',category:'Eatery',cost:600,price:1000,stockQty:60,lowStockThreshold:12,supplierId:'sup-5' },
    { id:'prod-106',name:'Half Cake',category:'Eatery',cost:250,price:500,stockQty:30,lowStockThreshold:6,supplierId:'sup-5',
      variants:[{id:'v-small',label:'Small',price:500,cost:250},{id:'v-large',label:'Large',price:1000,cost:500}] },
    { id:'prod-107',name:'Meat Samosa',category:'Eatery',cost:550,price:1000,stockQty:60,lowStockThreshold:12,supplierId:'sup-5' },
    { id:'prod-108',name:'Black Tea',category:'Eatery',cost:150,price:500,stockQty:200,lowStockThreshold:30,supplierId:'sup-5' },
    { id:'prod-109',name:'Milk Tea',category:'Eatery',cost:400,price:1000,stockQty:150,lowStockThreshold:25,supplierId:'sup-5' },
    { id:'prod-110',name:'Cookies on a Plate',category:'Eatery',cost:1200,price:2500,stockQty:40,lowStockThreshold:8,supplierId:'sup-5' },
  ];
  await batchInsert('products', ['id','name','category','cost','price','stockqty','lowstockthreshold','supplierid','isservice','imei','barcode','variants'],
    products.map(p => ({ id: p.id, name: p.name, category: p.category, cost: p.cost, price: p.price, stockqty: p.stockQty, lowstockthreshold: p.lowStockThreshold, supplierid: p.supplierId || null, isservice: p.isService || false, imei: p.imei || null, barcode: p.barcode || null, variants: p.variants ? JSON.stringify(p.variants) : null })));

  const expenses = [
    { id:'exp-1',timestamp:'2026-07-15T08:30:00Z',description:'Phone accessories restock',amount:85000,category:'Stock Purchase' },
    { id:'exp-2',timestamp:'2026-07-15T10:15:00Z',description:'Electricity (Yaka tokens)',amount:15000,category:'Utilities' },
    { id:'exp-3',timestamp:'2026-07-14T14:00:00Z',description:'Food supplies for eatery',amount:45000,category:'Stock Purchase' },
    { id:'exp-4',timestamp:'2026-07-15T12:00:00Z',description:'Shop rent (monthly)',amount:200000,category:'Rent' },
    { id:'exp-5',timestamp:'2026-07-14T09:15:00Z',description:'Printer ink refill',amount:25000,category:'Supplies' },
  ];
  await batchInsert('expenses', ['id','timestamp','description','amount','category'], expenses);

  const sales = [
    { id:'sale-1',orderNumber:'Order #8492',timestamp:'2026-07-15T11:10:00+03:00',items:[{productId:'prod-4',productName:'Phone Charger (USB-C)',qty:1,unitPrice:15000,unitCost:6000,lineTotal:15000},{productId:'prod-7',productName:'Bluetooth Earphones (TWS)',qty:1,unitPrice:55000,unitCost:25000,lineTotal:55000}],subtotal:70000,tax:0,total:70000,paymentMethod:'MTN MoMo' },
    { id:'sale-2',orderNumber:'Order #8491',timestamp:'2026-07-15T09:45:00+03:00',items:[{productId:'prod-20',productName:'Double Egg Rolex',qty:2,unitPrice:3500,unitCost:1800,lineTotal:7000},{productId:'prod-24',productName:'Soda (Glass Bottle)',qty:2,unitPrice:2000,unitCost:1200,lineTotal:4000}],subtotal:11000,tax:0,total:11000,paymentMethod:'Cash' },
    { id:'sale-3',orderNumber:'Order #8490',timestamp:'2026-07-15T08:30:00+03:00',items:[{productId:'prod-10',productName:'Phone Case (Silicone)',qty:2,unitPrice:12000,unitCost:4000,lineTotal:24000},{productId:'prod-4',productName:'Phone Charger (USB-C)',qty:1,unitPrice:15000,unitCost:6000,lineTotal:15000}],subtotal:39000,tax:0,total:39000,paymentMethod:'Cash' },
  ];
  await batchInsert('sales', ['id','ordernumber','timestamp','items','subtotal','tax','total','paymentmethod','customername','discount','notes'],
    sales.map(s => ({ id: s.id, ordernumber: s.orderNumber, timestamp: s.timestamp, items: JSON.stringify(s.items), subtotal: s.subtotal, tax: s.tax, total: s.total, paymentmethod: s.paymentMethod, customername: s.customerName || null, discount: s.discount || null, notes: s.notes || null })));

  const defaultSettings = { shopName:'IMAC Enterprises', themeId:'gold', vibe:'General Store', defaultPaymentMethod:'Cash', dailyGoalNum:'10' };
  await batchInsert('settings', ['key','value'], Object.entries(defaultSettings).map(([k,v]) => ({ key: k, value: typeof v === 'string' ? v : JSON.stringify(v) })));
}

let initPromise = initDB().then(() => seedDatabase()).catch(err => {
  console.error('Database initialization failed:', err);
});

async function syncLibraryProducts() {
  const libraryProducts = [
    { id:'prod-60',name:'Movie Download',category:'Library',cost:200,price:500,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-5' },
    { id:'prod-61',name:'Music Download (per song)',category:'Library',cost:100,price:250,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-5' },
    { id:'prod-62',name:'Android App (Basic)',category:'Library',cost:200,price:500,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-5' },
    { id:'prod-63',name:'Android App (Premium)',category:'Library',cost:400,price:1000,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-5' },
    { id:'prod-64',name:'Windows Software (Basic)',category:'Library',cost:1000,price:2000,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-5' },
    { id:'prod-65',name:'Windows Software (Pro)',category:'Library',cost:1500,price:3000,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-5' },
    { id:'prod-66',name:'Document Scanning (per page)',category:'Library',cost:200,price:500,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-5' },
    { id:'prod-67',name:'Internet Browsing (per 30min)',category:'Library',cost:300,price:1000,stockQty:9999,lowStockThreshold:0,isService:true,supplierId:'sup-5' },
  ];
  for (const p of libraryProducts) {
    await sql`
      INSERT INTO products (id,name,category,cost,price,stockQty,lowStockThreshold,supplierId,isService,imageUrl)
      VALUES (${p.id},${p.name},${p.category},${p.cost},${p.price},${p.stockQty},${p.lowStockThreshold},${p.supplierId},${p.isService},null)
      ON CONFLICT (id) DO NOTHING
    `;
  }
  await sql`DELETE FROM products WHERE category='Movies' OR category='Music' OR category='Software (Android)' OR category='Software (Windows)'`;
}

const EATERY_MENU = [
  { id:'prod-100',name:'Chappati',category:'Eatery',cost:250,price:500,stockQty:100,lowStockThreshold:20,supplierId:'sup-5',variants:null },
  { id:'prod-101',name:'Samosa / Sumbusa',category:'Eatery',cost:120,price:300,stockQty:120,lowStockThreshold:20,supplierId:'sup-5',
    variants:[{id:'v-single',label:'Single',price:300,cost:120},{id:'v-couple',label:'Couple / Pair',price:500,cost:250},{id:'v-big',label:'Big Size',price:500,cost:300}] },
  { id:'prod-102',name:'Egg Roll',category:'Eatery',cost:500,price:1000,stockQty:50,lowStockThreshold:10,supplierId:'sup-5',variants:null },
  { id:'prod-103',name:'Coconut Cookies',category:'Eatery',cost:200,price:500,stockQty:80,lowStockThreshold:15,supplierId:'sup-5',
    variants:[{id:'v-pair',label:'Pair',price:500,cost:200},{id:'v-plate',label:'Plate',price:2500,cost:1200}] },
  { id:'prod-104',name:'Shortbread Cookies',category:'Eatery',cost:250,price:500,stockQty:80,lowStockThreshold:15,supplierId:'sup-5',
    variants:[{id:'v-pair',label:'Pair',price:500,cost:250},{id:'v-plate',label:'Plate',price:2500,cost:1300}] },
  { id:'prod-105',name:'Sausage',category:'Eatery',cost:600,price:1000,stockQty:60,lowStockThreshold:12,supplierId:'sup-5',variants:null },
  { id:'prod-106',name:'Half Cake',category:'Eatery',cost:250,price:500,stockQty:30,lowStockThreshold:6,supplierId:'sup-5',
    variants:[{id:'v-small',label:'Small',price:500,cost:250},{id:'v-large',label:'Large',price:1000,cost:500}] },
  { id:'prod-107',name:'Meat Samosa',category:'Eatery',cost:550,price:1000,stockQty:60,lowStockThreshold:12,supplierId:'sup-5',variants:null },
  { id:'prod-108',name:'Black Tea',category:'Eatery',cost:150,price:500,stockQty:200,lowStockThreshold:30,supplierId:'sup-5',variants:null },
  { id:'prod-109',name:'Milk Tea',category:'Eatery',cost:400,price:1000,stockQty:150,lowStockThreshold:25,supplierId:'sup-5',variants:null },
  { id:'prod-110',name:'Cookies on a Plate',category:'Eatery',cost:1200,price:2500,stockQty:40,lowStockThreshold:8,supplierId:'sup-5',variants:null },
];

async function syncEateryMenu() {
  for (const p of EATERY_MENU) {
    await sql`
      INSERT INTO products (id,name,category,cost,price,stockQty,lowStockThreshold,supplierId,isService,imageUrl,variants)
      VALUES (${p.id},${p.name},${p.category},${p.cost},${p.price},${p.stockQty},${p.lowStockThreshold},${p.supplierId},false,null,${p.variants ? JSON.stringify(p.variants) : null})
      ON CONFLICT (id) DO NOTHING
    `;
  }
}

initPromise = initPromise.then(() => syncLibraryProducts()).then(() => syncEateryMenu()).catch(err => {
  console.error('Library sync failed:', err);
});

app.use((req, res, next) => {
  initPromise.then(() => next()).catch(err => {
    res.status(500).json({ error: 'Database initialization failed' });
  });
});

// === AUTH ===
// Stateless HMAC-signed tokens. The PIN hash lives in the settings table.
const AUTH_SECRET = process.env.AUTH_SECRET || createHash('sha256').update(DATABASE_URL || 'imac').digest('hex');
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function sha256Hex(s) {
  return createHash('sha256').update(String(s || '')).digest('hex');
}

function signToken() {
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  const sig = createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token) return false;
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return false;
  const expected = createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!exp || Date.now() > exp) return false;
    return true;
  } catch {
    return false;
  }
}

function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.headers['x-auth-token'] || '');
  if (!verifyToken(token)) return res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
  next();
}

// Verify a PIN and mint a token. Open (no PIN required on the server yet).
app.post('/api/auth/verify', asHandler(async (req, res) => {
  const { pin } = req.body || {};
  const rows = await sql`SELECT value FROM settings WHERE key='pinHash'`;
  const stored = rows.length ? rows[0].value : '';
  if (stored && sha256Hex(pin) !== stored) {
    return res.status(401).json({ error: 'Wrong PIN', code: 'WRONG_PIN' });
  }
  res.json({ ok: true, token: signToken(), hasPin: !!stored });
}));

// Every mutating request after this point requires a valid token.
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) return requireAuth(req, res, next);
  next();
});

// Set or clear the PIN (empty string removes it). Accepts { pin } (hashed here)
// or { hash } (stored as-is, used to migrate an existing client-side hash).
app.post('/api/auth/set', asHandler(async (req, res) => {
  const { pin, hash } = req.body || {};
  const value = typeof hash === 'string' ? hash : (pin ? sha256Hex(pin) : '');
  await sql`INSERT INTO settings (key, value) VALUES ('pinHash', ${value}) ON CONFLICT (key) DO UPDATE SET value=${value}`;
  res.json({ ok: true, hasPin: !!value, hash: value });
}));

// Atomic, server-side order numbers (no more per-device counter collisions).
app.post('/api/orders/next', asHandler(async (req, res) => {
  const existing = await sql`SELECT value FROM settings WHERE key='orderCounter'`;
  if (existing.length === 0) {
    const m = await sql`SELECT COALESCE(MAX((split_part(ordernumber, '#', 2))::int), 8492) AS m FROM sales`;
    const base = m.length ? m[0].m : 8492;
    await sql`INSERT INTO settings (key, value) VALUES ('orderCounter', ${String(base)}) ON CONFLICT (key) DO NOTHING`;
  }
  const n = await sql`UPDATE settings SET value = (value::int) + 1 WHERE key='orderCounter' RETURNING (value::int) AS n`;
  const next = n.length ? n[0].n : 8493;
  res.json({ orderNumber: `Order #${next}`, number: next });
}));

// === PRODUCTS API ===
app.get('/api/products', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM products`;
  res.json(rows.map(mapProduct));
}));

app.post('/api/products', asHandler(async (req, res) => {
  const p = req.body;
  await sql`INSERT INTO products (id,name,category,cost,price,stockQty,lowStockThreshold,supplierId,isService,imei,barcode,imageUrl,variants) VALUES (${p.id},${p.name},${p.category},${p.cost||0},${p.price||0},${p.stockQty||0},${p.lowStockThreshold||5},${p.supplierId||null},${p.isService||false},${p.imei||null},${p.barcode||null},${p.imageUrl||null},${p.variants ? JSON.stringify(p.variants) : null})`;
  res.json(p);
}));

app.put('/api/products/:id', asHandler(async (req, res) => {
  const p = req.body;
  await sql`UPDATE products SET name=${p.name},category=${p.category},cost=${p.cost||0},price=${p.price||0},stockQty=${p.stockQty||0},lowStockThreshold=${p.lowStockThreshold||5},supplierId=${p.supplierId||null},isService=${p.isService||false},imei=${p.imei||null},barcode=${p.barcode||null},imageUrl=${p.imageUrl||null},variants=${p.variants ? JSON.stringify(p.variants) : null} WHERE id=${req.params.id}`;
  res.json(p);
}));

app.delete('/api/products/:id', asHandler(async (req, res) => {
  await sql`DELETE FROM products WHERE id=${req.params.id}`;
  res.json({ success: true });
}));

// === SUPPLIERS API ===
app.get('/api/suppliers', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM suppliers`;
  res.json(rows.map(mapSupplier));
}));

app.post('/api/suppliers', asHandler(async (req, res) => {
  const s = req.body;
  await sql`INSERT INTO suppliers (id,name,contactPerson,phone,email) VALUES (${s.id},${s.name},${s.contactPerson||''},${s.phone||''},${s.email||''})`;
  res.json(s);
}));

app.put('/api/suppliers/:id', asHandler(async (req, res) => {
  const s = req.body;
  await sql`UPDATE suppliers SET name=${s.name},contactPerson=${s.contactPerson||''},phone=${s.phone||''},email=${s.email||''} WHERE id=${req.params.id}`;
  res.json(s);
}));

app.delete('/api/suppliers/:id', asHandler(async (req, res) => {
  await sql`DELETE FROM suppliers WHERE id=${req.params.id}`;
  res.json({ success: true });
}));

// === SALES API ===
app.get('/api/sales', asHandler(async (req, res) => {
  const { from, to, limit, offset } = req.query;
  let where = ' WHERE 1=1';
  const params = [];
  if (from) { params.push(from); where += ` AND timestamp >= $${params.length}`; }
  if (to) { params.push(to); where += ` AND timestamp <= $${params.length}`; }
  let query = `SELECT * FROM sales${where} ORDER BY timestamp DESC`;
  if (limit) { params.push(parseInt(limit)); query += ` LIMIT $${params.length}`; }
  if (offset) { params.push(parseInt(offset)); query += ` OFFSET $${params.length}`; }
  const rows = await sql.query(query, params);
  res.json(rows.map(mapSale));
}));

app.post('/api/sales', asHandler(async (req, res) => {
  const s = req.body;
  const itemsJson = JSON.stringify(s.items);
  await sql`INSERT INTO sales (id,orderNumber,timestamp,items,subtotal,tax,total,paymentMethod,customerName,discount,notes) VALUES (${s.id},${s.orderNumber},${s.timestamp},${itemsJson},${s.subtotal||0},${s.tax||0},${s.total||0},${s.paymentMethod||'Cash'},${s.customerName||null},${s.discount||null},${s.notes||null})`;
  for (const item of s.items) {
    await sql`UPDATE products SET stockQty = GREATEST(0, stockQty - ${item.qty}) WHERE id=${item.productId} AND isService=false`;
  }
  res.json(s);
}));

app.delete('/api/sales/:id', asHandler(async (req, res) => {
  const sale = await sql`SELECT * FROM sales WHERE id=${req.params.id}`;
  if (sale.length === 0) return res.status(404).json({ error: 'Sale not found' });
  const items = JSON.parse(sale[0].items);
  for (const item of items) {
    await sql`UPDATE products SET stockQty = stockQty + ${item.qty} WHERE id=${item.productId} AND isService=false`;
  }
  await sql`DELETE FROM sales WHERE id=${req.params.id}`;
  res.json({ success: true });
}));

// Soft refund: keep the sale row for the audit trail, restore stock, flag it.
app.post('/api/sales/:id/refund', asHandler(async (req, res) => {
  const sale = await sql`SELECT * FROM sales WHERE id=${req.params.id}`;
  if (sale.length === 0) return res.status(404).json({ error: 'Sale not found' });
  if (sale[0].refunded) return res.json({ success: true });
  const items = JSON.parse(sale[0].items);
  for (const item of items) {
    await sql`UPDATE products SET stockQty = stockQty + ${item.qty} WHERE id=${item.productId} AND isService=false`;
  }
  await sql`UPDATE sales SET refunded=true, refundedat=${new Date().toISOString()} WHERE id=${req.params.id}`;
  res.json({ success: true });
}));

// === EXPENSES API ===
app.get('/api/expenses', asHandler(async (req, res) => {
  const { from, to, limit, offset } = req.query;
  let where = ' WHERE 1=1';
  const params = [];
  if (from) { params.push(from); where += ` AND timestamp >= $${params.length}`; }
  if (to) { params.push(to); where += ` AND timestamp <= $${params.length}`; }
  let query = `SELECT * FROM expenses${where} ORDER BY timestamp DESC`;
  if (limit) { params.push(parseInt(limit)); query += ` LIMIT $${params.length}`; }
  if (offset) { params.push(parseInt(offset)); query += ` OFFSET $${params.length}`; }
  const rows = await sql.query(query, params);
  res.json(rows);
}));

app.post('/api/expenses', asHandler(async (req, res) => {
  const e = req.body;
  await sql`INSERT INTO expenses (id,timestamp,description,amount,category) VALUES (${e.id},${e.timestamp},${e.description},${e.amount},${e.category||''})`;
  res.json(e);
}));

app.delete('/api/expenses/:id', asHandler(async (req, res) => {
  await sql`DELETE FROM expenses WHERE id=${req.params.id}`;
  res.json({ success: true });
}));

// === SETTINGS API ===
app.get('/api/settings', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM settings`;
  const obj = {};
  for (const r of rows) {
    try { obj[r.key] = JSON.parse(r.value); } catch { obj[r.key] = r.value; }
  }
  const hasPin = !!obj.pinHash;
  delete obj.pinHash;
  obj.hasPin = hasPin;
  res.json(obj);
}));

app.put('/api/settings', asHandler(async (req, res) => {
  for (const [k, v] of Object.entries(req.body)) {
    await sql`INSERT INTO settings (key,value) VALUES (${k},${typeof v === 'string' ? v : JSON.stringify(v)}) ON CONFLICT (key) DO UPDATE SET value = ${typeof v === 'string' ? v : JSON.stringify(v)}`;
  }
  res.json({ success: true });
}));

// === CREDIT PAYMENTS API ===
app.get('/api/credit-payments', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM credit_payments ORDER BY createdat DESC`;
  res.json(rows.map(r => ({
    id: r.id, saleId: r.saleid,
    amount: r.amount, createdAt: r.createdat,
  })));
}));

app.post('/api/credit-payments', asHandler(async (req, res) => {
  const p = req.body;
  await sql`INSERT INTO credit_payments (id,saleid,amount,createdat) VALUES (${p.id},${p.saleId},${p.amount},${p.createdAt})`;
  res.json(p);
}));

// === CASH TRANSFERS API ===
app.get('/api/cash-transfers', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM cash_transfers ORDER BY createdat DESC`;
  res.json(rows.map(mapTransfer));
}));

app.post('/api/cash-transfers', asHandler(async (req, res) => {
  const t = req.body;
  await sql`INSERT INTO cash_transfers (id,fromcategory,tocategory,amount,reason,createdat,settledat) VALUES (${t.id},${t.fromCategory},${t.toCategory},${t.amount},${t.reason||''},${t.createdAt},${t.settledAt||null})`;
  res.json(t);
}));

app.put('/api/cash-transfers/:id/settle', asHandler(async (req, res) => {
  await sql`UPDATE cash_transfers SET settledat=${new Date().toISOString()} WHERE id=${req.params.id}`;
  res.json({ success: true });
}));

// === TAILORING ORDERS API ===
app.get('/api/tailoring-orders', asHandler(async (req, res) => {
  const rows = await sql`SELECT * FROM tailoring_orders ORDER BY createdat DESC`;
  res.json(rows.map(mapTailoringOrder));
}));

app.post('/api/tailoring-orders', asHandler(async (req, res) => {
  const o = req.body;
  await sql`INSERT INTO tailoring_orders (id,customername,customerphone,orderdate,expecteddate,completeddate,worktype,workdescription,totalamount,depositpaid,materialcost,status,notes,measurements,createdat) VALUES (${o.id},${o.customerName},${o.customerPhone||''},${o.orderDate},${o.expectedDate},${o.completedDate||null},${o.workType},${o.workDescription},${o.totalAmount||0},${o.depositPaid||0},${o.materialCost||0},${o.status||'pending'},${o.notes||''},${o.measurements||''},${o.createdAt})`;
  res.json(o);
}));

app.put('/api/tailoring-orders/:id', asHandler(async (req, res) => {
  const o = req.body;
  await sql`UPDATE tailoring_orders SET customername=${o.customerName},customerphone=${o.customerPhone||''},orderdate=${o.orderDate},expecteddate=${o.expectedDate},completeddate=${o.completedDate||null},worktype=${o.workType},workdescription=${o.workDescription},totalamount=${o.totalAmount||0},depositpaid=${o.depositPaid||0},materialcost=${o.materialCost||0},status=${o.status||'pending'},notes=${o.notes||''},measurements=${o.measurements||''} WHERE id=${req.params.id}`;
  res.json(o);
}));

app.delete('/api/tailoring-orders/:id', asHandler(async (req, res) => {
  await sql`DELETE FROM tailoring_orders WHERE id=${req.params.id}`;
  res.json({ success: true });
}));

// === SYNC PRODUCT CATALOG ===
app.post('/api/sync-products', asHandler(async (req, res) => {
  await syncLibraryProducts();
  res.json({ success: true, updated: 8 });
}));

// === SERVER-SIDE SUMMARY (date-range aggregates) ===
app.get('/api/summary', asHandler(async (req, res) => {
  const { from, to } = req.query;
  const salesWhere = ['refunded=false'];
  const salesParams = [];
  if (from) { salesParams.push(from); salesWhere.push(`timestamp >= $${salesParams.length}`); }
  if (to) { salesParams.push(to); salesWhere.push(`timestamp <= $${salesParams.length}`); }
  const salesRows = await sql.query(
    `SELECT items, total FROM sales WHERE ${salesWhere.join(' AND ')}`, salesParams);
  let revenue = 0;
  let cogs = 0;
  for (const r of salesRows) {
    revenue += r.total || 0;
    let items = [];
    try { items = JSON.parse(r.items); } catch {}
    for (const it of items) cogs += (it.unitCost || 0) * (it.qty || 0);
  }

  const expWhere = ['1=1'];
  const expParams = [];
  if (from) { expParams.push(from); expWhere.push(`timestamp >= $${expParams.length}`); }
  if (to) { expParams.push(to); expWhere.push(`timestamp <= $${expParams.length}`); }
  const expRows = await sql.query(
    `SELECT COALESCE(SUM(amount),0)::float AS total FROM expenses WHERE ${expWhere.join(' AND ')}`, expParams);

  const creditRows = await sql`SELECT COALESCE(SUM(total),0)::float AS total FROM sales WHERE paymentmethod='Credit / Book' AND refunded=false`;
  const paidRows = await sql`SELECT COALESCE(SUM(amount),0)::float AS total FROM credit_payments`;
  const lowRows = await sql`SELECT COUNT(*)::int AS n FROM products WHERE isservice=false AND stockqty <= lowstockthreshold`;

  const grossProfit = revenue - cogs;
  const expenseTotal = expRows.length ? expRows[0].total : 0;
  res.json({
    from: from || null,
    to: to || null,
    salesCount: salesRows.length,
    revenue,
    cogs,
    grossProfit,
    expenseTotal,
    netProfit: grossProfit - expenseTotal,
    creditOutstanding: (creditRows.length ? creditRows[0].total : 0) - (paidRows.length ? paidRows[0].total : 0),
    lowStockCount: lowRows.length ? lowRows[0].n : 0,
  });
}));

// === FULL DATA EXPORT / BACKUP ===
app.get('/api/export', requireAuth, asHandler(async (req, res) => {
  const [products, suppliers, sales, expenses, settingsRows, credit, transfers, tailoring] = await Promise.all([
    sql`SELECT * FROM products`,
    sql`SELECT * FROM suppliers`,
    sql`SELECT * FROM sales`,
    sql`SELECT * FROM expenses`,
    sql`SELECT * FROM settings`,
    sql`SELECT * FROM credit_payments`,
    sql`SELECT * FROM cash_transfers`,
    sql`SELECT * FROM tailoring_orders`,
  ]);
  res.json({
    exportedAt: new Date().toISOString(),
    products: products.map(mapProduct),
    suppliers: suppliers.map(mapSupplier),
    sales: sales.map(mapSale),
    expenses,
    settings: settingsRows,
    creditPayments: credit.map(r => ({ id: r.id, saleId: r.saleid, amount: r.amount, createdAt: r.createdat })),
    cashTransfers: transfers.map(mapTransfer),
    tailoringOrders: tailoring.map(mapTailoringOrder),
  });
}));

function mapProduct(r) {
  let variants = null;
  if (r.variants) {
    try { variants = JSON.parse(r.variants); } catch { variants = null; }
  }
  return {
    id: r.id, name: r.name, category: r.category, cost: r.cost, price: r.price,
    stockQty: r.stockqty, lowStockThreshold: r.lowstockthreshold,
    supplierId: r.supplierid, isService: !!r.isservice,
    imei: r.imei, barcode: r.barcode, imageUrl: r.imageurl || '',
    variants: variants || undefined,
  };
}

function mapTailoringOrder(r) {
  return {
    id: r.id, customerName: r.customername, customerPhone: r.customerphone || '',
    orderDate: r.orderdate, expectedDate: r.expecteddate,
    completedDate: r.completeddate || undefined,
    workType: r.worktype, workDescription: r.workdescription,
    totalAmount: r.totalamount, depositPaid: r.depositpaid,
    materialCost: r.materialcost || 0,
    status: r.status, notes: r.notes || '',
    measurements: r.measurements || '',
    createdAt: r.createdat,
  };
}

function mapSale(r) {
  return {
    id: r.id, orderNumber: r.ordernumber, timestamp: r.timestamp,
    items: JSON.parse(r.items), subtotal: r.subtotal, tax: r.tax, total: r.total,
    paymentMethod: r.paymentmethod, customerName: r.customername,
    discount: r.discount, notes: r.notes, refunded: !!r.refunded,
  };
}

function mapTransfer(r) {
  return {
    id: r.id, fromCategory: r.fromcategory, toCategory: r.tocategory,
    amount: r.amount, reason: r.reason, createdAt: r.createdat, settledAt: r.settledat,
  };
}

function mapSupplier(r) {
  return {
    id: r.id, name: r.name, contactPerson: r.contactperson,
    phone: r.phone, email: r.email,
  };
}

export default app;
