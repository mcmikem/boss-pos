import {StrictMode, useEffect, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import {AdminDashboard} from './components/AdminDashboard.tsx';
import {initSentry} from './utils/sentry.ts';

initSentry();

const root = createRoot(document.getElementById('root')!);

const Root = window.location.pathname === '/admin' ? AdminDashboard : App;

function MainTarget({ children }: { children: ReactNode }) {
  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return;
    main.id = 'main-content';
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  }, []);

  return children;
}

root.render(
  <StrictMode>
    <MainTarget>
      <ErrorBoundary>
        <Root />
      </ErrorBoundary>
    </MainTarget>
  </StrictMode>,
);

// A till that will not start must not be a black rectangle. The chunk self-heal
// below reloads twice and then gives up, and on a phone with a bad data bundle
// that is exactly how you get a black screen with nothing to tap: no word, no
// button, no way to tell whether the app is broken or the phone is. So when
// there is nothing left to try, say so in plain words and leave a Reload button
// under her thumb. Offline sales already sit in the outbox and are untouched by
// any of this.
function paintRecovery(reason: string) {
  try {
    const el = document.getElementById('root') || document.body;
    el.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.setAttribute('style', 'min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#0A0A0A;color:#EDEDED;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-align:center');
    const box = document.createElement('div');
    box.setAttribute('style', 'max-width:340px');
    const h = document.createElement('h1');
    h.textContent = 'The till could not start';
    h.setAttribute('style', 'font-size:17px;font-weight:800;margin:0 0 10px;color:#ffcc00;text-transform:uppercase;letter-spacing:.5px');
    const p = document.createElement('p');
    p.textContent = reason;
    p.setAttribute('style', 'font-size:14px;line-height:1.5;margin:0 0 8px;color:#A1A1AA');
    const p2 = document.createElement('p');
    p2.textContent = 'Nothing you sold today has been lost. Sales waiting for a connection are kept on this phone.';
    p2.setAttribute('style', 'font-size:12px;line-height:1.5;margin:0 0 20px;color:#71717A');
    const btn = document.createElement('button');
    btn.textContent = 'Reload the till';
    btn.setAttribute('style', 'width:100%;height:52px;border:none;border-radius:14px;background:#ffcc00;color:#000;font-weight:900;font-size:13px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer');
    btn.onclick = () => {
      try { sessionStorage.removeItem('boss_chunk_reloads'); } catch {}
      window.location.reload();
    };
    box.appendChild(h); box.appendChild(p); box.appendChild(p2); box.appendChild(btn);
    wrap.appendChild(box);
    el.appendChild(wrap);
  } catch {
    // Nothing left to do — at least the reload handler above still applies.
  }
}

let recoveryShown = false;
const showRecovery = (reason: string) => {
  if (recoveryShown) return;
  recoveryShown = true;
  paintRecovery(reason);
};


// Stale-chunk self-heal: after a deploy the new service worker purges the old
// hashed chunks, but a still-open page may try to lazy-load one (404 ->
// "Failed to fetch dynamically imported module"). Reload once so the newest
// index.html + chunks load. Capped via sessionStorage so a genuinely dead
// network can't loop forever.
let chunkReloads = 0;
try {
  chunkReloads = parseInt(sessionStorage.getItem('boss_chunk_reloads') || '0', 10);
} catch {}

window.addEventListener('error', (event) => {
  const msg = (event && event.message) || '';
  if (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed')
  ) {
    event.preventDefault();
    if (chunkReloads >= 2) {
      // Two reloads have not fixed it, so the phone cannot fetch the app. Say so
      // instead of leaving a black screen.
      showRecovery('This phone could not download the latest version of the till. Check the connection, then reload.');
      return;
    }
    chunkReloads += 1;
    try { sessionStorage.setItem('boss_chunk_reloads', String(chunkReloads)); } catch {}
    window.location.reload();
  }
}, true);

window.addEventListener('unhandledrejection', (event) => {
  const msg = String((event.reason && (event.reason as Error).message) || '');
  if (/dynamically imported module|Importing a module script|Failed to fetch/i.test(msg)) return;
  if (!document.getElementById('root')?.firstChild) {
    showRecovery('Something went wrong while starting the till.');
  }
});

// Old-Android keyboard rescue: pre-Chrome-70 WebViews don't resize the layout
// viewport when the keyboard opens, so fixed modals keep their full height
// behind it and the focused field + Save button hide underneath. Nudging the
// focused field into view (after the keyboard finishes opening) keeps every
// form usable. Harmless on modern browsers (they already scrolled correctly).
document.addEventListener('focusin', (event) => {
  const el = event.target as HTMLElement | null;
  if (!el) return;
  const tag = el.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return;
  window.setTimeout(() => {
    try {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch {
      try { el.scrollIntoView(); } catch { /* ignore */ }
    }
  }, 350);
});

if ('serviceWorker' in navigator) {
  type ServiceWorkerWindow = Window & { __bossPosServiceWorkerRegistered?: boolean };
  const serviceWorkerWindow = window as ServiceWorkerWindow;
  let refreshing = false;
  let hasController = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hasController) {
      hasController = true;
      return;
    }
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  const checkForUpdate = () => {
    navigator.serviceWorker.getRegistration().then(reg => {
      if (reg) reg.update().catch(() => {});
    }).catch(() => {});
  };

  const registerServiceWorker = () => {
    if (serviceWorkerWindow.__bossPosServiceWorkerRegistered) return;
    serviceWorkerWindow.__bossPosServiceWorkerRegistered = true;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      serviceWorkerWindow.__bossPosServiceWorkerRegistered = false;
    });
  };

  if (document.readyState === 'complete') registerServiceWorker();
  else window.addEventListener('load', registerServiceWorker, { once: true });
  window.addEventListener('load', () => setTimeout(checkForUpdate, 2500));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') setTimeout(checkForUpdate, 800);
  });
}
