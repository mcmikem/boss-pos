// Tour narration: warm spoken guidance via the device's own voices
// (Web Speech API — no downloads, works offline with on-device voices).
// Speech only ever starts from a real tap (browser autoplay rules), stops
// the moment the tour closes or moves on, and remembers the mute choice.
const VOICE_KEY = 'boss_pos_tour_voice';

export const isNarrationOn = (): boolean => {
  try { return localStorage.getItem(VOICE_KEY) !== '0'; } catch { return true; }
};

export const setNarrationOn = (on: boolean): void => {
  try { localStorage.setItem(VOICE_KEY, on ? '1' : '0'); } catch {}
  if (!on) stopSpeaking();
};

function pickVoice(): SpeechSynthesisVoice | null {
  try {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    // Ugandan seller first, then clear British English, then any English.
    return (
      voices.find(v => /en[-_]UG/i.test(v.lang)) ||
      voices.find(v => /en[-_]GB/i.test(v.lang) && /female|zira|samantha|google uk english/i.test(v.name)) ||
      voices.find(v => /en[-_]GB/i.test(v.lang)) ||
      voices.find(v => /^en/i.test(v.lang)) ||
      null
    );
  } catch {
    return null;
  }
}

// Warm up the (async) voice list on first touch so a voice is ready.
try {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }
} catch {}

export function speak(text: string): void {
  try {
    if (!isNarrationOn() || !('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.rate = 0.98;
    u.pitch = 1.05;
    u.volume = 1;
    synth.speak(u);
  } catch {}
}

export function stopSpeaking(): void {
  try {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  } catch {}
}
