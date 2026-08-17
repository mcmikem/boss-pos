import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
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
  }

  handleRetry = () => {
    // A failed lazy-chunk fetch (404 after a deploy re-hashed the file) can't
    // be fixed by re-rendering — the old chunk is gone. Reload so the newest
    // index.html + chunks load. Anything else just clears and re-tries.
    const msg = this.state.error?.message || '';
    if (
      msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('Importing a module script failed')
    ) {
      window.location.reload();
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
