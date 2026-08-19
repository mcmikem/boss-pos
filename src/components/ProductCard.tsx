import { memo } from 'react';
import { Plus } from 'lucide-react';
import { Product, SaleItem } from '../types';
import { CATEGORY_VISUALS, DEFAULT_CATEGORY_VISUAL } from '../data/categoryVisuals';
import { effectiveCost } from '../utils/recipe';

interface ProductCardProps {
  product: Product;
  cart?: SaleItem[];
  formatCurrency: (val: number) => string;
  onAddToCart: (product: Product) => void;
  onAdjustQty?: (productId: string, delta: number) => void;
  compact?: boolean;
}

const ProductCard = memo(function ProductCard({ product, cart, formatCurrency, onAddToCart, onAdjustQty, compact }: ProductCardProps) {
  const isLowStock = product.stockQty <= product.lowStockThreshold && !product.isService;
  const isOutOfStock = product.stockQty <= 0 && !product.isService;
  const hasVariants = !!product.variants && product.variants.length > 0;
  const minPrice = hasVariants ? Math.min(...(product.variants as { price: number }[]).map(v => v.price)) : product.price;
  const cartItem = cart?.find(item => item.productId === product.id && !item.variantId);
  const catVis = CATEGORY_VISUALS[product.category] || DEFAULT_CATEGORY_VISUAL;
  const CatIcon = catVis.icon;
  const isEatery = product.category === 'Eatery';
  const effCost = isEatery ? effectiveCost(product) : product.cost;
  const marginPct = isEatery && effCost > 0 && product.price > 0 ? ((product.price - effCost) / product.price) * 100 : null;

  if (compact) {
    return (
      <button
        onClick={() => !isOutOfStock && onAddToCart(product)}
        disabled={isOutOfStock}
        className={`w-full flex items-center justify-between bg-zinc-900 border border-zinc-800 hover:border-gold-brand/40 p-4 rounded-xl transition-all text-left cursor-pointer active:scale-[0.98] ${
          isOutOfStock ? 'opacity-30' : ''
        } ${cartItem ? 'border-gold-brand/40 bg-gold-brand/5' : ''}`}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-white uppercase truncate">{product.name}</p>
          <p className="text-[10px] text-zinc-500 font-bold mt-0.5 uppercase">
            {product.category} • {formatCurrency(product.price)}
            {!product.isService && ` • Stock: ${product.stockQty}`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          {cartItem && <span className="text-xs font-black text-gold-brand">x{cartItem.qty}</span>}
          <div className="w-11 h-11 bg-gold-brand text-black rounded-xl flex items-center justify-center font-black text-lg">+</div>
        </div>
      </button>
    );
  }

  return (
    <div
      onClick={() => !isOutOfStock && onAddToCart(product)}
      className={`bg-[#141414] border rounded-2xl overflow-hidden cursor-pointer active:scale-[0.97] transition-all flex flex-col ${
        isOutOfStock
          ? 'opacity-40 border-dashed border-rose-800/40'
          : cartItem
          ? 'border-gold-brand shadow-[0_0_15px_rgba(255,204,0,0.12)]'
          : 'border-white/5 hover:border-gold-brand/30'
      }`}
    >
      {/* aspect-ratio isn't supported on the old Androids this app targets
          (Chrome < 88), so force a square with the padding-top: 100% trick. */}
      <div className="relative w-full" style={{ paddingTop: '100%', backgroundImage: `linear-gradient(to bottom right, ${catVis.gradient.replace(/from-|via-|to-|\/.*/g, '').trim()})` }}>
        {product.imageUrl ? (
          <img referrerPolicy="no-referrer" src={product.imageUrl} alt={product.name}
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />
        ) : (
          <div className={`absolute inset-0 w-full h-full bg-gradient-to-br ${catVis.gradient} flex items-center justify-center`}>
                              <CatIcon className="w-12 h-12 sm:w-14 sm:h-14 opacity-80 drop-shadow-lg" />
                            </div>
        )}
        {isOutOfStock ? (
          <div className="absolute top-2 right-2 bg-rose-950/90 backdrop-blur-sm text-rose-300 text-[10px] font-black px-2.5 py-1 rounded-lg border border-rose-800/50 uppercase tracking-wider">SOLD OUT</div>
        ) : isLowStock ? (
          <div className="absolute top-2 right-2 bg-amber-950/90 backdrop-blur-sm text-amber-300 text-[10px] font-black px-2.5 py-1 rounded-lg border border-amber-800/50 uppercase tracking-wider animate-pulse">LOW ({product.stockQty})</div>
        ) : (
          !product.isService && (
            <div className="absolute top-2 right-2 bg-black/50 backdrop-blur-sm text-zinc-300 text-[10px] font-bold px-2.5 py-1 rounded-lg border border-white/10 uppercase tracking-wider">{product.stockQty}</div>
          )
        )}
      </div>

      <div className="p-3 flex flex-col gap-1.5 flex-1 min-h-0">
        <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wide line-clamp-2 leading-tight min-h-[2.5em]">
          {product.name}
        </h3>
        <div className="flex items-center justify-between mt-auto gap-1">
          <div>
            <p className="text-xs font-black text-gold-brand font-display leading-tight">{formatCurrency(minPrice)}{hasVariants ? '+' : ''}{product.saleUnit ? <span className="text-[10px] text-zinc-400 font-bold normal-case"> / {product.saleUnit}</span> : null}</p>
            {marginPct !== null ? (
              <p className={`text-[10px] font-black uppercase mt-0.5 ${marginPct <= 0 ? 'text-rose-400' : marginPct < 20 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {marginPct <= 0 ? 'LOSS' : `+${marginPct.toFixed(0)}%`}
              </p>
            ) : (
              product.cost > 0 && (
                <p className="text-[10px] text-zinc-600 font-bold uppercase mt-0.5">Cost: {formatCurrency(product.cost)}</p>
              )
            )}
          </div>
          {hasVariants ? (
            <span className="text-[9px] text-amber-400/80 font-black uppercase tracking-wider border border-amber-400/30 bg-amber-950/30 rounded-lg px-2 py-1.5">
              Options
            </span>
          ) : cartItem && onAdjustQty ? (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => onAdjustQty(product.id, -1)} className="touch-target rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-lg font-bold flex items-center justify-center transition-all active:scale-90">-</button>
              <span className="text-sm font-black text-white px-1 min-w-[20px] text-center font-mono">{cartItem.qty}</span>
              <button onClick={() => onAdjustQty(product.id, 1)} className="touch-target rounded-xl bg-gold-brand hover:bg-gold-medium text-black text-lg font-black flex items-center justify-center transition-all active:scale-90">+</button>
            </div>
          ) : (
            <button
              disabled={isOutOfStock}
              onClick={(e) => { e.stopPropagation(); onAddToCart(product); }}
              className="touch-target rounded-xl flex items-center justify-center transition-all active:scale-90 bg-zinc-800 hover:bg-gold-brand text-zinc-400 hover:text-black"
            >
              <Plus className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

export default ProductCard;
