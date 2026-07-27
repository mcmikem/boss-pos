import { useState, useRef, useEffect } from 'react';
import { Lock, X } from 'lucide-react';

interface PinGateProps {
  onUnlock: () => void;
  onSetPin: (pin: string) => void;
  hasPin: boolean;
  shopName: string;
}

export default function PinGate({ onUnlock, onSetPin, hasPin, shopName }: PinGateProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isSettingPin, setIsSettingPin] = useState(!hasPin);
  const [confirmPin, setConfirmPin] = useState('');
  const [step, setStep] = useState<'enter' | 'confirm'>('enter');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleDigit = (d: string) => {
    setError('');
    if (isSettingPin) {
      if (step === 'enter') {
        const next = pin + d;
        if (next.length <= 4) setPin(next);
        if (next.length === 4) { setStep('confirm'); setConfirmPin(''); setTimeout(() => inputRef.current?.focus(), 50); }
      } else {
        const next = confirmPin + d;
        if (next.length <= 4) setConfirmPin(next);
        if (next.length === 4) {
          if (next === pin) { onSetPin(pin); }
          else { setError('PINs do not match'); setPin(''); setConfirmPin(''); setStep('enter'); }
        }
      }
    } else {
      const next = pin + d;
      if (next.length <= 4) setPin(next);
      if (next.length === 4) {
        const stored = localStorage.getItem('boss_pos_pin');
        if (next === stored) { onUnlock(); }
        else { setError('Wrong PIN'); setPin(''); }
      }
    }
  };

  const handleClear = () => {
    setPin('');
    setConfirmPin('');
    setError('');
    if (isSettingPin) { setStep('enter'); }
  };

  const handleBackspace = () => {
    if (isSettingPin && step === 'confirm') {
      setConfirmPin(prev => prev.slice(0, -1));
    } else {
      setPin(prev => prev.slice(0, -1));
    }
  };

  const dots = isSettingPin && step === 'confirm' ? confirmPin : pin;

  return (
    <div className="fixed inset-0 bg-[#0A0A0A] z-[200] flex flex-col items-center justify-center p-6">
      <div className="w-16 h-16 rounded-full bg-gold-brand/10 border border-gold-brand/30 flex items-center justify-center mb-6">
        {isSettingPin ? <Lock className="w-7 h-7 text-gold-brand" /> : <Lock className="w-7 h-7 text-gold-brand" />}
      </div>
      <h1 className="text-lg font-black text-white uppercase tracking-wider mb-1">{shopName}</h1>
      <p className="text-xs text-zinc-500 font-bold uppercase tracking-wider mb-8">
        {isSettingPin ? (step === 'enter' ? 'Set a 4-digit PIN' : 'Confirm your PIN') : 'Enter PIN'}
      </p>

      <div className="flex gap-3 mb-8">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all ${dots.length > i ? 'bg-gold-brand border-gold-brand' : 'border-zinc-600'}`} />
        ))}
      </div>

      {error && <p className="text-xs text-rose-400 font-bold mb-4">{error}</p>}

      <div className="grid grid-cols-3 gap-3 max-w-[240px]">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
          <button key={n} onClick={() => handleDigit(String(n))}
            className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 hover:border-gold-brand/40 text-white text-xl font-black active:scale-90 transition-all cursor-pointer">
            {n}
          </button>
        ))}
        <button onClick={handleClear}
          className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-500 text-xs font-bold active:scale-90 transition-all cursor-pointer">
          Clear
        </button>
        <button onClick={() => handleDigit('0')}
          className="w-16 h-16 rounded-2xl bg-gold-brand text-black text-xl font-black active:scale-90 transition-all cursor-pointer">
          0
        </button>
        <button onClick={handleBackspace}
          className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-500 text-xs font-bold active:scale-90 transition-all cursor-pointer">
          ←
        </button>
      </div>

      {!isSettingPin && (
        <button onClick={() => { onUnlock(); }} className="mt-6 text-[10px] text-zinc-600 hover:text-zinc-400 font-bold uppercase tracking-wider cursor-pointer">
          Skip PIN (not secure)
        </button>
      )}
      <input ref={inputRef} type="text" className="absolute opacity-0 pointer-events-none" readOnly tabIndex={-1} />
    </div>
  );
}
