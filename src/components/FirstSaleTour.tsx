import { useState, useEffect, useCallback } from 'react';
import { MousePointerClick, Volume2, VolumeX, RotateCcw } from 'lucide-react';
import { speak, stopSpeaking, isNarrationOn, setNarrationOn } from '../utils/narration';

// Guided first sale: a spotlight + animated tap pointer that walks a brand-new
// till from empty shelf to first close-out. The overlay NEVER eats taps —
// everything except the tip card is pointer-events-none, so the seller really
// taps the product, the cart and the nav buttons themselves. The pointer
// follows the real UI state (cart closed → cart open → confirm), a warm voice
// narrates each move, and the whole thing auto-advances on real progress.
// Skippable anywhere, never shows again once finished or dismissed.
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

function rectOf(sel: string): DOMRect | null {
  try {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    // Zero-area = hidden (duplicate id in a hidden nav, closed sheet…) — not
    // a real target. This also fixes duplicate-id fallbacks picking the
    // invisible twin and leaving the tour as a "just message" popup.
    if (r.width < 2 || r.height < 2) return null;
    return r;
  } catch {
    return null;
  }
}

// First selector with a VISIBLE match wins.
const firstVisible = (...sels: (string | null)[]): string | null => {
  if (typeof document === 'undefined') return null;
  for (const s of sels) {
    if (s && rectOf(s)) return s;
  }
  return null;
};

// Budi, the till buddy: one friendly face for the whole tour. Idle dots for
// eyes while guiding, happy arcs + big smile once the first sale lands.
function BuddyFace({ mood }: { mood: 'idle' | 'happy' }) {
  return (
    <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 border border-black/20 ${mood === 'happy' ? 'bg-gold-brand' : 'bg-zinc-800'}`}>
      <svg viewBox="0 0 36 36" className="w-7 h-7" aria-hidden="true">
        {mood === 'happy' ? (
          <g stroke="#000" strokeWidth={2.6} strokeLinecap="round" fill="none">
            <path d="M9 15 l3.5 -3.5 l3.5 3.5" />
            <path d="M20 15 l3.5 -3.5 l3.5 3.5" />
            <path d="M10 21 q8 9 16 0" />
          </g>
        ) : (
          <g fill={ '#d4af37' }>
            <circle cx="13" cy="14" r="2.6" />
            <circle cx="23" cy="14" r="2.6" />
            <path d="M12 22 q6 5 12 0" stroke="#d4af37" strokeWidth={2.4} strokeLinecap="round" fill="none" />
          </g>
        )}
      </svg>
    </div>
  );
}

function useTarget(selector: string | null) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!selector) { setRect(null); return; }
    const update = () => setRect(rectOf(selector));
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
  const [voiceOn, setVoiceOn] = useState<boolean>(() => isNarrationOn());

  // Step 1 completes itself the moment something lands in the cart.
  useEffect(() => {
    if (step === 1 && hasProducts && cartCount > 0) {
      const t = setTimeout(() => setStep(2), 600);
      return () => clearTimeout(t);
    }
  }, [step, hasProducts, cartCount, setStep]);

  const finish = useCallback(() => {
    stopSpeaking();
    try { localStorage.setItem(TOUR_KEY, '1'); } catch {}
    onDone();
  }, [onDone]);
  useEffect(() => () => stopSpeaking(), []);

  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    setNarrationOn(next);
  };

  // Step targets: best-effort selectors, first VISIBLE match wins. Missing
  // target = bottom sheet tip, never a crash.
  const onSalesTab = activeTab === 'sales';
  const onInventoryTab = activeTab === 'inventory';
  const prodTarget = onSalesTab ? firstVisible('#catalog-scroll-container .grid > *:first-child') : firstVisible('#sales-nav-btn', '#more-nav-btn');
  const completeTarget = firstVisible('#tour-complete-sale');
  const cartTarget = onSalesTab ? firstVisible('#mobile-cart-fab', '#desktop-cart') : firstVisible('#sales-nav-btn', '#more-nav-btn');
  const stockTarget = firstVisible('#inventory-nav-btn', '#more-nav-btn');
  const closeTarget = firstVisible('#registers-nav-btn', '#more-nav-btn');
  const addTarget = firstVisible('#tour-add-product');
  const emptyTarget = onInventoryTab ? (addTarget || stockTarget) : stockTarget;

  // Step 2 follows the cart: closed → point at the opener; open (Complete
  // sale button on screen) → point at it. Nothing to do is impossible — the
  // pointer always sits on the next real control.
  const cartOpenTarget = onSalesTab ? completeTarget : firstVisible('#sales-nav-btn', '#more-nav-btn');
  const chargeTarget = cartOpenTarget || cartTarget;
  const chargeIsComplete = !!cartOpenTarget;

  const VOICE: Record<string, string> = {
    welcome: 'Hi! I am Budi, your till buddy. First sale in three quick taps. Watch my pointer, and tap where I draw. Let us go.',
    tapProduct: 'Tap the product I circled. It drops straight into the cart.',
    openStock: 'Your shelf is empty. Tap the Stock button I circled, and add one thing you sell.',
    addProduct: 'Tap the gold plus. Type the name, the price, and how many, then save.',
    openCart: 'Nice! Now tap the gold cart button to open your cart.',
    completeSale: 'Cash is already picked. Hit the big Complete sale button.',
    backToSell: 'Head back to Sell first, then tap the flashing cart.',
    closeDay: 'Beautiful! First sale done. Tonight, tap Close day and count your drawer. That is the whole job. Good luck selling!',
  };

  const steps = [
    {
      title: 'Sell your first item in 3 taps',
      body: 'Watch the flashing pointer — it shows exactly where to tap, and I will talk you through it. Your taps go straight through to the till.',
      voice: VOICE.welcome,
      target: null as string | null,
      actions: [
        { label: 'Start', primary: true, run: () => { speak(VOICE.welcome); setStep(1); } },
        { label: 'Skip', primary: false, run: finish },
      ],
    },
    hasProducts
      ? {
          title: '1 · Tap the flashing product',
          body: 'Tap the product inside the gold ring — it drops straight into the cart.',
          voice: VOICE.tapProduct,
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
          voice: onInventoryTab ? VOICE.addProduct : VOICE.openStock,
          target: emptyTarget,
          actions: [
            { label: onInventoryTab ? 'Back to Sell' : 'Go to Stock', primary: true, run: () => onNavigate(onInventoryTab ? 'sales' : 'inventory') },
            { label: 'Skip', primary: false, run: finish },
          ],
        },
    {
      title: chargeIsComplete ? '2 · Hit Complete sale' : '2 · Open your cart',
      body: chargeIsComplete
        ? 'Cash is already picked — hit the big Complete sale button inside the gold ring.'
        : onSalesTab
          ? 'Tap the gold Cart button to open your cart.'
          : 'Head back to Sell first — then tap the flashing cart.',
      voice: chargeIsComplete ? VOICE.completeSale : onSalesTab ? VOICE.openCart : VOICE.backToSell,
      target: chargeTarget,
      actions: [
        ...(!onSalesTab && !chargeIsComplete ? [{ label: 'Back to Sell', primary: true, run: () => onNavigate('sales') }] : []),
        { label: 'Next', primary: true, run: () => setStep(3) },
        { label: 'Skip', primary: false, run: finish },
      ],
    },
    {
      title: '3 · Close the day tonight',
      body: 'Tap the flashing Close day button: count the drawer against what the till expected. Two minutes, then you know the day.',
      voice: VOICE.closeDay,
      target: closeTarget,
      actions: [
        { label: 'Open Close day', primary: true, run: () => { onNavigate('registers'); finish(); } },
        { label: 'Later', primary: false, run: finish },
      ],
    },
  ];
  const s = steps[Math.min(step, steps.length - 1)];

  // Narrate every step (welcome is spoken by the Start tap itself).
  useEffect(() => {
    if (step > 0) speak(s.voice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, chargeIsComplete, onSalesTab, onInventoryTab, hasProducts]);

  const rect = useTarget(s.target);
  const cx = rect ? rect.left + rect.width / 2 : 0;
  const cy = rect ? rect.top + rect.height / 2 : 0;
  // Card sits above the target when there is room, otherwise below the tap
  // pointer so the two never overlap. Above the confirm modal (z-100) and
  // the cart sheet (z-70), below toasts.
  const placeAbove = !!rect && rect.top > 330;
  const cardStyle: React.CSSProperties = !rect
    ? { left: 16, right: 16, bottom: 'calc(5.5rem + env(safe-area-inset-bottom))' }
    : placeAbove
      ? { left: 16, right: 16, bottom: Math.max(8, window.innerHeight - rect.top + 16) }
      : { left: 16, right: 16, top: rect.bottom + 88 };

  return (
    <div className="fixed inset-0 z-[110] pointer-events-none" role="dialog" aria-label="First sale tour">
      {rect ? (
        <>
          <div className="absolute inset-x-0 top-0 bg-black/70" style={{ height: Math.max(0, rect.top - 8) }} />
          <div className="absolute inset-x-0 bottom-0 bg-black/70" style={{ top: rect.bottom + 8 }} />
          <div className="absolute top-0 bottom-0 bg-black/70" style={{ left: 0, width: Math.max(0, rect.left - 8), top: rect.top - 8, height: rect.height + 16 }} />
          <div className="absolute top-0 bottom-0 bg-black/70" style={{ right: 0, width: Math.max(0, window.innerWidth - rect.right - 8), top: rect.top - 8, height: rect.height + 16 }} />
          {/* Hand-drawn circle: an ellipse that sketches itself around the
              target the moment the pointer lands — arrow, circle, exact spot. */}
          {(() => {
            const rx = rect.width / 2 + 14;
            const ry = rect.height / 2 + 14;
            const c = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
            return (
              <svg key={`${s.target}:${step}`} className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
                <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none"
                  stroke="#d4af37" strokeWidth={4} strokeLinecap="round"
                  className="tour-draw" style={{ ['--tour-c' as string]: c }} />
              </svg>
            );
          })()}
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
      <div key={step} className="absolute max-w-md mx-auto pointer-events-auto animate-tour-card-in" style={cardStyle}>
        <div className={`bg-[#141414] border border-gold-brand/40 rounded-3xl p-5 shadow-2xl ${step >= 3 ? 'animate-tour-glow' : ''}`}>
          <div className="flex items-center gap-1.5 mb-3">
            <div className="flex items-center gap-1.5 flex-1">
              {steps.map((_, i) => (
                <span key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? 'bg-gold-brand' : 'bg-zinc-800'}`} />
              ))}
            </div>
            <button onClick={() => speak(s.voice)} title="Hear it again"
              className="p-1.5 -m-1 text-zinc-500 hover:text-gold-brand transition-colors cursor-pointer" aria-label="Replay voice">
              <RotateCcw className="w-4 h-4" />
            </button>
            <button onClick={toggleVoice} title={voiceOn ? 'Mute voice' : 'Unmute voice'}
              className="p-1.5 -m-1 text-zinc-500 hover:text-gold-brand transition-colors cursor-pointer" aria-label="Toggle voice">
              {voiceOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
          </div>
          <div className="flex items-center gap-2.5">
            <BuddyFace mood={step >= 3 ? 'happy' : 'idle'} />
            <div className="min-w-0">
              <h3 className="text-sm font-black text-white uppercase tracking-wider leading-tight">{s.title}</h3>
              <p className="text-[10px] text-gold-brand font-bold uppercase tracking-widest">Budi · till buddy</p>
            </div>
          </div>
          <p className="text-xs text-zinc-300 font-bold mt-2 leading-relaxed">{s.body}</p>
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
