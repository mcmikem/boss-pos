import { useState, useRef, useEffect } from 'react';
import { Lock, Loader2 } from 'lucide-react';
import { readLockLog, isRapidRelock } from '../utils/locklog';

interface PinGateProps {
  onUnlock: (pin: string) => Promise<void>;
  shopName: string;
  // Set when the same 4-digit PIN belongs to more than one person: the gate
  // asks who instead of guessing, and no token is issued until they answer.
  candidates?: Array<{ id: string; name: string; role: 'manager' | 'cashier' }> | null;
  onPickPerson?: (id: string) => Promise<void>;
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30 * 1000;

export default function PinGate({ onUnlock, shopName, candidates, onPickPerson }: PinGateProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // A PIN takes up to two round-trips to check (the person, then the till), and
  // this screen used to show four filled dots and a live-looking keypad for the
  // whole of it. It looked broken, and tapping Clear plus four more digits in
  // that window started a SECOND unlock competing with the first.
  const [busy, setBusy] = useState(false);
  // Ticks once a second so the countdown under the keypad is real time left,
  // not a sentence that says 30s for 30s and then vanishes.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lockedUntil) return;
    const iv = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(iv);
  }, [lockedUntil]);
  const secondsLeft = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000)) : 0;
  const lockedOut = secondsLeft > 0;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Why is the till asking for PIN again? Show the last recorded cause so a
  // loop becomes a named reason; escalate when locks are cycling rapidly.
  const [lockInfo] = useState(() => {
    try {
      const log = readLockLog();
      return { last: log[0] || null, rapid: isRapidRelock(log) };
    } catch {
      return { last: null, rapid: false };
    }
  });

  const handleDigit = async (d: string) => {
    if (busy || Date.now() < lockedUntil) return;
    setError('');
    const next = pin + d;
    if (next.length > 4) return;
    setPin(next);
    if (next.length === 4) {
      setBusy(true);
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
          setError(serverLocked ? msg : 'Too many attempts.');
        } else {
          setError(msg);
        }
      } finally {
        setBusy(false);
      }
    }
  };

  const handleClear = () => {
    if (busy) return;
    setPin('');
    setError('');
  };

  const handleBackspace = () => {
    if (busy) return;
    setPin(prev => prev.slice(0, -1));
  };

  return (
    <div className="fixed inset-0 bg-[#0A0A0A] z-[200] flex flex-col items-center justify-center p-6 overflow-y-auto">
      <div className="w-16 h-16 rounded-full bg-gold-brand/10 border border-gold-brand/30 flex items-center justify-center mb-6">
        <Lock className="w-7 h-7 text-gold-brand" />
      </div>
      <h1 className="text-lg font-black text-white uppercase tracking-wider mb-1">{shopName}</h1>
      {candidates?.length ? (
        <>
          <p className="text-xs text-gold-brand font-bold uppercase tracking-wider mb-1">Who is this?</p>
          <p className="text-[11px] text-zinc-500 font-bold uppercase mb-4 text-center max-w-[260px] leading-snug">
            This PIN is used by more than one person. Tap your name.
          </p>
          <div className="w-full max-w-[280px] space-y-2 mb-4">
            {candidates.map(c => (
              <button key={c.id} disabled={busy} onClick={async () => {
                setError('');
                setBusy(true);
                try { await onPickPerson?.(c.id); }
                catch (err) { setError((err as Error)?.message || 'Wrong PIN'); }
                finally { setBusy(false); }
              }}
                className="w-full h-14 rounded-2xl bg-zinc-900 border border-zinc-800 hover:border-gold-brand/40 text-white text-base font-black flex items-center justify-between px-4 active:scale-[0.99] transition-all cursor-pointer">
                <span className="truncate">{c.name}</span>
                <span className={`text-[10px] font-black uppercase tracking-widest ${c.role === 'manager' ? 'text-emerald-400' : 'text-zinc-500'}`}>
                  {c.role === 'manager' ? 'Manager' : 'Cashier'}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-zinc-500 font-bold uppercase tracking-wider mb-2">Enter your PIN</p>
          {lockInfo.rapid && lockInfo.last ? (
            <p className="text-[11px] text-amber-300 font-bold mb-1 max-w-[260px] text-center">
              Till keeps locking (last: {lockInfo.last.reason}) — after unlock, check Settings → Security for the full history.
            </p>
          ) : lockInfo.last ? (
            <p className="text-[10px] text-zinc-600 font-bold mb-1">Last lock: {lockInfo.last.reason}</p>
          ) : null}

          <div className="flex gap-3 mb-8 items-center justify-center">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all ${pin.length > i ? 'bg-gold-brand border-gold-brand' : 'border-zinc-600'}`} />
            ))}
            {busy && <Loader2 className="w-4 h-4 ml-1 text-gold-brand animate-spin" aria-label="Checking your PIN" />}
          </div>
        </>
      )}

      {!candidates?.length && error && (
        <p className={`text-xs font-bold mb-4 text-center ${lockedOut ? 'text-amber-300' : 'text-rose-400'}`}>
          {error}{lockedOut ? ` Try again in ${secondsLeft}s.` : ''}
        </p>
      )}

      {!candidates?.length && (
        <div className="grid grid-cols-3 gap-3 max-w-[240px]">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
            <button key={n} onClick={() => handleDigit(String(n))} disabled={busy || lockedOut}
              className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 hover:border-gold-brand/40 text-white text-xl font-black active:scale-90 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
              {n}
            </button>
          ))}
          <button onClick={handleClear} disabled={busy || lockedOut}
            className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-500 text-xs font-bold active:scale-90 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
            Clear
          </button>
          <button onClick={() => handleDigit('0')} disabled={busy || lockedOut}
            className="w-16 h-16 rounded-2xl bg-gold-brand text-black text-xl font-black active:scale-90 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
            0
          </button>
          <button onClick={handleBackspace} disabled={busy || lockedOut}
            className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-500 text-xs font-bold active:scale-90 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
            ←
          </button>
        </div>
      )}

      <input ref={inputRef} type="text" className="absolute opacity-0 pointer-events-none" readOnly tabIndex={-1} />

      <p className="text-[11px] text-zinc-600 font-bold mt-6 max-w-[260px] text-center leading-relaxed">
        Your own PIN opens the till and signs you in at once. Forgot it? Ask your manager — PINs can be reset in Settings.
      </p>
    </div>
  );
}
