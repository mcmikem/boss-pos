import type { ButtonHTMLAttributes, ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Design system: the rules every screen follows, as code.
// 1. ONE hero number per screen (28–32px). Supporting figures are 16px,
//    labels 11px uppercase. Never all-equal — all-equal reads as noise.
// 2. ONE primary action per screen: gold, full-width, h-12 minimum, always
//    visible — never buried in a collapsed card.
// 3. ONE source per number, one basis. If a figure appears twice it must be
//    identical and labelled identically.
// 4. Canonical words below. Same concept, same label, every screen.
// ---------------------------------------------------------------------------

export type MoneyTone =
  | 'gold' | 'white' | 'rose' | 'emerald' | 'amber' | 'sky' | 'cyan' | 'zinc';

const TONE_TEXT: Record<MoneyTone, string> = {
  gold: 'text-gold-brand',
  white: 'text-white',
  rose: 'text-rose-400',
  emerald: 'text-emerald-400',
  amber: 'text-amber-300',
  sky: 'text-sky-300',
  cyan: 'text-cyan-400',
  zinc: 'text-zinc-400',
};

// Canonical words. New UI must take its labels from here instead of
// inventing synonyms ("collected", "accounted for", "still out",
// "unaccounted", "missing"). Old screens adopt them as they are touched.
export const LABELS = {
  tookToday: 'Took today',
  expectedInDrawer: 'Expected in drawer',
  counted: 'Counted',
  difference: 'Difference',
  assigned: 'Assigned',
  notYetAssigned: 'Not yet assigned',
  awaitingConfirmation: 'Awaiting confirmation',
  committedToProduction: 'Committed to production',
  moneyOnShelves: 'Money on shelves',
  lowStock: 'Low stock',
  notSelling: 'Not selling',
  totalSpent: 'Total spent',
  moneyIn: 'Money in',
  profit: 'Profit',
  onFloat: 'On float',
  toOwner: 'To owner',
  toManager: 'To managers',
  banked: 'Banked',
  givenOut: 'Given out',
  collectedBack: 'Collected back',
} as const;

interface MoneyFigureProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: MoneyTone;
  title?: string;
}

// The one number a screen exists to answer. 28–32px, always tabular.
export function MoneyHero({ label, value, sub, tone = 'white', title }: MoneyFigureProps) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-black text-zinc-400 uppercase tracking-widest">{label}</p>
      <p
        className={`text-[28px] sm:text-[32px] leading-tight font-black font-display tabular-nums truncate ${TONE_TEXT[tone]}`}
        title={title}
      >
        {value}
      </p>
      {sub != null && sub !== '' && (
        <p className="text-[10px] font-bold text-zinc-500 uppercase mt-0.5 truncate">{sub}</p>
      )}
    </div>
  );
}

// A supporting figure. 16px — visibly smaller than any hero on the page.
export function MoneyStat({ label, value, sub, tone = 'zinc', title }: MoneyFigureProps) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">{label}</p>
      <p className={`text-base font-black font-display tabular-nums truncate mt-0.5 ${TONE_TEXT[tone]}`} title={title}>
        {value}
      </p>
      {sub != null && sub !== '' && (
        <p className="text-[10px] font-bold text-zinc-500 uppercase mt-0.5 truncate">{sub}</p>
      )}
    </div>
  );
}

export const PRIMARY_ACTION_CLASS =
  'w-full h-12 bg-gold-brand text-black rounded-xl text-sm font-black uppercase tracking-widest hover:opacity-90 active:scale-[0.99] transition-all cursor-pointer font-display disabled:opacity-50 disabled:cursor-not-allowed';

// The screen's one primary action. Full-width gold, h-12 minimum, always
// visible. Extra classes (e.g. a shadow, a taller till button) go in
// className — the gold/height/uppercase contract stays intact.
export function PrimaryAction({
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`${PRIMARY_ACTION_CLASS} ${className}`} {...rest}>
      {children}
    </button>
  );
}
