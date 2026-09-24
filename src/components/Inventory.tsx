import { useState, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import { 
  Search, Plus, AlertTriangle, Edit, Package, Save, X,
  PlusCircle, Truck, Hash, Barcode, Image, Trash2, Settings2, ListChecks, ChefHat, Upload
} from 'lucide-react';
import type { Product, ProductVariant, Supplier, SupplierPrice, Sale, Expense, Recipe, RecipeIngredient } from '../types';
import { uploadImage } from '../api';
import CategoryManager from './CategoryManager';
import StocktakePanel from './StocktakePanel';
import { RECIPE_UNITS, calculateRecipe, effectiveCost, emptyRecipe, suggestedFor } from '../utils/recipe';
import { parseQty } from '../utils/units';
import { expiryStatus, daysUntilExpiry } from '../utils/dates';
import { staleProducts } from '../utils/stale';
import { quotesForProduct, bestQuoteFor, restockQtyFor, buildRestockMessage, supplierWhatsAppUrl } from '../utils/suppliers';
import { parseProductsCsv, PRODUCTS_TEMPLATE, type ImportResult } from '../utils/csvImport';
import { downloadBlob } from '../utils/download';
import { getPriceHistory } from '../utils/priceHistory';
import { readAdjustLog, logAdjustment } from '../utils/adjustLog';

interface InventoryProps {
  products: Product[];
  suppliers: Supplier[];
  supplierPrices: SupplierPrice[];
  sales: Sale[];
  shopName: string;
  categories: string[];
  onAddProduct: (product: Product) => void;
  onUpdateProduct: (product: Product) => void;
  onDeleteProduct: (productId: string) => void;
  onUpsertQuote: (supplierId: string, productId: string, price: number) => void;
  onDeleteQuote: (quoteId: string) => void;
  onAddExpense?: (expense: Expense) => void;
  onAddCategory: (name: string) => void;
  onUpdateCategory: (oldName: string, newName: string) => void;
  onDeleteCategory: (name: string) => void;
  formatCurrency: (val: number) => string;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export default function Inventory({
  products,
  suppliers,
  supplierPrices,
  sales,
  shopName,
  categories,
  onAddProduct,
  onUpdateProduct,
  onDeleteProduct,
  onUpsertQuote,
  onDeleteQuote,
  onAddExpense,
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
  // Expiring filter: show only dated items expiring within 30 days (or past).
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  // Quick add: name + price + qty for basic sellers. Full details hides
  // behind one link — same save path, same validation, zero intimidation.
  const [quickMode, setQuickMode] = useState(true);
  
  const [stockAdjustment, setStockAdjustment] = useState<number>(0);
  const [adjustmentType, setAdjustmentType] = useState<'add' | 'remove' | 'set'>('add');
  // Why the stock moved — logged to a per-device journal so "where did 10
  // sodas go?" always has an answer (damage, theft, gifts, miscounts).
  const [adjustReason, setAdjustReason] = useState('');
  const ADJUST_REASONS: Record<string, string[]> = {
    add: ['Restock purchase', 'Found stock', 'Transfer in'],
    remove: ['Damaged', 'Expired', 'Stolen', 'Given free', 'Miscount'],
    set: ['Stock-take count', 'Miscount correction'],
  };
  // Cash paid for arriving stock — saved as a Stock Purchase expense in the
  // same tap, so stock and money can never drift apart. Empty = no expense.
  const [stockPaid, setStockPaid] = useState('');

  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('Electronics');
  const [newCost, setNewCost] = useState('0');
  const [newPrice, setNewPrice] = useState('0');
  const [newStock, setNewStock] = useState('10');
  const [newThreshold, setNewThreshold] = useState('5');
  const [newSupplierId, setNewSupplierId] = useState('');
  const [newImei, setNewImei] = useState('');
  const [newBarcode, setNewBarcode] = useState('');
  const [newExpiry, setNewExpiry] = useState('');
  // Bale-day bulk entry: rapid name + price rows, details later.
  const [showBulk, setShowBulk] = useState(false);
  const [showStocktake, setShowStocktake] = useState(false);
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkRows, setBulkRows] = useState<{ name: string; price: string }[]>([{ name: '', price: '' }]);
  // CSV import: file → parsed preview → confirmed bulk add. Parsed result is
  // kept (not applied) until the owner taps Import, so nothing lands by accident.
  const [showImport, setShowImport] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const importFileRef = useRef<HTMLInputElement>(null);
  const [newImageUrl, setNewImageUrl] = useState('');
  const [newSaleUnit, setNewSaleUnit] = useState('');
  const [newVariants, setNewVariants] = useState<ProductVariant[]>([]);
  const [newRecipe, setNewRecipe] = useState<Recipe | null>(null);
  // Services never carry stock — the toggle hides the stock fields below.
  const [newIsService, setNewIsService] = useState(false);

  const [editName, setEditName] = useState('');
  const [editCost, setEditCost] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editThreshold, setEditThreshold] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editSupplierId, setEditSupplierId] = useState('');
  const [editImei, setEditImei] = useState('');
  const [editBarcode, setEditBarcode] = useState('');
  const [editExpiry, setEditExpiry] = useState('');
  const [editImageUrl, setEditImageUrl] = useState('');
  const [editIsService, setEditIsService] = useState(false);
  const [editSaleUnit, setEditSaleUnit] = useState('');
  const [editVariants, setEditVariants] = useState<ProductVariant[]>([]);
  const [editRecipe, setEditRecipe] = useState<Recipe | null>(null);
  const [quoteSupplierId, setQuoteSupplierId] = useState('');
  const [quotePrice, setQuotePrice] = useState('');
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleImageSelect = async (file: File, setImageUrl: (url: string) => void) => {
    if (!file.type.startsWith('image/')) {
      triggerToast('Please select an image file', 'error');
      return;
    }
    // Old Android browsers can run out of memory decoding huge camera photos,
    // which kills the whole page. Reject oversized files before touching them.
    const MAX_FILE_BYTES = 6 * 1024 * 1024;
    if (file.size > MAX_FILE_BYTES) {
      triggerToast('Photo too large (max 6MB). Pick a smaller one.', 'error');
      return;
    }

    // The old-Android renderer dies the moment we try to DECODE a camera photo
    // into an <img>/canvas — that OOM is the "page just goes off" crash. So the
    // hard rule here is: while online, NEVER decode on the device. Upload the
    // raw bytes to the server (XHR, no Image object) and let sharp resize.
    if (navigator.onLine) {
      // Vercel serverless caps request bodies just under 4.5MB, so anything
      // bigger can't reach sharp — tell the user instead of guessing.
      const MAX_RAW_UPLOAD_BYTES = 4 * 1024 * 1024;
      if (file.size > MAX_RAW_UPLOAD_BYTES) {
        triggerToast('Photo too big for your connection (max ~4MB). Pick a smaller one.', 'error');
        return;
      }
      try {
        const url = await uploadImage(file);
        setImageUrl(url);
        return;
      } catch (err) {
        // Never fall back to the decoding path while online — that's the crash.
        triggerToast(err instanceof Error && err.message ? err.message : 'Photo upload failed — try again', 'error');
        return;
      }
    }

    // Offline fallback (last resort): downscale with a canvas. Only reached when
    // the device is offline and can't reach the server at all. Keep the input
    // small so a low-memory Android has a fighting chance.
    if (file.size > 2 * 1024 * 1024) {
      triggerToast('Offline photo limit is 2MB. Connect to the internet to use bigger photos.', 'error');
      return;
    }
    const MAX_W = 200;
    let img: HTMLImageElement | null = null;
    try {
      img = document.createElement('img');
    } catch {
      triggerToast('Image upload not supported on this device', 'error');
      return;
    }
    const timer = window.setTimeout(() => {
      triggerToast('Image processing timed out — try a smaller photo', 'error');
    }, 12000);
    img.onload = () => {
      window.clearTimeout(timer);
      try {
        URL.revokeObjectURL(img!.src);
        const w = img!.naturalWidth;
        const h = img!.naturalHeight;
        if (!w || !h) {
          triggerToast('Could not read image dimensions', 'error');
          return;
        }
        // Extra safety: don't even try to downscale absurdly large captures.
        if (w > 8192 || h > 8192) {
          triggerToast('Photo resolution too high for this device', 'error');
          return;
        }
        // Centre-crop to a square so the offline photo matches the clean,
        // uniform square thumbnails the server produces.
        const side = Math.min(w, h);
        const sx = Math.floor((w - side) / 2);
        const sy = Math.floor((h - side) / 2);
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(MAX_W, side);
        canvas.height = Math.min(MAX_W, side);
        const ctx = canvas.getContext('2d');
        if (!ctx) { triggerToast('Failed to process image', 'error'); return; }
        ctx.drawImage(img!, sx, sy, side, side, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
        if (dataUrl.length > 60_000) {
          triggerToast('Image too large after compression', 'error');
          return;
        }
        setImageUrl(dataUrl);
      } catch {
        triggerToast('Could not process image on this device', 'error');
      }
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      triggerToast('Failed to load image', 'error');
    };
    try {
      img.src = URL.createObjectURL(file);
    } catch {
      window.clearTimeout(timer);
      triggerToast('Could not open image on this device', 'error');
    }
  };

  const lowStockProducts = useMemo(() => {
    return products.filter(p => p.stockQty <= p.lowStockThreshold && !p.isService);
  }, [products]);

  // Dead money: stocked items with no sale in 30+ days (mitumba one-offs,
  // slow gadgets). Suggests clearance, the mirror of low-stock alerts.
  const staleList = useMemo(() => staleProducts(products, sales), [products, sales]);
  const staleDaysById = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const s of staleList) m.set(s.product.id, s.daysSince);
    return m;
  }, [staleList]);

  // Capital locked on shelves (cost × on-hand, services excluded) + how much
  // of it is dead (stale items). Answers "how much money is sitting here?"
  const stockValue = useMemo(() => {
    return products.reduce((a, p) => a + (p.isService || p.stockQty <= 0 ? 0 : (p.cost || 0) * p.stockQty), 0);
  }, [products]);
  const deadCapital = useMemo(() => {
    return staleList.reduce((a, s) => a + (s.product.stockQty > 0 && !s.product.isService ? (s.product.cost || 0) * s.product.stockQty : 0), 0);
  }, [staleList]);

  const processedProducts = useMemo(() => {
    const supName = (id?: string) => {
      if (!id) return '';
      return suppliers.find(s => s.id === id)?.name || '';
    };
    let list = products.filter(p => {
      const q = searchQuery.toLowerCase();
      return p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        supName(p.supplierId).toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        (p.imei && p.imei.toLowerCase().includes(q));
    });

    if (expiringOnly) {
      list = list.filter(p => !p.isService && p.expiryDate && expiryStatus(p.expiryDate) !== 'ok')
        .sort((a, b) => (daysUntilExpiry(a.expiryDate) ?? 9999) - (daysUntilExpiry(b.expiryDate) ?? 9999));
    }

    if (sortBy === 'stock') {
      list.sort((a, b) => a.stockQty - b.stockQty);
    } else if (sortBy === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'price') {
      list.sort((a, b) => b.price - a.price);
    }

    return list;
  }, [products, searchQuery, sortBy, expiringOnly, suppliers]);

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
    setEditExpiry(product.expiryDate || '');
    setEditImageUrl(product.imageUrl || '');
    setEditIsService(product.isService || false);
    setEditSaleUnit(product.saleUnit || '');
    setEditVariants(product.variants ? product.variants.map(v => ({ ...v })) : []);
    setEditRecipe(product.recipe ? JSON.parse(JSON.stringify(product.recipe)) : null);
    setStockAdjustment(0);
    setAdjustmentType('add');
    setAdjustReason('');
    setStockPaid('');
    setConfirmDelete(false);
  };

  const addVariant = () => {
    const base = editingProduct;
    setEditVariants(prev => [...prev, {
      id: `var-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label: '',
      price: base?.price || 0,
      cost: base?.cost || undefined,
    }]);
  };

  const updateVariant = (id: string, patch: Partial<ProductVariant>) => {
    setEditVariants(prev => prev.map(v => v.id === id ? { ...v, ...patch } : v));
  };

  const removeVariant = (id: string) => {
    setEditVariants(prev => prev.filter(v => v.id !== id));
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
    const thresholdNum = parseQty(editThreshold) || 0;

    if (costNum >= priceNum) {
      triggerToast(`Warning: Cost (${formatCurrency(costNum)}) is same or more than Price (${formatCurrency(priceNum)})!`, 'info');
    }

    let finalStock = editingProduct.stockQty;
    let receivedQty = 0;
    let movedQty = 0;
    if (editIsService) {
      // Services hold no stock, ever — wipe any legacy balance.
      finalStock = 0;
    } else if (editCategory !== 'Eatery' && (stockAdjustment > 0 || adjustmentType === 'set')) {
      if (adjustmentType === 'set') {
        finalStock = Math.max(0, stockAdjustment);
        movedQty = stockAdjustment;
        triggerToast(`Set stock to ${finalStock}`, 'success');
      } else if (adjustmentType === 'add') {
        finalStock = Math.round((finalStock + stockAdjustment) * 1000) / 1000;
        receivedQty = stockAdjustment;
        movedQty = stockAdjustment;
        triggerToast(`Added ${stockAdjustment} units!`, 'success');
      } else {
        finalStock = Math.max(0, Math.round((finalStock - stockAdjustment) * 1000) / 1000);
        movedQty = stockAdjustment;
        triggerToast(`Removed ${stockAdjustment} units`, 'info');
      }
      // Journal the why (default reason per button so it is never blank).
      const reason = adjustReason || (ADJUST_REASONS[adjustmentType]?.[0] || 'Adjusted');
      logAdjustment({
        ts: new Date().toISOString(), productId: editingProduct.id, name: nameTrimmed,
        type: adjustmentType, qty: movedQty, reason,
      });
    }

    const cleanVariants = editVariants
      .filter(v => v.label.trim() !== '')
      .map(v => ({
        id: v.id,
        label: v.label.trim(),
        price: parseFloat(String(v.price)) || 0,
        cost: parseFloat(String(v.cost)) || undefined,
      }));

    const updated: Product = {
      ...editingProduct,
      name: nameTrimmed,
      cost: costNum,
      price: priceNum,
      lowStockThreshold: editIsService ? 0 : thresholdNum,
      category: editCategory,
      supplierId: editSupplierId || undefined,
      stockQty: finalStock,
      imei: editImei || undefined,
      barcode: editBarcode || undefined,
      expiryDate: /^\d{4}-\d{2}-\d{2}$/.test(editExpiry) ? editExpiry : undefined,
      imageUrl: editImageUrl || undefined,
      isService: editIsService,
      saleUnit: editSaleUnit.trim() || undefined,
      variants: cleanVariants.length ? cleanVariants : undefined,
      recipe: sanitizeRecipe(editRecipe),
    };

    onUpdateProduct(updated);
    // Close the loop: arriving stock cost money, so log it as a Stock
    // Purchase in the same save. Empty = free transfer, no expense.
    const paidNum = parseFloat(stockPaid) || 0;
    if (receivedQty > 0 && paidNum > 0 && onAddExpense) {
      onAddExpense({
        id: `exp-${Date.now()}`,
        timestamp: new Date().toISOString(),
        description: `Restock: ${nameTrimmed} ×${receivedQty}`,
        amount: paidNum,
        category: 'Stock Purchase',
        source: 'drawer',
        items: [{ name: `${nameTrimmed} ×${receivedQty}`, amount: paidNum }],
        linkedProductId: editingProduct.id,
        linkedProductName: nameTrimmed,
      });
      triggerToast(`Stock + ${formatCurrency(paidNum)} purchase logged`, 'success');
    }
    setEditingProduct(null);
    triggerToast(`Updated ${nameTrimmed}`, 'success');
  };

  const addNewVariant = () => {
    setNewVariants(prev => [...prev, {
      id: `var-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label: '',
      price: parseFloat(newPrice) || 0,
      cost: parseFloat(newCost) || undefined,
    }]);
  };

  const updateNewVariant = (id: string, patch: Partial<ProductVariant>) => {
    setNewVariants(prev => prev.map(v => v.id === id ? { ...v, ...patch } : v));
  };

  const removeNewVariant = (id: string) => {
    setNewVariants(prev => prev.filter(v => v.id !== id));
  };

  const handleCreateProduct = () => {
    if (!newName.trim()) {
      triggerToast('Product name is required', 'error');
      return;
    }

    const costNum = parseFloat(newCost) || 0;
    const priceNum = parseFloat(newPrice) || 0;
    const stockNum = parseQty(newStock) || 0;
    const thresholdNum = parseQty(newThreshold) || 0;

    const cleanVariants = newVariants
      .filter(v => v.label.trim() !== '')
      .map(v => ({
        id: v.id,
        label: v.label.trim(),
        price: parseFloat(String(v.price)) || 0,
        cost: parseFloat(String(v.cost)) || undefined,
      }));

    const newProd: Product = {
      id: `prod-${Date.now()}`,
      name: newName,
      category: newCategory,
      cost: costNum,
      price: priceNum,
      // Eatery snacks hold no manual stock — Morning Production is the only
      // inflow. Services never hold stock either.
      stockQty: (newIsService || newCategory === 'Eatery') ? 0 : stockNum,
      lowStockThreshold: newIsService ? 0 : thresholdNum,
      isService: newIsService || undefined,
      supplierId: newSupplierId || undefined,
        imei: newImei || undefined,
        barcode: newBarcode || undefined,
        expiryDate: /^\d{4}-\d{2}-\d{2}$/.test(newExpiry) ? newExpiry : undefined,
      imageUrl: newImageUrl || undefined,
      saleUnit: newSaleUnit.trim() || undefined,
      variants: cleanVariants.length ? cleanVariants : undefined,
      recipe: sanitizeRecipe(newRecipe),
    };

    onAddProduct(newProd);
    setIsAddingNew(false);
    setNewName(''); setNewCost('0'); setNewPrice('0'); setNewStock('10');
    setNewThreshold('5'); setNewSupplierId(''); setNewImei(''); setNewBarcode(''); setNewExpiry(''); setNewImageUrl(''); setNewSaleUnit('');
    setNewIsService(false);
    setNewVariants([]);
    triggerToast(`Added "${newProd.name}"`, 'success');
  };

  const categoriesList = categories;

  const sanitizeRecipe = (recipe: Recipe | null): Recipe | undefined => {
    if (!recipe) return undefined;
    const ingredients = recipe.ingredients
      .filter(i => i.name.trim() !== '')
      .map(i => ({
        ...i,
        name: i.name.trim(),
        qty: Math.max(0, parseFloat(String(i.qty)) || 0),
        unitCost: Math.max(0, parseFloat(String(i.unitCost)) || 0),
        wastePct: Math.min(99, Math.max(0, parseFloat(String(i.wastePct)) || 0)),
      }));
    const yieldVal = Math.max(0, parseFloat(String(recipe.yield)) || 0);
    if (ingredients.length === 0 || yieldVal <= 0) return undefined;
    return {
      ingredients,
      yield: yieldVal,
      overhead: Math.max(0, parseFloat(String(recipe.overhead)) || 0),
      targetMarginPct: Math.min(99, Math.max(1, parseFloat(String(recipe.targetMarginPct)) || 60)),
    };
  };

  const renderRecipeCard = (
    recipe: Recipe | null,
    setRecipe: Dispatch<SetStateAction<Recipe | null>>,
    price: string,
    setPrice: Dispatch<SetStateAction<string>>,
    setVariants: Dispatch<SetStateAction<ProductVariant[]>>,
  ) => {
    if (!recipe) return null;
    const calc = calculateRecipe(recipe, parseFloat(price) || 0);

    const updateIng = (id: string, patch: Partial<RecipeIngredient>) => {
      setRecipe(prev => prev && {
        ...prev,
        ingredients: prev.ingredients.map(i => i.id === id ? { ...i, ...patch } : i),
      });
    };
    const removeIng = (id: string) => {
      setRecipe(prev => prev && { ...prev, ingredients: prev.ingredients.filter(i => i.id !== id) });
    };
    const addIng = () => {
      setRecipe(prev => prev && {
        ...prev,
        ingredients: [...prev.ingredients, { id: `ing-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: '', qty: 1, unit: 'kg', unitCost: 0, wastePct: 0 }],
      });
    };
    const applySuggested = () => {
      if (!calc) return;
      setPrice(String(Math.round(calc.suggestedPrice)));
      setVariants(prev => prev.map(v => ({
        ...v,
        price: Math.round(suggestedFor(v.cost ?? calc.cogsPerUnit, recipe.targetMarginPct)),
      })));
      triggerToast('Suggested prices applied', 'success');
    };

    return (
      <div className="bg-zinc-900/60 rounded-xl p-3 border border-gold-brand/20 space-y-3">
        <div className="flex justify-between items-center mb-1">
          <h4 className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
            <ChefHat className="w-3.5 h-3.5 text-gold-brand" /> Recipe Costing
          </h4>
          <span className="text-[10px] text-zinc-600 uppercase font-bold">Fresh-made recipe</span>
        </div>

        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_3.5rem_4rem_4.5rem_3.5rem_1.5rem] gap-1.5 text-[10px] text-zinc-500 font-bold uppercase">
            <span>Ingredient</span><span>Qty</span><span>Unit</span><span>Cost/Unit</span><span>Waste %</span><span></span>
          </div>
          {recipe.ingredients.map(ing => (
            <div key={ing.id} className="grid grid-cols-[1fr_3.5rem_4rem_4.5rem_3.5rem_1.5rem] gap-1.5 items-center">
              <input value={ing.name} placeholder="e.g. Chicken breast"
                onChange={(e) => updateIng(ing.id, { name: e.target.value })}
                className="min-w-0 bg-zinc-950 border border-zinc-800 text-gold-light rounded-lg h-9 px-2 text-xs focus:border-gold-brand focus:outline-none" />
              <input type="number" min="0" step="any" value={ing.qty || ''}
                onChange={(e) => updateIng(ing.id, { qty: parseFloat(e.target.value) || 0 })}
                className="bg-zinc-950 border border-zinc-800 text-gold-light rounded-lg h-9 px-2 text-xs focus:border-gold-brand focus:outline-none text-right" />
              <select value={ing.unit}
                onChange={(e) => updateIng(ing.id, { unit: e.target.value })}
                className="bg-zinc-950 border border-zinc-800 text-zinc-300 rounded-lg h-9 px-1 text-xs focus:border-gold-brand focus:outline-none">
                {RECIPE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              <input type="number" min="0" step="any" value={ing.unitCost || ''}
                onChange={(e) => updateIng(ing.id, { unitCost: parseFloat(e.target.value) || 0 })}
                className="bg-zinc-950 border border-zinc-800 text-gold-light rounded-lg h-9 px-2 text-xs focus:border-gold-brand focus:outline-none text-right" />
              <input type="number" min="0" max="99" value={ing.wastePct || ''}
                onChange={(e) => updateIng(ing.id, { wastePct: Math.min(99, Math.max(0, parseFloat(e.target.value) || 0)) })}
                className="bg-zinc-950 border border-zinc-800 text-amber-400 rounded-lg h-9 px-2 text-xs focus:border-gold-brand focus:outline-none text-right" />
              <button onClick={() => removeIng(ing.id)} className="text-rose-400 hover:text-rose-300 p-1.5"><X className="w-4 h-4" /></button>
            </div>
          ))}
          <button onClick={addIng} className="text-gold-brand text-xs font-bold flex items-center gap-1 hover:text-gold-light transition-colors">
            <PlusCircle className="w-3.5 h-3.5" /> Add ingredient
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-[10px] text-zinc-500 font-bold uppercase mb-1">Batch Yield</label>
            <input type="number" min="1" value={recipe.yield || ''}
              onChange={(e) => setRecipe(prev => prev && { ...prev, yield: Math.max(1, parseFloat(e.target.value) || 1) })}
              className="w-full bg-zinc-950 border border-zinc-800 text-gold-light rounded-lg h-9 px-2 text-xs focus:border-gold-brand focus:outline-none text-right" />
          </div>
          <div>
            <label className="block text-[10px] text-zinc-500 font-bold uppercase mb-1">Extra costs (UGX)</label>
            <input type="number" min="0" value={recipe.overhead || ''}
              onChange={(e) => setRecipe(prev => prev && { ...prev, overhead: Math.max(0, parseFloat(e.target.value) || 0) })}
              className="w-full bg-zinc-950 border border-zinc-800 text-gold-light rounded-lg h-9 px-2 text-xs focus:border-gold-brand focus:outline-none text-right" />
          </div>
          <div>
            <label className="block text-[10px] text-zinc-500 font-bold uppercase mb-1">Target profit %</label>
            <input type="number" min="1" max="99" value={recipe.targetMarginPct || ''}
              onChange={(e) => setRecipe(prev => prev && { ...prev, targetMarginPct: Math.min(99, Math.max(1, parseFloat(e.target.value) || 60)) })}
              className="w-full bg-zinc-950 border border-zinc-800 text-amber-400 rounded-lg h-9 px-2 text-xs focus:border-gold-brand focus:outline-none text-right" />
          </div>
        </div>

        {calc && (
          <div className="bg-zinc-950/60 border border-zinc-800 rounded-xl p-3 space-y-1.5 text-xs">
            <div className="flex justify-between"><span className="text-zinc-500 font-bold uppercase">Batch cost</span><span className="text-zinc-300 font-bold">{formatCurrency(calc.batchCost)}</span></div>
            <div className="flex justify-between"><span className="text-zinc-500 font-bold uppercase">+ Extra costs</span><span className="text-zinc-300 font-bold">{formatCurrency(calc.totalCost - calc.batchCost)}</span></div>
            <div className="flex justify-between border-t border-zinc-800 pt-1.5"><span className="text-zinc-500 font-bold uppercase">Cost per piece</span><span className="text-gold-light font-black">{formatCurrency(calc.cogsPerUnit)}</span></div>
            <div className="flex justify-between"><span className="text-zinc-500 font-bold uppercase">Sell price</span><span className="text-zinc-300 font-bold">{formatCurrency(parseFloat(price) || 0)}</span></div>
            <div className="flex justify-between">
              <span className="text-zinc-500 font-bold uppercase">Profit / piece</span>
              <span className={`font-black ${calc.isLoss ? 'text-rose-400' : 'text-emerald-400'}`}>{formatCurrency(calc.profitPerUnit)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500 font-bold uppercase">Profit %</span>
              <span className={`font-black ${calc.marginPct <= 0 ? 'text-rose-400' : calc.marginPct < 20 ? 'text-amber-400' : 'text-emerald-400'}`}>{calc.marginPct.toFixed(1)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500 font-bold uppercase">Suggested price</span>
              <span className="text-gold-brand font-black">{formatCurrency(Math.round(calc.suggestedPrice))}</span>
            </div>
            {calc.isLoss && <p className="text-rose-400 text-[11px] font-bold">You are selling this below cost!</p>}
            {!calc.isLoss && calc.isUnderpriced && <p className="text-amber-400 text-[11px] font-bold">Under target margin — tap apply suggested price.</p>}
          </div>
        )}

        <button onClick={applySuggested} className="w-full h-10 bg-gold-brand hover:bg-gold-medium text-black font-black uppercase tracking-widest text-xs rounded-xl transition-colors">
          Apply Suggested Prices
        </button>
      </div>
    );
  };

  // CSV import helpers: rows already on the shelf (same name + category)
  // are skipped so re-importing an export can never double the stock.
  const importKey = (name: string, category: string) =>
    `${name.trim().toLowerCase()}::${category.trim().toLowerCase()}`;
  const existingKeys = new Set(products.map(p => importKey(p.name, p.category || '')));
  const freshImportRows = (importResult?.products || []).filter(r => !existingKeys.has(importKey(r.name, r.category)));
  const importDupes = (importResult?.products.length || 0) - freshImportRows.length;

  const readImportFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { triggerToast('CSV too large (max 2MB)', 'error'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        setImportFileName(f.name);
        setImportResult(parseProductsCsv(String(reader.result || ''), categories[0] || 'General'));
      } catch { triggerToast('Could not read that file', 'error'); }
    };
    reader.onerror = () => triggerToast('Could not read that file', 'error');
    reader.readAsText(f);
  };

  const downloadImportTemplate = () => {
    const ok = downloadBlob(new Blob([PRODUCTS_TEMPLATE], { type: 'text/csv' }), 'stock-template.csv');
    triggerToast(ok ? 'Template downloaded — fill it in Excel, save as CSV' : 'Download failed on this device', ok ? 'success' : 'error');
  };

  const confirmImport = () => {
    if (freshImportRows.length === 0) { triggerToast('Nothing new to import', 'info'); return; }
    const now = Date.now();
    const seenCats = new Set(categories);
    freshImportRows.forEach((r, idx) => {
      if (r.category && !seenCats.has(r.category)) { seenCats.add(r.category); onAddCategory(r.category); }
      onAddProduct({
        id: `p-${now}-${idx}`, name: r.name, category: r.category,
        cost: r.cost, price: r.price,
        // Kitchen snacks start at zero — the batch arrives via Morning Production.
        stockQty: r.category === 'Eatery' ? 0 : r.stockQty,
        lowStockThreshold: r.lowStockThreshold,
        barcode: r.barcode || undefined,
        expiryDate: r.expiryDate,
      });
    });
    setShowImport(false);
    setImportResult(null);
    setImportFileName('');
    triggerToast(`${freshImportRows.length} products imported — check prices before selling`, 'success');
  };

  return (
    <div className="space-y-6" id="inventory-tab-content">
      {showStocktake ? (
        <StocktakePanel products={products} onUpdateProduct={onUpdateProduct}
          formatCurrency={formatCurrency} triggerToast={triggerToast}
          onBack={() => setShowStocktake(false)} />
      ) : (
      <>
      <section className="flex flex-col sm:flex-row gap-4 justify-between sm:items-center">
        <div className="relative flex-1">
          <input type="text" placeholder="Search products..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#141414] border border-white/5 text-gold-light focus:border-gold-brand focus:ring-1 focus:ring-gold-brand h-12 pl-11 pr-4 rounded-2xl !text-base transition-all outline-none" />
          <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button onClick={() => { setBulkCategory(categories[0] || ''); setBulkRows([{ name: '', price: '' }]); setShowBulk(true); }}
            className="h-12 px-4 bg-[#141414] border border-white/5 hover:border-gold-brand/40 text-zinc-300 font-black rounded-2xl text-xs uppercase tracking-wider transition-all active:scale-95 cursor-pointer touch-target flex items-center gap-1.5"
            title="Bale day: add many products fast, details later">
            <Plus className="w-4 h-4" /> Bulk
          </button>
          <button onClick={() => { setImportResult(null); setImportFileName(''); setShowImport(true); }}
            className="h-12 px-4 bg-[#141414] border border-white/5 hover:border-gold-brand/40 text-zinc-300 font-black rounded-2xl text-xs uppercase tracking-wider transition-all active:scale-95 cursor-pointer touch-target flex items-center gap-1.5"
            title="Load a stock list from Excel/CSV instead of typing">
            <Upload className="w-4 h-4" /> Import
          </button>
          <button onClick={() => setShowStocktake(true)}
            className="h-12 px-4 bg-[#141414] border border-white/5 hover:border-cyan-400/40 text-zinc-300 font-black rounded-2xl text-xs uppercase tracking-wider transition-all active:scale-95 cursor-pointer touch-target flex items-center gap-1.5"
            title="Count the shelves and match system stock">
            <ListChecks className="w-4 h-4" /> Count
          </button>
          <span className="text-xs font-bold text-zinc-500 uppercase">Sort</span>
          <select value={sortBy} onChange={(e: any) => setSortBy(e.target.value)}
            className="bg-[#141414] border border-white/5 text-gold-brand text-xs rounded-2xl px-3 h-12 outline-none focus:border-gold-brand font-bold">
            <option value="stock">Low Stock First</option>
            <option value="name">Name A-Z</option>
            <option value="price">Price High-Low</option>
          </select>
          <button onClick={() => setExpiringOnly(v => !v)} aria-pressed={expiringOnly} title="Only items expiring within 30 days (or past)"
            className={`h-12 px-4 rounded-2xl text-xs font-black uppercase tracking-wider border transition-all active:scale-95 cursor-pointer touch-target ${expiringOnly ? 'bg-amber-950/40 border-amber-600/40 text-amber-300' : 'bg-[#141414] border-white/5 text-zinc-500 hover:text-zinc-300'}`}>
            {expiringOnly ? '✓ Expiring' : 'Expiring'}
          </button>
        </div>
      </section>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="boss-card p-3 border-l-4 border-l-zinc-500 flex flex-col justify-between">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Products</p>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-black text-white font-display">{products.length}</span>
          </div>
        </div>
        <div className="boss-card p-3 border-l-4 border-l-cyan-500 flex flex-col justify-between" title="Capital locked on shelves: cost × quantity on hand">
          <p className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest">On shelves</p>
          <div className="flex items-baseline gap-2 mt-2 min-w-0">
            <span className="text-lg sm:text-xl font-black text-white font-display truncate tabular-nums" title={formatCurrency(stockValue)}>{formatCurrency(stockValue)}</span>
          </div>
        </div>
        <div className="boss-card p-3 border-l-4 border-l-rose-500 flex flex-col justify-between" id="tour-stock-alert">
          <p className="text-[10px] font-bold text-rose-400 uppercase tracking-widest">Low Stock</p>
          <div className="flex items-center gap-2 mt-2">
            <span className={`text-2xl font-black font-display ${lowStockProducts.length > 0 ? 'text-rose-400 animate-pulse' : 'text-zinc-500'}`}>
              {lowStockProducts.length}
            </span>
            {lowStockProducts.length > 0 && <AlertTriangle className="w-4 h-4 text-rose-400 animate-bounce" />}
          </div>
        </div>
        <div className="boss-card p-3 border-l-4 border-l-amber-500 flex flex-col justify-between" title="Stocked items with no sale in 30+ days — dead money, consider clearance">
          <p className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">Stale</p>
          <div className="flex items-center gap-2 mt-2">
            <span className={`text-2xl font-black font-display ${staleList.length > 0 ? 'text-amber-400' : 'text-zinc-500'}`}>
              {staleList.length}
            </span>
          </div>
          {deadCapital > 0 && (
            <p className="text-[10px] text-zinc-500 font-bold uppercase mt-1 truncate tabular-nums">{formatCurrency(deadCapital)} tied up</p>
          )}
        </div>
      </section>

      {staleList.length > 0 && (
        <details className="boss-card p-4">
          <summary className="text-xs font-black text-amber-400 uppercase tracking-widest cursor-pointer hover:text-amber-300 touch-target">
            Clearance list ({staleList.length}) • {formatCurrency(deadCapital)} sleeping
          </summary>
          <div className="mt-2 space-y-1.5">
            {staleList.slice(0, 20).map(({ product, daysSince }) => (
              <div key={product.id} className="flex items-center justify-between gap-2 bg-black/30 rounded-lg px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-white uppercase truncate">{product.name}</p>
                  <p className="text-[10px] text-zinc-500 font-bold uppercase">
                    {daysSince === null ? 'Never sold' : `${daysSince}d no sale`} • {product.stockQty} left • was {formatCurrency(product.price)}
                  </p>
                </div>
                <p className="text-xs font-black text-amber-300 shrink-0 tabular-nums">{formatCurrency((product.cost || 0) * Math.max(0, product.stockQty))}</p>
                <button onClick={() => {
                    const next = Math.max(0, Math.round(product.price * 0.8));
                    onUpdateProduct({ ...product, price: next });
                    triggerToast(`${product.name} cut to ${formatCurrency(next)} (−20%)`, 'success');
                  }}
                  title={`Cut ${product.name} price by 20% to clear it`}
                  className="shrink-0 h-9 px-3 bg-amber-950/40 border border-amber-600/40 text-amber-300 rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-amber-950/60 active:scale-95 transition-all cursor-pointer">
                  −20%
                </button>
              </div>
            ))}
            {staleList.length > 20 && (
              <p className="text-[10px] text-zinc-600 font-bold uppercase text-center">+{staleList.length - 20} more — search above to find them</p>
            )}
            <p className="text-[10px] text-zinc-600 font-bold uppercase">Tip: cut the price in Stock → edit, or bundle slow items with fast sellers.</p>
          </div>
        </details>
      )}

      <section className="space-y-3">
        <div className="flex justify-between items-center pb-2">
          <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-widest font-display">Product List</h2>
          <span className="text-xs text-zinc-500 font-bold uppercase">{processedProducts.length} items</span>
        </div>

        <div className="space-y-2">
          {processedProducts.map(product => {
            const isLowStock = product.stockQty <= product.lowStockThreshold && !product.isService;
            const isOutOfStock = product.stockQty <= 0 && !product.isService;
            const exp = !product.isService ? expiryStatus(product.expiryDate) : 'ok';
            const expDays = exp !== 'ok' ? daysUntilExpiry(product.expiryDate) : null;

            // One-button row (#7): the whole row is the single action that
            // opens the item — delete lives inside the editor, not here.
            return (
              <div key={product.id} role="button" tabIndex={0}
                onClick={() => handleOpenEdit(product)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpenEdit(product); } }}
                aria-label={`Open ${product.name} for editing`}
                className={`boss-card p-4 flex items-center justify-between cursor-pointer hover:border-gold-brand/40 group active:scale-[0.995] ${
                  isOutOfStock ? 'border-dashed border-rose-950 bg-rose-950/5' : ''
                }`}>
                <div className="flex items-center gap-4">
                  <div className={`w-11 h-11 border bg-[#0A0A0A] rounded-xl flex items-center justify-center text-zinc-400 shrink-0 ${
                    isOutOfStock ? 'border-rose-900' : isLowStock ? 'border-amber-600' : 'border-white/5'
                  }`}>
                    <Package className={`w-5 h-5 ${isLowStock ? 'text-amber-400' : 'text-zinc-400'}`} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[13px] font-semibold text-zinc-100 leading-snug truncate">{product.name}</h3>
                    <p className="text-xs text-zinc-500 font-medium mt-0.5 truncate">
                      {product.category} •{' '}
                      {product.isService ? (
                        <span className="text-zinc-400">Service — no stock</span>
                      ) : isOutOfStock ? (
                        <span className="text-rose-400 font-semibold">Sold out</span>
                      ) : isLowStock ? (
                        <span className="text-amber-400 font-semibold">{product.stockQty} left</span>
                      ) : (
                        <span className="text-zinc-400">{product.stockQty} in stock</span>
                      )}
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
                    <p className="text-[13px] font-bold text-zinc-100 font-display tabular-nums">{formatCurrency(product.price)}</p>
                    <p className="text-[11px] text-zinc-500 font-medium mt-0.5 tabular-nums">{formatCurrency(effectiveCost(product))}</p>
                      {(() => {
                      const best = bestQuoteFor(supplierPrices, product.id);
                      return best ? (
                        <p className="text-[10px] text-emerald-400 font-bold mt-0.5 tabular-nums">Best supply {formatCurrency(best.price)}</p>
                      ) : null;
                    })()}
                    {exp === 'expired' ? (
                      <p className="text-[10px] text-rose-400 font-black mt-0.5 uppercase">Expired — pull from shelf</p>
                    ) : exp === 'soon' ? (
                      <p className="text-[10px] text-amber-400 font-bold mt-0.5 tabular-nums">Expires in {expDays}d ({product.expiryDate})</p>
                    ) : null}
                    {(() => {
                      if (product.isService || !staleDaysById.has(product.id)) return null;
                      const d = staleDaysById.get(product.id);
                      return (
                        <p className="text-[10px] text-amber-500/90 font-bold mt-0.5 uppercase" title="No sale in 30+ days — consider a clearance price">
                          Stale{d === null ? '' : ` ${d}d`} — clear it?
                        </p>
                      );
                    })()}
                  </div>
                  <Edit className="w-4 h-4 text-zinc-600 group-hover:text-gold-brand transition-colors" />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <button onClick={() => { setQuickMode(true); setIsAddingNew(true); }} id="tour-add-product"
        className="fixed bottom-24 right-4 z-40 w-14 h-14 bg-gold-brand text-black rounded-2xl shadow-2xl flex items-center justify-center active:scale-95 transition-transform border border-white/10">
        <Plus className="w-8 h-8" />
      </button>

      {/* BULK ADD MODAL (bale day: names + prices fast, details later) */}
      {showBulk && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="boss-card w-full max-w-lg p-6 bg-zinc-950 border border-white/5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-3 border-b border-white/5">
              <h3 className="text-sm font-black text-white uppercase tracking-wider font-display flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-gold-brand" /> Bulk Add
              </h3>
              <button onClick={() => setShowBulk(false)} className="text-zinc-500 hover:text-white p-1 cursor-pointer" aria-label="Close bulk add">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-[11px] text-zinc-500">One row per item — name + selling price. Stock starts at 1, cost 0. Open each later for full details.</p>
            <div>
              <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">Category for all rows</label>
              <select value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none font-bold">
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              {bulkRows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={row.name} placeholder={`Item ${i + 1} name`}
                    onChange={(e) => {
                      const next = bulkRows.map((r, j) => j === i ? { ...r, name: e.target.value } : r);
                      if (i === next.length - 1 && e.target.value.trim()) next.push({ name: '', price: '' });
                      setBulkRows(next);
                    }}
                    className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-11 px-3 text-sm focus:border-gold-brand focus:outline-none font-bold" />
                  <input type="number" min="0" step="any" value={row.price} placeholder="Price"
                    onChange={(e) => setBulkRows(prev => prev.map((r, j) => j === i ? { ...r, price: e.target.value } : r))}
                    className="w-28 bg-zinc-900 border border-zinc-800 text-gold-brand rounded-xl h-11 px-3 text-sm focus:border-gold-brand focus:outline-none font-bold text-right" />
                  {bulkRows.length > 1 && (
                    <button onClick={() => setBulkRows(prev => prev.filter((_, j) => j !== i))} className="text-zinc-600 hover:text-rose-400 p-1.5 shrink-0 cursor-pointer" aria-label="Remove row">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={() => {
              const rows = bulkRows.filter(r => r.name.trim() && (parseFloat(r.price) || 0) > 0);
              if (rows.length === 0) { triggerToast('Add at least one name + price', 'error'); return; }
              const now = Date.now();
              rows.forEach((r, idx) => onAddProduct({
                id: `p-${now}-${idx}`, name: r.name.trim(),
                category: bulkCategory || categories[0] || 'General',
                cost: 0, price: parseFloat(r.price) || 0,
                // Kitchen snacks start at zero — the batch arrives via Morning Production.
                stockQty: (bulkCategory || categories[0] || '') === 'Eatery' ? 0 : 1, lowStockThreshold: 1,
              }));
              setShowBulk(false);
              triggerToast(`${rows.length} products added — open each later for details`, 'success');
            }} className="w-full h-12 bg-gold-brand hover:bg-gold-medium text-black font-black uppercase tracking-widest text-xs rounded-xl">
              Save all ({bulkRows.filter(r => r.name.trim() && (parseFloat(r.price) || 0) > 0).length})
            </button>
          </div>
        </div>
      )}

      {/* CSV IMPORT MODAL (Excel list in, typed stock out) */}
      {showImport && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="boss-card w-full max-w-lg p-6 bg-zinc-950 border border-white/5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-3 border-b border-white/5">
              <h3 className="text-sm font-black text-white uppercase tracking-wider font-display flex items-center gap-2">
                <Upload className="w-5 h-5 text-gold-brand" /> Import stock list
              </h3>
              <button onClick={() => setShowImport(false)} className="text-zinc-500 hover:text-white p-1 cursor-pointer" aria-label="Close import">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-[11px] text-zinc-500 leading-snug">From Excel: fill the template, save as CSV, pick the file. Headings: name, category, cost, price, stock, low_threshold. Items already on the shelf are skipped.</p>
            <div className="flex gap-2">
              <button onClick={downloadImportTemplate}
                className="flex-1 h-11 border border-zinc-800 hover:border-gold-brand/40 text-zinc-300 font-black uppercase tracking-wider text-xs rounded-xl cursor-pointer">
                Template
              </button>
              <button onClick={() => importFileRef.current?.click()}
                className="flex-1 h-11 bg-gold-brand hover:bg-gold-medium text-black font-black uppercase tracking-widest text-xs rounded-xl cursor-pointer">
                Choose CSV
              </button>
              <input ref={importFileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden"
                onChange={(e) => { readImportFile(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
            {importFileName && (
              <p className="text-[11px] text-zinc-400 font-bold truncate">File: {importFileName}</p>
            )}
            {importResult && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-wider">
                  <span className="px-2.5 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-800/40 text-emerald-300">{freshImportRows.length} ready</span>
                  {importDupes > 0 && (
                    <span className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400">{importDupes} already on shelf</span>
                  )}
                  {importResult.errors.length > 0 && (
                    <span className="px-2.5 py-1.5 rounded-lg bg-rose-950/40 border border-rose-800/40 text-rose-300">{importResult.errors.length} problem{importResult.errors.length === 1 ? '' : 's'}</span>
                  )}
                </div>
                {importResult.errors.length > 0 && (
                  <div className="bg-rose-950/20 border border-rose-900/40 rounded-xl p-3 space-y-1 max-h-28 overflow-y-auto">
                    {importResult.errors.map((err, i) => (
                      <p key={i} className="text-[11px] text-rose-300 font-bold leading-snug">{err}</p>
                    ))}
                  </div>
                )}
                {freshImportRows.length > 0 && (
                  <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl divide-y divide-white/5 max-h-44 overflow-y-auto">
                    {freshImportRows.slice(0, 8).map((r, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                        <span className="font-bold text-zinc-200 truncate min-w-0">{r.name} <span className="text-zinc-500">· {r.category} · ×{r.stockQty}</span></span>
                        <span className="font-black text-gold-brand tabular-nums shrink-0">{formatCurrency(r.price)}</span>
                      </div>
                    ))}
                    {freshImportRows.length > 8 && (
                      <p className="px-3 py-2 text-[10px] text-zinc-500 font-bold uppercase">+{freshImportRows.length - 8} more…</p>
                    )}
                  </div>
                )}
                <button onClick={confirmImport} disabled={freshImportRows.length === 0}
                  className={`w-full h-12 font-black uppercase tracking-widest text-xs rounded-xl transition-all ${freshImportRows.length === 0 ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed' : 'bg-gold-brand hover:bg-gold-medium text-black cursor-pointer'}`}>
                  Import {freshImportRows.length} product{freshImportRows.length === 1 ? '' : 's'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

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

            <div className="flex gap-1.5 bg-zinc-900 rounded-xl p-1">
              <button onClick={() => setQuickMode(true)}
                className={`flex-1 h-9 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all cursor-pointer ${quickMode ? 'bg-gold-brand text-black' : 'text-zinc-500 hover:text-zinc-300'}`}>
                Quick
              </button>
              <button onClick={() => setQuickMode(false)}
                className={`flex-1 h-9 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all cursor-pointer ${!quickMode ? 'bg-gold-brand text-black' : 'text-zinc-500 hover:text-zinc-300'}`}>
                Full details
              </button>
            </div>

            {quickMode ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">What are you selling?</label>
                  <input type="text" placeholder="e.g. Chapati, Coke 500ml" value={newName} onChange={(e) => setNewName(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-12 px-4 text-sm focus:border-gold-brand focus:outline-none" autoFocus />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">Which business?</label>
                    <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 text-gold-brand rounded-xl h-12 px-2 text-xs focus:border-gold-brand outline-none font-bold">
                      {categoriesList.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">Selling price</label>
                    <input type="number" min="0" placeholder="e.g. 1000" value={newPrice} onChange={(e) => setNewPrice(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 text-gold-brand rounded-xl h-12 px-4 text-sm font-black focus:border-gold-brand focus:outline-none tabular-nums" />
                  </div>
                </div>
                {(newCategory === 'Eatery' || newCategory === 'Drinks') ? (
                  <p className="text-[11px] font-bold text-amber-300/90 bg-amber-950/25 border border-amber-800/30 rounded-xl px-3 py-2.5 leading-snug">
                    Starts at zero — log today's batch in Sell → Production.
                  </p>
                ) : (
                  <div>
                    <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">How many do you have?</label>
                    <input type="number" min="0" placeholder="e.g. 24" value={newStock} onChange={(e) => setNewStock(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-12 px-4 text-sm focus:border-gold-brand focus:outline-none tabular-nums" />
                  </div>
                )}
                <button onClick={handleCreateProduct}
                  className="w-full h-12 bg-gold-brand hover:bg-gold-medium text-black font-black uppercase tracking-widest text-xs rounded-xl shadow-lg active:scale-[0.99] transition-all cursor-pointer">
                  Add it — start selling
                </button>
                <p className="text-[10px] text-zinc-600 font-bold uppercase text-center">Cost defaults to 0 — add it later for true profit.</p>
              </div>
            ) : (
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
                <p className="text-[10px] text-zinc-600 font-bold uppercase">
                  Photo not working? Save without one — you can attach it later from this screen.
                </p>
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
                  <select value={newCategory} onChange={(e) => { const v = e.target.value; setNewCategory(v); if ((v === 'Eatery' || v === 'Drinks') && !newRecipe) setNewRecipe(emptyRecipe()); }}
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

              <div className="flex items-center gap-3 bg-zinc-900 rounded-xl px-4 py-3 border border-zinc-800">
                <label className="text-xs text-zinc-400 font-bold uppercase">Service?</label>
                <button onClick={() => setNewIsService(!newIsService)}
                  className={`relative w-11 h-6 rounded-full transition-all ${newIsService ? 'bg-gold-brand' : 'bg-zinc-700'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${newIsService ? 'left-5' : 'left-0.5'}`}></span>
                </button>
                <span className="text-xs text-zinc-500">{newIsService ? 'No stock tracking' : 'Stock tracked'}</span>
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

              {newIsService ? (
                <p className="text-[11px] font-bold text-zinc-500 bg-zinc-900/60 border border-zinc-800/60 rounded-xl px-3 py-2.5 leading-snug">
                  Service — no stock to count. It sells without touching stock.
                </p>
              ) : newCategory === 'Eatery' ? (
                <>
                  <div className="bg-amber-950/25 border border-amber-800/30 rounded-xl px-3 py-2.5">
                    <p className="text-[11px] font-bold text-amber-300/90 leading-snug">
                      Kitchen snack — starts at zero. Today's batch arrives through Sell → Morning Production, which is the only place its stock comes from.
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">Alert when below</label>
                    <input type="number" step="any" value={newThreshold} onChange={(e) => setNewThreshold(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
                  </div>
                </>
              ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">Stock Quantity</label>
                  <input type="number" step="any" value={newStock} onChange={(e) => setNewStock(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">Alert when below</label>
                  <input type="number" step="any" value={newThreshold} onChange={(e) => setNewThreshold(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
                </div>
              </div>
              )}

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

              <div>
                <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">
                  Expires on (drugs, milk, chemicals — warns 30 days ahead)
                </label>
                <input type="date" value={newExpiry} onChange={(e) => setNewExpiry(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">
                  Per unit (e.g. page, copy, meter) — price shown as "{formatCurrency(parseFloat(newPrice) || 0)} / unit"
                </label>
                <input type="text" placeholder="Empty = sold per item; e.g. 'page' for printing" value={newSaleUnit} onChange={(e) => setNewSaleUnit(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
              </div>

              <div className="bg-zinc-900/60 rounded-xl p-3 border border-zinc-800/60">
                <div className="flex justify-between items-center mb-1">
                  <h4 className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
                    <ListChecks className="w-3.5 h-3.5 text-gold-brand" /> Product Options
                  </h4>
                  <button onClick={addNewVariant} className="text-gold-brand text-xs font-bold flex items-center gap-1 hover:text-gold-light transition-colors">
                    <PlusCircle className="w-3.5 h-3.5" /> Add
                  </button>
                </div>
                <p className="text-[11px] text-zinc-500 mb-2">Sellable sizes/prices for this snack (e.g. Single / Couple / Big)</p>
                {newVariants.length === 0 ? (
                  <p className="text-xs text-zinc-600 italic">No options yet. Tap Add to create one.</p>
                ) : (
                  <div className="space-y-2">
                    {newVariants.map(v => (
                      <div key={v.id} className="flex items-center gap-2">
                        <input value={v.label} placeholder="Label"
                          onChange={(e) => updateNewVariant(v.id, { label: e.target.value })}
                          className="flex-1 min-w-0 bg-zinc-950 border border-zinc-800 text-gold-light rounded-lg h-9 px-2 text-xs focus:border-gold-brand focus:outline-none" />
                        <input type="number" min="0" value={v.price || ''} placeholder="Price"
                          onChange={(e) => updateNewVariant(v.id, { price: parseFloat(e.target.value) || 0 })}
                          className="w-20 bg-zinc-950 border border-zinc-800 text-gold-brand rounded-lg h-9 px-2 text-xs focus:border-gold-brand focus:outline-none font-bold text-right" />
                        <input type="number" min="0" value={v.cost ?? ''} placeholder="Cost?"
                          onChange={(e) => updateNewVariant(v.id, { cost: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                          className="w-16 bg-zinc-950 border border-zinc-800 text-zinc-400 rounded-lg h-9 px-2 text-xs focus:border-gold-brand focus:outline-none text-right" />
                        <button onClick={() => removeNewVariant(v.id)} className="text-rose-400 hover:text-rose-300 p-1.5 shrink-0">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            {(newCategory === 'Eatery' || newCategory === 'Drinks') && renderRecipeCard(newRecipe, setNewRecipe, newPrice, setNewPrice, setNewVariants)}
            </div>
            )}

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

            <div>
              <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">
                Per unit (e.g. page, copy, meter) {editIsService && editSaleUnit ? <span className="text-gold-brand normal-case">— sold as "{editSaleUnit}", price is per {editSaleUnit}</span> : null}
              </label>
              <input type="text" placeholder="Leave empty to sell per item" value={editSaleUnit} onChange={(e) => setEditSaleUnit(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
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
            {editingProduct && (() => {
              const hist = getPriceHistory(editingProduct.id).slice(0, 5);
              if (hist.length === 0) return null;
              return (
                <details>
                  <summary className="text-[10px] font-black text-zinc-500 uppercase tracking-widest cursor-pointer hover:text-zinc-300">
                    Price history ({hist.length})
                  </summary>
                  <div className="mt-1.5 space-y-1">
                    {hist.map((h, i) => (
                      <p key={`${h.at}-${i}`} className="text-[11px] text-zinc-500 font-bold tabular-nums">
                        {new Date(h.at).toLocaleDateString()} • {formatCurrency(h.oldPrice)} → <span className="text-zinc-200">{formatCurrency(h.newPrice)}</span>
                        {h.by ? <span className="text-zinc-600"> • {h.by}</span> : null}
                      </p>
                    ))}
                  </div>
                </details>
              );
            })()}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5 flex items-center gap-1">
                  Category
                  <button onClick={() => setShowCategoryManager(true)}
                    className="p-0.5 text-zinc-500 hover:text-gold-brand transition-colors" title="Manage Categories">
                    <Settings2 className="w-3 h-3" />
                  </button>
                </label>
                <select value={editCategory} onChange={(e) => { const v = e.target.value; setEditCategory(v); if ((v === 'Eatery' || v === 'Drinks') && !editRecipe) setEditRecipe(emptyRecipe()); }}
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

            {editingProduct && (
              <div className="bg-zinc-900/60 rounded-xl p-3 border border-zinc-800/60">
                <h4 className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-1.5 mb-1">
                  <Truck className="w-3.5 h-3.5 text-gold-brand" /> Supplier prices
                </h4>
                <p className="text-[11px] text-zinc-500 mb-2">Record what each supplier charges — cheapest is flagged, and reorders go out on WhatsApp.</p>
                {(() => {
                  const quotes = quotesForProduct(supplierPrices, editingProduct.id);
                  const best = bestQuoteFor(supplierPrices, editingProduct.id);
                  const qty = restockQtyFor({ ...editingProduct, stockQty: editingProduct.stockQty, lowStockThreshold: parseFloat(editThreshold) || editingProduct.lowStockThreshold });
                  return (
                    <>
                      {quotes.length === 0 ? (
                        <p className="text-xs text-zinc-600 italic">No quotes yet. Add the first one below.</p>
                      ) : (
                        <div className="space-y-2 mb-2">
                          {quotes.map(q => {
                            const sup = suppliers.find(s => s.id === q.supplierId);
                            const wa = sup ? supplierWhatsAppUrl(sup.phone, buildRestockMessage(shopName, sup.name, [{ name: editingProduct.name, qty }])) : null;
                            return (
                              <div key={q.id} className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5">
                                <span className="flex-1 min-w-0 text-xs font-bold text-zinc-200 truncate">{sup?.name || 'Unknown supplier'}</span>
                                {best?.id === q.id && <span className="text-[9px] font-black bg-gold-brand text-black px-1.5 py-0.5 rounded uppercase">Best</span>}
                                <span className="text-xs font-bold text-gold-brand tabular-nums">{formatCurrency(q.price)}</span>
                                {wa ? (
                                  <a href={wa} target="_blank" rel="noopener noreferrer" className="text-[10px] font-black uppercase text-emerald-400 hover:text-emerald-300 px-1.5 py-1">Order</a>
                                ) : (
                                  <button onClick={() => triggerToast('Add a phone number for this supplier first (Reports → Suppliers)', 'error')} className="text-[10px] font-black uppercase text-zinc-600 px-1.5 py-1">Order</button>
                                )}
                                <button onClick={() => onDeleteQuote(q.id)} className="text-rose-400 hover:text-rose-300 p-1" title="Delete quote"><X className="w-3.5 h-3.5" /></button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <select value={quoteSupplierId} onChange={(e) => setQuoteSupplierId(e.target.value)}
                          className="flex-1 min-w-0 bg-zinc-950 border border-zinc-800 text-zinc-300 rounded-lg h-9 px-2 text-xs focus:border-gold-brand focus:outline-none">
                          <option value="">Supplier…</option>
                          {suppliers.map(sup => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
                        </select>
                        <input type="number" min="0" value={quotePrice} onChange={(e) => setQuotePrice(e.target.value)} placeholder="Price"
                          className="w-24 bg-zinc-950 border border-zinc-800 text-gold-brand rounded-lg h-9 px-2 text-xs focus:border-gold-brand focus:outline-none font-bold text-right" />
                        <button onClick={() => {
                          const amt = parseFloat(quotePrice) || 0;
                          if (!quoteSupplierId) { triggerToast('Pick a supplier first', 'error'); return; }
                          if (amt <= 0) { triggerToast('Enter the supplier price', 'error'); return; }
                          onUpsertQuote(quoteSupplierId, editingProduct.id, amt);
                          setQuotePrice('');
                        }} className="h-9 px-3 bg-gold-brand/10 border border-gold-brand/40 text-gold-brand rounded-lg text-xs font-black uppercase hover:bg-gold-brand/20">Add</button>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {!editIsService && (
            <div>
              <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">Alert when stock below</label>
              <input type="number" value={editThreshold} onChange={(e) => setEditThreshold(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
            </div>
            )}

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
              <p className="text-[10px] text-zinc-600 font-bold uppercase">
                Photo not working? Save anyway — you can attach one later from this screen.
              </p>
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

            <div>
              <label className="block text-xs text-zinc-400 font-bold uppercase mb-1.5">
                Expires on (drugs, milk, chemicals — warns 30 days ahead)
              </label>
              <input type="date" value={editExpiry} onChange={(e) => setEditExpiry(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
            </div>

            <div className="bg-zinc-900/60 rounded-xl p-3 border border-zinc-800/60">
              <div className="flex justify-between items-center mb-1">
                <h4 className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
                  <ListChecks className="w-3.5 h-3.5 text-gold-brand" /> Product Options
                </h4>
                <button onClick={addVariant} className="text-gold-brand text-xs font-bold flex items-center gap-1 hover:text-gold-light transition-colors">
                  <PlusCircle className="w-3.5 h-3.5" /> Add
                </button>
              </div>
              <p className="text-[11px] text-zinc-500 mb-2">Sellable sizes/prices for this snack (e.g. Single / Couple / Big)</p>
              {editVariants.length === 0 ? (
                <p className="text-xs text-zinc-600 italic">No options yet. Tap Add to create one.</p>
              ) : (
                <div className="space-y-2">
                  {editVariants.map(v => (
                    <div key={v.id} className="flex items-center gap-2">
                      <input value={v.label} placeholder="Label"
                        onChange={(e) => updateVariant(v.id, { label: e.target.value })}
                        className="flex-1 min-w-0 bg-zinc-950 border border-zinc-800 text-gold-light rounded-lg h-9 px-2 text-xs focus:border-gold-brand focus:outline-none" />
                      <input type="number" min="0" value={v.price || ''} placeholder="Price"
                        onChange={(e) => updateVariant(v.id, { price: parseFloat(e.target.value) || 0 })}
                        className="w-20 bg-zinc-950 border border-zinc-800 text-gold-brand rounded-lg h-9 px-2 text-xs focus:border-gold-brand focus:outline-none font-bold text-right" />
                      <input type="number" min="0" value={v.cost ?? ''} placeholder="Cost?"
                        onChange={(e) => updateVariant(v.id, { cost: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                        className="w-16 bg-zinc-950 border border-zinc-800 text-zinc-400 rounded-lg h-9 px-2 text-xs focus:border-gold-brand focus:outline-none text-right" />
                      <button onClick={() => removeVariant(v.id)} className="text-rose-400 hover:text-rose-300 p-1.5 shrink-0">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {(editCategory === 'Eatery' || editCategory === 'Drinks') && renderRecipeCard(editRecipe, setEditRecipe, editPrice, setEditPrice, setEditVariants)}

            {editIsService ? (
              <p className="text-[11px] font-bold text-zinc-500 bg-zinc-900/60 border border-zinc-800/60 rounded-xl px-3 py-2.5 leading-snug">
                Service — no stock to adjust. It sells without touching stock.
              </p>
            ) : editCategory === 'Eatery' || (editCategory === 'Drinks' && !!editRecipe) ? (
            <div className="bg-zinc-900 p-4 rounded-xl space-y-2 border border-zinc-800/60">
              <h4 className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
                <Truck className="w-3.5 h-3.5 text-gold-brand" /> Stock from production
              </h4>
              <p className="text-xs text-zinc-300 font-bold">
                Today's balance: <span className="text-gold-brand font-black tabular-nums">{editingProduct.stockQty}</span>
              </p>
              <p className="text-[11px] font-bold text-amber-300/90 bg-amber-950/25 border border-amber-800/30 rounded-xl px-3 py-2 leading-snug">
                {editCategory === 'Drinks'
                  ? 'Fresh juice stock comes from what you made — log the batch in Registers → Drinks (Morning Production). Depot sodas stay editable: remove the recipe to adjust their stock here.'
                  : "Kitchen snacks can't be typed in here — log the batch in Sell → Morning Production. To fix a wrong entry, delete it there and the balance corrects itself."}
              </p>
            </div>
            ) : (
            <div className="bg-zinc-900 p-4 rounded-xl space-y-3 border border-zinc-800/60">
              <div className="flex gap-2">
                <button onClick={() => setAdjustmentType('add')}
                  className={`flex-1 h-11 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${
                    adjustmentType === 'add' ? 'bg-emerald-950/20 border-emerald-500 text-emerald-400' : 'bg-zinc-950 border-zinc-800 text-zinc-500'
                  }`}>+ More arrived</button>
                <button onClick={() => setAdjustmentType('remove')}
                  className={`flex-1 h-11 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${
                    adjustmentType === 'remove' ? 'bg-rose-950/20 border-rose-500 text-rose-400' : 'bg-zinc-950 border-zinc-800 text-zinc-500'
                  }`}>- Used / Sold</button>
                <button onClick={() => setAdjustmentType('set')}
                  className={`flex-1 h-11 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${
                    adjustmentType === 'set' ? 'bg-gold-brand/15 border-gold-brand text-gold-brand' : 'bg-zinc-950 border-zinc-800 text-zinc-500'
                  }`}>= Set exact</button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500 font-bold uppercase">{adjustmentType === 'set' ? 'New total' : 'Qty:'}</span>
                <input type="number" min="0" step="any" value={stockAdjustment === 0 ? '' : stockAdjustment} placeholder={adjustmentType === 'set' ? '40' : '0'}
                  onChange={(e) => setStockAdjustment(parseQty(e.target.value))}
                  className="w-24 bg-zinc-950 border border-zinc-800 text-gold-light rounded text-center text-xs h-8 focus:border-gold-brand focus:outline-none font-bold" />
                <span className="text-xs text-zinc-400 font-bold uppercase">(Current: {editingProduct.stockQty})</span>
                </div>
                {adjustmentType === 'add' && onAddExpense && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500 font-bold uppercase">Paid (UGX):</span>
                    <input type="number" min="0" value={stockPaid} placeholder={stockAdjustment > 0 && (parseFloat(editCost) || 0) > 0 ? String(Math.round(stockAdjustment * (parseFloat(editCost) || 0))) : '0 = free'}
                      onChange={(e) => setStockPaid(e.target.value)}
                      className="w-28 bg-zinc-950 border border-zinc-800 text-gold-light rounded text-center text-xs h-8 focus:border-gold-brand focus:outline-none font-bold" />
                    <span className="text-[10px] text-zinc-600 font-bold uppercase">logs a Stock Purchase</span>
                  </div>
                )}
                {(stockAdjustment > 0 || adjustmentType === 'set') && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500 font-bold uppercase">Why:</span>
                    <select value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)}
                      className="flex-1 bg-zinc-950 border border-zinc-800 text-zinc-200 rounded-lg h-8 px-2 text-xs focus:border-gold-brand focus:outline-none font-bold">
                      <option value="">{ADJUST_REASONS[adjustmentType]?.[0] || 'Adjusted'} (default)</option>
                      {ADJUST_REASONS[adjustmentType]?.slice(1).map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                )}
                {editingProduct && readAdjustLog().filter(e => e.productId === editingProduct.id).slice(0, 3).map(e => (
                  <p key={e.ts + e.qty} className="text-[10px] text-zinc-600 font-bold uppercase">
                    {new Date(e.ts).toLocaleDateString()} • {e.type} {e.qty} • {e.reason}
                  </p>
                ))}
              </div>
            )}

            <div className="pt-2 flex gap-3">
              <button onClick={() => setEditingProduct(null)} className="flex-1 h-11 border border-zinc-800 hover:bg-zinc-900 text-zinc-400 font-bold uppercase tracking-wider text-xs rounded-xl">Cancel</button>
              <button onClick={handleSaveEdit} className="flex-1 h-11 bg-gold-brand hover:bg-gold-medium text-black font-black uppercase tracking-widest text-xs rounded-xl shadow-lg flex items-center justify-center gap-2">
                <Save className="w-4 h-4" /> Save
              </button>
            </div>

            <div className="pt-3 border-t border-zinc-800 space-y-2">
              <button onClick={() => {
                  if (!editingProduct) return;
                  const copy: Product = {
                    ...editingProduct,
                    id: `prod-${Date.now()}`,
                    name: `${editingProduct.name} (copy)`,
                    stockQty: editingProduct.isService ? 0 : 0,
                    barcode: undefined, imei: undefined,
                    variants: editingProduct.variants?.map(v => ({ ...v, id: `${v.id}-copy-${Date.now().toString().slice(-4)}` })),
                    recipe: editingProduct.recipe ? JSON.parse(JSON.stringify(editingProduct.recipe)) : undefined,
                  };
                  onAddProduct(copy);
                  triggerToast(`Duplicated — edit "${copy.name}" and set stock`, 'success');
                  setEditingProduct(null);
                }}
                className="w-full h-10 border border-zinc-800 hover:border-gold-brand/40 hover:text-gold-brand text-zinc-400 font-bold uppercase tracking-wider text-xs rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer">
                <Plus className="w-4 h-4" /> Duplicate Product
              </button>
              {!confirmDelete ? (
                <button onClick={() => setConfirmDelete(true)} className="w-full h-10 border border-rose-900/40 hover:bg-rose-950/30 text-rose-400 font-bold uppercase tracking-wider text-xs rounded-xl flex items-center justify-center gap-2 transition-all">
                  <Trash2 className="w-4 h-4" /> Delete Product
                </button>
              ) : (
                <div className="bg-rose-950/20 border border-rose-500/30 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-bold text-rose-400 text-center uppercase">Delete "{editingProduct.name}" for good?</p>
                  <p className="text-[10px] text-zinc-500 font-bold text-center uppercase">Past sales keep the name — only new sales are affected.</p>
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
      </>
      )}
    </div>
  );
}