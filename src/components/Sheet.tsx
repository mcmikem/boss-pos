// Shared bottom-sheet shell: handle, header, scrollable middle with pinned
// footer. One pattern for every slide-up form so footers can never end up
// behind the bottom nav again (sheet at z-80, safe-area footer padding,
// min-h-0 shrink chain inside).
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { X } from 'lucide-react';

interface SheetProps {
  onClose: () => void;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

export default function Sheet({ onClose, title, icon, children, footer }: SheetProps) {
  // Consistent back (#24): every sheet closes with ✕ top-right, backdrop tap,
  // or Escape / swipe-back — never a reinvented gesture per screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] flex flex-col">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative mt-auto bg-[#141414] border-t border-zinc-800 rounded-t-3xl max-h-[92vh] flex flex-col shadow-2xl animate-slide-up">
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-zinc-700" />
        </div>
        <div className="flex items-center justify-between px-5 pb-3 border-b border-white/5">
          <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
            {icon}
            {title}
          </h3>
          <button onClick={onClose} aria-label="Close"
            className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 transition-all cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
          {children}
        </div>
        {footer && (
          <div className="p-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] border-t border-white/5 flex gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
