import React from 'react';
import { X, Keyboard } from 'lucide-react';

interface KeyboardShortcutsProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function KeyboardShortcuts({ isOpen, onClose }: KeyboardShortcutsProps) {
  if (!isOpen) return null;

  const shortcuts = [
    { key: 'F1', action: 'Open Barcode Scanner' },
    { key: 'F2', action: 'Complete Sale' },
    { key: 'Esc', action: 'Close Modal' },
    { key: 'Ctrl+N', action: 'Quick Add Product' },
    { key: 'Ctrl+/', action: 'Show Shortcuts' },
  ];

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4">
          <div className="flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-gold-brand" />
            <h3 className="text-sm font-black text-white uppercase tracking-wider">Keyboard Shortcuts</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3 max-h-[400px] overflow-y-auto mb-4">
          {shortcuts.map((shortcut, idx) => (
            <div key={idx} className="flex items-center justify-between bg-[#0A0A0A] border border-white/5 rounded-lg p-3">
              <p className="text-xs text-zinc-400">{shortcut.action}</p>
              <kbd className="bg-gold-brand/10 border border-gold-brand/40 text-gold-brand px-2 py-1 rounded text-xs font-bold whitespace-nowrap">
                {shortcut.key}
              </kbd>
            </div>
          ))}
        </div>

        <button
          onClick={onClose}
          className="w-full h-10 bg-gold-brand text-black font-black uppercase tracking-widest rounded-xl text-xs hover:opacity-90 active:scale-98 transition-all"
        >
          Got It
        </button>
      </div>
    </div>
  );
}
