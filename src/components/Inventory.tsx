import { useState, useMemo, useRef } from 'react';
import { 
  Search, Plus, AlertTriangle, Edit, Package, Save, X,
  PlusCircle, Truck, Hash, Barcode, Image, Trash2, Settings2
} from 'lucide-react';
import type { Product, Supplier } from '../types';
import CategoryManager from './CategoryManager';

interface InventoryProps {
  products: Product[];
  suppliers: Supplier[];
  categories: string[];
  onAddProduct: (product: Product) => void;
  onUpdateProduct: (product: Product) => void;
  onDeleteProduct: (productId: string) => void;
  onAddCategory: (name: string) => void;
  onUpdateCategory: (oldName: string, newName: string) => void;
  onDeleteCategory: (name: string) => void;
  formatCurrency: (val: number) => string;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export default function Inventory({
  products,
  suppliers,
  categories,
  onAddProduct,
  onUpdateProduct,
  onDeleteProduct,
  onAddCategory,
  onUpdateCategory,
  onDeleteCategory,
  formatCurrency,
  triggerToast
}: InventoryProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'stock' | 'name' | 'price'>('stock');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  
  const [stockAdjustment, setStockAdjustment] = useState<number>(0);
  const [adjustmentType, setAdjustmentType] = useState<'add' | 'remove'>('add');

  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('Electronics');
  const [newCost, setNewCost] = useState('0');
  const [newPrice, setNewPrice] = useState('0');
  const [newStock, setNewStock] = useState('10');
  const [newThreshold, setNewThreshold] = useState('5');
  const [newSupplierId, setNewSupplierId] = useState('');
  const [newImei, setNewImei] = useState('');
  const [newBarcode, setNewBarcode] = useState('');
  const [newImageUrl, setNewImageUrl] = useState('');

  const [editName, setEditName] = useState('');
  const [editCost, setEditCost] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editThreshold, setEditThreshold] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editSupplierId, setEditSupplierId] = useState('');
  const [editImei, setEditImei] = useState('');
  const [editBarcode, setEditBarcode] = useState('');
  const [editImageUrl, setEditImageUrl] = useState('');
  const [editIsService, setEditIsService] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleImageSelect = (file: File, setImageUrl: (url: string) => void) => {
    if (!file.type.startsWith('image/')) {
      triggerToast('Please select an image file', 'error');
      return;
    }
    if (file.size > 500 * 1024) {
      triggerToast('Image must be under 500KB', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) setImageUrl(e.target.result as string);
    };
    reader.readAsDataURL(file);
  };

  const lowStockProducts = useMemo(() => {
    return products.filter(p => p.stockQty <= p.lowStockThreshold && !p.isService);
  }, [products]);

  const processedProducts = useMemo(() => {
    let list = products.filter(p => {
      const q = searchQuery.toLowerCase();
      return p.name.toLowerCase().includes(q) || 
        p.category.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        (p.imei && p.imei.toLowerCase().includes(q));
    });

    if (sortBy === 'stock') {
      list.sort((a, b) => a.stockQty - b.stockQty);
    } else if (sortBy === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'price') {
      list.sort((a, b) => b.price - a.price);
    }

    return list;
  }, [products, searchQuery, sortBy]);

  const handleOpenEdit = (product: Product) => {
    setEditingProduct(product);
    setEditName(product.name);
    setEditCost(String(product.cost));
    setEditPrice(String(product.price));
    setEditThreshold(String(product.lowStockThreshold));
    setEditCategory(product.category);
    setEditSupplierId(product.supplierId || '');
    setEditImei(product.imei || '');
    setEditBarcode(product.barcode || '');
    setEditImageUrl(product.imageUrl || '');
    setEditIsService(product.isService || false);
    setStockAdjustment(0);
    setAdjustmentType('add');
    setConfirmDelete(false);
  };

  const handleSaveEdit = () => {
    if (!editingProduct) return;

    const nameTrimmed = editName.trim();
    if (!nameTrimmed) {
      triggerToast('Product name is required', 'error');
      return;
    }

    const costNum = parseFloat(editCost) || 0;
    const priceNum = parseFloat(editPrice) || 0;
    const thresholdNum = parseInt(editThreshold, 10) || 0;

    if (costNum >= priceNum) {
      triggerToast(`Warning: Cost (${formatCurrency(costNum)}) is same or more than Price (${formatCurrency(priceNum)})!`, 'info');
    }

    let finalStock = editingProduct.stockQty;
    if (stockAdjustment > 0) {
      if (adjustmentType === 'add') {
        finalStock += stockAdjustment;
        triggerToast(`Added ${stockAdjustment} units!`, 'success');
      } else {
        finalStock = Math.max(0, finalStock - stockAdjustment);
        triggerToast(`Removed ${stockAdjustment} units`, 'info');
      }
    }

    const updated: Product = {
      ...editingProduct,
      name: nameTrimmed,
      cost: costNum,
      price: priceNum,
      lowStockThreshold: thresholdNum,
      category: editCategory,
      supplierId: editSupplierId || undefined,
      stockQty: finalStock,
      imei: editImei || undefined,
      barcode: editBarcode || undefined,
      imageUrl: editImageUrl || undefined,
      isService: editIsService,
    };

    onUpdateProduct(updated);
    setEditingProduct(null);
    triggerToast(`Updated ${nameTrimmed}`, 'success');
  };

  const handleCreateProduct = () => {
    if (!newName.trim()) {
      triggerToast('Product name is required', 'error');
      return;
    }

    const costNum = parseFloat(newCost) || 0;
    const priceNum = parseFloat(newPrice) || 0;
    const stockNum = parseInt(newStock, 10) || 0;
    const thresholdNum = parseInt(newThreshold, 10) || 0;

    const newProd: Product = {
      id: `prod-${Date.now()}`,
      name: newName,
      category: newCategory,
      cost: costNum,
      price: priceNum,
      stockQty: stockNum,
      lowStockThreshold: thresholdNum,
      supplierId: newSupplierId || undefined,
      imei: newImei || undefined,
      barcode: newBarcode || undefined,
      imageUrl: newImageUrl || undefined,
    };

    onAddProduct(newProd);
    setIsAddingNew(false);
    setNewName(''); setNewCost('0'); setNewPrice('0'); setNewStock('10');
    setNewThreshold('5'); setNewSupplierId(''); setNewImei(''); setNewBarcode(''); setNewImageUrl('');
    triggerToast(`Added "${newProd.name}"`, 'success');
  };

  const categoriesList = categories;

  return (
    <div className="space-y-6" id="inventory-tab-content">
      <section className="flex flex-col sm:flex-row gap-4 justify-between sm:items-center">
        <div className="relative flex-1">
          <input type="text" placeholder="Search products..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#141414] border border-white/5 text-gold-light focus:border-gold-brand focus:ring-1 focus:ring-gold-brand h-12 pl-11 pr-4 rounded-2xl text-sm transition-all outline-none" />
          <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs font-bold text-zinc-500 uppercase">Sort</span>
          <select value={sortBy} onChange={(e: any) => setSortBy(e.target.value)}
            className="bg-[#141414] border border-white/5 text-gold-brand text-xs rounded-2xl px-3 h-12 outline-none focus:border-gold-brand font-bold">
            <option value="stock">Low Stock First</option>
            <option value="name">Name A-Z</option>
            <option value="price">Price High-Low</option>
          </select>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4">
        <div className="boss-card p-4 border-l-4 border-l-zinc-500 flex flex-col justify-between">
          <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Total Products</p>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-3xl font-black text-white font-display">{products.length}</span>
            <span className="text-xs text-zinc-500 font-bold uppercase">items</span>
          </div>
        </div>
        <div className="boss-card p-4 border-l-4 border-l-rose-500 flex flex-col justify-between">
          <p className="text-xs font-bold text-rose-400 uppercase tracking-widest">Low Stock Items</p>
          <div className="flex items-center gap-2 mt-2">
            <span className={`text-3xl font-black font-display ${lowStockProducts.length > 0 ? 'text-rose-400 animate-pulse' : 'text-zinc-500'}`}>
              {lowStockProducts.length}
            </span>
            {lowStockProducts.length > 0 && <AlertTriangle className="w-5 h-5 text-rose-400 animate-bounce" />}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex justify-between items-center pb-2">
          <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-widest font-display">Product List</h2>
          <span className="text-xs text-zinc-500 font-bold uppercase">{processedProducts.length} items</span>
        </div>

        <div className="space-y-2">
          {processedProducts.map(product => {
            const isLowStock = product.stockQty <= product.lowStockThreshold && !product.isService;
            const isOutOfStock = product.stockQty <= 0 && !product.isService;

            return (
              <div key={product.id} onClick={() => handleOpenEdit(product)}
                className={`boss-card p-4 flex items-center justify-between cursor-pointer hover:border-gold-brand/40 group active:scale-[0.995] ${
                  isOutOfStock ? 'border-dashed border-rose-950 bg-rose-950/5' : ''
                }`}>
                <div className="flex items-center gap-4">
                  <div className={`w-11 h-11 border bg-[#0A0A0A] rounded-xl flex items-center justify-center text-zinc-400 shrink-0 ${
                    isOutOfStock ? 'border-rose-900' : isLowStock ? 'border-amber-600' : 'border-white/5'
                  }`}>
                    <Package className={`w-5 h-5 ${isLowStock ? 'text-amber-400' : 'text-zinc-400'}`} />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wide">{product.name}</h3>
                    <p className="text-xs text-zinc-500 font-bold mt-1 uppercase">
                      {product.category} •{' '}
                      <span className={isOutOfStock ? 'text-rose-400 font-black' : isLowStock ? 'text-amber-400 font-black' : 'text-gold-light'}>
                        {isOutOfStock ? 'SOLD OUT' : isLowStock ? `${product.stockQty} LEFT` : `${product.stockQty} in stock`}
                      </span>
                    </p>
                    {!product.isService && (
                      <div className="w-32 sm:w-44 bg-[#0A0A0A] h-1.5 rounded-full mt-2 overflow-hidden border border-white/5 shrink-0">
                        <div className={`h-full rounded-full transition-all duration-300 ${
                          isOutOfStock ? 'bg-rose-600' : isLowStock ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'
                        }`} style={{ width: `${Math.min((product.stockQty / Math.max(product.lowStockThreshold * 3, 20)) * 100, 100)}%` }}></div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-right flex items-center gap-4">
                  <div>
                    <p className="text-xs font-black text-white font-display">{formatCurrency(product.price)}</p>
                    <p className="text-xs text-zinc-500 font-bold uppercase mt-0.5">Cost: {formatCurrency(product.cost)}</p>
                  </div>
                  <Edit className="w-4 h-4 text-zinc-600 group-hover:text-gold-brand transition-colors" />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <button onClick={() => setIsAddingNew(true)}
        className="fixed bottom-24 right-4 z-40 w-14 h-14 bg-gold-brand text-black rounded-2xl shadow-2xl flex items-center justify-center active:scale-95 transition-transform border border-white/10">
        <Plus className="w-8 h-8" />
      </button>

      {/* ADD PRODUCT MODAL */}
      {isAddingNew && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="boss-card w-full max-w-lg p-6 bg-zinc-950 border border-white/5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-3 border-b border-white/5">
              <h3 className="text-sm font-black text-white uppercase tracking-wider font-display flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-gold-brand" /> Add New Product
              </h3>
              <button onClick={() => setIsAddingNew(false)} className="text-zinc-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">Product Name</label>
                <input type="text" placeholder="e.g. Phone Charger USB-C" value={newName} onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">Product Image</label>
                <div className="flex items-center gap-3">
                  <button onClick={() => fileInputRef.current?.click()}
                    className="h-10 px-4 bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-gold-brand rounded-xl text-xs font-bold flex items-center gap-2">
                    <Image className="w-4 h-4" /> {newImageUrl ? 'Change' : 'Upload'}
                  </button>
                  {newImageUrl && (
                    <button onClick={() => setNewImageUrl('')} className="text-xs text-rose-400 font-bold hover:underline">Remove</button>
                  )}
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageSelect(f, setNewImageUrl); }} />
                </div>
                {newImageUrl && (
                  <img src={newImageUrl} alt="Preview" className="mt-2 w-16 h-16 object-cover rounded-xl border border-zinc-800" />
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5 flex items-center gap-1">
                    Category
                    <button onClick={() => setShowCategoryManager(true)}
                      className="p-0.5 text-zinc-500 hover:text-gold-brand transition-colors" title="Manage Categories">
                      <Settings2 className="w-3 h-3" />
                    </button>
                  </label>
                  <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 text-gold-brand rounded-xl h-10 px-2 text-xs focus:border-gold-brand focus:outline-none font-bold">
                    {categoriesList.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">Supplier</label>
                  <select value={newSupplierId} onChange={(e) => setNewSupplierId(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl h-10 px-2 text-xs focus:border-gold-brand focus:outline-none">
                    <option value="">None</option>
                    {suppliers.map(sup => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">Cost Price</label>
                  <input type="number" value={newCost} onChange={(e) => setNewCost(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">Selling Price</label>
                  <input type="number" value={newPrice} onChange={(e) => setNewPrice(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 text-gold-brand rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none font-bold" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">Stock Quantity</label>
                  <input type="number" value={newStock} onChange={(e) => setNewStock(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">Alert when below</label>
                  <input type="number" value={newThreshold} onChange={(e) => setNewThreshold(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5 flex items-center gap-1">
                    <Hash className="w-3 h-3" /> IMEI / Serial
                  </label>
                  <input type="text" placeholder="Optional" value={newImei} onChange={(e) => setNewImei(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5 flex items-center gap-1">
                    <Barcode className="w-3 h-3" /> Barcode
                  </label>
                  <input type="text" placeholder="Optional" value={newBarcode} onChange={(e) => setNewBarcode(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
                </div>
              </div>
            </div>

            <div className="pt-4 flex gap-3">
              <button onClick={() => setIsAddingNew(false)} className="flex-1 h-11 border border-zinc-800 hover:bg-zinc-900 text-zinc-400 font-bold uppercase tracking-wider text-xs rounded-xl">Cancel</button>
              <button onClick={handleCreateProduct} className="flex-1 h-11 bg-gold-brand hover:bg-gold-medium text-black font-black uppercase tracking-widest text-xs rounded-xl shadow-lg">Add Product</button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT PRODUCT MODAL */}
      {editingProduct && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="boss-card w-full max-w-lg p-6 rounded-2xl bg-zinc-950 border border-zinc-800 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-3 border-b border-zinc-800">
              <h3 className="text-sm font-black text-white uppercase tracking-wider font-display flex items-center gap-2">
                <Edit className="w-5 h-5 text-gold-brand" /> Edit: {editingProduct.name}
              </h3>
              <button onClick={() => setEditingProduct(null)} className="text-zinc-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>

            <div>
              <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">Product Name</label>
              <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
            </div>

            <div className="flex items-center gap-3 bg-zinc-900 rounded-xl px-4 py-3 border border-zinc-800">
              <label className="text-xs text-zinc-400 font-bold uppercase">Service?</label>
              <button onClick={() => setEditIsService(!editIsService)}
                className={`relative w-11 h-6 rounded-full transition-all ${editIsService ? 'bg-gold-brand' : 'bg-zinc-700'}`}>
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${editIsService ? 'left-5' : 'left-0.5'}`}></span>
              </button>
              <span className="text-xs text-zinc-500">{editIsService ? 'No stock tracking' : 'Stock tracked'}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">Cost Price</label>
                <input type="number" value={editCost} onChange={(e) => setEditCost(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">Selling Price</label>
                <input type="number" value={editPrice} onChange={(e) => setEditPrice(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-gold-brand rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none font-bold" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5 flex items-center gap-1">
                  Category
                  <button onClick={() => setShowCategoryManager(true)}
                    className="p-0.5 text-zinc-500 hover:text-gold-brand transition-colors" title="Manage Categories">
                    <Settings2 className="w-3 h-3" />
                  </button>
                </label>
                <select value={editCategory} onChange={(e) => setEditCategory(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-gold-brand rounded-xl h-10 px-2 text-xs focus:border-gold-brand focus:outline-none font-bold">
                  {categoriesList.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">Supplier</label>
                <select value={editSupplierId} onChange={(e) => setEditSupplierId(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl h-10 px-2 text-xs focus:border-gold-brand focus:outline-none">
                  <option value="">None</option>
                  {suppliers.map(sup => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">Alert when stock below</label>
              <input type="number" value={editThreshold} onChange={(e) => setEditThreshold(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
            </div>

            <div>
              <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">Product Image</label>
              <div className="flex items-center gap-3">
                <button onClick={() => editFileInputRef.current?.click()}
                  className="h-10 px-4 bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-gold-brand rounded-xl text-xs font-bold flex items-center gap-2">
                  <Image className="w-4 h-4" /> {editImageUrl ? 'Change' : 'Upload'}
                </button>
                {editImageUrl && (
                  <button onClick={() => setEditImageUrl('')} className="text-xs text-rose-400 font-bold hover:underline">Remove</button>
                )}
                <input ref={editFileInputRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageSelect(f, setEditImageUrl); }} />
              </div>
              {editImageUrl && (
                <img src={editImageUrl} alt="Preview" className="mt-2 w-16 h-16 object-cover rounded-xl border border-zinc-800" />
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5 flex items-center gap-1">
                  <Hash className="w-3 h-3" /> IMEI / Serial
                </label>
                <input type="text" value={editImei} onChange={(e) => setEditImei(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5 flex items-center gap-1">
                  <Barcode className="w-3 h-3" /> Barcode
                </label>
                <input type="text" value={editBarcode} onChange={(e) => setEditBarcode(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
              </div>
            </div>

            <div className="bg-zinc-900 p-4 rounded-xl space-y-3 border border-zinc-800/60">
              <h4 className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
                <Truck className="w-3.5 h-3.5 text-gold-brand" /> Adjust Stock
              </h4>
              <div className="flex gap-2">
                <button onClick={() => setAdjustmentType('add')}
                  className={`flex-1 h-11 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${
                    adjustmentType === 'add' ? 'bg-emerald-950/20 border-emerald-500 text-emerald-400' : 'bg-zinc-950 border-zinc-800 text-zinc-500'
                  }`}>+ More arrived</button>
                <button onClick={() => setAdjustmentType('remove')}
                  className={`flex-1 h-11 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${
                    adjustmentType === 'remove' ? 'bg-rose-950/20 border-rose-500 text-rose-400' : 'bg-zinc-950 border-zinc-800 text-zinc-500'
                  }`}>- Used / Sold</button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500 font-bold uppercase">Qty:</span>
                <input type="number" min="0" value={stockAdjustment === 0 ? '' : stockAdjustment} placeholder="0"
                  onChange={(e) => setStockAdjustment(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-24 bg-zinc-950 border border-zinc-800 text-gold-light rounded text-center text-xs h-8 focus:border-gold-brand focus:outline-none font-bold" />
                <span className="text-xs text-zinc-400 font-bold uppercase">(Current: {editingProduct.stockQty})</span>
              </div>
            </div>

            <div className="pt-2 flex gap-3">
              <button onClick={() => setEditingProduct(null)} className="flex-1 h-11 border border-zinc-800 hover:bg-zinc-900 text-zinc-400 font-bold uppercase tracking-wider text-xs rounded-xl">Cancel</button>
              <button onClick={handleSaveEdit} className="flex-1 h-11 bg-gold-brand hover:bg-gold-medium text-black font-black uppercase tracking-widest text-xs rounded-xl shadow-lg flex items-center justify-center gap-2">
                <Save className="w-4 h-4" /> Save
              </button>
            </div>

            <div className="pt-3 border-t border-zinc-800">
              {!confirmDelete ? (
                <button onClick={() => setConfirmDelete(true)} className="w-full h-10 border border-rose-900/40 hover:bg-rose-950/30 text-rose-400 font-bold uppercase tracking-wider text-xs rounded-xl flex items-center justify-center gap-2 transition-all">
                  <Trash2 className="w-4 h-4" /> Delete Product
                </button>
              ) : (
                <div className="bg-rose-950/20 border border-rose-500/30 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-bold text-rose-400 text-center uppercase">Delete "{editingProduct.name}" permanently?</p>
                  <div className="flex gap-2">
                    <button onClick={() => setConfirmDelete(false)} className="flex-1 h-9 border border-zinc-800 text-zinc-400 font-bold text-xs rounded-lg">Cancel</button>
                    <button onClick={() => {
                      onDeleteProduct(editingProduct.id);
                      setEditingProduct(null);
                      setConfirmDelete(false);
                      triggerToast(`Deleted "${editingProduct.name}"`, 'info');
                    }} className="flex-1 h-9 bg-rose-600 hover:bg-rose-500 text-white font-black text-xs rounded-lg uppercase">Delete</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showCategoryManager && (
        <CategoryManager
          categories={categories}
          onAddCategory={onAddCategory}
          onUpdateCategory={onUpdateCategory}
          onDeleteCategory={onDeleteCategory}
          onClose={() => setShowCategoryManager(false)}
          triggerToast={triggerToast}
        />
      )}
    </div>
  );
}