import { useState, useEffect, useCallback, useRef } from 'react';
import { MousePointerClick, Volume2, VolumeX } from 'lucide-react';
import { speak, stopSpeaking, isNarrationOn, setNarrationOn } from '../utils/narration';

// "Show me around": a silent-first guided tour in four short chapters (Sell,
// Money, Stock, Reports). No character, no scribbles, no robot monologue —
// a spotlight cutout, one pulsing dot on the real control, and a small card
// with one instruction. Accuracy rules keep it honest:
//   - the dot appears only after the target holds still across two checks;
//   - it never points at a fallback: a missing target means an honest
//     instruction card, and the step auto-advances the instant the real
//     control appears (or the real action happens);
//   - the overlay never eats taps — everything but the card passes through;
//   - voice narrates each step, and when the browser blocks autoplay a
//     "Tap for sound" pill appears instead of silence.
const TOUR_KEY = 'boss_pos_tour_done';
export const isTourDone = () => {
  try { return localStorage.getItem(TOUR_KEY) === '1'; } catch { return false; }
};

type TourTab = 'sales' | 'inventory' | 'registers' | 'analytics';

interface Signals {
  cartCount: number;
  hasProducts: boolean;
  salesCount: number;
  activeTab: string;
}

interface TourProps {
  onDone: () => void;
  onNavigate: (tab: TourTab) => void;
  signals: Signals;
}

interface Step {
  id: string;
  tab: TourTab;
  tabLabel: string;
  target: () => string | null;
  title: string;
  body: string;
  voice: string;
  primaryLabel: string;
  primaryRun: 'next' | 'navigate' | 'finish';
  advance?: 'cart' | 'sale' | 'products' | 'tab';
  goTo?: { chapter: number; step: number };
  showIf?: () => boolean;
}

interface Chapter {
  id: string;
  title: string;
  steps: Step[];
}

function rectOf(sel: string): DOMRect | null {
  try {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    // Zero-area = hidden (duplicate id in a hidden nav, closed card…) — never
    // a target. This kills the "pointer in the corner at nothing" class of bug.
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

const NAV_SEL: Record<TourTab, string> = {
  sales: '#sales-nav-btn',
  inventory: '#inventory-nav-btn',
  registers: '#registers-nav-btn',
  analytics: '#analytics-nav-btn',
};

function useTarget(selector: string | null) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [stable, setStable] = useState(false);
  const prev = useRef<{ l: number; t: number; w: number; h: number } | null>(null);
  const runCount = useRef(0);
  useEffect(() => {
    prev.current = null;
    runCount.current = 0;
    setStable(false);
    if (!selector) { setRect(null); return; }
    const snap = () => {
      const r = rectOf(selector);
      if (!r) {
        prev.current = null;
        runCount.current = 0;
        setRect(null);
        setStable(false);
        return;
      }
      const p = prev.current;
      const same = !!p && Math.abs(p.l - r.left) < 4 && Math.abs(p.t - r.top) < 4 && Math.abs(p.w - r.width) < 4 && Math.abs(p.h - r.height) < 4;
      runCount.current = same ? runCount.current + 1 : 1;
      prev.current = { l: r.left, t: r.top, w: r.width, h: r.height };
      setRect(r);
      setStable(runCount.current >= 2);
    };
    // Scroll the target to the middle first, measure only after it settles —
    // measuring mid-scroll is how pointers land beside their button.
    try { document.querySelector(selector)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch {}
    const t0 = setTimeout(snap, 120);
    const t1 = setTimeout(snap, 550);
    const iv = setInterval(snap, 800);
    window.addEventListener('scroll', snap, true);
    window.addEventListener('resize', snap);
    return () => { clearTimeout(t0); clearTimeout(t1); clearInterval(iv); window.removeEventListener('scroll', snap, true); window.removeEventListener('resize', snap); };
  }, [selector]);
  return { rect, stable };
}

export default function FirstSaleTour({ onDone, onNavigate, signals }: TourProps) {
  const { cartCount, hasProducts, salesCount, activeTab } = signals;
  const [chapterIdx, setChapterIdx] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [voiceOn, setVoiceOn] = useState<boolean>(() => isNarrationOn());
  const [needTap, setNeedTap] = useState(false);
  const prevSales = useRef(salesCount);
  const vibrated = useRef('');

  const goTo = useCallback((chapter: number, step: number) => {
    setChapterIdx(chapter);
    setStepIdx(step);
  }, []);

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
    if (!next) setNeedTap(false);
  };

  // ---- live DOM reads (recomputed every render, so the guide tracks reality)
  const catalogTarget = firstVisible('#catalog-scroll-container .grid > *:first-child');
  const completeTarget = firstVisible('.tour-complete-sale');
  const confirmTarget = firstVisible('#tour-confirm-btn');
  const cartTarget = firstVisible('#mobile-cart-fab', '#desktop-cart');
  const cashVisible = firstVisible('.tour-cash-btn');
  let cashPicked = true;
  try {
    const el = cashVisible ? document.querySelector(cashVisible) : null;
    cashPicked = !el || /bg-gold-brand\/1[05]/.test(el.className);
  } catch { cashPicked = true; }
  const countedTarget = firstVisible('#tour-counted-drawer');
  const recordTarget = firstVisible('#tour-record-money');
  const capitalTarget = firstVisible('#tour-capital-input');

  // Charge phase inside the sell flow: confirm > cash > complete > open cart.
  // Null means the cart is closed — an honest instruction, never a wrong pointer.
  const chargePhase: 'confirm' | 'cash' | 'complete' | 'open' =
    confirmTarget ? 'confirm'
    : cashVisible && !cashPicked ? 'cash'
    : completeTarget ? 'complete' : 'open';
  const chargeTarget =
    chargePhase === 'confirm' ? confirmTarget
    : chargePhase === 'cash' ? cashVisible
    : chargePhase === 'complete' ? completeTarget
    : cartTarget;

  const chapters: Chapter[] = [
    {
      id: 'sell', title: 'Sell',
      steps: [
        ...(!hasProducts ? [{
          id: 's-stock', tab: 'sales' as TourTab, tabLabel: 'Sell',
          target: () => (activeTab === 'inventory' ? firstVisible('#tour-add-product') : firstVisible('#inventory-nav-btn', '#more-nav-btn')),
          title: 'Stock the shelf first',
          body: activeTab === 'inventory' ? 'Tap the gold + button, save one product — I will wait here.' : 'Your shelf is empty. Open Stock and add one thing you sell.',
          voice: 'Your shelf is empty. Open Stock and add one thing you sell.',
          primaryLabel: activeTab === 'inventory' ? 'Back to Sell' : 'Go to Stock',
          primaryRun: 'navigate' as const,
          advance: 'products' as const,
        }] : []),
        ...(hasProducts ? [{
          id: 's-tap', tab: 'sales' as TourTab, tabLabel: 'Sell',
          target: () => catalogTarget,
          title: 'Tap the product',
          body: catalogTarget ? 'Tap the circled product — it drops into the cart.' : 'Back on the Sell screen, tap a product to drop it in the cart.',
          voice: 'Tap the circled product. It drops straight into the cart.',
          primaryLabel: cartCount > 0 ? 'Next' : 'I tapped it',
          primaryRun: 'next' as const,
          advance: 'cart' as const,
        }] : []),
        ...(hasProducts ? [{
          id: 's-charge', tab: 'sales' as TourTab, tabLabel: 'Sell',
          target: () => chargeTarget,
          title: chargePhase === 'confirm' ? 'Confirm it' : chargePhase === 'cash' ? 'Pick Cash' : chargePhase === 'complete' ? 'Hit Complete sale' : 'Open your cart',
          body: chargePhase === 'confirm' ? 'Check the receipt, then hit Confirm.'
            : chargePhase === 'cash' ? 'Tap Cash, so the till knows how they paid.'
            : chargePhase === 'complete' ? 'Cash is picked — hit the big Complete sale button.'
            : 'Tap the gold Cart button to open your cart.',
          voice: chargePhase === 'confirm' ? 'Last tap. Check the receipt, then Confirm.'
            : chargePhase === 'cash' ? 'Tap Cash, so the till knows how they paid.'
            : chargePhase === 'complete' ? 'Cash is picked. Hit the big Complete sale button.'
            : 'Tap the gold cart button to open your cart.',
          primaryLabel: 'Next',
          primaryRun: 'next' as const,
          advance: 'sale' as const,
          goTo: { chapter: 1, step: 1 },
        }] : []),
      ],
    },
    {
      id: 'money', title: 'Money',
      steps: [
        {
          id: 'm-open', tab: 'registers' as TourTab, tabLabel: 'Close day',
          target: () => null,
          title: 'Sale done — now the money',
          body: 'Every evening: count the drawer, move the money, keep tomorrow’s opening. Open Close day.',
          voice: 'Sale done. Now the money. Open Close day.',
          primaryLabel: 'Open Close day',
          primaryRun: 'navigate' as const,
          advance: 'tab' as const,
        },
        {
          id: 'm-count', tab: 'registers' as TourTab, tabLabel: 'Close day',
          target: () => countedTarget,
          title: 'Count the drawer',
          body: countedTarget ? 'Type what you physically counted — the till shows what it expects.' : 'Find the drawer math card and type what you counted.',
          voice: 'Type what you physically counted in the drawer.',
          primaryLabel: 'Next',
          primaryRun: 'next' as const,
        },
        {
          id: 'm-move', tab: 'registers' as TourTab, tabLabel: 'Close day',
          target: () => recordTarget || firstVisible('#close-money button'),
          title: 'Move the money',
          body: recordTarget ? 'Record where every shilling went — float, cash, owner, bank.' : 'Tap Money out and capital to unfold it, then record where it went.',
          voice: 'Record where every shilling went. Float, cash, owner, or bank.',
          primaryLabel: 'Next',
          primaryRun: 'next' as const,
        },
        {
          id: 'm-capital', tab: 'registers' as TourTab, tabLabel: 'Close day',
          target: () => capitalTarget,
          title: 'Keep tomorrow’s opening',
          body: capitalTarget ? 'Type what stays in the drawer — tomorrow opens with it.' : 'The keep-aside box sets tomorrow’s opening.',
          voice: 'Keep tomorrow’s opening here. It carries to the next day.',
          primaryLabel: 'Next: Stock',
          primaryRun: 'next' as const,
        },
      ],
    },
    {
      id: 'stock', title: 'Stock',
      steps: [
        {
          id: 'k-open', tab: 'inventory' as TourTab, tabLabel: 'Stock',
          target: () => null,
          title: 'Where stock lives',
          body: 'Everything you sell lives in Stock. Open it.',
          voice: 'Stock lives here. Open it.',
          primaryLabel: 'Open Stock',
          primaryRun: 'navigate' as const,
          advance: 'tab' as const,
        },
        {
          id: 'k-add', tab: 'inventory' as TourTab, tabLabel: 'Stock',
          target: () => firstVisible('#tour-add-product'),
          title: 'The gold + adds products',
          body: 'Name, price, how many — that is the whole form.',
          voice: 'The gold plus adds a product. Name, price, how many.',
          primaryLabel: 'Next',
          primaryRun: 'next' as const,
        },
        {
          id: 'k-low', tab: 'inventory' as TourTab, tabLabel: 'Stock',
          target: () => firstVisible('#tour-stock-alert'),
          title: 'Low stock warns you here',
          body: 'This counter glows red — tap a row to restock before the shelf empties.',
          voice: 'Low stock warns you here, before the shelf empties.',
          primaryLabel: 'Next: Reports',
          primaryRun: 'next' as const,
        },
      ],
    },
    {
      id: 'reports', title: 'Reports',
      steps: [
        {
          id: 'r-open', tab: 'analytics' as TourTab, tabLabel: 'Reports',
          target: () => null,
          title: 'Did we make money?',
          body: 'Reports answers that plus who owes you. Open it.',
          voice: 'Reports answers: did we make money? Open it.',
          primaryLabel: 'Open Reports',
          primaryRun: 'navigate' as const,
          advance: 'tab' as const,
        },
        {
          id: 'r-profit', tab: 'analytics' as TourTab, tabLabel: 'Reports',
          target: () => firstVisible('#tour-stats-grid'),
          title: 'Your three answers',
          body: 'Top seller, money in, profit kept — plus the How breakdown under profit.',
          voice: 'Top seller, money in, profit kept. Your three answers.',
          primaryLabel: 'Finish',
          primaryRun: 'finish' as const,
        },
      ],
    },
  ];

  // Visible steps only (empty-shelf branch swaps automatically).
  const visible: { chapter: number; step: number; s: Step }[] = [];
  chapters.forEach((ch, ci) => ch.steps.forEach((s, si) => {
    if (s.id === 's-stock' || s.id === 's-tap' || s.id === 's-charge') {
      if (s.id === 's-stock' && hasProducts) return;
      if ((s.id === 's-tap' || s.id === 's-charge') && !hasProducts) return;
    }
    visible.push({ chapter: ci, step: si, s });
  }));
  const pos = Math.max(0, visible.findIndex(v => v.chapter === chapterIdx && v.step === stepIdx));
  const cur = visible[Math.min(pos < 0 ? 0 : pos, visible.length - 1)];

  const goNext = useCallback(() => {
    const i = visible.findIndex(v => v.chapter === chapterIdx && v.step === stepIdx);
    const nxt = visible[i < 0 ? 0 : i + 1];
    if (!nxt) finish();
    else goTo(nxt.chapter, nxt.step);
  }, [visible, chapterIdx, stepIdx, goTo, finish]);

  // Auto-advance on the real world: cart fills, sale lands, stock appears,
  // tab opens. Never on a timer, never on a guess.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; prevSales.current = salesCount; return; }
    const adv = cur?.s.advance;
    if (!adv) { prevSales.current = salesCount; return; }
    let fire = false;
    if (adv === 'cart' && cartCount > 0) fire = true;
    else if (adv === 'sale' && salesCount > prevSales.current) fire = true;
    else if (adv === 'products' && hasProducts) fire = true;
    else if (adv === 'tab' && activeTab === cur.s.tab) fire = true;
    prevSales.current = salesCount;
    if (!fire) return;
    const t = setTimeout(() => {
      if (cur.s.goTo) goTo(cur.s.goTo.chapter, cur.s.goTo.step);
      else goNext();
    }, 600);
    return () => clearTimeout(t);
  }, [cartCount, salesCount, hasProducts, activeTab, cur, goNext, goTo]);

  // Wrong tab: point at the tab button with an honest instruction instead of
  // a fallback control. Taps pass through, so the seller just goes there.
  const onTab = activeTab === cur.s.tab;
  const navSel = firstVisible(NAV_SEL[cur.s.tab]);
  const rawSel = cur.s.target();
  const selector = onTab ? rawSel : navSel;
  const { rect, stable } = useTarget(selector);
  const stepKey = `${cur.chapter}:${cur.step}:${selector || 'none'}`;

  // Voice per step. Blocked autoplay (no gesture yet) surfaces a
  // "Tap for sound" pill instead of silence.
  useEffect(() => {
    setNeedTap(false);
    speak(cur.s.voice, { onStart: () => setNeedTap(false), onBlocked: () => setNeedTap(true) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);

  // Tiny haptic tick the first time the dot locks on (Android feel, free).
  useEffect(() => {
    if (stable && selector && vibrated.current !== stepKey) {
      vibrated.current = stepKey;
      try { navigator.vibrate?.(15); } catch {}
    }
  }, [stable, selector, stepKey]);

  const ch = chapters[cur.chapter];
  const inCh = ch.steps.filter(s => {
    if (s.id === 's-stock') return !hasProducts;
    if (s.id === 's-tap' || s.id === 's-charge') return hasProducts;
    return true;
  });
  const inPos = inCh.findIndex(s => s.id === cur.s.id);

  const runPrimary = () => {
    const p = cur.s.primaryRun;
    if (p === 'finish') finish();
    else if (p === 'navigate') onNavigate(cur.s.tab);
    else goNext();
  };

  // Rounded ints: sub-pixel style churn would re-trigger the glide nonstop.
  const cx = rect ? Math.round(rect.left + rect.width / 2) : 0;
  const cy = rect ? Math.round(rect.top + rect.height / 2) : 0;
  // Card placement with viewport clamping: below the target when it fits,
  // otherwise above. Never parked half off-screen on small phones.
  const CARD_H = 300;
  const GAP = 72;
  const fitsBelow = !rect || (window.innerHeight - rect.bottom - GAP >= Math.min(CARD_H, window.innerHeight - 120));
  const placeAbove = !!rect && !fitsBelow;
  const cardStyle: React.CSSProperties = !rect
    ? { left: 16, right: 16, bottom: 'calc(5.5rem + env(safe-area-inset-bottom))' }
    : placeAbove
      ? { left: 16, right: 16, bottom: Math.max(8, window.innerHeight - rect.top + 16) }
      : { left: 16, right: 16, top: rect.bottom + GAP };
  const arrowLeft = `min(max(28px, ${cx - 24}px), calc(100% - 28px))`;

  const shownBody = !onTab
    ? `Open ${cur.s.tabLabel} first — tap the marked tab below, I will continue there.`
    : cur.s.body;

  return (
    <div className="fixed inset-0 z-[110] pointer-events-none" role="dialog" aria-label="Guided tour">
      {rect ? (
        <>
          <div className="absolute inset-x-0 top-0 bg-black/70 transition-all duration-300 ease-out" style={{ height: Math.max(0, rect.top - 8) }} />
          <div className="absolute inset-x-0 bottom-0 bg-black/70 transition-all duration-300 ease-out" style={{ top: rect.bottom + 8 }} />
          <div className="absolute top-0 bottom-0 bg-black/70 transition-all duration-300 ease-out" style={{ left: 0, width: Math.max(0, rect.left - 8), top: rect.top - 8, height: rect.height + 16 }} />
          <div className="absolute top-0 bottom-0 bg-black/70 transition-all duration-300 ease-out" style={{ right: 0, width: Math.max(0, window.innerWidth - rect.right - 8), top: rect.top - 8, height: rect.height + 16 }} />
          {stable && (
            <div className="absolute transition-all duration-300 ease-out" style={{ left: cx, top: cy }}>
              <div className="relative -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
                <span className="absolute top-1 inline-flex h-12 w-12 rounded-full bg-gold-brand/60 animate-ping" />
                <MousePointerClick className="relative w-8 h-8 text-gold-brand animate-bounce drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)]" />
                <span className="relative mt-1 text-[10px] font-black uppercase tracking-widest text-black bg-gold-brand rounded-md px-2 py-0.5">Tap</span>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="absolute inset-0 bg-black/70" />
      )}
      <div key={stepKey} className="absolute max-w-md mx-auto pointer-events-auto animate-tour-card-in" style={cardStyle}>
        <div className="relative bg-[#141414] border border-gold-brand/40 rounded-3xl p-5 shadow-2xl">
          {rect && (
            <span aria-hidden="true"
              className={`absolute w-3.5 h-3.5 rotate-45 bg-[#141414] ${placeAbove ? '-bottom-[7px] border-b border-r border-gold-brand/40' : '-top-[7px] border-t border-l border-gold-brand/40'}`}
              style={{ left: arrowLeft }} />
          )}
          <div className="flex items-center gap-1.5 mb-2">
            <div className="flex items-center gap-1.5 flex-1">
              {chapters.map((c, i) => (
                <span key={c.id} title={c.title}
                  className={`h-1.5 flex-1 rounded-full transition-colors ${i < cur.chapter ? 'bg-gold-brand' : i === cur.chapter ? 'bg-gold-brand/60' : 'bg-zinc-800'}`} />
              ))}
            </div>
            {needTap ? (
              <button onClick={() => speak(cur.s.voice, { onStart: () => setNeedTap(false), onBlocked: () => setNeedTap(true) })}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-gold-brand text-black text-[10px] font-black uppercase tracking-wider animate-pulse cursor-pointer" aria-label="Play sound">
                <Volume2 className="w-4 h-4" /> Tap for sound
              </button>
            ) : (
              <>
                <button onClick={() => speak(cur.s.voice, { onStart: () => setNeedTap(false), onBlocked: () => setNeedTap(true) })} title="Hear it again"
                  className="p-1.5 -m-1 text-zinc-500 hover:text-gold-brand transition-colors cursor-pointer" aria-label="Replay voice">
                  <Volume2 className="w-4 h-4" />
                </button>
                <button onClick={toggleVoice} title={voiceOn ? 'Mute voice' : 'Unmute voice'}
                  className="p-1.5 -m-1 text-zinc-500 hover:text-gold-brand transition-colors cursor-pointer" aria-label="Toggle voice">
                  {voiceOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                </button>
              </>
            )}
          </div>
          <p className="text-[10px] font-black text-gold-brand uppercase tracking-widest">{ch.title} • {inPos + 1} of {inCh.length}</p>
          <h3 className="text-sm font-black text-white uppercase tracking-wider mt-0.5">{!onTab ? `Open ${cur.s.tabLabel}` : cur.s.title}</h3>
          <p className="text-xs text-zinc-300 font-bold mt-1 leading-relaxed">{shownBody}</p>
          <p className="text-[9px] text-zinc-700 font-mono mt-2">
            {typeof __BUILD_COMMIT__ === 'string' && __BUILD_COMMIT__ ? __BUILD_COMMIT__.slice(0, 7) : 'dev'} • {cur.s.id}
          </p>
          <div className="flex gap-2 mt-4">
            <button onClick={runPrimary}
              className="flex-1 h-11 rounded-xl text-xs font-black uppercase tracking-wider transition-all active:scale-95 cursor-pointer bg-gold-brand text-black">
              {!onTab ? `Open ${cur.s.tabLabel}` : cur.s.primaryRun === 'finish' ? 'Finish' : cur.s.primaryLabel}
            </button>
            <button onClick={finish}
              className="h-11 px-4 rounded-xl text-xs font-black uppercase tracking-wider transition-all active:scale-95 cursor-pointer border border-zinc-700 text-zinc-400">
              Skip
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
