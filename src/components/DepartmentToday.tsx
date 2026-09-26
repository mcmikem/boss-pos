import type { DepartmentConfig, DepartmentStat } from './departmentRegistry';
import { MoneyHero, MoneyStat } from './Design';

// The Today screen every department opens with: who you are, the state in
// figures, nothing else. The shelf (grid, orders, production) follows right
// below in the caller, so tapping a department is always state → job → shelf
// with no competing navigation layers in between.
export default function DepartmentToday({
  config,
  stats,
}: {
  config: DepartmentConfig;
  stats: DepartmentStat[];
}) {
  const Icon = config.icon;
  const [hero, ...rest] = stats;
  return (
    <section aria-label={config.title} className="space-y-2">
      <div className="flex items-center gap-2.5">
        <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-gold-brand" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-black text-white uppercase tracking-wider font-display truncate">{config.title}</h2>
          <p className="text-[10px] text-zinc-500 font-bold uppercase truncate">{config.subtitle}</p>
        </div>
      </div>
      {stats.length > 0 && (
        <div className="boss-card p-3 space-y-2">
          {hero && (
            <MoneyHero label={hero.label} value={hero.value} sub={hero.sub} tone={hero.tone} />
          )}
          {rest.length > 0 && (
            <div className="grid grid-cols-2 gap-2 border-t border-white/5 pt-2">
              {rest.map(s => (
                <MoneyStat key={s.label} label={s.label} value={s.value} sub={s.sub} tone={s.tone} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
