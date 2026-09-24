// Shared area home: one component behind Tailoring, Printing, Repairs and
// Bookings TODAY surfaces. Each area is a small config (title, fetcher,
// stats, rows, doors) — no more copy-pasted triplets drifting apart.
// Reads only; writes happen in the managers it opens.
//
// Honest states: loading shimmer, genuine empty ("No orders yet"), and a
// LOUD load failure ("Couldn't load — check connection") that can never be
// mistaken for an empty book.
import { useEffect, useState, type ComponentType } from 'react';
import { ArrowRightLeft, Plus, AlertTriangle, RotateCcw } from 'lucide-react';

export interface AreaStat {
  label: string;
  value: string;
  sub?: string;
  tone: 'white' | 'emerald' | 'amber' | 'cyan' | 'gold' | 'orange' | 'rose';
  wide?: boolean;
}

export interface AreaRow {
  key: string;
  title: string;
  meta?: string;
  amount?: string;
  hot?: boolean;
}

export interface AreaHomeConfig<T> {
  workspace: string;
  title: string;
  subtitle: string;
  icon: ComponentType<{ className?: string }>;
  iconWrap: string;
  iconColor: string;
  fetchList: () => Promise<T[]>;
  stats: (items: T[], fmt: (n: number) => string) => AreaStat[];
  rows: (items: T[], fmt: (n: number) => string) => AreaRow[];
  listEmpty: string;
  primaryLabel: string;
  bookLabel?: string;
}

interface AreaHomeProps {
  config: AreaHomeConfig<any>;
  formatCurrency: (val: number) => string;
  onBackSell: () => void;
  onPrimary: () => void;
  onOpenBook: () => void;
}

const TONE_BORDER: Record<AreaStat['tone'], string> = {
  white: 'border-l-zinc-500',
  emerald: 'border-l-emerald-500',
  amber: 'border-l-amber-500',
  cyan: 'border-l-cyan-500',
  gold: 'border-l-gold-brand',
  orange: 'border-l-orange-500',
  rose: 'border-l-rose-500',
};

const TONE_TEXT: Record<AreaStat['tone'], string> = {
  white: 'text-white',
  emerald: 'text-emerald-400',
  amber: 'text-amber-300',
  cyan: 'text-cyan-300',
  gold: 'text-gold-brand',
  orange: 'text-orange-300',
  rose: 'text-rose-400',
};

export default function AreaHome({
  config, formatCurrency, onBackSell, onPrimary, onOpenBook,
}: AreaHomeProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [items, setItems] = useState<any[]>([]);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setFailed(false);
    config.fetchList()
      .then(l => { setItems(Array.isArray(l) ? l : []); setLoading(false); })
      .catch(() => { setFailed(true); setLoading(false); });
  };
  useEffect(load, []);
  const stats = config.stats(items, formatCurrency);
  const rows = config.rows(items, formatCurrency).slice(0, 4);
  const Icon = config.icon;

  return (
    <div className="space-y-4" aria-label={config.workspace}>
      <div className="flex items-center gap-3">
        <div className={`w-11 h-11 rounded-xl border flex items-center justify-center ${config.iconWrap}`}>
          <Icon className={`w-5 h-5 ${config.iconColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-black text-white uppercase tracking-tight font-display">{config.title}</h2>
          <p className="text-xs text-zinc-500 font-bold">{config.subtitle}</p>
        </div>
        <button onClick={onBackSell}
          className="shrink-0 h-10 px-4 bg-gold-brand text-black rounded-xl text-xs font-black uppercase tracking-wider active:scale-95 transition-all cursor-pointer">
          Sell
        </button>
      </div>

      {failed ? (
        <div className="boss-card p-4 border-l-4 border-l-rose-500" role="alert">
          <p className="text-xs font-black text-rose-300 uppercase tracking-wider flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" /> Couldn't load — check connection
          </p>
          <p className="text-[11px] text-zinc-500 font-bold mt-1">This is NOT an empty book. Your data is safe on the server.</p>
          <button onClick={load}
            className="mt-2 h-10 px-4 bg-rose-950/40 border border-rose-800/50 text-rose-200 rounded-xl text-xs font-black uppercase tracking-wider active:scale-95 transition-all cursor-pointer flex items-center gap-1.5">
            <RotateCcw className="w-4 h-4" /> Retry
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2" aria-busy={loading}>
            {loading ? (
              <div className="boss-card p-3 col-span-2">
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest animate-pulse">Loading…</p>
              </div>
            ) : (
              stats.map(s => (
                <div key={s.label} className={`boss-card p-3 border-l-4 ${TONE_BORDER[s.tone]} ${s.wide ? 'col-span-2' : ''}`}>
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{s.label}</p>
                  <p className={`text-lg font-black font-display mt-1 tabular-nums ${TONE_TEXT[s.tone]}`}>{s.value}</p>
                  {s.sub && <p className="text-[10px] text-zinc-500 font-bold uppercase">{s.sub}</p>}
                </div>
              ))
            )}
          </div>

          {!loading && rows.length > 0 && (
            <div className="space-y-1.5">
              {rows.map(r => (
                <div key={r.key} className={`bg-zinc-900/50 border rounded-xl px-3 py-2 flex items-center justify-between gap-2 ${r.hot ? 'border-amber-600/50' : 'border-white/5'}`}>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white truncate">{r.title}</p>
                    {r.meta && <p className={`text-[10px] font-bold uppercase truncate ${r.hot ? 'text-amber-300' : 'text-zinc-500'}`}>{r.meta}</p>}
                  </div>
                  {r.amount && <p className="text-xs font-black text-emerald-400 tabular-nums shrink-0">{r.amount}</p>}
                </div>
              ))}
            </div>
          )}
          {!loading && rows.length === 0 && (
            <p className="text-xs text-zinc-500 font-bold uppercase">{config.listEmpty}</p>
          )}
        </>
      )}

      <button onClick={onPrimary}
        className="w-full h-12 bg-gold-brand text-black rounded-xl text-sm font-black uppercase tracking-widest hover:opacity-90 active:scale-[0.99] transition-all cursor-pointer flex items-center justify-center gap-2">
        <Plus className="w-4 h-4" /> {config.primaryLabel}
      </button>
      <button onClick={onOpenBook}
        className="w-full h-10 bg-[#141414] border border-white/10 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all cursor-pointer">
        {config.bookLabel || 'Open book'}
      </button>
      <button onClick={onBackSell}
        className="w-full h-10 bg-[#141414] border border-white/10 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer">
        <ArrowRightLeft className="w-4 h-4" /> Back to products
      </button>
    </div>
  );
}
