import { useState, useEffect, useCallback } from 'react';
import { confirmDialog } from './Dialog';

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

export interface AdminMarketer {
  id: string;
  name: string;
  phone: string;
  code: string;
  commissionPct: number;
  active: boolean;
  createdAt: string;
  shops: number;
  earned: number;
  paid: number;
  balance: number;
}

export interface AdminReferral {
  id: string;
  tenant_id: string;
  shop_name: string;
  status: string;
  commission_due: number;
  created_at: string;
  marketer_name: string | null;
  marketer_code: string | null;
}

const ADMIN_API_BASE = '/api/admin';

const adminHeaders = (token: string) => ({ 'Content-Type': 'application/json', 'x-admin-token': token });

async function adminGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${ADMIN_API_BASE}${path}`, { headers: adminHeaders(token) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

async function adminSend(token: string, method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${ADMIN_API_BASE}${path}`, {
    method,
    headers: adminHeaders(token),
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || 'Failed');
  }
  return res.json().catch(() => ({}));
}

async function adminPost(token: string, path: string, body: unknown): Promise<void> {
  await adminSend(token, 'POST', path, body);
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
      <p className="text-[10px] text-zinc-500 font-bold uppercase">The marketer's commission is added automatically with each payment.</p>
      <div className="flex gap-2">
        <button disabled={busy || !parseFloat(amount)} onClick={() => run(() => payApi.mutate(shop.id, parseFloat(amount), method, reference || undefined), 'Payment recorded')}
          className="flex-1 h-10 bg-emerald-600/20 border border-emerald-600/40 text-emerald-300 rounded-xl text-[11px] font-black uppercase disabled:opacity-40 cursor-pointer">
          Record payment
        </button>
        {confirmCancel ? (
          <button disabled={busy} onClick={() => run(() => cancelApi.mutate(shop.id), 'Subscription cancelled')}
            className="flex-1 h-10 bg-rose-600 text-white rounded-xl text-[11px] font-black uppercase disabled:opacity-40 cursor-pointer">
            Yes, cancel it
          </button>
        ) : (
          <button onClick={() => setConfirmCancel(true)}
            className="flex-1 h-10 border border-zinc-800 text-zinc-500 rounded-xl text-[11px] font-black uppercase hover:text-rose-400 hover:border-rose-800/50 cursor-pointer">
            Cancel subscription
          </button>
        )}
      </div>
      {msg && <p className="text-[11px] font-bold text-zinc-300">{msg}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shop console: onboard + full settings editor + PIN + status + overview.
// Scope: each deployment is one isolated shop DB, so this console manages the
// shop behind THIS url. Open that shop's url + #admin with the admin token.
// ---------------------------------------------------------------------------

interface ShopOverview {
  day: string;
  salesToday: number;
  revenueToday: number;
  refundedToday: number;
  expensesToday: number;
  expensesTotalToday: number;
  products: number;
  lowStock: number;
  negativeStock: number;
  staff: number;
  lastBackupAt: string | null;
  recentActivity: { id: string; at: string; action: string; detail: string }[];
}

function fieldInput(name: string, value: unknown, onChange: (v: unknown) => void, onError: (m: string) => void) {
  if (typeof value === 'boolean') {
    return (
      <button onClick={() => onChange(!value)}
        className={`h-10 px-4 rounded-xl text-[11px] font-black uppercase border cursor-pointer ${value ? 'bg-gold-brand/15 border-gold-brand/50 text-gold-brand' : 'bg-[#0A0A0A] border-zinc-800 text-zinc-500'}`}>
        {value ? 'On' : 'Off'}
      </button>
    );
  }
  if (typeof value === 'number') {
    return (
      <input type="number" value={String(value)} onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="w-full h-10 bg-[#0A0A0A] border border-white/10 rounded-xl px-3 text-xs font-bold text-white outline-none focus:border-gold-brand tabular-nums" />
    );
  }
  if (Array.isArray(value)) {
    const asText = (value as unknown[]).map(v => String(v)).join(', ');
    return (
      <input type="text" defaultValue={asText} key={asText}
        onBlur={e => onChange(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
        placeholder="Comma-separated"
        className="w-full h-10 bg-[#0A0A0A] border border-white/10 rounded-xl px-3 text-xs font-bold text-white outline-none focus:border-gold-brand" />
    );
  }
  if (value !== null && typeof value === 'object') {
    return (
      <textarea defaultValue={JSON.stringify(value, null, 1)} key={JSON.stringify(value)} rows={4}
        onBlur={e => { try { onChange(JSON.parse(e.target.value)); } catch { onError(`"${name}" was NOT saved — check the JSON (a missing quote or bracket).`); } }}
        spellCheck={false}
        className="w-full bg-[#0A0A0A] border border-white/10 rounded-xl px-3 py-2 text-[11px] font-mono text-white outline-none focus:border-gold-brand" />
    );
  }
  return (
    <input type="text" value={value === null || value === undefined ? '' : String(value)} onChange={e => onChange(e.target.value)}
      className="w-full h-10 bg-[#0A0A0A] border border-white/10 rounded-xl px-3 text-xs font-bold text-white outline-none focus:border-gold-brand" />
  );
}

function ShopConsole({ token }: { token: string }) {
  const [overview, setOverview] = useState<ShopOverview | null>(null);
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [tenant, setTenant] = useState<AdminShop | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pin, setPin] = useState('');
  const [obName, setObName] = useState('');
  const [obPlan, setObPlan] = useState('basic');
  const [obPin, setObPin] = useState('');
  const [obPhone, setObPhone] = useState('');
  const [obRef, setObRef] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, s] = await Promise.all([
        adminGet<ShopOverview>(token, '/shop/overview'),
        adminGet<{ settings: Record<string, unknown>; tenant: AdminShop | null }>(token, '/shop/settings'),
      ]);
      setOverview(o);
      setSettings(s.settings);
      setDraft(s.settings);
      setTenant(s.tenant);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const changed: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(draft)) {
        if (JSON.stringify(v) !== JSON.stringify((settings || {})[k])) changed[k] = v;
      }
      if (Object.keys(changed).length === 0) { setMsg('No changes to save.'); return; }
      const r = await adminSend(token, 'PUT', '/shop/settings', changed);
      setMsg(`Saved: ${(r.updated || []).join(', ')}`);
      load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const onboard = async () => {
    if (!obName.trim()) { setMsg('Shop name is required.'); return; }
    setSaving(true);
    try {
      const r = await adminSend(token, 'POST', '/shop/onboard', {
        shopName: obName.trim(), plan: obPlan, pin: obPin || undefined, ownerPhone: obPhone || undefined,
        marketerCode: obRef.trim() || undefined,
      });
      setMsg(`Onboarded "${r.tenant?.name}" (${r.tenant?.id})${r.pinSet ? ' — PIN set' : ''}${r.referredBy ? ` — referred by ${r.referredBy}` : ''}`);
      setObName(''); setObPin(''); setObPhone(''); setObRef('');
      load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const resetPin = async (clear: boolean) => {
    if (!clear && !/^\d{4}$/.test(pin)) { setMsg('PIN must be exactly 4 digits.'); return; }
    if (!(await confirmDialog({ title: clear ? 'Clear PIN' : 'Set PIN', message: clear ? 'Clear the till PIN? The shop opens without a PIN.' : 'Set a new till PIN? All devices re-lock.', confirmLabel: clear ? 'Clear' : 'Set PIN', danger: clear }))) return;
    try {
      await adminSend(token, 'POST', '/shop/pin', { pin: clear ? '' : pin });
      setMsg(clear ? 'PIN cleared.' : 'PIN reset — devices re-locked.');
      setPin('');
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const setStatus = async (status: 'active' | 'suspended') => {
    if (!(await confirmDialog({ title: status === 'suspended' ? 'Suspend shop' : 'Reactivate shop', message: status === 'suspended' ? 'Suspend this shop?' : 'Reactivate this shop?', confirmLabel: status === 'suspended' ? 'Suspend' : 'Reactivate', danger: status === 'suspended' }))) return;
    try {
      await adminSend(token, 'POST', '/shop/status', { status });
      setMsg(`Shop ${status}.`);
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  if (loading) return <p className="text-zinc-500 text-xs font-bold uppercase p-2">Loading shop console…</p>;

  return (
    <div className="space-y-4">
      {tenant && (
        <div className="bg-[#141414] border border-white/5 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">This shop (this app link)</p>
              <p className="font-black text-white truncate">{tenant.name}</p>
              <p className="text-[10px] text-zinc-500 font-mono truncate">{tenant.id} • {tenant.plan} • {tenant.status}</p>
            </div>
            <button onClick={() => setStatus(tenant.status === 'active' ? 'suspended' : 'active')}
              className={`h-10 px-4 rounded-xl text-[11px] font-black uppercase shrink-0 cursor-pointer ${tenant.status === 'active' ? 'border border-zinc-800 text-zinc-400 hover:text-rose-400 hover:border-rose-800/50' : 'bg-emerald-600/20 border border-emerald-600/40 text-emerald-300'}`}>
              {tenant.status === 'active' ? 'Suspend' : 'Activate'}
            </button>
          </div>
          <p className="text-[10px] text-zinc-600 font-bold uppercase">
            {tenant.status === 'active'
              ? 'Suspending locks every till immediately — the shop cannot unlock until reactivated.'
              : 'This shop is suspended — tills cannot unlock. Activate to reopen.'}
          </p>
        </div>
      )}

      {overview && (
        <div className="grid grid-cols-3 gap-2">
          {[
            ['Sales today', `${overview.salesToday} • ${overview.revenueToday.toLocaleString()}`],
            ['Refunded', String(overview.refundedToday)],
            ['Expenses', `${overview.expensesToday} • ${overview.expensesTotalToday.toLocaleString()}`],
            ['Products', String(overview.products)],
            ['Low / negative stock', `${overview.lowStock} / ${overview.negativeStock}`],
            ['Staff', String(overview.staff)],
          ].map(([label, val]) => (
            <div key={label} className="bg-[#141414] border border-white/5 rounded-2xl p-3">
              <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">{label}</p>
              <p className="text-sm font-black text-white tabular-nums mt-0.5">{val}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-[#141414] border border-white/5 rounded-2xl p-4 space-y-3">
        <h3 className="text-xs font-black text-white uppercase tracking-widest">Onboard / register shop</h3>
        <div className="grid grid-cols-2 gap-2">
          <input value={obName} onChange={e => setObName(e.target.value)} placeholder="Shop name *"
            className="h-10 bg-[#0A0A0A] border border-white/10 rounded-xl px-3 text-xs font-bold text-white outline-none focus:border-gold-brand" />
          <select value={obPlan} onChange={e => setObPlan(e.target.value)}
            className="h-10 bg-[#0A0A0A] border border-white/10 rounded-xl px-2 text-xs font-bold text-white outline-none focus:border-gold-brand">
            {['basic', 'starter', 'growth', 'scale', 'pro', 'enterprise'].map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <input value={obPin} onChange={e => setObPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Till PIN (4 digits, optional)" inputMode="numeric"
            className="h-10 bg-[#0A0A0A] border border-white/10 rounded-xl px-3 text-xs font-bold text-white outline-none focus:border-gold-brand" />
          <input value={obPhone} onChange={e => setObPhone(e.target.value.replace(/\D/g, '').slice(0, 12))} placeholder="Owner phone (optional)" inputMode="tel"
            className="h-10 bg-[#0A0A0A] border border-white/10 rounded-xl px-3 text-xs font-bold text-white outline-none focus:border-gold-brand" />
          <input value={obRef} onChange={e => setObRef(e.target.value.toUpperCase())} placeholder="Marketer code (optional, e.g. BOSS-A1B2C3)"
            className="h-10 bg-[#0A0A0A] border border-white/10 rounded-xl px-3 text-xs font-bold text-white outline-none focus:border-gold-brand font-mono" />
        </div>
        <button disabled={saving} onClick={onboard}
          className="w-full h-10 bg-gold-brand text-black rounded-xl text-[11px] font-black uppercase disabled:opacity-40 cursor-pointer">
          Register shop
        </button>
      </div>

      <div className="bg-[#141414] border border-white/5 rounded-2xl p-4 space-y-3">
        <p className="text-[10px] text-amber-300/90 font-bold uppercase bg-amber-950/20 border border-amber-800/30 rounded-xl p-2.5 -mt-1">
          Advanced — changes go live on the till the moment you save.
        </p>
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black text-white uppercase tracking-widest">Shop settings</h3>
          <button disabled={saving} onClick={save}
            className="h-9 px-4 bg-gold-brand text-black rounded-xl text-[11px] font-black uppercase disabled:opacity-40 cursor-pointer">
            Save changes
          </button>
        </div>
        {!settings ? <p className="text-zinc-500 text-xs">Could not load settings.</p> : (
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {Object.entries(draft).map(([k, v]) => (
              <div key={k} className="bg-black/30 border border-white/5 rounded-xl p-2.5">
                <p className="text-[10px] font-black text-gold-brand uppercase tracking-wider mb-1.5 font-mono">{k}</p>
                {fieldInput(k, v, (nv) => setDraft(prev => ({ ...prev, [k]: nv })), (m) => setMsg(m))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-[#141414] border border-white/5 rounded-2xl p-4 space-y-2">
        <h3 className="text-xs font-black text-white uppercase tracking-widest">Till PIN</h3>
        <div className="flex gap-2">
          <input value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="New 4-digit PIN" inputMode="numeric"
            className="flex-1 h-10 bg-[#0A0A0A] border border-white/10 rounded-xl px-3 text-xs font-bold text-white outline-none focus:border-gold-brand" />
          <button onClick={() => resetPin(false)} className="h-10 px-4 bg-gold-brand text-black rounded-xl text-[11px] font-black uppercase cursor-pointer">Set</button>
          <button onClick={() => resetPin(true)} className="h-10 px-4 border border-rose-800/50 text-rose-400 rounded-xl text-[11px] font-black uppercase cursor-pointer">Clear</button>
        </div>
      </div>

      {msg && <p className="text-[11px] font-bold text-zinc-300 bg-black/30 border border-white/5 rounded-xl p-3">{msg}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Marketers: register, attribute shops, track commission, pay out.
// Commission rule: X% of every recorded shop payment auto-accrues to the
// referrer. Marketer portal link: <shop-url>#marketer-CODE (code is secret).
// ---------------------------------------------------------------------------

function Marketers({ token }: { token: string }) {
  const [list, setList] = useState<AdminMarketer[]>([]);
  const [referrals, setReferrals] = useState<AdminReferral[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pct, setPct] = useState('10');
  const [refShop, setRefShop] = useState('');
  const [refCode, setRefCode] = useState('');
  const [payoutFor, setPayoutFor] = useState<string | null>(null);
  const [payoutAmt, setPayoutAmt] = useState('');
  const [payoutMethod, setPayoutMethod] = useState('MTN MoMo');
  const [payoutRef, setPayoutRef] = useState('');
  const [editFor, setEditFor] = useState<string | null>(null);
  const [editPct, setEditPct] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, r] = await Promise.all([
        adminGet<{ marketers: AdminMarketer[] }>(token, '/marketers'),
        adminGet<{ referrals: AdminReferral[] }>(token, '/referrals'),
      ]);
      setList(m.marketers || []);
      setReferrals(r.referrals || []);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const portalLink = (code: string) => {
    try {
      const base = window.location.href.split('#')[0];
      return `${base}#marketer-${code}`;
    } catch { return `#marketer-${code}`; }
  };

  const copy = async (text: string, ok: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(ok);
    } catch { setMsg('Copy failed — long-press to copy manually.'); }
  };

  const register = async () => {
    if (!name.trim()) { setMsg('Marketer name is required.'); return; }
    try {
      const r = await adminSend(token, 'POST', '/marketers', { name: name.trim(), phone: phone.trim(), commissionPct: parseFloat(pct) || 10 });
      setMsg(`Registered ${r.marketer?.name} — code ${r.marketer?.code}. Share the portal link.`);
      setName(''); setPhone(''); setPct('10');
      load();
    } catch (e) { setMsg((e as Error).message); }
  };

  const attribute = async () => {
    if (!refCode.trim()) { setMsg('Marketer code is required.'); return; }
    try {
      await adminSend(token, 'POST', '/referrals', { shopName: refShop.trim(), marketerCode: refCode.trim() });
      setMsg(`Attributed "${refShop.trim() || 'this shop'}" to ${refCode.trim().toUpperCase()}.`);
      setRefShop(''); setRefCode('');
      load();
    } catch (e) { setMsg((e as Error).message); }
  };

  const payout = async (id: string) => {
    const amt = Math.round(parseFloat(payoutAmt) || 0);
    if (amt <= 0) { setMsg('Enter a payout amount.'); return; }
    try {
      await adminSend(token, 'POST', `/marketers/${id}/payout`, { amount: amt, method: payoutMethod, reference: payoutRef || undefined });
      setMsg(`Paid out ${amt.toLocaleString()} UGX.`);
      setPayoutFor(null); setPayoutAmt(''); setPayoutRef('');
      load();
    } catch (e) { setMsg((e as Error).message); }
  };

  const saveRate = async (id: string) => {
    try {
      await adminSend(token, 'PUT', `/marketers/${id}`, { commissionPct: parseFloat(editPct) || 0 });
      setMsg('Commission rate updated (applies to future payments).');
      setEditFor(null);
      load();
    } catch (e) { setMsg((e as Error).message); }
  };

  const toggleActive = async (m: AdminMarketer) => {
    if (m.active && !(await confirmDialog({ title: 'Deactivate marketer', message: `Deactivate ${m.name}? They stop accruing commission.`, confirmLabel: 'Deactivate', danger: true }))) return;
    try {
      await adminSend(token, 'PUT', `/marketers/${m.id}`, { active: !m.active });
      load();
    } catch (e) { setMsg((e as Error).message); }
  };

  if (loading) return <p className="text-zinc-500 text-xs font-bold uppercase p-2">Loading marketers…</p>;

  const totals = list.reduce((a, m) => ({ earned: a.earned + m.earned, paid: a.paid + m.paid, balance: a.balance + m.balance }), { earned: 0, paid: 0, balance: 0 });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {[['Earned', totals.earned], ['Paid out', totals.paid], ['To pay', totals.balance]].map(([label, val]) => (
          <div key={label} className="bg-[#141414] border border-white/5 rounded-2xl p-3">
            <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">{label}</p>
            <p className="text-sm font-black text-gold-brand tabular-nums mt-0.5">{(val as number).toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="bg-[#141414] border border-white/5 rounded-2xl p-4 space-y-2">
        <h3 className="text-xs font-black text-white uppercase tracking-widest">Register marketer</h3>
        <div className="grid grid-cols-2 gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name *"
            className="h-10 bg-[#0A0A0A] border border-white/10 rounded-xl px-3 text-xs font-bold text-white outline-none focus:border-gold-brand" />
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone (e.g. 0772…)"
            className="h-10 bg-[#0A0A0A] border border-white/10 rounded-xl px-3 text-xs font-bold text-white outline-none focus:border-gold-brand" />
        </div>
        <div className="flex gap-2">
          <div className="flex items-center gap-2 flex-1 h-10 bg-[#0A0A0A] border border-white/10 rounded-xl px-3">
            <span className="text-[10px] text-zinc-500 font-bold uppercase">Commission %</span>
            <input type="number" min="0" max="50" value={pct} onChange={e => setPct(e.target.value)}
              className="flex-1 bg-transparent text-xs font-bold text-white outline-none tabular-nums" />
          </div>
          <button onClick={register} className="h-10 px-5 bg-gold-brand text-black rounded-xl text-[11px] font-black uppercase cursor-pointer">Add</button>
        </div>
        <p className="text-[10px] text-zinc-600 font-bold uppercase">Rule: this % of every recorded shop payment goes to the marketer. Old payments don't change.</p>
      </div>

      <div className="space-y-2">
        {list.length === 0 && <p className="text-zinc-500 text-xs font-bold uppercase text-center py-4">No marketers yet.</p>}
        {list.map(m => (
          <div key={m.id} className={`bg-[#141414] border rounded-2xl p-4 space-y-2 ${m.active ? 'border-white/5' : 'border-zinc-800 opacity-60'}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-black text-white text-sm truncate">{m.name} {!m.active && <span className="text-[9px] text-zinc-500 uppercase">(off)</span>}</p>
                <p className="text-[10px] text-zinc-500 font-mono">{m.code} • {m.commissionPct}% • {m.phone || 'no phone'}</p>
              </div>
              <button onClick={() => toggleActive(m)} className="text-[10px] font-black uppercase text-zinc-500 hover:text-white cursor-pointer shrink-0">
                {m.active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[['Shops', m.shops], ['Earned', m.earned], ['Paid', m.paid], ['To pay', m.balance]].map(([l, v]) => (
                <div key={l} className="bg-black/30 rounded-xl p-2">
                  <p className="text-[8px] text-zinc-500 font-bold uppercase">{l}</p>
                  <p className="text-xs font-black text-white tabular-nums">{Number(v).toLocaleString()}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => copy(portalLink(m.code), `Portal link for ${m.name} copied — send it to them.`)}
                className="h-9 px-3 bg-gold-brand/10 border border-gold-brand/40 text-gold-brand rounded-xl text-[10px] font-black uppercase cursor-pointer">
                Copy portal link
              </button>
              <button onClick={() => copy(m.code, `Code ${m.code} copied.`)}
                className="h-9 px-3 border border-zinc-800 text-zinc-400 rounded-xl text-[10px] font-black uppercase cursor-pointer">
                Copy code
              </button>
              {editFor === m.id ? (
                <span className="flex items-center gap-1.5">
                  <input type="number" min="0" max="50" value={editPct} onChange={e => setEditPct(e.target.value)} placeholder="New %"
                    className="w-20 h-9 bg-[#0A0A0A] border border-gold-brand/50 rounded-xl px-2 text-xs font-bold text-white outline-none tabular-nums" />
                  <button onClick={() => saveRate(m.id)} className="h-9 px-3 bg-gold-brand text-black rounded-xl text-[10px] font-black uppercase cursor-pointer">Save</button>
                </span>
              ) : (
                <button onClick={() => { setEditFor(m.id); setEditPct(String(m.commissionPct)); }}
                  className="h-9 px-3 border border-zinc-800 text-zinc-400 rounded-xl text-[10px] font-black uppercase cursor-pointer">
                  Edit rate
                </button>
              )}
              <button onClick={() => { setPayoutFor(payoutFor === m.id ? null : m.id); setPayoutAmt(m.balance > 0 ? String(m.balance) : ''); }}
                disabled={m.balance <= 0}
                className="h-9 px-3 bg-emerald-600/20 border border-emerald-600/40 text-emerald-300 rounded-xl text-[10px] font-black uppercase disabled:opacity-40 cursor-pointer">
                Pay out
              </button>
            </div>
            {payoutFor === m.id && (
              <div className="grid grid-cols-3 gap-2 bg-black/30 border border-emerald-800/30 rounded-xl p-2.5">
                <input type="number" min="1" value={payoutAmt} onChange={e => setPayoutAmt(e.target.value)} placeholder="Amount"
                  className="h-9 bg-[#0A0A0A] border border-white/10 rounded-lg px-2 text-xs font-bold text-white outline-none tabular-nums" />
                <input value={payoutMethod} onChange={e => setPayoutMethod(e.target.value)} placeholder="Method"
                  className="h-9 bg-[#0A0A0A] border border-white/10 rounded-lg px-2 text-xs font-bold text-white outline-none" />
                <button onClick={() => payout(m.id)} className="h-9 bg-emerald-600 text-white rounded-lg text-[10px] font-black uppercase cursor-pointer">Confirm</button>
                <input value={payoutRef} onChange={e => setPayoutRef(e.target.value)} placeholder="Reference (optional)"
                  className="col-span-3 h-9 bg-[#0A0A0A] border border-white/10 rounded-lg px-2 text-xs font-bold text-white outline-none" />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="bg-[#141414] border border-white/5 rounded-2xl p-4 space-y-2">
          <h3 className="text-xs font-black text-white uppercase tracking-widest">Link a shop to a marketer ({referrals.length})</h3>
        <div className="flex gap-2">
          <input value={refShop} onChange={e => setRefShop(e.target.value)} placeholder="Shop name"
            className="flex-1 h-10 bg-[#0A0A0A] border border-white/10 rounded-xl px-3 text-xs font-bold text-white outline-none focus:border-gold-brand" />
          <input value={refCode} onChange={e => setRefCode(e.target.value.toUpperCase())} placeholder="BOSS-XXXX"
            className="w-32 h-10 bg-[#0A0A0A] border border-white/10 rounded-xl px-3 text-xs font-bold text-white outline-none focus:border-gold-brand font-mono" />
          <button onClick={attribute} className="h-10 px-4 bg-gold-brand text-black rounded-xl text-[11px] font-black uppercase cursor-pointer">Link</button>
        </div>
        {referrals.length > 0 && (
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {referrals.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-2 bg-black/30 border border-white/5 rounded-xl px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-black text-white truncate">{r.shop_name || r.tenant_id}</p>
                  <p className="text-[9px] text-zinc-500 font-bold uppercase">{r.marketer_name || '?'} • {r.marketer_code || ''} • {r.status}</p>
                </div>
                <span className="text-xs font-black text-gold-brand tabular-nums shrink-0">{Number(r.commission_due || 0).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {msg && <p className="text-[11px] font-bold text-zinc-300 bg-black/30 border border-white/5 rounded-xl p-3">{msg}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public marketer portal: <shop-url>#marketer-BOSS-XXXX. Code is the secret.
// ---------------------------------------------------------------------------

function MarketerPortal({ code }: { code: string }) {
  const [data, setData] = useState<null | {
    name: string; code: string; commissionPct: number; active: boolean;
    shops: { shopName: string; status: string; earned: number; since: string }[];
    earned: number; paid: number; balance: number;
    payouts: { amount: number; method: string; reference: string; at: string }[];
  }>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/m/${encodeURIComponent(code)}`)
      .then(res => {
        if (!res.ok) throw new Error('Unknown marketer code — check the link.');
        return res.json();
      })
      .then(setData)
      .catch(e => setError(e.message));
  }, [code]);

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-zinc-100 pb-16">
      <nav className="border-b border-white/10 bg-[#141414]/80">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <p className="text-gold-brand text-[10px] font-black uppercase tracking-widest">BOSS POS • Marketer</p>
            <h1 className="text-base font-black tracking-wider uppercase">{data ? `${data.name}'s earnings` : 'Earnings'}</h1>
          </div>
          <button onClick={() => { try { window.location.hash = ''; window.location.reload(); } catch {} }}
            className="h-8 px-3 bg-white/5 rounded-xl text-[10px] font-black uppercase text-zinc-400 hover:text-white cursor-pointer">← Back to shop</button>
        </div>
      </nav>
      <main className="max-w-3xl mx-auto px-4 pt-4 space-y-4">
        {error && <p className="text-rose-400 font-bold text-sm bg-rose-950/20 border border-rose-800/40 rounded-2xl p-4">{error}</p>}
        {!data && !error && <p className="text-zinc-500 text-xs font-bold uppercase">Loading…</p>}
        {data && (
          <>
            {!data.active && <p className="text-amber-300 text-xs font-bold uppercase bg-amber-950/30 border border-amber-800/40 rounded-2xl p-3">Account paused — contact support.</p>}
            <div className="grid grid-cols-3 gap-2">
              {[['Earned', data.earned, 'text-gold-brand'], ['Paid', data.paid, 'text-emerald-400'], ['Balance', data.balance, 'text-white']].map(([l, v, tone]) => (
                <div key={l} className="bg-[#141414] border border-white/5 rounded-2xl p-4">
                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{l}</p>
                  <p className={`text-xl font-black tabular-nums mt-0.5 ${tone}`}>{(v as number).toLocaleString()} <span className="text-[10px] text-zinc-500">UGX</span></p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-zinc-500 font-bold uppercase">Rate: {data.commissionPct}% of every recorded shop payment • Code {data.code}</p>
            <div className="bg-[#141414] border border-white/5 rounded-2xl p-4">
              <h2 className="text-xs font-black text-white uppercase tracking-widest mb-3">Shops you brought ({data.shops.length})</h2>
              {data.shops.length === 0 ? <p className="text-zinc-500 text-xs">No shops linked yet — share your code with shop owners.</p> : (
                <div className="space-y-1.5">
                  {data.shops.map((s, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 bg-black/30 border border-white/5 rounded-xl px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-xs font-black text-white truncate">{s.shopName || 'Shop'}</p>
                        <p className="text-[9px] text-zinc-500 font-bold uppercase">{s.status}</p>
                      </div>
                      <span className="text-xs font-black text-gold-brand tabular-nums shrink-0">+{s.earned.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {data.payouts.length > 0 && (
              <div className="bg-[#141414] border border-white/5 rounded-2xl p-4">
                <h2 className="text-xs font-black text-white uppercase tracking-widest mb-3">Payouts</h2>
                <div className="space-y-1.5">
                  {data.payouts.map((p, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 bg-black/30 border border-white/5 rounded-xl px-3 py-2">
                      <p className="text-xs font-bold text-emerald-300">{p.method}{p.reference ? ` • ${p.reference}` : ''}</p>
                      <span className="text-xs font-black text-white tabular-nums">{p.amount.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <a href={`https://wa.me/256727790003?text=${encodeURIComponent(`Hello BOSS POS, I am marketer ${data.code} (${data.name}) — I need help.`)}`}
              target="_blank" rel="noopener noreferrer"
              className="block text-center h-11 leading-[44px] bg-emerald-600/20 border border-emerald-600/40 text-emerald-300 rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-emerald-600/30 transition-colors">
              Questions? WhatsApp 0727790003
            </a>
          </>
        )}
      </main>
    </div>
  );
}

export const AdminDashboard: React.FC = () => {
  const hash = typeof window !== 'undefined' ? window.location.hash : '';
  const portalMatch = hash.match(/^#marketer-([A-Za-z0-9-]+)/i);
  if (portalMatch) return <MarketerPortal code={portalMatch[1].toUpperCase()} />;

  const isLocalDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const [token, setToken] = useState(() => {
    try { return localStorage.getItem('boss_admin_token') || (isLocalDevelopment ? 'local-dev-admin' : ''); }
    catch { return isLocalDevelopment ? 'local-dev-admin' : ''; }
  });
  const [draftToken, setDraftToken] = useState(token);
  const [openShop, setOpenShop] = useState<string | null>(null);
  const [tab, setTab] = useState<'shops' | 'console' | 'marketers'>('shops');
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
      <nav className="border-b border-white/10 bg-[#141414]/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-base font-black tracking-wider uppercase">BOSS POS <span className="text-gold-brand">Admin</span></h1>
          <div className="flex items-center gap-2">
            <span className="text-zinc-500 text-xs font-bold uppercase">Super Admin</span>
            <button onClick={() => { try { window.location.hash = ''; window.location.reload(); } catch {} }}
              className="h-8 px-3 bg-white/5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer text-[10px] font-black uppercase text-zinc-300" title="Back to the shop">← Back to shop</button>
            <button onClick={reload} className="p-2 bg-white/5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer" title="Refresh" aria-label="Refresh dashboard">↻</button>
            <button onClick={() => { try { localStorage.removeItem('boss_admin_token'); } catch {} setToken(''); }}
              className="p-2 text-xs font-black uppercase text-zinc-500 hover:text-rose-400 cursor-pointer">Sign out</button>
          </div>
        </div>
        <div className="max-w-3xl mx-auto px-4 pb-3 flex gap-2">
          {(['shops', 'console', 'marketers'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 h-10 rounded-xl text-[11px] font-black uppercase tracking-wider cursor-pointer border transition-all ${tab === t ? 'bg-gold-brand text-black border-gold-brand' : 'bg-white/5 text-zinc-400 border-white/5 hover:text-white'}`}>
              {t === 'shops' ? 'Shops' : t === 'console' ? 'Shop console' : 'Marketers'}
            </button>
          ))}
        </div>
      </nav>

      <main>
        <div className="max-w-3xl mx-auto px-4 pt-4 space-y-4">
          {tab === 'shops' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-[#141414] border border-white/5 rounded-2xl p-4">
                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Shops</p>
                  <p className="text-2xl font-black text-white font-display">{stats.totalShops} <span className="text-sm text-emerald-400">({stats.activeShops} live)</span></p>
                </div>
                <div className="bg-[#141414] border border-white/5 rounded-2xl p-4">
                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Payments received (UGX)</p>
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
              <p className="text-center text-[10px] text-zinc-600 font-bold uppercase pb-4">Each shop has its own app link — open that shop's link + #admin for its console.</p>
            </>
          )}

          {tab === 'console' && (
            <>
              <p className="text-[11px] text-zinc-500 font-bold uppercase bg-black/30 border border-white/5 rounded-xl p-3">
                This console manages this shop — register it, edit any setting, reset its PIN, suspend it.
              </p>
              <ShopConsole token={token} />
            </>
          )}

          {tab === 'marketers' && <Marketers token={token} />}
        </div>
      </main>
    </div>
  );
};
