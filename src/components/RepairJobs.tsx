import { useState, useMemo, useEffect } from 'react';
import { Wrench, Plus, X, Search, ChevronRight, RotateCcw } from 'lucide-react';
import type { RepairJob } from '../types';
import { repairJobApi } from '../api';
import { todayLocalKey } from '../utils/dates';

const STATUS_CFG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  received:    { label: 'Received',    color: 'text-amber-400',   bg: 'bg-amber-950/30',   dot: 'bg-amber-400' },
  in_progress: { label: 'In Progress', color: 'text-blue-400',    bg: 'bg-blue-950/30',    dot: 'bg-blue-400' },
  ready:       { label: 'Ready',       color: 'text-emerald-400', bg: 'bg-emerald-950/30', dot: 'bg-emerald-400' },
  collected:   { label: 'Collected',   color: 'text-zinc-500',    bg: 'bg-zinc-900/50',    dot: 'bg-zinc-500' },
};

const STATUS_ORDER = ['received', 'in_progress', 'ready', 'collected'];

interface RepairJobsProps {
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

// Workshop / electronics intake: item in, fault, price, deposit, and a
// received → in progress → ready → collected flow. The till still rings the
// collection payment as a normal sale.
export default function RepairJobs({ triggerToast }: RepairJobsProps) {
  const [jobs, setJobs] = useState<RepairJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('open');
  const [search, setSearch] = useState('');
  const [showPanel, setShowPanel] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const [f, setF] = useState({
    customerName: '', customerPhone: '', itemLabel: '', issue: '',
    price: '', deposit: '', partsCost: '', expectedDate: '', notes: '',
  });

  const today = todayLocalKey();

  useEffect(() => {
    repairJobApi.list()
      .then(setJobs)
      .catch(() => triggerToast('Failed to load repair jobs', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return jobs.filter(j => {
      if (filter === 'open' && j.status === 'collected') return false;
      if (filter !== 'all' && filter !== 'open' && j.status !== filter) return false;
      if (!q) return true;
      return j.customerName.toLowerCase().includes(q) ||
             j.customerPhone.includes(q) ||
             j.itemLabel.toLowerCase().includes(q) ||
             j.issue.toLowerCase().includes(q);
    });
  }, [jobs, filter, search]);

  const openCount = jobs.filter(j => j.status !== 'collected').length;
  const readyCount = jobs.filter(j => j.status === 'ready').length;

  function resetForm() {
    setF({ customerName: '', customerPhone: '', itemLabel: '', issue: '', price: '', deposit: '', partsCost: '', expectedDate: today, notes: '' });
  }

  function openCreate() {
    setEditId(null);
    resetForm();
    setShowPanel(true);
  }

  function openEdit(j: RepairJob) {
    setEditId(j.id);
    setF({
      customerName: j.customerName, customerPhone: j.customerPhone,
      itemLabel: j.itemLabel, issue: j.issue,
      price: String(j.price), deposit: String(j.deposit), partsCost: String(j.partsCost),
      expectedDate: j.expectedDate, notes: j.notes,
    });
    setShowPanel(true);
  }

  async function handleSave() {
    if (!f.customerName.trim()) { triggerToast('Enter customer name', 'error'); return; }
    if (!f.itemLabel.trim()) { triggerToast('Enter the item (e.g. Tecno Spark, drill)', 'error'); return; }
    const price = parseFloat(f.price) || 0;

    const now = new Date().toISOString();
    const existing = editId ? jobs.find(j => j.id === editId) : null;
    const job: RepairJob = {
      id: editId || `rj-${Date.now()}`,
      customerName: f.customerName.trim(),
      customerPhone: f.customerPhone.trim(),
      itemLabel: f.itemLabel.trim(),
      issue: f.issue.trim(),
      price,
      deposit: Math.min(parseFloat(f.deposit) || 0, price),
      partsCost: parseFloat(f.partsCost) || 0,
      status: existing?.status || 'received',
      expectedDate: f.expectedDate || today,
      completedDate: existing?.completedDate,
      notes: f.notes.trim(),
      createdAt: existing?.createdAt || now,
      clientWriteId: existing?.clientWriteId || `rj-${Date.now()}`,
    };

    try {
      if (editId) {
        const updated = await repairJobApi.update(job);
        setJobs(prev => prev.map(j => j.id === editId ? updated : j));
        triggerToast('Job updated', 'success');
      } else {
        const created = await repairJobApi.create(job);
        setJobs(prev => [created, ...prev]);
        triggerToast('Job booked in', 'success');
      }
      setShowPanel(false);
    } catch { triggerToast('Failed to save job', 'error'); }
  }

  async function advance(j: RepairJob) {
    const idx = STATUS_ORDER.indexOf(j.status);
    if (idx === -1 || idx === STATUS_ORDER.length - 1) return;
    const next = STATUS_ORDER[idx + 1] as RepairJob['status'];
    try {
      const result = await repairJobApi.update({
        ...j, status: next,
        completedDate: next === 'ready' ? new Date().toISOString() : j.completedDate,
      });
      setJobs(prev => prev.map(x => x.id === j.id ? result : x));
      triggerToast(`${j.itemLabel} → ${STATUS_CFG[next]?.label}`, 'success');
    } catch { triggerToast('Failed to update job', 'error'); }
  }

  async function handleDelete(id: string) {
    try {
      await repairJobApi.remove(id);
      setJobs(prev => prev.filter(j => j.id !== id));
      setConfirmDelete(null);
      triggerToast('Job deleted', 'info');
    } catch { triggerToast('Failed to delete job', 'error'); }
  }

  const inputCls = 'w-full bg-[#0A0A0A] border border-white/5 text-sm px-3 rounded-xl text-white font-bold focus:border-gold-brand outline-none h-11';

  if (loading) return <div className="py-10 text-center text-xs text-zinc-500 font-bold uppercase">Loading repair jobs…</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex-1 grid grid-cols-2 gap-2">
          <div className="boss-card px-3 py-2 text-center">
            <p className="text-lg font-black text-gold-brand tabular-nums">{openCount}</p>
            <p className="text-[9px] text-zinc-500 font-bold uppercase">Open</p>
          </div>
          <div className="boss-card px-3 py-2 text-center">
            <p className="text-lg font-black text-emerald-400 tabular-nums">{readyCount}</p>
            <p className="text-[9px] text-zinc-500 font-bold uppercase">Ready</p>
          </div>
        </div>
        <button onClick={openCreate}
          className="h-11 px-4 bg-gold-brand text-black rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 cursor-pointer touch-target">
          <Plus className="w-4 h-4" /> Intake
        </button>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer, item, fault"
          className="w-full bg-[#0A0A0A] border border-white/5 text-sm pl-9 pr-3 rounded-xl text-white font-bold focus:border-gold-brand outline-none h-11" />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {['open', 'all', 'received', 'in_progress', 'ready', 'collected'].map(k => (
          <button key={k} onClick={() => setFilter(k)}
            className={`px-4 h-9 rounded-full text-[11px] font-black uppercase tracking-wider shrink-0 cursor-pointer ${filter === k ? 'bg-gold-brand text-black' : 'bg-[#141414] text-zinc-400 border border-white/5'}`}>
            {k.replace('_', ' ')}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-xs text-zinc-600 font-bold uppercase py-8">No jobs here yet</p>
      )}

      {filtered.map(j => {
        const cfg = STATUS_CFG[j.status] || STATUS_CFG.received;
        const balance = Math.max(0, j.price - j.deposit);
        return (
          <div key={j.id} className="boss-card p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-black text-white truncate">{j.itemLabel}</p>
                <p className="text-[11px] text-zinc-500 font-bold truncate">{j.customerName}{j.customerPhone ? ` · ${j.customerPhone}` : ''}</p>
              </div>
              <span className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${cfg.bg} ${cfg.color}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />{cfg.label}
              </span>
            </div>
            {j.issue && <p className="text-xs text-zinc-400 mt-2">Fault: {j.issue}</p>}
            <p className="text-xs font-bold mt-1 tabular-nums">
              <span className="text-gold-brand">{j.price.toLocaleString()}</span>
              {j.partsCost > 0 && <span className="text-zinc-500"> · parts {j.partsCost.toLocaleString()}</span>}
              {j.deposit > 0 && <span className="text-emerald-400"> · paid {j.deposit.toLocaleString()}</span>}
              {balance > 0 && <span className="text-rose-400"> · owes {balance.toLocaleString()}</span>}
            </p>
            {j.expectedDate && <p className="text-[11px] text-zinc-500 font-bold mt-1 tabular-nums">Due {j.expectedDate}</p>}
            {j.notes && <p className="text-[11px] text-zinc-500 mt-1">{j.notes}</p>}
            <div className="flex gap-2 mt-3">
              {j.status !== 'collected' ? (
                <button onClick={() => advance(j)}
                  className="flex-1 h-9 bg-emerald-950/40 border border-emerald-800/50 text-emerald-300 rounded-xl text-[11px] font-black uppercase flex items-center justify-center gap-1 cursor-pointer">
                  {STATUS_CFG[STATUS_ORDER[STATUS_ORDER.indexOf(j.status) + 1]]?.label} <ChevronRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button onClick={async () => {
                  try {
                    const result = await repairJobApi.update({ ...j, status: 'received' });
                    setJobs(prev => prev.map(x => x.id === j.id ? result : x));
                  } catch { triggerToast('Failed to reopen job', 'error'); }
                }}
                  className="flex-1 h-9 bg-[#0A0A0A] border border-white/5 text-zinc-400 rounded-xl text-[11px] font-black uppercase flex items-center justify-center gap-1 cursor-pointer">
                  <RotateCcw className="w-3.5 h-3.5" /> Reopen
                </button>
              )}
              <button onClick={() => openEdit(j)}
                className="h-9 px-4 bg-[#0A0A0A] border border-white/5 text-zinc-300 rounded-xl text-[11px] font-black uppercase cursor-pointer">
                Edit
              </button>
              {confirmDelete === j.id ? (
                <button onClick={() => handleDelete(j.id)}
                  className="h-9 px-4 bg-rose-600 text-white rounded-xl text-[11px] font-black uppercase cursor-pointer">
                  Sure?
                </button>
              ) : (
                <button onClick={() => setConfirmDelete(j.id)}
                  className="h-9 px-3 text-zinc-600 hover:text-rose-400 cursor-pointer" aria-label="Delete job">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        );
      })}

      {showPanel && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-[#141414] border border-white/10 rounded-3xl w-full max-w-md p-6 max-h-[92vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4">
              <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                <Wrench className="w-4 h-4 text-gold-brand" /> {editId ? 'Edit job' : 'New intake'}
              </h3>
              <button onClick={() => setShowPanel(false)} className="p-1 text-zinc-500 hover:text-white cursor-pointer" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <input value={f.customerName} onChange={(e) => setF(p => ({ ...p, customerName: e.target.value }))} placeholder="Customer name" className={inputCls} />
              <input value={f.customerPhone} onChange={(e) => setF(p => ({ ...p, customerPhone: e.target.value }))} placeholder="Phone (optional)" inputMode="tel" className={inputCls} />
              <input value={f.itemLabel} onChange={(e) => setF(p => ({ ...p, itemLabel: e.target.value }))} placeholder="Item (e.g. Tecno Spark 10, drill)" className={inputCls} />
              <input value={f.issue} onChange={(e) => setF(p => ({ ...p, issue: e.target.value }))} placeholder="Fault (e.g. cracked screen, no power)" className={inputCls} />
              <div className="grid grid-cols-3 gap-2">
                <input type="number" min="0" value={f.price} onChange={(e) => setF(p => ({ ...p, price: e.target.value }))} placeholder="Price" className={inputCls} />
                <input type="number" min="0" value={f.deposit} onChange={(e) => setF(p => ({ ...p, deposit: e.target.value }))} placeholder="Deposit" className={inputCls} />
                <input type="number" min="0" value={f.partsCost} onChange={(e) => setF(p => ({ ...p, partsCost: e.target.value }))} placeholder="Parts" className={inputCls} />
              </div>
              <input type="date" value={f.expectedDate} onChange={(e) => setF(p => ({ ...p, expectedDate: e.target.value }))} className={inputCls} />
              <input value={f.notes} onChange={(e) => setF(p => ({ ...p, notes: e.target.value }))} placeholder="Notes (optional)" className={inputCls} />
              <button onClick={handleSave} className="w-full h-12 bg-gold-brand text-black font-black uppercase tracking-widest text-xs rounded-xl cursor-pointer">
                {editId ? 'Save changes' : 'Book in'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
