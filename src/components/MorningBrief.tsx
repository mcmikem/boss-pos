// Boss morning briefing: one glance before the day starts — sold today vs
// yesterday, who still owes (credit), what is running out, what hasn't
// synced. Manager-only, every tile jumps to the screen that fixes it.
import { useMemo, useState, useEffect } from 'react';
import { bookingApi } from '../api';
import type { Booking } from '../types';
import { Sunrise, TrendingUp, TrendingDown, Users, PackageX, RefreshCw, AlertTriangle, ChevronDown, Wallet } from 'lucide-react';
import type { Sale, CreditEat, Product, Expense, MomoTransfer } from '../types';
import { getOpeningCapital, drawerExpensesByCategory, moneyOutByCategory, tenderByCategory, momoExpensesByCategory, openingPhoneFor, prevDayKey } from '../utils/cashflow';
import { localDayKey, todayLocalKey } from '../utils/dates';
import { revenueOnDay, outstandingCredit, lowStockCount, dayDelta, expiringCount } from '../utils/brief';
import { isLiveSale } from '../utils/saleStatus';
import { stockoutLosses } from '../utils/stockout';

interface MorningBriefProps {
  sales: Sale[];
  products: Product[];
  creditEats: CreditEat[];
  pendingCount: number;
  lastSyncedAt?: number | null;
  formatCurrency: (val: number) => string;
  onNavigate: (tab: 'sales' | 'inventory' | 'analytics' | 'expenses' | 'registers') => void;
  onSync: () => void;
  dailyGoal?: number;
  dailyGoalRevenue?: number;
  expenses?: Expense[];
  momoTransfers?: MomoTransfer[];
  eodCapital?: Record<string, number>;
  // Role split: managers get the full briefing (revenue, debts, drawer).
  // Cashiers get their shift card (my sales, handover, sync) — never the
  // boss's numbers. Solo shops (no staff logins) see the manager view.
  managerView?: boolean;
  sellerName?: string;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function MorningBrief({ sales, products, creditEats, pendingCount, lastSyncedAt = null, formatCurrency, onNavigate, onSync, dailyGoal, dailyGoalRevenue, expenses = [], momoTransfers = [], eodCapital, managerView = true, sellerName = '' }: MorningBriefProps) {
  // Cashier shift card: greeting, MY sales today, handover, sync — the
  // worker's own work, never revenue/debts/drawer (manager-only numbers).
  const shift = useMemo(() => {
    if (managerView) return null;
    const today = todayLocalKey();
    const name = (sellerName || '').trim();
    const mine = name
      ? sales.filter(s => isLiveSale(s) && localDayKey(s.timestamp) === today && (s.staffName || '').trim() === name)
      : [];
    let handover: { at: string; from: string; to: string; amount: number } | null = null;
    try {
      const log = JSON.parse(localStorage.getItem('boss_pos_handovers') || '[]');
      if (Array.isArray(log) && log[0]) handover = log[0];
    } catch {}
    return { name, count: mine.length, total: mine.reduce((a, s) => a + (s.total || 0), 0), handover };
  }, [managerView, sellerName, sales]);
  const isShiftView = !managerView && !!shift;
  // Minimisable: cashiers short on space collapse it; choice sticks per device.
  // Today's chairs: salon bookings due today that aren't done/cancelled.
  const [todayBookings, setTodayBookings] = useState<Booking[]>([]);
  useEffect(() => {
    let live = true;
    bookingApi.list()
      .then(list => {
        if (!live) return;
        const k = todayLocalKey();
        setTodayBookings(list.filter(b => b.date === k && b.status === 'booked'));
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  // Minimised by default: on small phones the tiles push "today in…" below
  // the fold, so the card opens as one greeting line. Choice sticks per device.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem('boss_pos_brief_collapsed');
      return v === null ? true : v === '1';
    } catch { return true; }
  });
  const toggleCollapsed = () => {
    setCollapsed(prev => {
      try { localStorage.setItem('boss_pos_brief_collapsed', prev ? '0' : '1'); } catch {}
      return !prev;
    });
  };
  const brief = useMemo(() => {
    const today = localDayKey(new Date().toISOString());
    const yesterday = localDayKey(new Date(Date.now() - 86400000).toISOString());
    const t = revenueOnDay(sales, today, localDayKey);
    const y = revenueOnDay(sales, yesterday, localDayKey);
    const stockout = stockoutLosses(products, sales, 7, today);
    // Seller of the day: top revenue among named sellers today.
    const bySeller = new Map<string, { name: string; total: number; count: number }>();
    for (const s of sales) {
      if (!isLiveSale(s) || localDayKey(s.timestamp) !== today) continue;
      const name = (s.staffName || '').trim();
      if (!name) continue;
      const cur = bySeller.get(name) || { name, total: 0, count: 0 };
      cur.total += s.total;
      cur.count += 1;
      bySeller.set(name, cur);
    }
    const topSeller = Array.from(bySeller.values()).sort((a, b) => b.total - a.total)[0] || null;
    // Live holdings: drawer cash vs phone money (sente zesimu), all
    // departments. Drawer = kept capital + cash sales − drawer spend − moved
    // out. Phone = MoMo sales + float moves − MoMo-paid expenses.
    const cats = new Set<string>();
    products.forEach(p => { if (p.category) cats.add(p.category); });
    const drawerExp = drawerExpensesByCategory(expenses, today);
    const moved = moneyOutByCategory(momoTransfers, today);
    const tender = tenderByCategory(sales, products, today);
    const momoExp = momoExpensesByCategory(expenses, today);
    const phoneOpen = openingPhoneFor(sales, products, momoTransfers, expenses, today);
    let inDrawers = 0;
    let drawerCash = 0;
    let phoneCash = 0;
    let phoneFloat = 0;
    for (const cat of cats) {
      const t = tender[cat] || { cash: 0, momo: 0 };
      const m = moved[cat] || { float: 0, cash: 0, owner: 0, bank: 0 };
      const movedOut = m.float + m.cash + m.owner + (m.bank || 0);
      drawerCash += getOpeningCapital(today, cat, eodCapital) + t.cash
        - (drawerExp[cat] || 0) - movedOut;
      phoneCash += (phoneOpen.get(cat) || 0) + t.momo + m.float - (momoExp[cat] || 0);
      phoneFloat += m.float;
    }
    inDrawers = drawerCash + phoneCash;
    // Rush hour: busiest sales hour today (5am–11pm sane range for display).
    const hourly = new Array<number>(24).fill(0);
    for (const s of sales) {
      if (!isLiveSale(s) || localDayKey(s.timestamp) !== today) continue;
      const h = new Date(s.timestamp).getHours();
      if (Number.isFinite(h)) hourly[h] += 1;
    }
    let rushHour = -1;
    let rushCount = 0;
    hourly.forEach((c, h) => { if (c > rushCount) { rushCount = c; rushHour = h; } });
    const fmtHour = (h: number) => {
      const h12 = h % 12 === 0 ? 12 : h % 12;
      return `${h12}${h < 12 ? 'am' : 'pm'}`;
    };
    // Yesterday's close record: closed clean vs never closed — the first
    // thing a boss checks at 8am.
    const yKey = prevDayKey(today);
    let closedDepts = 0;
    for (const cat of cats) {
      try {
        const raw = JSON.parse(localStorage.getItem(`boss_pos_dayclosed_${yKey}::${cat}`) || 'null');
        if (raw?.at) closedDepts += 1;
      } catch {}
    }
    return {
      today: t,
      delta: dayDelta(t.revenue, y.revenue),
      owed: outstandingCredit(creditEats),
      low: lowStockCount(products),
      expiring: expiringCount(products, todayLocalKey()),
      stockout,
      topSeller,
      rushHour, rushCount, fmtHour,
      inDrawers,
      drawerCash,
      phoneCash,
      phoneFloat,
      closedDepts,
      deptCount: cats.size,
    };
  }, [sales, products, creditEats, expenses, momoTransfers, eodCapital]);

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
      sub: pendingCount > 0
        ? 'tap to sync — sales wait on this phone'
        : lastSyncedAt
          ? `all synced ${Math.max(0, Math.round((Date.now() - lastSyncedAt) / 60000))}m ago`
          : 'all synced',
      tone: pendingCount > 0 ? 'text-amber-300' : 'text-zinc-500',
      icon: <RefreshCw className="w-3.5 h-3.5 text-amber-400" />,
      act: onSync,
    },
    {
      label: 'In drawer',
      value: brief.inDrawers < 0
        ? `${formatCurrency(Math.abs(Math.round(brief.inDrawers)))} short`
        : formatCurrency(Math.round(brief.inDrawers)),
      sub: `cash ${formatCurrency(Math.round(brief.drawerCash))} • phone ${formatCurrency(Math.round(brief.phoneCash))}${brief.phoneFloat > 0 ? ` (float ${formatCurrency(Math.round(brief.phoneFloat))})` : ''}${brief.inDrawers < 0 ? ' • over-moved' : ''}`,
      tone: brief.inDrawers < 0 ? 'text-rose-300' : 'text-cyan-300',
      icon: <Wallet className="w-3.5 h-3.5 text-cyan-400" />,
      act: () => onNavigate('registers'),
    },
  ];

  // Trial nudge: shop age from oldest sale (or first-seen on a fresh till).
  // Established shops (>14 days) never see this — they're paying or
  // grandfathered. Trial is 3 days per the landing page.
  const trialAgeDays = useMemo(() => {
    let first = '';
    try {
      first = localStorage.getItem('boss_pos_first_seen') || '';
      if (!first) {
        first = new Date().toISOString();
        localStorage.setItem('boss_pos_first_seen', first);
      }
    } catch { first = new Date().toISOString(); }
    for (const s of sales) {
      if (!first || s.timestamp < first) first = s.timestamp;
    }
    const ms = Date.now() - Date.parse(first || new Date().toISOString());
    return Math.max(0, Math.floor(ms / 86400000));
  }, [sales]);

  return (
    <>
      {isShiftView && shift && (
        <section className="boss-card px-4 py-3 rounded-2xl mb-4 space-y-1" aria-label="Your shift">
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" aria-hidden="true" />
            <p className="text-[11px] font-black text-zinc-300 uppercase tracking-wider flex-1 min-w-0 truncate">
              {greeting()}{shift.name ? `, ${shift.name}` : ''} — your shift
            </p>
            <p className="text-xs font-black text-gold-brand tabular-nums shrink-0">
              {shift.count} sale{shift.count !== 1 ? 's' : ''} • {formatCurrency(shift.total)}
            </p>
          </div>
          <div className="flex items-center gap-2 pl-5">
            <button onClick={() => onNavigate('sales')}
              className="text-[10px] font-black text-gold-brand uppercase tracking-wider hover:underline cursor-pointer shrink-0">
              Sell
            </button>
            <button onClick={onSync}
              className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider hover:text-zinc-300 cursor-pointer truncate">
              {pendingCount > 0 ? `${pendingCount} to sync — tap` : 'All synced'}
            </button>
            {shift.handover && (
              <p className="text-[10px] text-zinc-500 font-bold uppercase truncate ml-auto">
                Handover {shift.handover.from} → {shift.handover.to}: {formatCurrency(shift.handover.amount)}
              </p>
            )}
          </div>
        </section>
      )}
      {!isShiftView && (
      <section className="boss-card p-4 rounded-2xl mb-4">
      {trialAgeDays <= 14 && (
        <div className={`rounded-xl border px-3 py-2.5 mb-3 flex items-center gap-2 ${trialAgeDays <= 3 ? 'bg-gold-brand/5 border-gold-brand/30' : 'bg-amber-950/25 border-amber-600/30'}`}>
          <span className="text-[10px] font-black uppercase tracking-wider flex-1">
            {trialAgeDays <= 3 ? (
              <span className="text-gold-brand">Trial: {3 - trialAgeDays} day{3 - trialAgeDays !== 1 ? 's' : ''} left</span>
            ) : (
              <span className="text-amber-300">Trial ended — stay open</span>
            )}
          </span>
          <a href="https://wa.me/256727790003?text=Hi%2C%20I%20want%20to%20activate%20BOSS%20for%20my%20shop."
            target="_blank" rel="noopener noreferrer"
            className="h-8 px-3 bg-gold-brand text-black font-black text-[10px] rounded-lg uppercase tracking-wider flex items-center shrink-0">
            Activate
          </a>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Sunrise className="w-4 h-4 text-gold-brand shrink-0" />
        <h3 className="text-xs font-black text-white uppercase tracking-widest font-display flex-1 min-w-0 truncate">
          {greeting()} — today at a glance
        </h3>
        <span className={`text-[10px] font-black tabular-nums shrink-0 ${brief.closedDepts > 0 ? 'text-emerald-400' : 'text-zinc-600'}`}
          title={brief.closedDepts > 0 ? 'Yesterday was closed' : 'Yesterday was never closed'}>
          {brief.closedDepts > 0 ? `Yday ✓` : 'Yday open'}
        </span>
        {collapsed && (
          <span className="text-[10px] font-black text-gold-brand tabular-nums shrink-0">{formatCurrency(brief.today.revenue)}</span>
        )}
        <button onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand today at a glance' : 'Minimise today at a glance'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand' : 'Minimise'}
          className="w-8 h-8 rounded-lg bg-[#0A0A0A] border border-white/10 text-zinc-400 hover:text-gold-brand hover:border-gold-brand/40 flex items-center justify-center shrink-0 transition-all cursor-pointer">
          <ChevronDown className={`w-4 h-4 transition-transform ${collapsed ? '' : 'rotate-180'}`} />
        </button>
      </div>
      {!collapsed && (
      <>
      <div className="mt-3">
      {brief.topSeller && brief.topSeller.count > 0 && (
        <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 truncate">
          ★ Seller of the day: <span className="text-gold-brand">{brief.topSeller.name}</span>
          <span className="text-zinc-500"> • {formatCurrency(brief.topSeller.total)} ({brief.topSeller.count} sale{brief.topSeller.count !== 1 ? 's' : ''})</span>
          {brief.rushHour >= 0 && brief.rushCount >= 2 && (
            <span className="text-zinc-500"> • rush ~{brief.fmtHour(brief.rushHour)} ({brief.rushCount})</span>
          )}
        </p>
      )}
      {todayBookings.length > 0 && (
        <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 truncate">
          🪑 {todayBookings.length} chair{todayBookings.length !== 1 ? 's' : ''} today
          <span className="text-zinc-600"> — {todayBookings.slice(0, 2).map(b => `${b.customerName}${b.time ? ` ${b.time}` : ''}`).join(' • ')}{todayBookings.length > 2 ? '…' : ''}</span>
        </p>
      )}
      {dailyGoal !== undefined && dailyGoal > 0 && (
        <div className="mb-3" title={`Daily goal: ${dailyGoal} sales${dailyGoalRevenue ? ` • ${formatCurrency(dailyGoalRevenue)}` : ''}`}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Daily goal</span>
            <span className="text-[10px] font-black text-gold-brand tabular-nums">
              {brief.today.count}/{dailyGoal}{brief.today.count >= dailyGoal ? ' ✓' : ''}
            </span>
          </div>
          <div className="h-1.5 bg-zinc-900 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${brief.today.count >= dailyGoal ? 'bg-emerald-400' : 'bg-gold-brand'}`}
              style={{ width: `${Math.min(100, Math.round((brief.today.count / dailyGoal) * 100))}%` }} />
          </div>
          {(dailyGoalRevenue || 0) > 0 && (
            <div className="flex items-center justify-between mt-1.5 mb-1">
              <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Revenue goal</span>
              <span className="text-[10px] font-black text-gold-brand tabular-nums">
                {formatCurrency(brief.today.revenue)}/{formatCurrency(dailyGoalRevenue || 0)}{brief.today.revenue >= (dailyGoalRevenue || 0) ? ' ✓' : ''}
              </span>
            </div>
          )}
          {(dailyGoalRevenue || 0) > 0 && (
            <div className="h-1.5 bg-zinc-900 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${brief.today.revenue >= (dailyGoalRevenue || 0) ? 'bg-emerald-400' : 'bg-gold-brand'}`}
                style={{ width: `${Math.min(100, Math.round((brief.today.revenue / (dailyGoalRevenue || 1)) * 100))}%` }} />
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
      {brief.expiring > 0 && (
        <button onClick={() => onNavigate('inventory')}
          className="mt-2 w-full flex items-center gap-2 bg-amber-950/30 border border-amber-800/40 rounded-xl px-3 py-2.5 text-left transition-all active:scale-[0.99] cursor-pointer">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-[11px] font-bold text-amber-300 uppercase">
            {brief.expiring} item{brief.expiring !== 1 ? 's' : ''} expired or expiring soon — check stock
          </span>
        </button>
      )}
      {brief.stockout.total > 0 && (
        <button onClick={() => onNavigate('inventory')}
          className="mt-2 w-full flex items-center gap-2 bg-rose-950/30 border border-rose-800/40 rounded-xl px-3 py-2.5 text-left transition-all active:scale-[0.99] cursor-pointer">
          <PackageX className="w-4 h-4 text-rose-400 shrink-0" />
          <span className="text-[11px] font-bold text-rose-300 uppercase">
            Out of {brief.stockout.lines[0]?.product.name}{brief.stockout.lines.length > 1 ? ` +${brief.stockout.lines.length - 1} more` : ''} — losing ~{formatCurrency(brief.stockout.total)}/day
          </span>
        </button>
      )}
      </div>
      </>
      )}
    </section>
      )}
    </>
  );
}
