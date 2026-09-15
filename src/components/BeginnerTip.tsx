import { useState } from 'react';
import { X, Lightbulb } from 'lucide-react';

interface BeginnerTipProps {
  tipKey: string;
  text: string;
}

// Plain-language helper (#5): a one-line explainer shown ONLY the first time
// a beginner sees a term ("Ingredient cost", "Close day", ...). Dismissal is
// persisted forever — graduates never see it again.
export default function BeginnerTip({ tipKey, text }: BeginnerTipProps) {
  const storageKey = `boss_pos_tip_${tipKey}`;
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(storageKey) === '1'; } catch { return false; }
  });
  if (dismissed) return null;
  const dismiss = () => {
    try { localStorage.setItem(storageKey, '1'); } catch {}
    setDismissed(true);
  };
  return (
    <div role="note" className="flex items-start gap-2 rounded-xl border border-gold-brand/30 bg-gold-brand/5 px-3 py-2">
      <Lightbulb className="w-4 h-4 text-gold-brand shrink-0 mt-0.5" aria-hidden="true" />
      <p className="flex-1 min-w-0 text-[11px] font-bold text-zinc-300 leading-snug">{text}</p>
      <button onClick={dismiss} aria-label="Dismiss tip"
        className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 cursor-pointer shrink-0">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
