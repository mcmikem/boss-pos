// Boss morning briefing: one glance before the day starts — sold today vs
// yesterday, who still owes (credit), what is running out, what hasn't
// synced. Manager-only, every tile jumps to the screen that fixes it.
import { useMemo } from 'react';
import { Sunrise, TrendingUp, TrendingDown, Users, PackageX, RefreshCw } from 'lucide-react';
import type { Sale, CreditEat, Product } from '../types';
import { localDayKey } from '../utils/dates';
import { revenueOnDay, outstandingCredit, lowStockCount, dayDelta } from '../utils/brief';

interface MorningBriefProps {
  sales: Sale[];
  products: Product[];
  creditEats: CreditEat[];
  pendingCount: number;
  formatCurrency: (val: number) => string;
  onNavigate: (tab: 'sales' | 'inventory' | 'analytics' | 'expenses' | 'registers') => void;
  onSync: () => void;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function MorningBrief({ sales, products, creditEats, pendingCount, formatCurrency, onNavigate, onSync }: MorningBriefProps) {
  const brief = useMemo(() => {
    const today = localDayKey(new Date().toISOString());
    const yesterday = localDayKey(new Date(Date.now() - 86400000).toISOString());
    const t = revenueOnDay(sales, today, localDayKey);
    const y = revenueOnDay(sales, yesterday, localDayKey);
    return {
      today: t,
      delta: dayDelta(t.revenue, y.revenue),
      owed: outstandingCredit(creditEats),
      low: lowStockCount(products),
    };
  }, [sales, products, creditEats]);

  const tiles = [
    {
      label: 'Sold today',
      value: formatCurrency(brief.today.revenue),
      sub: `${brief.today.count} sales${brief.delta === null ? '' : ` • ${brief.delta >= 0 ? '+' : ''}${brief.delta}% vs yday`}`,
      tone: 'text-cyan-300',
      icon: brief.delta !== null && brief.delta < 0
        ? <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
        : <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />,
      act: () => onNavigate('analytics'),
    },
    {
      label: 'Still owed',
      value: formatCurrency(brief.owed),
      sub: brief.owed > 0 ? 'tap to collect' : 'books clear',
      tone: brief.owed > 0 ? 'text-amber-300' : 'text-zinc-500',
      icon: <Users className="w-3.5 h-3.5 text-amber-400" />,
      act: () => onNavigate('registers'),
    },
    {
      label: 'Low stock',
      value: String(brief.low),
      sub: brief.low > 0 ? 'tap to restock' : 'shelves ok',
      tone: brief.low > 0 ? 'text-rose-300' : 'text-zinc-500',
      icon: <PackageX className="w-3.5 h-3.5 text-rose-400" />,
      act: () => onNavigate('inventory'),
    },
    {
      label: 'Unsynced',
      value: String(pendingCount),
      sub: pendingCount > 0 ? 'tap to sync' : 'all synced',
      tone: pendingCount > 0 ? 'text-amber-300' : 'text-zinc-500',
      icon: <RefreshCw className="w-3.5 h-3.5 text-amber-400" />,
      act: onSync,
    },
  ];

  return (
    <section className="boss-card p-4 rounded-2xl mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Sunrise className="w-4 h-4 text-gold-brand" />
        <h3 className="text-xs font-black text-white uppercase tracking-widest font-display">
          {greeting()} — today at a glance
        </h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {tiles.map(t => (
          <button key={t.label} onClick={t.act}
            className="bg-zinc-950/60 border border-white/5 hover:border-gold-brand/40 rounded-xl p-3 text-left transition-all active:scale-95 cursor-pointer min-h-[76px]">
            <span className="flex items-center gap-1.5 text-[9px] font-bold text-zinc-500 uppercase tracking-widest">
              {t.icon}{t.label}
            </span>
            <span className={`block text-base font-black font-display mt-1 tabular-nums ${t.tone}`}>{t.value}</span>
            <span className="block text-[9px] text-zinc-600 font-bold mt-0.5 truncate">{t.sub}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
