import { Component, type ReactNode, type ErrorInfo } from 'react';
import { chunkRetried, markChunkRetried, clearChunkRetried, isChunkError } from '../utils/lazyRetry';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

// Crash streak in this session: repeated crashes close together mean the
// shell itself is stale (mixed old/new chunks after a deploy), not a
// render flake — only a fresh load past the service worker fixes that.
function crashStreak(): number {
  try {
    const raw = JSON.parse(sessionStorage.getItem('boss_pos_crash_streak') || 'null');
    if (raw && Date.now() - raw.at < 120000) return raw.n + 1;
  } catch {}
  return 1;
}

function noteCrash(): void {
  try {
    const n = crashStreak();
    sessionStorage.setItem('boss_pos_crash_streak', JSON.stringify({ n, at: Date.now() }));
  } catch {}
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
    noteCrash();
  }

  handleRetry = () => {
    // A failed lazy-chunk fetch (404 after a deploy re-hashed the file, or a
    // stuck service worker serving a stale shell) can't be fixed by
    // re-rendering. Neither can a repeated crash: two failures close together
    // mean mixed old/new chunks, so go straight past re-render to a clean load.
    const msg = this.state.error?.message || '';
    let streak = 1;
    try {
      const raw = JSON.parse(sessionStorage.getItem('boss_pos_crash_streak') || 'null');
      if (raw && Date.now() - raw.at < 120000) streak = raw.n;
    } catch {}
    const hardReload = async () => {
      try { sessionStorage.removeItem('boss_pos_crash_streak'); } catch {}
      try {
        if ('serviceWorker' in navigator) {
          const rs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(rs.map((r) => r.unregister()));
        }
      } catch {}
      window.location.reload();
    };
    if (isChunkError(msg) || streak >= 2) {
      if (!chunkRetried()) {
        markChunkRetried();
        window.location.reload();
        return;
      }
      clearChunkRetried();
      hardReload();
      return;
    }
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex items-center justify-center min-h-[200px] p-8">
          <div className="text-center">
            <div className="w-14 h-14 rounded-full bg-rose-950/30 border border-rose-500/30 flex items-center justify-center mx-auto mb-3">
              <span className="text-2xl text-rose-400 font-black">!</span>
            </div>
            <p className="text-sm font-black text-rose-400 uppercase tracking-widest mb-1">Something went wrong</p>
            <p className="text-xs text-zinc-500 mb-4">{this.state.error?.message || 'An unexpected error occurred'}</p>
            <button
              onClick={this.handleRetry}
              className="px-5 h-10 bg-gold-brand text-black font-black uppercase tracking-widest text-xs rounded-xl"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
