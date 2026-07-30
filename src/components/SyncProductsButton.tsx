import { useState } from 'react';
import { RefreshCw } from 'lucide-react';

interface SyncProductsButtonProps {
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  onSynced: () => void;
}

export default function SyncProductsButton({ triggerToast, onSynced }: SyncProductsButtonProps) {
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/sync-products', { method: 'POST' });
      if (!res.ok) throw new Error('Sync failed');
      const data = await res.json();
      triggerToast(`Updated ${data.updated} products`, 'success');
      onSynced();
    } catch {
      triggerToast('Failed to sync product catalog', 'error');
    }
    setSyncing(false);
  };

  return (
    <div className="border-t border-white/5 pt-3 space-y-2">
      <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Product Catalog</label>
      <button onClick={handleSync} disabled={syncing}
        className="w-full h-10 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-bold uppercase tracking-wider hover:border-gold-brand/40 transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50">
        <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
        {syncing ? 'Syncing...' : 'Sync Product Catalog'}
      </button>
    </div>
  );
}