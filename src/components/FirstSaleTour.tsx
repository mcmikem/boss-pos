import { useState, useEffect, useCallback } from 'react';
import { MousePointerClick } from 'lucide-react';

// Guided first sale: a spotlight + animated tap pointer that walks a brand-new
// till from empty shelf to first close-out. The overlay NEVER eats taps —
// everything except the tip card is pointer-events-none, so the seller really
// taps the product, the cart and the nav buttons themselves. Auto-advances on
// real progress (product tapped → sale rung), skippable anywhere, never shows
// again once finished or dismissed.
const TOUR_KEY = 'boss_pos_tour_done';
export const isTourDone = () => {
  try { return localStorage.getItem(TOUR_KEY) === '1'; } catch { return false; }
};

interface TourProps {
  step: number;
  setStep: (n: number) => void;
  onDone: () => void;
  onNavigate: (tab: 'sales' | 'inventory' | 'registers') => void;
  cartCount: number;
  hasProducts: boolean;
  activeTab: string;
}

const exists = (sel: string | null): string | null => {
  if (!sel || typeof document === 'undefined') return null;
  try { return document.querySelector(sel) ? sel : null; } catch { return null; }
};

const firstExisting = (...sels: (string | null)[]): string | null => {
  for (const s of sels) {
    const hit = exists(s);
    if (hit) return hit;
  }
  return null;
};

function useTarget(selector: string | null) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!selector) { setRect(null); return; }
    const update = () => {
      const el = document.querySelector(selector);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    update();
    // Bring the target on screen once per step so the pointer is visible.
    try { document.querySelector(selector)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch {}
    const t = setTimeout(update, 400);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    const iv = setInterval(update, 800);
    return () => { clearTimeout(t); clearInterval(iv); window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); };
  }, [selector]);
  return rect;
}

export default function FirstSaleTour({ step, setStep, onDone, onNavigate, cartCount, hasProducts, activeTab }: TourProps) {
  // Step 1 completes itself the moment something lands in the cart.
  useEffect(() => {
    if (step === 1 && hasProducts && cartCount > 0) {
      const t = setTimeout(() => setStep(2), 600);
      return () => clearTimeout(t);
    }
  }, [step, hasProducts, cartCount, setStep]);

  const finish = useCallback(() => {
    try { localStorage.setItem(TOUR_KEY, '1'); } catch {}
    onDone();
  }, [onDone]);

  // Step targets: best-effort selectors, sales tab first, nav buttons as the
  // fallback when the seller wandered to another tab. Missing target =
  // bottom sheet tip, never a crash.
  const onSalesTab = activeTab === 'sales';
  const catalogFirst = '#catalog-scroll-container .grid > *:first-child';
  const cartSel = firstExisting('#mobile-cart-fab', '#desktop-cart');
  const stockSel = firstExisting('#inventory-nav-btn', '#more-nav-btn');
  const closeSel = firstExisting('#registers-nav-btn', '#more-nav-btn');
  const salesSel = firstExisting('#sales-nav-btn', '#more-nav-btn');
  const addSel = firstExisting('#tour-add-product');

  const onInventoryTab = activeTab === 'inventory';
  const prodTarget = onSalesTab ? firstExisting(catalogFirst) : salesSel;
  const chargeTarget = onSalesTab ? cartSel : salesSel;
  const emptyTarget = onInventoryTab ? (addSel || stockSel) : stockSel;

  const steps = [
    {
      title: 'Sell your first item in 3 taps',
      body: 'Watch the flashing pointer — it shows exactly where to tap. Your taps go straight through to the till.',
      target: null as string | null,
      actions: [
        { label: 'Start', primary: true, run: () => setStep(1) },
        { label: 'Skip', primary: false, run: finish },
      ],
    },
    hasProducts
      ? {
          title: '1 · Tap the flashing product',
          body: 'Tap the product inside the gold ring — it drops straight into the cart.',
          target: prodTarget,
          actions: [
            { label: cartCount > 0 ? 'Next' : 'I tapped it', primary: true, run: () => setStep(2) },
            { label: 'Skip', primary: false, run: finish },
          ],
        }
      : {
          title: onInventoryTab ? '1 · Tap the gold + button' : '1 · Open Stock first',
          body: onInventoryTab
            ? 'Tap the gold + button, fill name + price + how many, hit Save — then head back to Sell.'
            : 'The shelf is empty. Tap the flashing Stock button and add one thing you sell.',
          target: emptyTarget,
          actions: [
            { label: onInventoryTab ? 'Back to Sell' : 'Go to Stock', primary: true, run: () => onNavigate(onInventoryTab ? 'sales' : 'inventory') },
            { label: 'Skip', primary: false, run: finish },
          ],
        },
    {
      title: '2 · Charge inside the cart',
      body: onSalesTab
        ? 'Tap the flashing cart, pick Cash (or MoMo), then hit the big Complete sale button.'
        : 'Head back to Sell first — then tap the flashing cart.',
      target: chargeTarget,
      actions: [
        ...(onSalesTab ? [] : [{ label: 'Back to Sell', primary: true, run: () => onNavigate('sales') }]),
        { label: 'Next', primary: true, run: () => setStep(3) },
        { label: 'Skip', primary: false, run: finish },
      ],
    },
    {
      title: '3 · Close the day tonight',
      body: 'Tap the flashing Close day button: count the drawer against what the till expected. Two minutes, then you know the day.',
      target: closeSel,
      actions: [
        { label: 'Open Close day', primary: true, run: () => { onNavigate('registers'); finish(); } },
        { label: 'Later', primary: false, run: finish },
      ],
    },
  ];
  const s = steps[Math.min(step, steps.length - 1)];
  const rect = useTarget(s.target);
  const cx = rect ? rect.left + rect.width / 2 : 0;
  const cy = rect ? rect.top + rect.height / 2 : 0;
  // Card sits above the target when there is room, otherwise below the tap
  // pointer so the two never overlap.
  const placeAbove = !!rect && rect.top > 330;
  const cardStyle: React.CSSProperties = !rect
    ? { left: 16, right: 16, bottom: 'calc(5.5rem + env(safe-area-inset-bottom))' }
    : placeAbove
      ? { left: 16, right: 16, bottom: Math.max(8, window.innerHeight - rect.top + 16) }
      : { left: 16, right: 16, top: rect.bottom + 88 };

  return (
    <div className="fixed inset-0 z-[90] pointer-events-none" role="dialog" aria-label="First sale tour">
      {rect ? (
        <>
          <div className="absolute inset-x-0 top-0 bg-black/70" style={{ height: Math.max(0, rect.top - 8) }} />
          <div className="absolute inset-x-0 bottom-0 bg-black/70" style={{ top: rect.bottom + 8 }} />
          <div className="absolute top-0 bottom-0 bg-black/70" style={{ left: 0, width: Math.max(0, rect.left - 8), top: rect.top - 8, height: rect.height + 16 }} />
          <div className="absolute top-0 bottom-0 bg-black/70" style={{ right: 0, width: Math.max(0, window.innerWidth - rect.right - 8), top: rect.top - 8, height: rect.height + 16 }} />
          <div className="absolute border-[3px] border-gold-brand rounded-2xl pointer-events-none animate-pulse"
            style={{ left: rect.left - 8, top: rect.top - 8, width: rect.width + 16, height: rect.height + 16 }} />
          {/* Animated tap pointer: ripple + bouncing cursor + TAP tag, fixed
              on the target's center so the seller sees exactly where to hit. */}
          <div className="absolute" style={{ left: cx, top: cy }}>
            <div className="relative -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
              <span className="absolute top-1 inline-flex h-12 w-12 rounded-full bg-gold-brand/60 animate-ping" />
              <MousePointerClick className="relative w-8 h-8 text-gold-brand animate-bounce drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)]" />
              <span className="relative mt-1 text-[10px] font-black uppercase tracking-widest text-black bg-gold-brand rounded-md px-2 py-0.5">Tap</span>
            </div>
          </div>
        </>
      ) : (
        <div className="absolute inset-0 bg-black/70" />
      )}
      <div className="absolute max-w-md mx-auto pointer-events-auto" style={cardStyle}>
        {!rect && <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-zinc-700" />}
        <div className="bg-[#141414] border border-gold-brand/40 rounded-3xl p-5 shadow-2xl">
          <div className="flex items-center gap-1.5 mb-2">
            {steps.map((_, i) => (
              <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-gold-brand' : 'bg-zinc-800'}`} />
            ))}
          </div>
          <h3 className="text-sm font-black text-white uppercase tracking-wider">{s.title}</h3>
          <p className="text-xs text-zinc-300 font-bold mt-1 leading-relaxed">{s.body}</p>
          <div className="flex gap-2 mt-4">
            {s.actions.map(a => (
              <button key={a.label} onClick={a.run}
                className={`flex-1 h-11 rounded-xl text-xs font-black uppercase tracking-wider transition-all active:scale-95 cursor-pointer ${
                  a.primary ? 'bg-gold-brand text-black' : 'border border-zinc-700 text-zinc-400'
                }`}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
