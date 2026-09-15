import { useEffect, useRef } from 'react';
import { CheckCircle, AlertTriangle, Info, X } from 'lucide-react';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export type TriggerToast = (message: string, type: 'success' | 'error' | 'info', action?: ToastAction) => void;

interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'info';
  action?: ToastAction;
  onClose: () => void;
}

export default function Toast({ message, type, action, onClose }: ToastProps) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const actionRef = useRef(action);
  actionRef.current = action;

  useEffect(() => {
    // Action toasts linger so there's time to read and tap.
    const timer = setTimeout(() => {
      onCloseRef.current();
    }, actionRef.current ? 6000 : 4000);
    return () => clearTimeout(timer);
  }, []);

  const bgStyles = {
    success: 'bg-emerald-950 border border-emerald-500/30 text-emerald-300',
    error: 'bg-rose-950 border border-rose-500/30 text-rose-300',
    info: 'bg-amber-950 border border-amber-500/30 text-amber-300',
  };

  const icons = {
    success: <CheckCircle className="w-5 h-5 text-emerald-400" />,
    error: <AlertTriangle className="w-5 h-5 text-rose-400" />,
    info: <Info className="w-5 h-5 text-amber-400" />,
  };

  return (
    <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-[3000] flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl animate-slide-up max-w-[calc(100vw-2rem)] ${bgStyles[type]}`}>
      {icons[type]}
      <span className="text-sm font-medium tracking-wide">{message}</span>
      {action && (
        <button
          onClick={() => { action.onClick(); onClose(); }}
          className="ml-1 shrink-0 h-9 px-3 bg-gold-brand text-black font-black text-[11px] rounded-lg uppercase tracking-wider cursor-pointer active:scale-95"
        >
          {action.label}
        </button>
      )}
      <button 
        onClick={onClose} 
        className="ml-2 hover:opacity-80 active:scale-90 transition-all"
        id="close-toast-btn"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}