// Shared bottom-sheet shell: handle, header, scrollable middle with pinned
// footer. One pattern for every slide-up form so footers can never end up
// behind the bottom nav again (sheet at z-80, safe-area footer padding,
// min-h-0 shrink chain inside).
import type { ReactNode, RefObject } from 'react';
import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

interface SheetProps {
  onClose: () => void;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  'audio[controls]',
  'video[controls]',
  'summary',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

type DialogStackEntry = { token: symbol; container: HTMLElement };
const dialogStack: DialogStackEntry[] = [];

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(element => {
    if (element.getAttribute('aria-hidden') === 'true') return false;
    if (element.getAttribute('aria-disabled') === 'true') return false;
    if (element.closest('[hidden], [aria-hidden="true"], [inert], fieldset[disabled]')) return false;
    const style = typeof window === 'undefined' ? null : window.getComputedStyle(element);
    if (style?.display === 'none' || style?.visibility === 'hidden') return false;
    return element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0 || element === document.activeElement;
  });
}

function focusFirst(container: HTMLElement, backwards = false) {
  const focusable = getFocusable(container);
  const target = backwards ? focusable[focusable.length - 1] : focusable[0];
  (target || container).focus();
}

export function useDialogFocus(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;

    const container = containerRef.current;
    if (!container) return;

    const previous = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
    const token = Symbol('dialog');
    dialogStack.push({ token, container });
    const focusTimer = window.setTimeout(() => {
      if (dialogStack[dialogStack.length - 1]?.token !== token) return;
      const focusable = getFocusable(container);
      const preferred = focusable.find(element => element.hasAttribute('data-dialog-initial-focus'));
      (preferred || focusable[0] || container).focus();
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1]?.token !== token) return;
      if (event.key === 'Escape' || event.key === 'Esc') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusable(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (!container.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && (activeElement === first || activeElement === container)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const onFocusIn = (event: FocusEvent) => {
      if (dialogStack[dialogStack.length - 1]?.token !== token) return;
      if (container.contains(event.target as Node)) return;
      focusFirst(container, false);
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
      const index = dialogStack.findIndex(entry => entry.token === token);
      if (index !== -1) dialogStack.splice(index, 1);
      window.setTimeout(() => {
        const current = dialogStack[dialogStack.length - 1];
        if (current) {
          if (previous && current.container.contains(previous)) previous.focus();
          else focusFirst(current.container, false);
          return;
        }
        const target = previous && document.documentElement.contains(previous)
          ? previous
          : document.getElementById('main-content');
        target?.focus();
      }, 0);
    };
  }, [active, containerRef]);
}

export default function Sheet({ onClose, title, icon, children, footer }: SheetProps) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  useDialogFocus(true, sheetRef, onClose);

  return (
    <div className="fixed inset-0 z-[80] flex flex-col">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onMouseDown={onClose} aria-hidden="true" />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative mt-auto bg-[#141414] border-t border-zinc-800 rounded-t-3xl max-h-[92vh] flex flex-col shadow-2xl animate-slide-up"
      >
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-zinc-700" />
        </div>
        <div className="flex items-center justify-between px-5 pb-3 border-b border-white/5">
          <h3 id={titleId} className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
            {icon}
            {title}
          </h3>
          <button type="button" onClick={onClose} aria-label={`Close ${title}`} data-dialog-initial-focus
            className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 transition-all cursor-pointer">
            <X className="w-5 h-5" aria-hidden="true" />
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
