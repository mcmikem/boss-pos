import { useState, useEffect, useCallback } from 'react';

// Guided first sale: a 4-step spotlight that walks a brand-new till from
// empty shelf to first close-out. Auto-advances on real progress (product
// tapped → cart opened → sale rung), skippable anywhere, never shows again.
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
}

function useTarget(selector: string | null) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!selector) { setRect(null); return; }
    const update = () => {
      const el = document.querySelector(selector);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    update();
    const t = setTimeout(update, 350);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    const iv = setInterval(update, 800);
    return () => { clearTimeout(t); clearInterval(iv); window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); };
  }, [selector]);
  return rect;
}

export default function FirstSaleTour({ step, setStep, onDone, onNavigate, cartCount, hasProducts }: TourProps) {
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

  // Step targets: stock tab (or More) → first product → cart → close tab.
  // Best-effort selectors: missing target = centered tip, never a crash.
  const catalogFirst = typeof document !== 'undefined' && document.querySelector('#catalog-scroll-container .grid > *')
    ? '#catalog-scroll-container .grid > *:first-child' : null;
  const cartTarget = typeof document !== 'undefined' && document.querySelector('#mobile-cart-fab')
    ? '#mobile-cart-fab'
    : (typeof document !== 'undefined' && document.querySelector('#desktop-cart') ? '#desktop-cart' : null);
  const stockTarget = typeof document !== 'undefined' && document.querySelector('#inventory-nav-btn')
    ? '#inventory-nav-btn'
    : (typeof document !== 'undefined' && document.querySelector('#more-nav-btn') ? '#more-nav-btn' : null);
  const closeTarget = typeof document !== 'undefined' && document.querySelector('#registers-nav-btn')
    ? '#registers-nav-btn'
    : (typeof document !== 'undefined' && document.querySelector('#more-nav-btn') ? '#more-nav-btn' : null);

  const steps = [
    {
      title: 'Sell your first item in 3 taps',
      body: 'This tour points at each step. Tap through it once — selling gets boring fast after that.',
      target: null as string | null,
      actions: [
        { label: 'Start', primary: true, run: () => setStep(1) },
        { label: 'Skip', primary: false, run: finish },
      ],
    },
    hasProducts
      ? {
          title: '1 · Tap a product',
          body: 'Tap anything on the shelf to drop it in the cart. The gold button opens the cart.',
          target: catalogFirst,
          actions: [
            { label: cartCount > 0 ? 'Next' : 'I added one', primary: true, run: () => setStep(2) },
            { label: 'Skip', primary: false, run: finish },
          ],
        }
      : {
          title: '1 · Add your first product',
          body: 'The shelf is empty. Open Stock and add one thing you sell — name, price, how many.',
          target: stockTarget,
          actions: [
            { label: 'Go to Stock', primary: true, run: () => onNavigate('inventory') },
            { label: 'Skip', primary: false, run: finish },
          ],
        },
    {
      title: '2 · Charge the customer',
      body: 'Open the cart, pick Cash or MoMo, then hit Complete sale. That is the whole job.',
      target: cartTarget,
      actions: [
        { label: 'Next', primary: true, run: () => setStep(3) },
        { label: 'Skip', primary: false, run: finish },
      ],
    },
    {
      title: '3 · Close the day tonight',
      body: 'Count the drawer against what the till expected. Two minutes, then you know the day.',
      target: closeTarget,
      actions: [
        { label: 'Open Close day', primary: true, run: () => { onNavigate('registers'); finish(); } },
        { label: 'Later', primary: false, run: finish },
      ],
    },
  ];
  const s = steps[Math.min(step, steps.length - 1)];
  const rect = useTarget(s.target);

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-label="First sale tour">
      {rect ? (
        <>
          <div className="absolute inset-x-0 top-0 bg-black/70" style={{ height: Math.max(0, rect.top - 8) }} />
          <div className="absolute inset-x-0 bottom-0 bg-black/70" style={{ top: rect.bottom + 8 }} />
          <div className="absolute top-0 bottom-0 bg-black/70" style={{ left: 0, width: Math.max(0, rect.left - 8), top: rect.top - 8, height: rect.height + 16 }} />
          <div className="absolute top-0 bottom-0 bg-black/70" style={{ right: 0, width: Math.max(0, window.innerWidth - rect.right - 8), top: rect.top - 8, height: rect.height + 16 }} />
          <div className="absolute border-[3px] border-gold-brand rounded-2xl pointer-events-none animate-pulse"
            style={{ left: rect.left - 8, top: rect.top - 8, width: rect.width + 16, height: rect.height + 16 }} />
        </>
      ) : (
        <div className="absolute inset-0 bg-black/70" onClick={finish} />
      )}
      <div className="absolute inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] max-w-md mx-auto bg-[#141414] border border-gold-brand/40 rounded-3xl p-5 shadow-2xl">
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
  );
}
