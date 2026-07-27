import { useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import { Product, SaleItem } from '../types';

interface LibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  cart: SaleItem[];
  setCart: (updater: (prev: SaleItem[]) => SaleItem[]) => void;
  formatCurrency: (val: number) => string;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export default function LibraryModal({ isOpen, onClose, products, cart, setCart, formatCurrency, triggerToast }: LibraryModalProps) {
  const [libraryQtys, setLibraryQtys] = useState<Record<string, number>>({});
  const libraryProducts = products.filter(p => p.category === 'Library');

  if (!isOpen) return null;

  const handleAddToCart = () => {
    let added = 0;
    Object.entries(libraryQtys).forEach(([id, qty]) => {
      if (qty <= 0) return;
      const product = products.find(p => p.id === id);
      if (!product) return;
      setCart(prev => {
        const existing = prev.find(item => item.productId === id);
        if (existing) {
          return prev.map(item =>
            item.productId === id
              ? { ...item, qty: item.qty + qty, lineTotal: (item.qty + qty) * item.unitPrice }
              : item
          );
        }
        return [...prev, {
          productId: id, productName: product.name, qty,
          unitPrice: product.price, unitCost: product.cost,
          lineTotal: qty * product.price,
        }];
      });
      added += qty;
    });
    if (added > 0) {
      setLibraryQtys({});
      onClose();
      triggerToast(`Added ${added} library items to cart`, 'success');
    } else {
      triggerToast('Select at least one item', 'error');
    }
  };

  const totalItems = Object.values(libraryQtys).reduce((s, v) => s + v, 0);
  const grandTotal = Object.entries(libraryQtys).reduce((sum, [id, qty]) => {
    const p = products.find(p => p.id === id);
    return sum + (p ? qty * p.price : 0);
  }, 0);

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-md max-h-[85vh] overflow-y-auto p-6 shadow-2xl">
        <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-violet-400" />
            <h3 className="text-sm font-black text-white uppercase tracking-wider font-display">Library Services</h3>
          </div>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <p className="text-xs text-zinc-500 mb-4 font-bold uppercase tracking-wider">Select how many of each:</p>

        <div className="space-y-3">
          {libraryProducts.length > 0 ? libraryProducts.map(product => {
            const qty = libraryQtys[product.id] || 0;
            return (
              <div key={product.id} className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4">
                <div className="flex justify-between items-center mb-3">
                  <div>
                    <h4 className="text-sm font-bold text-white uppercase">{product.name}</h4>
                    <p className="text-xs text-gold-brand font-black mt-0.5">{formatCurrency(product.price)} each</p>
                  </div>
                  {qty > 0 && <span className="text-sm font-black text-gold-brand">{formatCurrency(qty * product.price)}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 bg-zinc-950 rounded-xl p-1">
                    {[1, 2, 3, 5, 10].map(n => (
                      <button key={n} onClick={() => setLibraryQtys(prev => ({ ...prev, [product.id]: prev[product.id] === n ? 0 : n }))}
                        className={`min-w-[40px] h-11 rounded-lg text-xs font-bold transition-all cursor-pointer active:scale-95 ${qty === n ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}>
                        {n}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => {
                    const input = prompt('How many?', String(qty || 1));
                    const num = parseInt(input || '0', 10);
                    if (num > 0) setLibraryQtys(prev => ({ ...prev, [product.id]: num }));
                  }}
                    className="h-11 px-3 rounded-lg bg-zinc-800 text-zinc-400 hover:text-white text-xs font-bold transition-all cursor-pointer active:scale-95">
                    +
                  </button>
                  {qty > 0 && (
                    <button onClick={() => setLibraryQtys(prev => ({ ...prev, [product.id]: 0 }))}
                      className="h-11 px-2 rounded-lg text-rose-400 hover:bg-rose-950/30 text-xs font-bold transition-all cursor-pointer active:scale-95">
                      x
                    </button>
                  )}
                </div>
              </div>
            );
          }) : (
            <div className="text-center py-8">
              <BookOpen className="w-10 h-10 text-zinc-600 mx-auto mb-2" />
              <p className="text-xs text-zinc-500 font-bold uppercase">No Library products found</p>
              <p className="text-[10px] text-zinc-600 mt-1">Add Library-category products in Stock first</p>
            </div>
          )}
        </div>

        <div className="mt-6 pt-4 border-t border-white/5 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-xs text-zinc-400 font-bold uppercase">Total Items</span>
            <span className="text-sm font-black text-white">{totalItems}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-zinc-400 font-bold uppercase">Grand Total</span>
            <span className="text-xl font-black text-gold-brand">{formatCurrency(grandTotal)}</span>
          </div>
          <button onClick={handleAddToCart}
            disabled={totalItems === 0}
            className={`w-full h-12 rounded-2xl text-sm font-black uppercase tracking-widest transition-all active:scale-95 cursor-pointer ${
              totalItems > 0
                ? 'bg-violet-600 text-white hover:bg-violet-500 shadow-lg'
                : 'bg-zinc-800 text-zinc-600 cursor-not-allowed opacity-50'
            }`}>
            Add {totalItems > 0 ? `${totalItems} items to cart` : 'to cart'}
          </button>
        </div>
      </div>
    </div>
  );
}
