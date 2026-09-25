import { useEffect, useState } from 'react';
import { Moon, X } from 'lucide-react';
import { closeReminderState, formatMinutesLeft, type ShopHours } from '../utils/dates';

const DISMISSED_KEY = 'boss_pos_close_reminder_dismissed';

export interface CloseReminderBarProps {
  hours: ShopHours;
  leadMinutes?: number;
  soundOn?: boolean;
  onStartClose: () => void;
  onDismiss: () => void;
}

export default function CloseReminderBar({
  hours, leadMinutes, soundOn, onStartClose, onDismiss,
}: CloseReminderBarProps) {
  const [now, setNow] = useState(() => new Date());
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(DISMISSED_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    const tick = () => setNow(new Date());
    const iv = window.setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(iv); document.removeEventListener('visibilitychange', tick); };
  }, []);

  const state = closeReminderState(hours, leadMinutes, now);
  if (!state || dismissed) return null;

  // One short beep when the reminder first appears, not a repeating alarm.
  useEffect(() => {
    if (!soundOn) return;
    try {
      const AC = (window as unknown as { AudioContext?: new () => AudioContext; webkitAudioContext?: new () => AudioContext }).AudioContext
        || (window as unknown as { webkitAudioContext?: new () => AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const gain = ctx.createGain();
      gain.gain.value = 0.12;
      gain.connect(ctx.destination);
      for (const [freq, delay] of [[660, 0], [880, 0.18]] as const) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(gain);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + 0.12);
      }
    } catch {}
  }, [soundOn]);

  const urgent = state.minutesLeft <= 15;
  const label = state.minutesLeft <= 0
    ? 'Closing time has passed'
    : `${formatMinutesLeft(state.minutesLeft)} to close`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-2xl border px-4 py-3 mb-4 flex items-center gap-3 ${
        urgent ? 'bg-rose-950/40 border-rose-600/50' : 'bg-amber-950/30 border-amber-500/40'
      }`}
    >
      <span
        aria-hidden="true"
        className={`w-2 h-2 rounded-full shrink-0 ${urgent ? 'bg-rose-400 animate-pulse' : 'bg-amber-400'}`}
      />
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-black uppercase tracking-wider ${urgent ? 'text-rose-200' : 'text-amber-200'}`}>
          <Moon className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
          {label}
        </p>
        <p className="text-[11px] font-bold text-zinc-400 mt-0.5">
          Count the drawer and finish the books before you lock up.
        </p>
      </div>
      <button
        onClick={onStartClose}
        className="shrink-0 h-11 px-4 rounded-xl bg-gold-brand text-black text-[11px] font-black uppercase tracking-wider active:scale-95 transition-all cursor-pointer"
      >
        Close day
      </button>
      <button
        onClick={() => { setDismissed(true); onDismiss(); try { localStorage.setItem(DISMISSED_KEY, '1'); } catch {} }}
        aria-label="Dismiss closing reminder for today"
        className="shrink-0 p-2 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 cursor-pointer"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
