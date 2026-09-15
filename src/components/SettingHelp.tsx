import { useState } from 'react';
import { Info } from 'lucide-react';

interface SettingHelpProps {
  label: string;
  text: string;
}

// Per-setting explainer: a small (i) next to the label. Tapping it shows one
// plain-language paragraph right under the label — nothing hidden in manuals,
// and graduates never need to open it again.
export default function SettingHelp({ label, text }: SettingHelpProps) {
  const [open, setOpen] = useState(false);
  return (
    <span className="contents">
      <button onClick={() => setOpen(o => !o)} aria-label={`What does ${label} do?`} aria-expanded={open}
        title={`What does ${label} do?`}
        className={`p-1 -m-1 rounded-lg transition-all cursor-pointer shrink-0 ${open ? 'text-gold-brand' : 'text-zinc-600 hover:text-gold-brand'}`}>
        <Info className="w-3.5 h-3.5" />
      </button>
      {open && (
        <span className="block basis-full mt-1 rounded-xl border border-gold-brand/30 bg-gold-brand/5 px-3 py-2 text-[11px] font-bold text-zinc-300 leading-snug normal-case tracking-normal">
          {text}
        </span>
      )}
    </span>
  );
}
