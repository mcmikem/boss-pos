import { useState, useEffect } from 'react';

export interface AdminShop {
  id: string;
  name: string;
  plan: string;
  status: string;
}

export interface AdminStats {
  totalShops: number;
  activeShops: number;
  totalRevenue: number;
  pendingPayments: number;
}

const ADMIN_API_BASE = '/api/admin';

const adminHeaders = (token: string) => ({ 'Content-Type': 'application/json', 'x-admin-token': token });

export const useAdminShops = (token: string) => {
  const [shops, setShops] = useState<AdminShop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch(`${ADMIN_API_BASE}/shops`, {
      method: 'GET',
      headers: adminHeaders(token),
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed');
        return res.json();
      })
      .then((data) => setShops(data.shops || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [token]);

  return { shops, loading, error, reload: load };
};

export const useAdminStats = (token: string) => {
  const [stats, setStats] = useState<AdminStats>({
    totalShops: 0, activeShops: 0, totalRevenue: 0, pendingPayments: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch(`${ADMIN_API_BASE}/stats`, {
      method: 'GET',
      headers: adminHeaders(token),
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed');
        return res.json();
      })
      .then((data) => setStats(data.stats || stats))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [token]);

  return { stats, loading, error, reload: load };
};

export const useUpdateShopPlan = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return {
    mutate: (tenantId: string, plan: string) => {
      setLoading(true);
      fetch(`${ADMIN_API_BASE}/shop/${tenantId}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      })
        .then((res) => {
          if (!res.ok) return res.json().then((e) => { throw new Error(e.error || 'Failed'); });
          return res.json();
        })
        .then(() => setLoading(false))
        .catch((err) => { setError(err.message); setLoading(false); });
    },
    loading,
    error,
  };
};

export const useCancelShopSubscription = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return {
    mutate: (tenantId: string) => {
      setLoading(true);
      fetch(`${ADMIN_API_BASE}/shop/${tenantId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
        .then((res) => {
          if (!res.ok) return res.json().then((e) => { throw new Error(e.error || 'Failed'); });
          return res.json();
        })
        .then(() => setLoading(false))
        .catch((err) => { setError(err.message); setLoading(false); });
    },
    loading,
    error,
  };
};

export const useManualPayment = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return {
    mutate: (tenantId: string, amount: number, method: string, reference?: string) => {
      setLoading(true);
      fetch(`${ADMIN_API_BASE}/shop/${tenantId}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, method, reference }),
      })
        .then((res) => {
          if (!res.ok) return res.json().then((e) => { throw new Error(e.error || 'Failed'); });
          return res.json();
        })
        .then(() => setLoading(false))
        .catch((err) => { setError(err.message); setLoading(false); });
    },
    loading,
    error,
  };
};

export const AdminDashboard: React.FC = () => {
  const isLocalDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const [token, setToken] = useState(() => localStorage.getItem('boss_admin_token') || (isLocalDevelopment ? 'local-dev-admin' : ''));
  const [draftToken, setDraftToken] = useState(token);
  const { shops, loading: shopsLoading, error: shopsError, reload: reloadShops } = useAdminShops(token);
  const { stats, loading: statsLoading, error: statsError, reload: reloadStats } = useAdminStats(token);
  const reload = () => { reloadShops(); reloadStats(); };

  const saveToken = (event: React.FormEvent) => {
    event.preventDefault();
    localStorage.setItem('boss_admin_token', draftToken.trim());
    setToken(draftToken.trim());
  };

  if (!token || (shopsError || statsError)?.includes('authentication')) {
    return (
      <div className="min-h-screen bg-primary flex items-center justify-center p-6">
        <form onSubmit={saveToken} className="w-full max-w-md bg-white/5 border border-white/10 rounded-2xl p-6">
          <p className="text-secondary text-xs font-bold uppercase tracking-widest">BOSS POS</p>
          <h1 className="text-2xl font-bold mt-2 mb-2">Super Admin access</h1>
          <p className="text-white/60 text-sm mb-5">{isLocalDevelopment ? 'Local development access is available on this machine.' : 'Enter the server-configured admin token to manage shops and subscriptions.'}</p>
          <input type="password" value={draftToken} onChange={(e) => setDraftToken(e.target.value)} autoFocus className="w-full h-12 rounded-xl bg-black/20 border border-white/10 px-3 text-white outline-none focus:border-secondary" placeholder="Admin token" />
          {(shopsError || statsError) && <p className="text-red-300 text-sm mt-3">{shopsError || statsError}</p>}
          <button className="w-full h-12 rounded-xl bg-secondary text-primary font-bold mt-5">Sign in</button>
        </form>
      </div>
    );
  }

  if (shopsLoading || statsLoading) {
    return <div className="min-h-screen bg-primary p-8">Loading admin dashboard...</div>;
  }

  if (shopsError || statsError) {
    return (
      <div className="bg-white/5 rounded-xl p-6">
        <p className="text-red-400">{shopsError || statsError}</p>
        <button className="mt-2 bg-secondary text-primary hover:bg-primary/90 transition-colors">Retry</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-primary">
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/10 bg-primary/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-wider">BOSS POS Admin</h1>
          <div className="flex items-center gap-4">
            <span className="text-white/70 text-sm">Super Admin</span>
            <button onClick={reload} className="p-2 bg-white/5 rounded-xl hover:bg-white/10 transition-colors" title="Refresh" aria-label="Refresh dashboard">
              ↻
            </button>
          </div>
        </div>
      </nav>

      <main className="pt-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="bg-white/5 rounded-xl p-6">
              <h3 className="font-bold text-lg mb-4">Overview</h3>
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-white/60 text-sm">Total Shops</p><p className="text-3xl font-bold">{stats.totalShops}</p></div>
                <div><p className="text-white/60 text-sm">Active Shops</p><p className="text-3xl font-bold">{stats.activeShops}</p></div>
                <div><p className="text-white/60 text-sm">Recorded Payments</p><p className="text-2xl font-bold">UGX {stats.totalRevenue.toLocaleString()}</p></div>
                <div><p className="text-white/60 text-sm">Pending Payments</p><p className="text-3xl font-bold text-yellow-400">{stats.pendingPayments}</p></div>
              </div>
            </div>
            <div className="bg-white/5 rounded-xl p-6">
              <h3 className="font-bold text-lg mb-4">Actions</h3>
              <p className="text-white/60 text-sm">Managed shop records</p><p className="text-2xl font-bold text-secondary">{shops.length}</p>
              <p className="text-white/60 text-sm mt-3">Subscription records needing attention</p><p className="text-2xl font-bold text-yellow-400">{stats.pendingPayments}</p>
            </div>
          </div>

          <div className="bg-white/5 rounded-xl p-6 mb-8">
            <h2 className="font-bold text-2xl mb-6">Shop Management</h2>
            {shops.length === 0 ? <p className="text-white/60 text-sm">No shops found</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-white/50 border-b border-white/10"><tr><th className="py-3 pr-4">Shop</th><th className="py-3 pr-4">Plan</th><th className="py-3">Status</th></tr></thead>
                  <tbody>{shops.map(shop => <tr key={shop.id} className="border-b border-white/5"><td className="py-4 pr-4 font-semibold">{shop.name}</td><td className="py-4 pr-4 capitalize text-white/70">{shop.plan}</td><td className="py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${shop.status === 'active' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-yellow-400/10 text-yellow-300'}`}>{shop.status}</span></td></tr>)}</tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="bg-white/5 border-t border-white/10 py-12">
        <div className="max-w-7xl mx-auto px-6">
          <p className="text-white/60 text-center text-sm">BOSS POS Admin Panel • 2026</p>
        </div>
      </footer>
    </div>
  );
};