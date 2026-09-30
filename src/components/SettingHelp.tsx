import { useState } from 'react';
import { Info } from 'lucide-react';

interface SettingHelpProps {
  label: string;
  text: string;
  /**
   * Where this setting lives, said on the row itself rather than buried in the
   * paragraph. A phone-only setting that LOOKS saved is how a manager changes
   * something on one till and cannot work out why the other till ignored it.
   */
  scope?: 'shop' | 'phone';
}

/**
 * Says WHERE a setting is saved, on the row itself. A setting that looks saved
 * but only lives on one phone is how a manager changes something and cannot work
 * out why the other till ignored it — so this is on the row, not in the
 * paragraph you have to open to find.
 */
export function ScopeChip({ scope }: { scope: 'shop' | 'phone' }) {
  return (
    <span className={`px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest border shrink-0 ${
      scope === 'shop'
        ? 'bg-emerald-950/40 text-emerald-300/90 border-emerald-700/40'
        : 'bg-zinc-800/50 text-zinc-400 border-zinc-600/50'
    }`}
      title={scope === 'shop'
        ? 'Saved to the shop — every till sees this'
        : 'This phone only. Other tills are not changed, and nothing is lost — it just lives here.'}
    >
      {scope === 'shop' ? 'All tills' : 'This phone'}
    </span>
  );
}

// Per-setting explainer: a small (i) next to the label. Tapping it shows one
// plain-language paragraph right under the label — nothing hidden in manuals,
// and graduates never need to open it again.
export default function SettingHelp({ label, text, scope }: SettingHelpProps) {
  const [open, setOpen] = useState(false);
  return (
    <span className="contents">
      <button onClick={() => setOpen(o => !o)} aria-label={`What does ${label} do?`} aria-expanded={open}
        title={`What does ${label} do?`}
        className={`p-1 -m-1 rounded-lg transition-all cursor-pointer shrink-0 ${open ? 'text-gold-brand' : 'text-zinc-600 hover:text-gold-brand'}`}>
        <Info className="w-3.5 h-3.5" />
      </button>
      {/* On the row, always visible, not only when the paragraph is open. */}
      {scope && (
        <span className={`px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest border shrink-0 ${
          scope === 'shop'
            ? 'bg-emerald-950/40 text-emerald-300/90 border-emerald-700/40'
            : 'bg-zinc-800/50 text-zinc-400 border-zinc-600/50'
        }`}
          title={scope === 'shop'
            ? 'Saved to the shop — every till sees this'
            : 'This phone only. Other tills are not changed, and this is not lost — it just lives here.'}
        >
          {scope === 'shop' ? 'All tills' : 'This phone'}
        </span>
      )}
      {open && (
        <span className="block basis-full mt-1 rounded-xl border border-gold-brand/30 bg-gold-brand/5 px-3 py-2 text-[11px] font-bold text-zinc-300 leading-snug normal-case tracking-normal">
          {text}
        </span>
      )}
    </span>
  );
}
