import { useMemo } from 'react';
import { ChevronRight, PackageMinus, CookingPot, HandCoins, AlertTriangle } from 'lucide-react';
import type { CreditEat, Product, ProductionRegister, WastageLog } from '../types';
import { TRADE_VOCABULARY, type DepartmentConfig } from './departmentRegistry';
import { todayLocalKey } from '../utils/dates';
import { prevDayKey } from '../utils/cashflow';
import { isLiveSale } from '../utils/saleStatus';
import { leftoverFor } from '../utils/cashflow';

// "Do this now" — the anti-bottleneck strip.
//
// Every other part of a Today screen is a report: it tells you where you are.
// This tells you what to DO, in at most three cards, each one tap, and each
// card only exists when it is genuinely true. Nothing to do means the strip is
// absent — not a grey panel saying "all good", which is noise the eye has to
// read past on every single screen of the day.
//
// The rules a card must satisfy:
//   1. It is actionable TODAY, not someday.
//   2. Tapping it goes straight to the work, not to a report about the work.
//   3. If two cards say the same thing, it is one card.

export interface ActionCard {
  id: string;
  // One line, in the shop's own words. Not "Low stock: 3".
  title: string;
  // Why it matters, or what tapping will do.
  detail: string;
  icon: typeof PackageMinus;
  tone: 'rose' | 'amber' | 'sky';
  action: 'reorder' | 'production' | 'credit';
}

export interface ActionInputs {
  /** The department, not a kind. Passing a kind meant a screen could hand a
   *  tailor the kitchen's cards by passing the wrong value — the screen should
   *  not be able to make that mistake at all. */
  dept: DepartmentConfig;
  category: string;
  products: Product[];
  sales: Array<{ id: string; timestamp: string; refunded?: boolean; voided?: boolean; items: Array<{ productId: string; qty: number; lineTotal?: number }> }>;
  productionRegisters?: ProductionRegister[];
  wastageLogs?: WastageLog[];
  creditEats?: CreditEat[];
  formatCurrency: (n: number) => string;
}

const MAX_CARDS = 3;

export function buildActionCards(input: ActionInputs): ActionCard[] {
  const { dept, category, products, sales, productionRegisters = [], wastageLogs = [], creditEats = [], formatCurrency } = input;
  const kind = dept.kind;
  // The words come from the shape's own vocabulary. They used to be written
  // again here, which meant a second copy of "tray" existed outside the place
  // that owns it — so a guard could pass while the card still said it.
  const words = TRADE_VOCABULARY[kind];
  const cards: ActionCard[] = [];
  const today = todayLocalKey();
  const yesterday = prevDayKey(today);

  // --- Kitchen: what yesterday left on the tray decides today's batch. ---
  if (kind === 'kitchen' && products.some((p) => p.category === category)) {
    const leftovers = leftoverFor(products, productionRegisters, sales as never, wastageLogs, yesterday)
      .filter((r) => {
        if (r.leftover <= 0) return false;
        const p = products.find((x) => x.id === r.productId);
        return !!p && p.category === category;
      })
      .sort((a, b) => b.leftover - a.leftover)
      .slice(0, 2);
    if (leftovers.length) {
      const total = leftovers.reduce((sum, r) => sum + r.leftover, 0);
      cards.push({
        id: 'carry-tray',
        title: `${total} still ${words.leftover.toLowerCase()} from yesterday`,
        detail: leftovers.length === 1
          ? `${leftovers[0].productName} — sell what's left before making more`
          : `Includes ${leftovers[0].productName} and ${leftovers.length - 1} more — make less today`,
        icon: CookingPot,
        tone: 'amber',
        action: 'production',
      });
    }
  }

  // --- Shelf: what has run out or is about to. ---
  if (kind === 'sell') {
    const stocked = products.filter((p) => p.category === category && !p.isService);
    const out = stocked.filter((p) => (p.stockQty || 0) <= 0);
    const low = stocked.filter((p) => (p.stockQty || 0) > 0 && (p.stockQty || 0) <= (p.lowStockThreshold ?? 5));
    if (out.length) {
      cards.push({
        id: 'out-of-stock',
        title: `${out.length} item${out.length === 1 ? '' : 's'} finished`,
        detail: out.slice(0, 3).map((p) => p.name).join(', ') + (out.length > 3 ? '…' : ''),
        icon: PackageMinus,
        tone: 'rose',
        action: 'reorder',
      });
    } else if (low.length) {
      cards.push({
        id: 'low-stock',
        title: `${low.length} item${low.length === 1 ? '' : 's'} running low`,
        detail: low.slice(0, 3).map((p) => p.name).join(', ') + (low.length > 3 ? '…' : ''),
        icon: PackageMinus,
        tone: 'amber',
        action: 'reorder',
      });
    }
  }

  // --- Anyone who sells on credit: who owes, and how stale it is. ---
  const owing = creditEats
    .filter((c) => !c.paid && (c.total - (c.paidAmount || 0)) > 0)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (owing.length) {
    const total = owing.reduce((sum, c) => sum + (c.total - (c.paidAmount || 0)), 0);
    const oldest = owing[owing.length - 1];
    const days = oldest?.date ? daysSince(oldest.date) : null;
    cards.push({
      id: 'credit-owed',
      title: `${formatCurrency(total)} owed on credit`,
      detail: owing.length === 1
        ? `${owing[0].customerName}${days && days > 2 ? ` — ${days} days old` : ''}`
        : `${owing.length} customers, oldest ${days ?? 0} days`,
      icon: owing.length > 2 ? AlertTriangle : HandCoins,
      tone: owing.length > 2 ? 'rose' : 'sky',
      action: 'credit',
    });
  }

  return cards.slice(0, MAX_CARDS);
}

function daysSince(dayKey: string): number {
  const then = Date.parse(`${dayKey}T00:00:00`);
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.round((Date.now() - then) / 86400000));
}

export default function DepartmentActions({
  cards,
  onAction,
}: {
  cards: ActionCard[];
  onAction?: (action: ActionCard['action'], card: ActionCard) => void;
}) {
  const visible = useMemo(() => (cards || []).filter(Boolean).slice(0, MAX_CARDS), [cards]);
  // Nothing to do is the absence of the strip, not a reassuring panel.
  if (visible.length === 0) return null;
  return (
    <section aria-label="Do this now" className="space-y-1.5">
      <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest px-0.5">Do this now</p>
      <div className="space-y-1.5">
        {visible.map(card => {
          const Icon = card.icon;
          const tone = card.tone === 'rose'
            ? 'border-rose-800/50 bg-rose-950/25 text-rose-200'
            : card.tone === 'amber'
              ? 'border-amber-800/50 bg-amber-950/25 text-amber-200'
              : 'border-sky-800/50 bg-sky-950/25 text-sky-200';
          return (
            <button key={card.id} onClick={() => onAction?.(card.action, card)}
              className={`w-full min-h-[52px] rounded-xl border px-3 py-2 flex items-center gap-2.5 text-left active:scale-[0.99] transition-all cursor-pointer ${tone}`}>
              <Icon className="w-4 h-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-black truncate">{card.title}</span>
                <span className="block text-[10px] font-bold opacity-75 truncate">{card.detail}</span>
              </span>
              {onAction && <ChevronRight className="w-4 h-4 shrink-0 opacity-60" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// Kept next to the builder so a new trade cannot invent a card that breaks the
// rule that a card means "today, and one tap from done".
export { isLiveSale };
