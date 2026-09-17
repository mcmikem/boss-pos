import { memo } from 'react';
import { Plus, Star } from 'lucide-react';
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
  pinned?: boolean;
  onTogglePin?: (productId: string) => void;
  simple?: boolean;
}

const ProductCard = memo(function ProductCard({ product, cart, formatCurrency, onAddToCart, onAdjustQty, compact, pinned, onTogglePin, simple }: ProductCardProps) {
  const isLowStock = product.stockQty <= product.lowStockThreshold && !product.isService;
  const isOutOfStock = product.stockQty <= 0 && !product.isService;
  const hasVariants = !!product.variants && product.variants.length > 0;
  const minPrice = hasVariants ? Math.min(...(product.variants as { price: number }[]).map(v => v.price)) : product.price;
  // Variant-aware in-cart state: ANY line for this product counts (a chapati
  // "Single" line must still light up the card), not just variant-less lines.
  const cartLines = cart?.filter(item => item.productId === product.id) || [];
  const cartQty = cartLines.reduce((s, i) => s + i.qty, 0);
  const cartQtyLabel = Number.isInteger(cartQty) ? String(cartQty) : String(Math.round(cartQty * 1000) / 1000);
  const cartItem = cartLines.find(item => !item.variantId);
  const inCart = cartQty > 0;
  const catVis = CATEGORY_VISUALS[product.category] || DEFAULT_CATEGORY_VISUAL;
  const CatIcon = catVis.icon;
  const isEatery = product.category === 'Eatery' || product.category === 'Drinks';
  const effCost = isEatery ? effectiveCost(product) : product.cost;
  const marginPct = isEatery && effCost > 0 && product.price > 0 ? ((product.price - effCost) / product.price) * 100 : null;

  if (compact) {
    return (
      <button
        onClick={() => !isOutOfStock && onAddToCart(product)}
        disabled={isOutOfStock}
        aria-label={isOutOfStock ? `${product.name}, sold out` : `Add ${product.name} to cart, ${formatCurrency(product.price)}${inCart ? `, ${cartQtyLabel} already in cart` : ''}`}
        className={`w-full flex items-center justify-between bg-zinc-900 border border-zinc-800 hover:border-gold-brand/40 p-4 rounded-xl transition-all text-left cursor-pointer active:scale-[0.98] min-h-[64px] ${
          isOutOfStock ? 'opacity-30' : ''
        } ${inCart ? 'border-gold-brand/40 bg-gold-brand/5' : ''}`}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-100 truncate leading-snug">{product.name}</p>
          <p className="text-[11px] text-zinc-500 font-medium mt-0.5 truncate tracking-wide">
            {product.category} • {formatCurrency(product.price)}
            {!product.isService && ` • ${product.stockQty} left`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          {inCart && <span className="text-xs font-bold text-gold-brand tabular-nums">×{cartQtyLabel}</span>}
          <div className="w-11 h-11 bg-gold-brand text-black rounded-xl flex items-center justify-center font-black text-lg" aria-hidden="true">+</div>
        </div>
      </button>
    );
  }

  // Simple mode (#7): beginners get exactly ONE obvious tap target — the whole
  // card is a single button. No pin star, no stepper, no nested buttons.
  // Tapping adds one; variants still open their picker via onAddToCart.
  if (simple) {
    return (
      <button
        onClick={() => !isOutOfStock && onAddToCart(product)}
        disabled={isOutOfStock}
        aria-label={isOutOfStock ? `${product.name}, sold out` : `Add ${product.name} to cart, ${formatCurrency(minPrice)}${inCart ? `, ${cartQtyLabel} already in cart` : ''}`}
        className={`bg-[#141414] border rounded-2xl overflow-hidden cursor-pointer active:scale-[0.97] transition-all flex flex-col text-left focus-visible:outline-2 focus-visible:outline-gold-brand w-full min-h-[64px] ${
          isOutOfStock
            ? 'opacity-40 border-dashed border-rose-800/40'
            : inCart
            ? 'border-gold-brand shadow-[0_0_15px_rgba(255,204,0,0.12)]'
            : 'border-white/5 hover:border-gold-brand/30'
        }`}
      >
        <div className="relative w-full" style={{ paddingTop: '100%' }}>
          {product.imageUrl ? (
            <img referrerPolicy="no-referrer" src={product.imageUrl} alt=""
              className="absolute inset-0 w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />
          ) : (
            <div className={`absolute inset-0 w-full h-full bg-gradient-to-br ${catVis.gradient} flex items-center justify-center`}>
              <CatIcon className="w-12 h-12 sm:w-14 sm:h-14 opacity-80 drop-shadow-lg" />
            </div>
          )}
          {isOutOfStock ? (
            <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-md text-rose-300 text-[10px] font-bold px-2.5 py-1 rounded-lg border border-white/15 shadow-md uppercase tracking-[0.08em] leading-none">Sold out</div>
          ) : inCart ? (
            <div className="absolute top-2 right-2 bg-gold-brand text-black text-[10px] font-bold px-2.5 py-1 rounded-lg border border-black/20 shadow-md tracking-[0.08em] leading-none tabular-nums">{cartQtyLabel} in cart</div>
          ) : !product.isService ? (
            <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-md text-zinc-200 text-[10px] font-semibold px-2.5 py-1 rounded-lg border border-white/15 shadow-md tracking-[0.08em] leading-none">{product.stockQty}</div>
          ) : null}
        </div>
        <div className="p-3 flex flex-col gap-1 flex-1 min-h-0 w-full">
          <span className="text-[15px] font-bold text-zinc-100 leading-snug line-clamp-2 min-h-[2.5em]">
            {product.name}
          </span>
          <span className="flex items-center justify-between mt-auto gap-2">
            <span className="text-xs font-semibold text-zinc-400 truncate tabular-nums">{formatCurrency(minPrice)}{hasVariants ? '+' : ''}</span>
            <span className="shrink-0 h-10 px-4 bg-gold-brand text-black rounded-xl flex items-center justify-center font-black text-xs uppercase tracking-wider" aria-hidden="true">
              {hasVariants ? 'Choose' : <Plus className="w-5 h-5" />}
            </span>
          </span>
        </div>
      </button>
    );
  }

  return (
    <div
      role="button"
      tabIndex={isOutOfStock ? -1 : 0}
      aria-label={isOutOfStock ? `${product.name}, sold out` : `${product.name}, ${formatCurrency(minPrice)}${hasVariants ? ' and up, has options' : ''}${!product.isService ? `, ${product.stockQty} in stock` : ''}${inCart ? `, ${cartQtyLabel} in cart` : ''}. Activate to ${hasVariants ? 'choose options' : 'add to cart'}.`}
      aria-disabled={isOutOfStock}
      onClick={() => !isOutOfStock && onAddToCart(product)}
      onKeyDown={(e) => {
        if (isOutOfStock) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAddToCart(product); }
      }}
      className={`bg-[#141414] border rounded-2xl overflow-hidden cursor-pointer active:scale-[0.97] transition-all flex flex-col focus-visible:outline-2 focus-visible:outline-gold-brand ${
        isOutOfStock
          ? 'opacity-40 border-dashed border-rose-800/40'
          : inCart
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
        {/* Pin fast sellers to the top strip (Sell screen). stopPropagation
            so pinning never adds to cart. */}
        {onTogglePin && (
          <button onClick={(e) => { e.stopPropagation(); onTogglePin(product.id); }}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label={pinned ? 'Unpin from fast sellers' : 'Pin as fast seller'}
            aria-pressed={!!pinned}
            title={pinned ? 'Unpin from fast sellers' : 'Pin as fast seller'}
            className={`absolute top-2 left-2 w-8 h-8 rounded-lg border flex items-center justify-center shadow-md transition-all active:scale-90 cursor-pointer ${
              pinned ? 'bg-gold-brand border-black/20 text-black' : 'bg-black/70 backdrop-blur-md border-white/15 text-zinc-400'
            }`}>
            <Star className={`w-4 h-4 ${pinned ? 'fill-black' : ''}`} />
          </button>
        )}
        {/* Mistake 1 fix: badges sit on ANY product photo (dark, bright, busy), so
            they get a solid container + outline + shadow — never bare text/icons
            on the image. See video "icons lost in the image". */}
        {isOutOfStock ? (
          <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-md text-rose-300 text-[10px] font-bold px-2.5 py-1 rounded-lg border border-white/15 shadow-md uppercase tracking-[0.08em] leading-none">Sold out</div>
        ) : inCart && !product.isService ? (
          <div className="absolute top-2 right-2 bg-gold-brand text-black text-[10px] font-bold px-2.5 py-1 rounded-lg border border-black/20 shadow-md tracking-[0.08em] leading-none tabular-nums">{cartQtyLabel} in cart</div>
        ) : isLowStock ? (
          <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-md text-amber-300 text-[10px] font-bold px-2.5 py-1 rounded-lg border border-white/15 shadow-md tracking-[0.08em] leading-none">Only {product.stockQty} left</div>
        ) : (
          !product.isService && (
            <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-md text-zinc-200 text-[10px] font-semibold px-2.5 py-1 rounded-lg border border-white/15 shadow-md tracking-[0.08em] leading-none">{product.stockQty}</div>
          )
        )}
      </div>

      <div className="p-3 flex flex-col gap-1 flex-1 min-h-0">
        {/* Mistake 7 fix: title stands out without shouting — sentence case,
            semibold (not black/uppercase), tight leading for easy scanning. */}
        {/* Names first (scanning), price second: new users look for the item,
            not the number. */}
        <h3 className="text-sm sm:text-[15px] font-semibold text-zinc-100 leading-snug line-clamp-2 min-h-[2.5em]">
          {product.name}
        </h3>
        {/* Mistake 9 fix: trust signal (stock) lives next to the title/price,
            not only as a far-away badge — "what is it, can I trust it, how much". */}
        <div className="flex items-center justify-between mt-auto gap-1">
          <div className="min-w-0">
            <p className="text-xs sm:text-[13px] font-bold text-gold-brand font-display leading-tight truncate tabular-nums">{formatCurrency(minPrice)}{hasVariants ? '+' : ''}{product.saleUnit ? <span className="text-[10px] text-zinc-400 font-semibold"> / {product.saleUnit}</span> : null}</p>
            {isLowStock && !isOutOfStock && !product.isService ? (
              <p className="text-[11px] font-semibold text-amber-400/90 mt-0.5">Only {product.stockQty} left</p>
            ) : marginPct !== null ? (
              <p className={`text-[11px] font-bold mt-0.5 ${marginPct <= 0 ? 'text-rose-400' : marginPct < 20 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {marginPct <= 0 ? 'Loss' : `+${marginPct.toFixed(0)}%`}
              </p>
            ) : (
              product.cost > 0 && (
                <p className="text-[11px] text-zinc-500 font-medium mt-0.5">{formatCurrency(product.cost)}</p>
              )
            )}
          </div>
          {hasVariants ? (
            <span className="text-[10px] text-amber-300/90 font-semibold tracking-[0.06em] border border-white/10 bg-white/5 rounded-lg px-2 py-1.5">
              Options
            </span>
          ) : cartItem && onAdjustQty ? (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <button onClick={() => onAdjustQty(product.id, -1)} aria-label={`Remove one ${product.name} from cart`} className="touch-target rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-lg font-bold flex items-center justify-center transition-all active:scale-90">-</button>
              <span className="text-sm font-black text-white px-1 min-w-[20px] text-center font-mono tabular-nums" aria-live="polite">{cartItem.qty}</span>
              <button onClick={() => onAdjustQty(product.id, 1)} aria-label={`Add one more ${product.name} to cart`} className="touch-target rounded-xl bg-gold-brand hover:bg-gold-medium text-black text-lg font-black flex items-center justify-center transition-all active:scale-90">+</button>
            </div>
          ) : (
            <button
              disabled={isOutOfStock}
              onClick={(e) => { e.stopPropagation(); onAddToCart(product); }}
              aria-label={isOutOfStock ? `${product.name} is sold out` : `Add ${product.name} to cart`}
              className="touch-target rounded-xl flex items-center justify-center transition-all active:scale-90 bg-zinc-800 hover:bg-gold-brand text-zinc-400 hover:text-black disabled:opacity-40 disabled:cursor-not-allowed"
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
