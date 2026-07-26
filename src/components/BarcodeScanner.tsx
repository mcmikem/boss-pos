import React, { useRef, useEffect } from 'react';
import { Barcode, AlertCircle } from 'lucide-react';

interface BarcodeScannerProps {
  onScan: (barcode: string | number) => void;
  isOpen: boolean;
  onClose: () => void;
}

export default function BarcodeScanner({ onScan, isOpen, onClose }: BarcodeScannerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleScan = (value: string) => {
    if (value.trim()) {
      // Convert barcode to productId or IMEI
      onScan(value.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const value = (e.target as HTMLInputElement).value;
      if (value.trim()) {
        handleScan(value);
        (e.target as HTMLInputElement).value = '';
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center gap-2 mb-4">
          <Barcode className="w-5 h-5 text-gold-brand" />
          <h3 className="text-sm font-black text-white uppercase tracking-wider">Scan Barcode/IMEI</h3>
        </div>

        <div className="bg-[#0A0A0A] border border-dashed border-gold-brand/40 rounded-xl p-4 mb-4">
          <p className="text-xs text-zinc-400 text-center mb-3">
            Place barcode scanner in focus and scan product barcode or IMEI
          </p>
          <input
            ref={inputRef}
            type="text"
            placeholder="Scan here..."
            onKeyDown={handleKeyDown}
            className="w-full h-14 bg-[#141414] border border-gold-brand/60 text-white text-center text-lg font-mono tracking-wider px-4 rounded-lg focus:border-gold-brand outline-none placeholder-zinc-600"
            autoComplete="off"
            spellCheck="false"
          />
        </div>

        <div className="bg-blue-900/10 border border-blue-900/30 rounded-lg p-3 mb-4">
          <div className="flex gap-2">
            <AlertCircle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-300">
              Press <strong>Enter</strong> to submit scan. Press <strong>Esc</strong> to close.
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full h-10 bg-[#0A0A0A] border border-white/10 text-zinc-300 font-bold rounded-xl text-xs hover:bg-white/5 active:scale-98 transition-all uppercase tracking-wider"
        >
          Close Scanner
        </button>
      </div>
    </div>
  );
}
