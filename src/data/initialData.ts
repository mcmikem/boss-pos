import { Product, Expense, Sale, Supplier } from '../types';

export const INITIAL_SUPPLIERS: Supplier[] = [
  {
    id: 'sup-1',
    name: 'Kampala Wholesalers Ltd',
    contactPerson: 'Kato James',
    phone: '+256 772 123456',
    email: 'kato@kwl.com'
  },
  {
    id: 'sup-2',
    name: 'City Printing Hub',
    contactPerson: 'Sarah Nakato',
    phone: '+256 701 987654',
    email: 'sarah@cityprint.com'
  },
  {
    id: 'sup-3',
    name: 'Prime Textiles',
    contactPerson: 'Emmanuel Okeke',
    phone: '+256 703 111 2222',
    email: 'emmanuel@primetextiles.com'
  },
  {
    id: 'sup-4',
    name: 'Megatech Electronics',
    contactPerson: 'Peter Wasswa',
    phone: '+256 755 333444',
    email: 'peter@megatech.co.ug'
  },
  {
    id: 'sup-5',
    name: 'Fresh Foods Supply',
    contactPerson: 'Grace Nambi',
    phone: '+256 782 555666',
    email: 'grace@freshfoods.ug'
  }
];

export const INITIAL_PRODUCTS: Product[] = [
  // === ELECTRONICS (Phones, chargers, accessories) ===
  { id: 'prod-1', name: 'Oppo A78 (Used)', category: 'Electronics', cost: 350000, price: 450000, stockQty: 5, lowStockThreshold: 2, supplierId: 'sup-4' },
  { id: 'prod-2', name: 'Samsung Galaxy A14', category: 'Electronics', cost: 380000, price: 480000, stockQty: 4, lowStockThreshold: 1, supplierId: 'sup-4' },
  { id: 'prod-3', name: 'Phone Charger (Micro USB)', category: 'Electronics', cost: 5000, price: 12000, stockQty: 40, lowStockThreshold: 8, supplierId: 'sup-4' },
  { id: 'prod-4', name: 'Phone Charger (USB-C)', category: 'Electronics', cost: 6000, price: 15000, stockQty: 35, lowStockThreshold: 8, supplierId: 'sup-4' },
  { id: 'prod-5', name: 'Phone Charger (Lightning)', category: 'Electronics', cost: 8000, price: 20000, stockQty: 15, lowStockThreshold: 4, supplierId: 'sup-4' },
  { id: 'prod-6', name: 'Wired Earphones (In-Ear)', category: 'Electronics', cost: 5000, price: 15000, stockQty: 30, lowStockThreshold: 6, supplierId: 'sup-4' },
  { id: 'prod-7', name: 'Bluetooth Earphones (TWS)', category: 'Electronics', cost: 25000, price: 55000, stockQty: 15, lowStockThreshold: 3, supplierId: 'sup-4' },
  { id: 'prod-8', name: 'Power Bank (10000mAh)', category: 'Electronics', cost: 30000, price: 65000, stockQty: 12, lowStockThreshold: 3, supplierId: 'sup-4' },
  { id: 'prod-9', name: 'Screen Protector (Tempered Glass)', category: 'Electronics', cost: 2000, price: 8000, stockQty: 80, lowStockThreshold: 15, supplierId: 'sup-4' },
  { id: 'prod-10', name: 'Phone Case (Silicone)', category: 'Electronics', cost: 4000, price: 12000, stockQty: 50, lowStockThreshold: 10, supplierId: 'sup-4' },
  { id: 'prod-11', name: 'USB Cable (Braided 2m)', category: 'Electronics', cost: 6000, price: 15000, stockQty: 30, lowStockThreshold: 6, supplierId: 'sup-4' },
  { id: 'prod-12', name: 'Memory Card (64GB)', category: 'Electronics', cost: 25000, price: 55000, stockQty: 20, lowStockThreshold: 4, supplierId: 'sup-4' },
  { id: 'prod-13', name: 'Bluetooth Speaker', category: 'Electronics', cost: 30000, price: 70000, stockQty: 10, lowStockThreshold: 2, supplierId: 'sup-4' },
  { id: 'prod-14', name: 'Flash Disk (32GB)', category: 'Electronics', cost: 20000, price: 45000, stockQty: 15, lowStockThreshold: 3, supplierId: 'sup-4' },

  // === EATERY (Food & drinks) ===
  { id: 'prod-20', name: 'Double Egg Rolex', category: 'Eatery', cost: 1800, price: 3500, stockQty: 50, lowStockThreshold: 10, supplierId: 'sup-5' },
  { id: 'prod-21', name: 'Single Egg Rolex', category: 'Eatery', cost: 1200, price: 2500, stockQty: 40, lowStockThreshold: 10, supplierId: 'sup-5' },
  { id: 'prod-22', name: 'Plain Chapati', category: 'Eatery', cost: 500, price: 1500, stockQty: 80, lowStockThreshold: 15, supplierId: 'sup-5' },
  { id: 'prod-23', name: 'Samosa (Beef, 3pcs)', category: 'Eatery', cost: 1200, price: 3000, stockQty: 40, lowStockThreshold: 8, supplierId: 'sup-5' },
  { id: 'prod-24', name: 'Soda (Glass Bottle)', category: 'Eatery', cost: 1200, price: 2000, stockQty: 60, lowStockThreshold: 15, supplierId: 'sup-5' },
  { id: 'prod-25', name: 'Bottled Water (500ml)', category: 'Eatery', cost: 700, price: 1500, stockQty: 100, lowStockThreshold: 20, supplierId: 'sup-5' },
  { id: 'prod-26', name: 'African Milk Tea', category: 'Eatery', cost: 700, price: 2000, stockQty: 40, lowStockThreshold: 8, supplierId: 'sup-5' },
  { id: 'prod-27', name: 'Fresh Juice (Passion)', category: 'Eatery', cost: 2000, price: 4000, stockQty: 25, lowStockThreshold: 5, supplierId: 'sup-5' },
  { id: 'prod-28', name: 'Crisps (Packet)', category: 'Eatery', cost: 1500, price: 3000, stockQty: 50, lowStockThreshold: 10, supplierId: 'sup-5' },
  { id: 'prod-29', name: 'Biscuits (Assorted)', category: 'Eatery', cost: 500, price: 1500, stockQty: 60, lowStockThreshold: 12, supplierId: 'sup-5' },

  // === STATIONERY ===
  { id: 'prod-30', name: 'Exercise Book (200pg)', category: 'Stationery', cost: 2000, price: 4000, stockQty: 100, lowStockThreshold: 20, supplierId: 'sup-2' },
  { id: 'prod-31', name: 'BIC Pen (Blue/Black)', category: 'Stationery', cost: 500, price: 1500, stockQty: 200, lowStockThreshold: 30, supplierId: 'sup-2' },
  { id: 'prod-32', name: 'Pencil (HB)', category: 'Stationery', cost: 300, price: 1000, stockQty: 150, lowStockThreshold: 25, supplierId: 'sup-2' },
  { id: 'prod-33', name: 'Ruler (30cm)', category: 'Stationery', cost: 1000, price: 3000, stockQty: 40, lowStockThreshold: 8, supplierId: 'sup-2' },
  { id: 'prod-34', name: 'Glue Stick', category: 'Stationery', cost: 1500, price: 4000, stockQty: 30, lowStockThreshold: 6, supplierId: 'sup-2' },
  { id: 'prod-35', name: 'Notebook (A5)', category: 'Stationery', cost: 3000, price: 7000, stockQty: 50, lowStockThreshold: 10, supplierId: 'sup-2' },
  { id: 'prod-36', name: 'Marker Pen (Permanent)', category: 'Stationery', cost: 1500, price: 4000, stockQty: 35, lowStockThreshold: 7, supplierId: 'sup-2' },

  // === PRINTING ===
  { id: 'prod-40', name: 'Photocopy (B&W Page)', category: 'Printing', cost: 50, price: 300, stockQty: 500, lowStockThreshold: 100, supplierId: 'sup-2' },
  { id: 'prod-41', name: 'Color Printing (A4)', category: 'Printing', cost: 500, price: 1500, stockQty: 200, lowStockThreshold: 30, supplierId: 'sup-2' },
  { id: 'prod-42', name: 'Lamination (A4)', category: 'Printing', cost: 1000, price: 3000, stockQty: 40, lowStockThreshold: 8, supplierId: 'sup-2' },
  { id: 'prod-43', name: 'Spiral Binding', category: 'Printing', cost: 2000, price: 5000, stockQty: 30, lowStockThreshold: 5, supplierId: 'sup-2' },
  { id: 'prod-44', name: 'Passport Photos', category: 'Printing', cost: 1500, price: 5000, stockQty: 9999, lowStockThreshold: 0, isService: true, supplierId: 'sup-2' },

  // === TAILORING ===
  { id: 'prod-50', name: 'Trouser Hemming', category: 'Tailoring', cost: 2000, price: 8000, stockQty: 9999, lowStockThreshold: 0, isService: true, supplierId: 'sup-3' },
  { id: 'prod-51', name: 'Zip Replacement', category: 'Tailoring', cost: 2000, price: 7000, stockQty: 9999, lowStockThreshold: 0, isService: true, supplierId: 'sup-3' },
  { id: 'prod-52', name: 'Kitenge Dress (Custom)', category: 'Tailoring', cost: 18000, price: 45000, stockQty: 10, lowStockThreshold: 2, supplierId: 'sup-3' },
  { id: 'prod-53', name: 'School Uniform (Full)', category: 'Tailoring', cost: 20000, price: 35000, stockQty: 8, lowStockThreshold: 2, supplierId: 'sup-3' },
  { id: 'prod-54', name: "Men's Shirt (Fitted)", category: 'Tailoring', cost: 15000, price: 35000, stockQty: 8, lowStockThreshold: 2, supplierId: 'sup-3' },

  // === LIBRARY (Movies, music, software - qty-based, no names needed) ===
  { id: 'prod-60', name: 'Movie Download', category: 'Library', cost: 3000, price: 7000, stockQty: 9999, lowStockThreshold: 0, isService: true, supplierId: 'sup-5' },
  { id: 'prod-61', name: 'Music Download', category: 'Library', cost: 1000, price: 3000, stockQty: 9999, lowStockThreshold: 0, isService: true, supplierId: 'sup-5' },
  { id: 'prod-62', name: 'Software Install', category: 'Library', cost: 5000, price: 15000, stockQty: 9999, lowStockThreshold: 0, isService: true, supplierId: 'sup-5' },
  { id: 'prod-63', name: 'Karaoke Track', category: 'Library', cost: 1000, price: 3000, stockQty: 9999, lowStockThreshold: 0, isService: true, supplierId: 'sup-5' },
  { id: 'prod-64', name: 'Audio Recording (per hr)', category: 'Library', cost: 25000, price: 60000, stockQty: 9999, lowStockThreshold: 0, isService: true, supplierId: 'sup-5' },

  // === SPORTS ===
  { id: 'prod-70', name: 'Soccer Ball (Size 5)', category: 'Sports', cost: 28000, price: 50000, stockQty: 8, lowStockThreshold: 2, supplierId: 'sup-1' },
  { id: 'prod-71', name: 'Skipping Rope', category: 'Sports', cost: 5000, price: 12000, stockQty: 15, lowStockThreshold: 3, supplierId: 'sup-1' },
  { id: 'prod-72', name: 'Whistle (Referee)', category: 'Sports', cost: 3000, price: 8000, stockQty: 20, lowStockThreshold: 4, supplierId: 'sup-1' },

  // === GRAPHICS ===
  { id: 'prod-80', name: 'Logo Design (Basic)', category: 'Graphics', cost: 30000, price: 80000, stockQty: 9999, lowStockThreshold: 0, isService: true, supplierId: 'sup-2' },
  { id: 'prod-81', name: 'Flyer Design (A5)', category: 'Graphics', cost: 15000, price: 45000, stockQty: 9999, lowStockThreshold: 0, isService: true, supplierId: 'sup-2' },
  { id: 'prod-82', name: 'Business Cards (100pcs)', category: 'Graphics', cost: 15000, price: 40000, stockQty: 20, lowStockThreshold: 3, supplierId: 'sup-2' },
  { id: 'prod-83', name: 'PVC Banner (per sq m)', category: 'Graphics', cost: 12000, price: 25000, stockQty: 30, lowStockThreshold: 5, supplierId: 'sup-2' },
];

export const INITIAL_EXPENSES: Expense[] = [
  { id: 'exp-1', timestamp: '2026-07-15T08:30:00Z', description: 'Phone accessories restock', amount: 85000, category: 'Stock Purchase' },
  { id: 'exp-2', timestamp: '2026-07-15T10:15:00Z', description: 'Electricity (Yaka tokens)', amount: 15000, category: 'Utilities' },
  { id: 'exp-3', timestamp: '2026-07-14T14:00:00Z', description: 'Food supplies for eatery', amount: 45000, category: 'Stock Purchase' },
  { id: 'exp-4', timestamp: '2026-07-15T12:00:00Z', description: 'Shop rent (monthly)', amount: 200000, category: 'Rent' },
  { id: 'exp-5', timestamp: '2026-07-14T09:15:00Z', description: 'Printer ink refill', amount: 25000, category: 'Supplies' },
];

export const INITIAL_SALES: Sale[] = [
  {
    id: 'sale-1', orderNumber: 'Order #8492',
    timestamp: '2026-07-15T11:10:00+03:00',
    items: [
      { productId: 'prod-4', productName: 'Phone Charger (USB-C)', qty: 1, unitPrice: 15000, unitCost: 6000, lineTotal: 15000 },
      { productId: 'prod-7', productName: 'Bluetooth Earphones (TWS)', qty: 1, unitPrice: 55000, unitCost: 25000, lineTotal: 55000 },
    ],
    subtotal: 70000, tax: 0, total: 70000, paymentMethod: 'MTN MoMo'
  },
  {
    id: 'sale-2', orderNumber: 'Order #8491',
    timestamp: '2026-07-15T09:45:00+03:00',
    items: [
      { productId: 'prod-20', productName: 'Double Egg Rolex', qty: 2, unitPrice: 3500, unitCost: 1800, lineTotal: 7000 },
      { productId: 'prod-24', productName: 'Soda (Glass Bottle)', qty: 2, unitPrice: 2000, unitCost: 1200, lineTotal: 4000 },
    ],
    subtotal: 11000, tax: 0, total: 11000, paymentMethod: 'Cash'
  },
  {
    id: 'sale-3', orderNumber: 'Order #8490',
    timestamp: '2026-07-15T08:30:00+03:00',
    items: [
      { productId: 'prod-10', productName: 'Phone Case (Silicone)', qty: 2, unitPrice: 12000, unitCost: 4000, lineTotal: 24000 },
      { productId: 'prod-62', productName: 'Charging Port Repair', qty: 1, unitPrice: 30000, unitCost: 10000, lineTotal: 30000 },
    ],
    subtotal: 54000, tax: 0, total: 54000, paymentMethod: 'Cash'
  },
];
