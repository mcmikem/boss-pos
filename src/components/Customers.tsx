import { useState, useMemo, useEffect } from 'react';
import { Users, Plus, X, Star, Bell, BellOff, MessageCircle, Trash2, Check } from 'lucide-react';
import type { Sale, Product } from '../types';
import { loadCustomers, saveCustomers, statsFor, customerWhatsAppUrl, type CustomerProfile } from '../utils/customers';

interface CustomersProps {
  sales: Sale[];
  products: Product[];
  formatCurrency: (val: number) => string;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  onClose: () => void;
}

// Regulars directory: frequent buyers with contact, standing (VIP/wholesale),
// a standing till discount, and a new-arrival subscription. Stats (visits,
// spent) always come live from sales — the profile stores the rest.
export default function Customers({ sales, products, formatCurrency, triggerToast, onClose }: CustomersProps) {
  const [list, setList] = useState<CustomerProfile[]>(() => loadCustomers());
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<CustomerProfile | null>(null);
  const [isNew, setIsNew] = useState(false);

  useEffect(() => {
    const h = () => setList(loadCustomers());
    window.addEventListener('boss-pos-customers-updated', h);
    return () => window.removeEventListener('boss-pos-customers-updated', h);
  }, []);

  const persist = (next: CustomerProfile[]) => {
    setList(next);
    saveCustomers(next);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = list.map(c => ({ c, stats: statsFor(c.name, sales) }));
    const matching = q
      ? rows.filter(r => r.c.name.toLowerCase().includes(q) || (r.c.phone || '').includes(q))
      : rows;
    return matching.sort((a, b) => b.stats.totalSpent - a.stats.totalSpent);
  }, [list, sales, search]);

  const subscribed = useMemo(() => list.filter(c => c.subscribed && c.phone), [list]);
  const freshStock = useMemo(() => {
    return [...products]
      .filter(p => !p.isService)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .slice(0, 3);
  }, [products]);

  const announce = (c: CustomerProfile) => {
    if (!c.phone) { triggerToast('Add a phone number first', 'error'); return; }
    const items = freshStock.map(p => `${p.name} (${formatCurrency(p.price)})`).join(', ');
    const url = customerWhatsAppUrl(c.phone,
      `Hello ${c.name}! New in stock${items ? `: ${items}` : ''} — come check it out. Thank you for shopping with us!`);
    if (!url) { triggerToast('Phone number looks wrong — check it', 'error'); return; }
    const w = window.open(url, '_blank', 'noopener');
    if (w) triggerToast(`Announcing to ${c.name}`, 'success');
    else triggerToast('Could not open WhatsApp', 'error');
  };

  const removeProfile = (id: string) => {
    persist(list.filter(c => c.id !== id));
    setEditing(null);
    triggerToast('Profile removed — past sales keep the name', 'info');
  };

  return (
    <div className="fixed inset-0 bg-black/95 backdrop-blur-sm z-[80] flex flex-col">
      <div className="flex items-center gap-3 p-4 border-b border-white/5">
        <Users className="w-5 h-5 text-gold-brand shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-black text-white uppercase tracking-wider truncate">Regulars ({list.length})</h3>
          <p className="text-[10px] text-zinc-500 font-bold uppercase">{subscribed.length} subscribed to new-stock alerts</p>
        </div>
        <button onClick={() => { setEditing({ id: `c-${Date.now()}`, name: '', createdAt: new Date().toISOString() }); setIsNew(true); }}
          className="h-10 px-4 bg-gold-brand text-black font-black text-xs rounded-xl uppercase tracking-wider cursor-pointer shrink-0 flex items-center gap-1">
          <Plus className="w-4 h-4" /> Add
        </button>
        <button onClick={onClose}
          className="h-10 px-4 border border-zinc-700 text-zinc-300 font-bold text-xs rounded-xl uppercase tracking-wider cursor-pointer shrink-0">Close</button>
      </div>

      <div className="p-4 pb-2">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or phone…"
          className="w-full bg-zinc-900 border border-white/5 text-white h-11 px-4 rounded-xl text-sm outline-none focus:border-gold-brand" />
      </div>

      <div className="flex-1 overflow-y-auto p-4 pt-2 space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-10">
            <Star className="w-10 h-10 text-zinc-700 mx-auto mb-2" />
            <p className="text-xs text-zinc-500 font-bold uppercase">{search ? 'No regulars match' : 'No profiles yet'}</p>
            <p className="text-[11px] text-zinc-600 font-bold mt-1">Named buyers appear in Reports — add them here for VIP discounts + alerts.</p>
          </div>
        )}
        {filtered.map(({ c, stats }) => (
          <div key={c.id} className="bg-[#141414] border border-white/5 rounded-2xl p-3.5">
            <div className="flex items-center justify-between gap-2">
              <button onClick={() => { setEditing({ ...c }); setIsNew(false); }} className="min-w-0 flex-1 text-left cursor-pointer">
                <p className="text-sm font-black text-white truncate flex items-center gap-1.5">
                  {(c.tags || []).includes('VIP') && <Star className="w-3.5 h-3.5 text-gold-brand fill-gold-brand shrink-0" />}
                  {c.name}
                </p>
                <p className="text-[10px] text-zinc-500 font-bold uppercase mt-0.5 truncate tabular-nums">
                  {stats.visits} visit{stats.visits !== 1 ? 's' : ''} • {formatCurrency(stats.totalSpent)}
                  {stats.lastVisit ? ` • last ${new Date(stats.lastVisit).toLocaleDateString()}` : ' • never bought'}
                </p>
              </button>
              <div className="flex items-center gap-1.5 shrink-0">
                {(c.discountPct || 0) > 0 && (
                  <span className="text-[10px] font-black text-purple-300 bg-purple-950/40 border border-purple-800/40 rounded-lg px-2 py-1">−{c.discountPct}%</span>
                )}
                {c.subscribed ? (
                  <button onClick={() => announce(c)} title={`Tell ${c.name} about new stock`}
                    className="w-9 h-9 rounded-xl bg-emerald-950/40 border border-emerald-800/40 text-emerald-300 flex items-center justify-center cursor-pointer" aria-label={`Tell ${c.name} about new stock`}>
                    <MessageCircle className="w-4 h-4" />
                  </button>
                ) : (
                  <span title="Not subscribed" className="w-9 h-9 rounded-xl bg-zinc-900 border border-white/5 text-zinc-700 flex items-center justify-center">
                    <BellOff className="w-4 h-4" />
                  </span>
                )}
              </div>
            </div>
            {(c.phone || (c.tags || []).length > 0) && (
              <p className="text-[10px] text-zinc-600 font-bold uppercase mt-1 truncate">
                {[c.phone, (c.tags || []).join(' • ')].filter(Boolean).join('  ·  ')}
              </p>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[90] flex items-end justify-center" onClick={() => setEditing(null)}>
          <div className="bg-[#141414] w-full max-w-md rounded-t-3xl border border-white/10 p-5 max-h-[85vh] overflow-y-auto animate-slide-up"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-black text-white uppercase tracking-wider">{isNew ? 'New regular' : editing.name}</h4>
              <button onClick={() => setEditing(null)} className="p-1.5 text-zinc-500 hover:text-white cursor-pointer" aria-label="Close editor">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Name *</label>
                <input type="text" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="e.g. Nakato Sarah"
                  className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-gold-brand" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Phone</label>
                  <input type="tel" value={editing.phone || ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                    placeholder="0701…"
                    className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-gold-brand" />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Birthday (MM-DD)</label>
                  <input type="text" value={editing.birthday || ''} onChange={(e) => setEditing({ ...editing, birthday: e.target.value.replace(/[^0-9-]/g, '').slice(0, 5) })}
                    placeholder="05-14"
                    className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-gold-brand" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Tags (comma)</label>
                  <input type="text" value={(editing.tags || []).join(', ')} onChange={(e) => setEditing({ ...editing, tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 4) })}
                    placeholder="VIP, Wholesale"
                    className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-gold-brand" />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Till discount %</label>
                  <input type="number" min="0" max="50" value={editing.discountPct ?? ''} onChange={(e) => setEditing({ ...editing, discountPct: Math.min(50, Math.max(0, parseFloat(e.target.value) || 0)) || undefined })}
                    placeholder="e.g. 10"
                    className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-gold-brand" />
                </div>
              </div>
              <button onClick={() => setEditing({ ...editing, subscribed: !editing.subscribed })}
                className={`w-full h-11 rounded-xl border text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-all ${editing.subscribed ? 'bg-emerald-950/40 border-emerald-600/40 text-emerald-300' : 'bg-zinc-900 border-zinc-800 text-zinc-500'}`}>
                {editing.subscribed ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                {editing.subscribed ? 'Subscribed — new-stock alerts on' : 'Subscribe — new-stock alerts'}
              </button>
              <div>
                <label className="text-[10px] text-zinc-400 font-bold uppercase mb-1 block">Notes</label>
                <input type="text" value={editing.notes || ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                  placeholder="Sizes, preferences…"
                  className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl h-11 px-3 text-sm outline-none focus:border-gold-brand" />
              </div>
              <div className="flex gap-2">
                {!isNew && (
                  <button onClick={() => removeProfile(editing.id)}
                    className="h-11 px-4 bg-rose-950/30 border border-rose-800/40 text-rose-300 rounded-xl cursor-pointer" aria-label="Delete profile">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => {
                    const name = editing.name.trim();
                    if (!name) { triggerToast('Enter a name', 'error'); return; }
                    const dup = list.find(c => c.id !== editing.id && c.name.trim().toLowerCase() === name.toLowerCase());
                    if (dup) { triggerToast('That regular already exists', 'error'); return; }
                    persist(isNew ? [...list, { ...editing, name }] : list.map(c => c.id === editing.id ? { ...editing, name } : c));
                    triggerToast(isNew ? `${name} joined the regulars` : 'Profile saved', 'success');
                    setEditing(null);
                  }}
                  className="flex-1 h-11 bg-gold-brand text-black font-black uppercase tracking-widest text-xs rounded-xl cursor-pointer flex items-center justify-center gap-1.5">
                  <Check className="w-4 h-4" /> Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
