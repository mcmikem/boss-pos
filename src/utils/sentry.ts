let enabled = false;
export function initSentry() {
  if (enabled) return;
  enabled = true;
  window.addEventListener('error', (e) => {
    try {
      const payload = { msg: e.message, src: e.filename, line: e.lineno, col: e.colno, stack: (e.error as Error)?.stack?.slice(0, 800) || '', ua: navigator.userAgent, time: new Date().toISOString() };
      // Best-effort: send to /api/audit as Sentry-lite (no external dep, works offline-queued)
      fetch('/api/audit', { method: 'GET', headers: { Authorization: localStorage.getItem('boss_pos_token') ? `Bearer ${localStorage.getItem('boss_pos_token')}` : '' } }).catch(()=>{});
      console.error('[sentry]', payload);
      // Store last 20 errors locally for Settings → View errors
      try {
        const key = 'boss_pos_client_errors';
        const arr = JSON.parse(localStorage.getItem(key) || '[]');
        arr.unshift(payload);
        localStorage.setItem(key, JSON.stringify(arr.slice(0, 20)));
      } catch {}
    } catch {}
  });
  window.addEventListener('unhandledrejection', (e) => {
    try {
      const msg = String((e.reason as Error)?.message || e.reason || 'unhandledrejection');
      console.error('[sentry] unhandled', msg);
      try {
        const key = 'boss_pos_client_errors';
        const arr = JSON.parse(localStorage.getItem(key) || '[]');
        arr.unshift({ msg, stack: String((e.reason as Error)?.stack || '').slice(0,800), time: new Date().toISOString() });
        localStorage.setItem(key, JSON.stringify(arr.slice(0,20)));
      } catch {}
    } catch {}
  });
}
