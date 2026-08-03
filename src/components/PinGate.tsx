import { useState, useRef, useEffect } from 'react';
import { Lock } from 'lucide-react';

interface PinGateProps {
  onUnlock: (pin: string) => Promise<void>;
  shopName: string;
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30 * 1000;

export default function PinGate({ onUnlock, shopName }: PinGateProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleDigit = async (d: string) => {
    if (Date.now() < lockedUntil) return;
    setError('');
    const next = pin + d;
    if (next.length > 4) return;
    setPin(next);
    if (next.length === 4) {
      try {
        await onUnlock(next);
      } catch (err) {
        const msg = (err as Error)?.message || 'Wrong PIN';
        const serverLocked = msg.includes('Too many attempts');
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        setPin('');
        if (serverLocked || newAttempts >= MAX_ATTEMPTS) {
          const until = Date.now() + LOCKOUT_MS;
          setLockedUntil(until);
          setAttempts(0);
          setError(serverLocked ? msg : `Too many attempts. Try again in ${LOCKOUT_MS / 1000}s.`);
          setTimeout(() => setError(''), LOCKOUT_MS);
        } else {
          setError(msg);
        }
      }
    }
  };

  const handleClear = () => {
    setPin('');
    setError('');
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
  };

  return (
    <div className="fixed inset-0 bg-[#0A0A0A] z-[200] flex flex-col items-center justify-center p-6">
      <div className="w-16 h-16 rounded-full bg-gold-brand/10 border border-gold-brand/30 flex items-center justify-center mb-6">
        <Lock className="w-7 h-7 text-gold-brand" />
      </div>
      <h1 className="text-lg font-black text-white uppercase tracking-wider mb-1">{shopName}</h1>
      <p className="text-xs text-zinc-500 font-bold uppercase tracking-wider mb-8">Enter PIN</p>

      <div className="flex gap-3 mb-8">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all ${pin.length > i ? 'bg-gold-brand border-gold-brand' : 'border-zinc-600'}`} />
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

      <input ref={inputRef} type="text" className="absolute opacity-0 pointer-events-none" readOnly tabIndex={-1} />
    </div>
  );
}
