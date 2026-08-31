import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import ErrorBoundary from './components/ErrorBoundary.tsx';

const root = createRoot(document.getElementById('root')!);

root.render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
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

// Service worker: auto-update to the latest version on deploy
// (reloads once when a new SW takes control, so stale lazy-loaded chunks never fail)
if ('serviceWorker' in navigator) {
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

  // Proactively ask the network for a newer build on boot and whenever the app
  // returns to the foreground, so phones on flaky Wi-Fi pick up deploys within
  // minutes instead of silently running an old service-worker cache for weeks.
  // A new SW -> controllerchange above -> one reload into the fresh build.
  const checkForUpdate = () => {
    navigator.serviceWorker.getRegistration().then(reg => {
      if (reg) reg.update().catch(() => {});
    }).catch(() => {});
  };
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  window.addEventListener('load', () => setTimeout(checkForUpdate, 2500));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') setTimeout(checkForUpdate, 800);
  });
}
