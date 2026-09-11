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

async function adminPost(token: string, path: string, body: unknown): Promise<void> {
  const res = await fetch(`${ADMIN_API_BASE}${path}`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || 'Failed');
  }
}

export const useAdminShops = (token: string) => {
  const [shops, setShops] = useState<AdminShop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    fetch(`${ADMIN_API_BASE}/shops`, {
      method: 'GET',
      headers: adminHeaders(token),
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed');
        return res.json();
      })
      .then((data) => { setShops(data.shops || []); setError(null); })
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
    if (!token) { setLoading(false); return; }
    setLoading(true);
    fetch(`${ADMIN_API_BASE}/stats`, {
      method: 'GET',
      headers: adminHeaders(token),
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed');
        return res.json();
      })
      .then((data) => { setStats(data.stats || stats); setError(null); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [token]);

  return { stats, loading, error, reload: load };
};

function useAdminMutation(token: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutate = async (path: string, body: unknown) => {
    setLoading(true);
    setError(null);
    try {
      await adminPost(token, path, body);
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally {
      setLoading(false);
    }
  };
  return { mutate, loading, error };
}

export const useUpdateShopPlan = (token: string) => {
  const { mutate, loading, error } = useAdminMutation(token);
  return {
    mutate: (tenantId: string, plan: string) => mutate(`/shop/${tenantId}/plan`, { plan }),
    loading,
    error,
  };
};

export const useCancelShopSubscription = (token: string) => {
  const { mutate, loading, error } = useAdminMutation(token);
  return {
    mutate: (tenantId: string) => mutate(`/shop/${tenantId}/cancel`, {}),
    loading,
    error,
  };
};

export const useManualPayment = (token: string) => {
  const { mutate, loading, error } = useAdminMutation(token);
  return {
    mutate: (tenantId: string, amount: number, method: string, reference?: string) =>
      mutate(`/shop/${tenantId}/payment`, { amount, method, reference }),
    loading,
    error,
  };
};

function ShopActions({ shop, token, onDone }: { shop: AdminShop; token: string; onDone: () => void }) {
  const [plan, setPlan] = useState(shop.plan);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Cash');
  const [reference, setReference] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const planApi = useUpdateShopPlan(token);
  const payApi = useManualPayment(token);
  const cancelApi = useCancelShopSubscription(token);
  const busy = planApi.loading || payApi.loading || cancelApi.loading;

  const run = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn();
      setMsg(ok);
      onDone();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="mt-3 space-y-3 bg-black/30 border border-white/5 rounded-xl p-3">
      <div className="flex items-center gap-2">
        <select value={plan} onChange={e => setPlan(e.target.value)}
          className="flex-1 h-10 bg-[#0A0A0A] border border-white/10 rounded-xl px-2 text-xs font-bold text-white outline-none focus:border-gold-brand">
          <option value="starter">Starter</option>
          <option value="growth">Growth</option>
          <option value="scale">Scale</option>
        </select>
        <button disabled={busy} onClick={() => run(() => planApi.mutate(shop.id, plan), `Plan → ${plan}`)}
          className="h-10 px-4 bg-gold-brand text-black rounded-xl text-[11px] font-black uppercase disabled:opacity-40 cursor-pointer">
          Set plan
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <input type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount"
          className="h-10 bg-[#0A0A0A] border border-white/10 rounded-xl px-2 text-xs font-bold text-white outline-none focus:border-gold-brand tabular-nums" />
        <input type="text" value={method} onChange={e => setMethod(e.target.value)} placeholder="Method"
          className="h-10 bg-[#0A0A0A] border border-white/10 rounded-xl px-2 text-xs font-bold text-white outline-none focus:border-gold-brand" />
        <input type="text" value={reference} onChange={e => setReference(e.target.value)} placeholder="Ref (optional)"
          className="h-10 bg-[#0A0A0A] border border-white/10 rounded-xl px-2 text-xs font-bold text-white outline-none focus:border-gold-brand" />
      </div>
      <div className="flex gap-2">
        <button disabled={busy || !parseFloat(amount)} onClick={() => run(() => payApi.mutate(shop.id, parseFloat(amount), method, reference || undefined), 'Payment recorded')}
          className="flex-1 h-10 bg-emerald-600/20 border border-emerald-600/40 text-emerald-300 rounded-xl text-[11px] font-black uppercase disabled:opacity-40 cursor-pointer">
          Record payment
        </button>
        {confirmCancel ? (
          <button disabled={busy} onClick={() => run(() => cancelApi.mutate(shop.id), 'Subscription cancelled')}
            className="flex-1 h-10 bg-rose-600 text-white rounded-xl text-[11px] font-black uppercase disabled:opacity-40 cursor-pointer">
            Sure? Cancel it
          </button>
        ) : (
          <button onClick={() => setConfirmCancel(true)}
            className="flex-1 h-10 border border-zinc-800 text-zinc-500 rounded-xl text-[11px] font-black uppercase hover:text-rose-400 hover:border-rose-800/50 cursor-pointer">
            Cancel sub
          </button>
        )}
      </div>
      {msg && <p className="text-[11px] font-bold text-zinc-300">{msg}</p>}
    </div>
  );
}

export const AdminDashboard: React.FC = () => {
  const isLocalDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const [token, setToken] = useState(() => {
    try { return localStorage.getItem('boss_admin_token') || (isLocalDevelopment ? 'local-dev-admin' : ''); }
    catch { return isLocalDevelopment ? 'local-dev-admin' : ''; }
  });
  const [draftToken, setDraftToken] = useState(token);
  const [openShop, setOpenShop] = useState<string | null>(null);
  const { shops, loading: shopsLoading, error: shopsError, reload: reloadShops } = useAdminShops(token);
  const { stats, loading: statsLoading, error: statsError, reload: reloadStats } = useAdminStats(token);
  const reload = () => { reloadShops(); reloadStats(); };

  const saveToken = (event: React.FormEvent) => {
    event.preventDefault();
    try { localStorage.setItem('boss_admin_token', draftToken.trim()); } catch {}
    setToken(draftToken.trim());
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-6">
        <form onSubmit={saveToken} className="w-full max-w-md bg-[#141414] border border-white/10 rounded-2xl p-6">
          <p className="text-gold-brand text-xs font-black uppercase tracking-widest">BOSS POS</p>
          <h1 className="text-2xl font-black text-white mt-2 mb-2">Super Admin access</h1>
          <p className="text-zinc-400 text-sm mb-5">{isLocalDevelopment ? 'Local development access is available on this machine.' : 'Enter the server-configured admin token to manage shops and subscriptions.'}</p>
          <input type="password" value={draftToken} onChange={(e) => setDraftToken(e.target.value)} autoFocus className="w-full h-12 rounded-xl bg-black/40 border border-white/10 px-3 text-white outline-none focus:border-gold-brand" placeholder="Admin token" />
          {(shopsError || statsError) && <p className="text-rose-400 text-sm mt-3">{shopsError || statsError}</p>}
          <button className="w-full h-12 rounded-xl bg-gold-brand text-black font-black mt-5 cursor-pointer">Sign in</button>
        </form>
      </div>
    );
  }

  if (shopsLoading || statsLoading) {
    return <div className="min-h-screen bg-[#0A0A0A] text-zinc-400 p-8">Loading admin dashboard...</div>;
  }

  if (shopsError || statsError) {
    try { localStorage.removeItem('boss_admin_token'); } catch {}
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-[#141414] border border-white/10 rounded-2xl p-6 text-center">
          <p className="text-rose-400 font-bold mb-4">{shopsError || statsError || 'Access denied'}</p>
          <button onClick={() => setToken('')} className="h-11 px-6 bg-gold-brand text-black font-black uppercase text-xs rounded-xl cursor-pointer">Try another token</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-zinc-100 pb-16">
      <nav className="border-b border-white/10 bg-[#141414]/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-base font-black tracking-wider uppercase">BOSS POS <span className="text-gold-brand">Admin</span></h1>
          <div className="flex items-center gap-2">
            <span className="text-zinc-500 text-xs font-bold uppercase">Super Admin</span>
            <button onClick={reload} className="p-2 bg-white/5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer" title="Refresh" aria-label="Refresh dashboard">↻</button>
            <button onClick={() => { try { localStorage.removeItem('boss_admin_token'); } catch {} setToken(''); }}
              className="p-2 text-xs font-black uppercase text-zinc-500 hover:text-rose-400 cursor-pointer">Out</button>
          </div>
        </div>
      </nav>

      <main>
        <div className="max-w-3xl mx-auto px-4 pt-4 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-[#141414] border border-white/5 rounded-2xl p-4">
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Shops</p>
              <p className="text-2xl font-black text-white font-display">{stats.totalShops} <span className="text-sm text-emerald-400">({stats.activeShops} live)</span></p>
            </div>
            <div className="bg-[#141414] border border-white/5 rounded-2xl p-4">
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Recorded UGX</p>
              <p className="text-2xl font-black text-gold-brand font-display tabular-nums">{stats.totalRevenue.toLocaleString()}</p>
            </div>
          </div>

          <div className="bg-[#141414] border border-white/5 rounded-2xl p-4">
            <h2 className="text-xs font-black text-white uppercase tracking-widest mb-3">Shops ({shops.length})</h2>
            {shops.length === 0 ? <p className="text-zinc-500 text-xs font-bold uppercase">No shops found</p> : (
              <div className="space-y-2">
                {shops.map(shop => (
                  <div key={shop.id} className="bg-black/30 border border-white/5 rounded-xl p-3">
                    <button onClick={() => setOpenShop(openShop === shop.id ? null : shop.id)}
                      className="w-full flex items-center justify-between gap-2 cursor-pointer">
                      <span className="font-bold text-sm text-white truncate">{shop.name}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-zinc-500 font-bold uppercase">{shop.plan}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-black uppercase ${shop.status === 'active' ? 'bg-emerald-950/50 text-emerald-300' : 'bg-amber-950/50 text-amber-300'}`}>{shop.status}</span>
                      </span>
                    </button>
                    {openShop === shop.id && <ShopActions shop={shop} token={token} onDone={reload} />}
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="text-center text-[10px] text-zinc-600 font-bold uppercase pb-4">New shops: provision-shop.mjs • Backups: pull-backups.mjs</p>
        </div>
      </main>
    </div>
  );
};
