import { useState } from 'react';
import { Store } from 'lucide-react';
import { TRADE_CHOICES, departmentsForShop } from './departmentRegistry';
import type { StoreSettings } from '../types';

/**
 * "What does this shop trade in?" — asked once, stored, and never guessed again.
 *
 * Deliberately NOT a modal. She is opening this app to sell, not to configure
 * it, and every other modal in this build has cost somebody a sale. So it is a
 * card that sits under the grid until it is answered, it can be skipped, and it
 * comes back in Settings to change later.
 *
 * The card disappears the moment an answer is saved. A shop that never answers
 * keeps today's behaviour exactly, which is why this can ship to a live till.
 */
interface ShopTradesProps {
  settings: StoreSettings | undefined;
  /** Department keys the shop currently has, so it can warn before hiding one. */
  availableDepartments: string[];
  onSave: (trades: string[]) => void;
  onDismiss: () => void;
  /** Shown inside Settings, where the question is being revisited. */
  compact?: boolean;
}

export default function ShopTrades({ settings, availableDepartments, onSave, onDismiss, compact }: ShopTradesProps) {
  const saved = settings?.trades;
  const answered = Array.isArray(saved) && saved.length > 0;
  // State first, return second — a hook below the return changes the hook
  // count the moment settings load, and React drops the card instead.
  const [picked, setPicked] = useState<string[]>(Array.isArray(saved) ? saved : []);
  if (answered && !compact) return null;

  const toggle = (key: string) => setPicked(prev => (
    prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
  ));

  // The honest warning: saving this hides departments the shop still has stock
  // or production in. She can decide, but she should be told, not surprised at
  // close.
  const wouldHide = availableDepartments.filter(d => {
    const chosen = picked.length ? departmentsForShop(availableDepartments, picked) : availableDepartments;
    return !chosen.includes(d);
  });

  return (
    <section className="boss-card rounded-2xl border border-gold-brand/25 p-4 space-y-3" aria-label="What this shop trades in">
      <div className="flex items-start gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-gold-brand/10 border border-gold-brand/30 flex items-center justify-center shrink-0">
          <Store className="w-4.5 h-4.5 text-gold-brand" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-black text-white uppercase tracking-widest">What does this shop trade in?</h3>
          <p className="text-[11px] text-zinc-400 font-medium leading-snug mt-0.5">
            Tap everything you sell. The till then shows only those screens and uses
            their words — no tailor is told about chapatis.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {TRADE_CHOICES.map(c => {
          const on = picked.includes(c.key);
          return (
            <button
              key={c.key}
              onClick={() => toggle(c.key)}
              aria-pressed={on}
              className={`text-left rounded-xl border px-3 py-2.5 min-h-[44px] transition-all active:scale-[0.99] cursor-pointer ${
                on ? 'border-gold-brand bg-gold-brand/10' : 'border-white/10 bg-[#0A0A0A] hover:border-white/20'
              }`}
            >
              <span className={`block text-xs font-black uppercase tracking-wider ${on ? 'text-gold-brand' : 'text-zinc-300'}`}>
                {on ? '✓ ' : ''}{c.label}
              </span>
              <span className="block text-[10px] text-zinc-500 font-medium leading-snug mt-0.5">{c.blurb}</span>
            </button>
          );
        })}
      </div>

      {wouldHide.length > 0 && (
        <p className="text-[10px] text-amber-300/90 font-bold leading-snug">
          {wouldHide.join(', ')} {wouldHide.length === 1 ? 'has' : 'have'} stock or batches and would be
          hidden from the till. Include {wouldHide.length === 1 ? 'it' : 'them'} or close the day first.
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => { if (picked.length) onSave(picked); }}
          disabled={picked.length === 0}
          className="flex-1 h-11 bg-gold-brand text-black font-black uppercase tracking-widest text-[10px] rounded-xl disabled:opacity-40 cursor-pointer"
        >
          {picked.length === 0 ? 'Pick at least one' : `Save (${picked.length})`}
        </button>
        {!compact && (
          <button
            onClick={onDismiss}
            className="h-11 px-4 border border-white/10 text-zinc-400 font-bold text-[10px] uppercase tracking-widest rounded-xl hover:border-white/20 hover:text-zinc-200 cursor-pointer"
          >
            Later
          </button>
        )}
      </div>
      {compact && (
        <button
          onClick={() => onSave([])}
          className="w-full text-[10px] text-zinc-500 font-bold uppercase tracking-widest hover:text-zinc-300 cursor-pointer"
        >
          Show every department again
        </button>
      )}
    </section>
  );
}
