import { X, ChefHat } from 'lucide-react';
import { Product, SaleItem } from '../types';

interface ProfitAnalyzerModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  cart: SaleItem[];
  formatCurrency: (val: number) => string;
}

export default function ProfitAnalyzerModal({ isOpen, onClose, products, cart, formatCurrency }: ProfitAnalyzerModalProps) {
  if (!isOpen) return null;

  const eateryProducts = products.filter(p => p.category === 'Eatery').sort((a, b) => {
    const marginA = a.price > 0 ? ((a.price - a.cost) / a.price) * 100 : -Infinity;
    const marginB = b.price > 0 ? ((b.price - b.cost) / b.price) * 100 : -Infinity;
    return marginA - marginB;
  });

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6 shadow-2xl">
        <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4">
          <div className="flex items-center gap-2">
            <ChefHat className="w-5 h-5 text-amber-400" />
            <h3 className="text-sm font-black text-white uppercase tracking-wider font-display">Profit Analyzer</h3>
          </div>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-3">
          <p className="text-xs text-zinc-500 font-bold uppercase tracking-wider">Per-Product Profitability</p>
          {eateryProducts.length > 0 ? eateryProducts.map(product => {
            const profitPerUnit = product.price - product.cost;
            const marginPct = product.price > 0 ? (profitPerUnit / product.price) * 100 : 0;
            const isLoss = profitPerUnit <= 0;
            const totalSold = cart.filter(c => c.productId === product.id).reduce((s, c) => s + c.qty, 0);
            return (
              <div key={product.id} className={`bg-zinc-900/50 border rounded-2xl p-4 ${isLoss ? 'border-rose-500/30 bg-rose-950/10' : 'border-zinc-800'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${isLoss ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}`}></span>
                    <h4 className="text-sm font-bold text-white uppercase">{product.name}</h4>
                    <span className="text-[10px] text-zinc-500">{product.category}</span>
                  </div>
                  {totalSold > 0 && (
                    <span className="text-[10px] text-gold-brand font-bold">{totalSold} in cart</span>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-3">
                  <div><p className="text-[10px] text-zinc-500 uppercase font-bold">Cost</p><p className="text-xs font-black text-zinc-300">{formatCurrency(product.cost)}</p></div>
                  <div><p className="text-[10px] text-zinc-500 uppercase font-bold">Price</p><p className="text-xs font-black text-gold-brand">{formatCurrency(product.price)}</p></div>
                  <div><p className="text-[10px] text-zinc-500 uppercase font-bold">Profit</p><p className={`text-xs font-black ${isLoss ? 'text-rose-400' : 'text-emerald-400'}`}>{isLoss ? '-' : '+'}{formatCurrency(Math.abs(profitPerUnit))}</p></div>
                  <div><p className="text-[10px] text-zinc-500 uppercase font-bold">Margin</p><p className={`text-xs font-black ${isLoss ? 'text-rose-400' : marginPct < 20 ? 'text-amber-400' : 'text-emerald-400'}`}>{marginPct.toFixed(0)}%</p></div>
                </div>
                {isLoss && <p className="text-[10px] text-rose-400 font-bold mt-2 uppercase tracking-wider">Selling at a loss! Increase price or reduce ingredient cost.</p>}
                {marginPct > 0 && marginPct < 20 && <p className="text-[10px] text-amber-400 font-bold mt-2 uppercase tracking-wider">Low margin — consider raising price or reducing costs.</p>}
              </div>
            );
          }) : (
            <div className="text-center py-8">
              <ChefHat className="w-10 h-10 text-zinc-600 mx-auto mb-2" />
              <p className="text-xs text-zinc-500 font-bold uppercase">No eatery products found</p>
              <p className="text-[10px] text-zinc-600 mt-1">Add products with category "Eatery" in Stock to see profit analysis</p>
            </div>
          )}
        </div>

        <div className="mt-6 pt-4 border-t border-white/5">
          <p className="text-[10px] text-zinc-600 leading-relaxed">
            <strong className="text-zinc-400">Tip:</strong> Use the <span className="text-emerald-400">Expense → Batch Costing</span> tool to log ingredient purchases and calculate per-unit costs.
          </p>
        </div>
      </div>
    </div>
  );
}
