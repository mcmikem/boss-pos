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
    if (chunkReloads >= 2) return;
    chunkReloads += 1;
    try { sessionStorage.setItem('boss_chunk_reloads', String(chunkReloads)); } catch {}
    window.location.reload();
  }
}, true);

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
