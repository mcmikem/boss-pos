import { useState } from 'react';
import { X } from 'lucide-react';
import { Product } from '../types';

interface CustomChargeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (product: Product) => void;
  categories: string[];
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export default function CustomChargeModal({ isOpen, onClose, onAdd, categories, triggerToast }: CustomChargeModalProps) {
  const [customItemName, setCustomItemName] = useState('');
  const [customItemPrice, setCustomItemPrice] = useState('');
  const [customItemCategory, setCustomItemCategory] = useState('Custom');

  if (!isOpen) return null;

  const handleAdd = () => {
    const priceNum = parseFloat(customItemPrice);
    if (isNaN(priceNum) || priceNum <= 0) {
      triggerToast('Enter a valid price', 'error');
      return;
    }
    const name = customItemName.trim() || 'Custom Item';
    const fakeProduct: Product = {
      id: `custom-${Date.now()}`,
      name: name,
      category: customItemCategory || 'Custom',
      cost: Math.round(priceNum * 0.5),
      price: priceNum,
      stockQty: 9999,
      lowStockThreshold: 0,
    };
    onAdd(fakeProduct);
    setCustomItemName('');
    setCustomItemPrice('');
    onClose();
  };

  const quickPrices = [500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4">
          <h3 className="text-sm font-black text-white uppercase tracking-wider font-display">+ Custom Item</h3>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <input type="text" placeholder="Item name (e.g. Phone Repair, Cable)" value={customItemName}
            onChange={(e) => setCustomItemName(e.target.value)}
            className="w-full bg-[#0A0A0A] border border-white/5 text-gold-light focus:border-gold-brand h-12 px-4 rounded-xl text-sm outline-none" />
          <input type="number" placeholder="Price (UGX)" value={customItemPrice}
            onChange={(e) => setCustomItemPrice(e.target.value)}
            className="w-full bg-[#0A0A0A] border border-white/5 text-gold-brand font-bold focus:border-gold-brand h-12 px-4 rounded-xl text-sm outline-none" />
          <div>
            <label className="block text-xs text-zinc-500 font-bold uppercase mb-1">Category</label>
            <select value={customItemCategory} onChange={(e) => setCustomItemCategory(e.target.value)}
              className="w-full bg-[#0A0A0A] border border-white/5 text-zinc-300 rounded-xl h-12 px-3 text-xs focus:border-gold-brand outline-none font-bold">
              <option value="Custom">Uncategorized</option>
              {categories.filter(c => c !== 'Custom').map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs text-zinc-500 font-bold uppercase tracking-wider mr-1 w-full">Quick Prices:</span>
            {quickPrices.map(amt => (
              <button key={amt} type="button" onClick={() => setCustomItemPrice(String(amt))}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                  customItemPrice === String(amt) ? 'bg-gold-brand text-black border-gold-brand' : 'bg-[#0A0A0A] text-zinc-400 border-white/5'
                }`}>
                {amt >= 1000 ? `${(amt/1000).toFixed(0)}K` : amt}
              </button>
            ))}
          </div>
          <button onClick={handleAdd}
            className="w-full h-12 bg-gold-brand text-black font-black uppercase text-sm tracking-widest rounded-xl mt-2">+ Add to Cart</button>
        </div>
      </div>
    </div>
  );
}
