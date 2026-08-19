import { useEffect, useRef } from 'react';
import { CheckCircle, AlertTriangle, Info, X } from 'lucide-react';

interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'info';
  onClose: () => void;
}

export default function Toast({ message, type, onClose }: ToastProps) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const timer = setTimeout(() => {
      onCloseRef.current();
    }, 4000);
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
    <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-[300] flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl transition-all duration-300 animate-bounce ${bgStyles[type]}`}>
      {icons[type]}
      <span className="text-sm font-medium tracking-wide">{message}</span>
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
