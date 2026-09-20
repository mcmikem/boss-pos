import { lazy, type ComponentType } from 'react';

// Chunk-failure recovery for code-split screens. Deploys re-hash filenames
// and delete the old ones, so a phone holding a stale app shell (classic:
// old Android with a stuck service worker) 404s its lazy chunks and would
// otherwise sit on a dead "Something went wrong" screen forever.
// First failure in a session: reload once — the fresh index.html usually
// fixes it. Success clears the flag. A second failure throws through to the
// ErrorBoundary, whose retry then takes the nuclear path (drop the SW).
export const CHUNK_RETRY_KEY = 'boss_pos_chunk_retry';

export function chunkRetried(): boolean {
  try {
    return sessionStorage.getItem(CHUNK_RETRY_KEY) === '1';
  } catch {
    return false;
  }
}

export function markChunkRetried(): void {
  try {
    sessionStorage.setItem(CHUNK_RETRY_KEY, '1');
  } catch {}
}

export function clearChunkRetried(): void {
  try {
    sessionStorage.removeItem(CHUNK_RETRY_KEY);
  } catch {}
}

export function lazyRetry<T extends ComponentType<any>>(importer: () => Promise<{ default: T }>) {
  return lazy(() =>
    importer().then(
      (m) => {
        clearChunkRetried();
        return m;
      },
      (err) => {
        if (!chunkRetried()) {
          markChunkRetried();
          window.location.reload();
          return new Promise<{ default: T }>(() => {});
        }
        throw err;
      },
    ),
  );
}

// Old browsers (SystemJS-era Android WebViews) don't use Chrome's module
// error wording, so match on the asset URL + failure language instead.
export function isChunkError(message: string): boolean {
  if (!message || !message.includes('.js')) return false;
  return /failed to fetch|importing a module|loading chunk|unable to load|failed to load|failed to fetch dynamically imported module/i.test(
    message,
  );
}
