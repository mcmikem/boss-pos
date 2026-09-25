import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptOptions {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  secure?: boolean;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel';
  validate?: (value: string) => string | null;
}

function DialogShell({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
      (first || dialogRef.current)?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
      window.setTimeout(() => previous?.focus(), 0);
    };
  }, []);
  return (
    <div
      className="fixed inset-0 bg-black/85 backdrop-blur-md z-[110] flex items-center justify-center p-4"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-sm p-6 shadow-2xl max-h-[92vh] overflow-y-auto focus:outline-none"
      >
        <h3 className="text-sm font-black text-white uppercase tracking-wider text-center mb-2">{title}</h3>
        <div className="space-y-3">{children}</div>
        <div className="flex gap-2 mt-4">{footer}</div>
      </div>
    </div>
  );
}

function ConfirmView({ options, onDone }: { options: ConfirmOptions; onDone: (value: boolean) => void }) {
  return (
    <DialogShell
      title={options.title}
      onClose={() => onDone(false)}
      footer={(
        <>
          <button type="button" onClick={() => onDone(false)} className="flex-1 h-11 border border-zinc-800 text-zinc-400 font-bold text-xs rounded-xl uppercase tracking-wider cursor-pointer">
            {options.cancelLabel || 'Cancel'}
          </button>
          <button type="button" onClick={() => onDone(true)} className={`flex-1 h-11 font-black text-xs rounded-xl uppercase tracking-widest cursor-pointer ${options.danger ? 'bg-rose-600 text-white' : 'bg-gold-brand text-black'}`}>
            {options.confirmLabel || 'Confirm'}
          </button>
        </>
      )}
    >
      <p className="text-xs text-zinc-300 text-center leading-relaxed whitespace-pre-line">{options.message}</p>
    </DialogShell>
  );
}

function PromptView({ options, onDone }: { options: PromptOptions; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(options.defaultValue || '');
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const trimmed = value.trim();
    if (options.validate) {
      const message = options.validate(trimmed);
      if (message) {
        setError(message);
        return;
      }
    }
    onDone(trimmed);
  };
  return (
    <DialogShell
      title={options.title}
      onClose={() => onDone(null)}
      footer={(
        <>
          <button type="button" onClick={() => onDone(null)} className="flex-1 h-11 border border-zinc-800 text-zinc-400 font-bold text-xs rounded-xl uppercase tracking-wider cursor-pointer">
            {options.cancelLabel || 'Cancel'}
          </button>
          <button type="button" onClick={submit} className="flex-1 h-11 bg-gold-brand text-black font-black text-xs rounded-xl uppercase tracking-widest cursor-pointer">
            {options.confirmLabel || 'Save'}
          </button>
        </>
      )}
    >
      {options.message && <p className="text-xs text-zinc-300 text-center leading-relaxed whitespace-pre-line">{options.message}</p>}
      <input
        type={options.secure ? 'password' : 'text'}
        inputMode={options.inputMode === 'numeric' ? 'numeric' : options.inputMode === 'decimal' ? 'decimal' : options.inputMode === 'tel' ? 'tel' : 'text'}
        value={value}
        placeholder={options.placeholder}
        onChange={event => { setValue(event.target.value); setError(null); }}
        onKeyDown={event => { if (event.key === 'Enter') submit(); }}
        aria-label={options.title}
        className="w-full h-12 bg-[#0A0A0A] border border-white/10 rounded-xl px-4 text-sm text-white font-bold outline-none focus:border-gold-brand"
      />
      {error && <p role="alert" className="text-[11px] text-rose-400 font-bold text-center">{error}</p>}
    </DialogShell>
  );
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (value: boolean) => {
      try { root.unmount(); } catch {}
      host.remove();
      resolve(value);
    };
    root.render(<ConfirmView options={options} onDone={done} />);
  });
}

export function promptDialog(options: PromptOptions): Promise<string | null> {
  return new Promise(resolve => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (value: string | null) => {
      try { root.unmount(); } catch {}
      host.remove();
      resolve(value);
    };
    root.render(<PromptView options={options} onDone={done} />);
  });
}

export function notifyDialog(message: string): Promise<void> {
  return confirmDialog({ title: 'Notice', message, confirmLabel: 'OK', cancelLabel: 'Close' }).then(() => undefined);
}
