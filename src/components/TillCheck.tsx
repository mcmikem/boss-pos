import { lastServerError } from '../api';
import { readLastCrash } from './ErrorBoundary';
import { useState } from 'react';
import { CheckCircle2, XCircle, Loader2, Wrench } from 'lucide-react';
import { supportApi } from '../api';
import { outboxCountsAsync } from '../api';

/**
 * "Check this till."
 *
 * Every round of this has started the same way: something went wrong, and the
 * report was a description of what a phone showed. That is expensive for both of
 * us — a description cannot be looked up, but a timestamp can.
 *
 * So this runs a handful of READ-ONLY checks and says green or red. It writes
 * nothing, changes nothing, and cannot refuse: it is the opposite of the write
 * paths that have been failing. If it is green and the till still misbehaves,
 * the problem is on the screen and worth describing; if it is red, the reason is
 * on the screen already.
 */
interface Check { label: string; ok: boolean | null; detail?: string }

export default function TillCheck({ onClose, creditEats = [], creditPayments = [] }: {
  onClose: () => void;
  creditEats?: Array<{ id: string; customerName: string; total: number; paidAmount: number; paid?: boolean }>;
  creditPayments?: Array<{ saleId: string; amount: number }>;
}) {
  const [running, setRunning] = useState(false);
  const [checks, setChecks] = useState<Check[]>([]);
  const [ranAt, setRanAt] = useState<string>('');

  const run = async () => {
    setRunning(true);
    setChecks([]);
    const out: Check[] = [];
    const when = new Date().toISOString();

    // 1. Can this phone reach the server at all?
    try {
      const ready = await supportApi.ready();
      const db = ready.report?.database;
      out.push({
        label: 'Reaches the server',
        ok: ready.ok,
        detail: ready.ok
          ? `yes · build ${ready.report?.build || 'unknown'}`
          : db?.error
            ? `database: ${String(db.error).slice(0, 50)}`
            : 'no answer — see Settings → Support',
      });
    } catch (e) {
      out.push({ label: 'Reaches the server', ok: false, detail: (e as Error)?.message?.slice(0, 60) || 'no answer' });
    }

    // 2. Is anything still waiting to go up? This is the number that says a
    //    sale is safe on the phone but not yet on the books.
    try {
      const counts = await outboxCountsAsync();
      out.push({
        label: 'Everything saved to the server',
        ok: (counts.pending || 0) === 0,
        detail: counts.pending ? `${counts.pending} waiting — they will go up on their own` : 'yes, all up',
      });
    } catch (e) {
      out.push({ label: 'Everything saved to the server', ok: null, detail: 'could not be read' });
    }

    // 3. Money taken against the credit book that the server has no record of.
    //    A collection used to be swallowed as a "duplicate" and still answered
    //    200, so the book said paid and nothing was recorded. This names the
    //    gap in shillings instead of leaving her to describe a symptom.
    try {
      const serverBook = new Map<string, number>();
      for (const p of creditPayments) {
        if (typeof p?.saleId === 'string' && p.saleId.startsWith('book:')) {
          serverBook.set(p.saleId, (serverBook.get(p.saleId) || 0) + (Number(p.amount) || 0));
        }
      }
      const gaps = (creditEats || [])
        .map(c => ({ c, missing: (Number(c.paidAmount) || 0) - (serverBook.get(`book:${c.id}`) || 0) }))
        .filter(x => x.missing > 0.5);
      out.push({
        label: 'Credit book collections recorded',
        ok: gaps.length === 0,
        detail: gaps.length === 0
          ? 'every payment taken is on the server'
          : gaps.slice(0, 4).map(x => `${x.c.customerName || 'unnamed'} ${Math.round(x.missing).toLocaleString()}`).join(' · ')
            + (gaps.length > 4 ? ` · +${gaps.length - 4} more` : ''),
      });
    } catch (e) {
      out.push({ label: 'Credit book collections recorded', ok: null, detail: 'could not be read' });
    }

    // 4. The last time the server failed on THIS phone. Every 5xx is our bug,
    //    so it is recorded with the reference that identifies it -- she reads
    //    one line instead of describing a symptom.
    {
      const last = lastServerError();
      out.push({
        label: 'Last server failure on this phone',
        ok: last ? null : true,
        detail: last
          ? `${last.message} · ${last.path} · ref ${last.traceId || last.code || 'none'} · ${last.at.slice(0, 16).replace('T', ' ')}`
          : 'none — the server has not failed on this phone',
      });
    }

    // 5. Did the app itself fall over on this phone? A crash is written where
    //    it survives a restart, because on a phone nobody can watch, "it just
    //    doesn't work" is the only symptom there is.
    {
      const crash = readLastCrash();
      out.push({
        label: 'This phone has crashed',
        ok: crash ? null : true,
        detail: crash
          ? `${crash.msg} · ${crash.where || 'no stack'} · build ${crash.build} · ${crash.at.slice(0, 16).replace('T', ' ')}`
          : 'no — nothing has fallen over on this phone',
      });
    }

    // 6. The build, so a report can name it.
    {
      const serverBuild = (checks.find(c => c.label === 'Reaches the server')?.detail || '').match(/build ([0-9a-f]{7,})/)?.[1] || '';
      const here = (typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__ : '').slice(0, 7);
      const same = !serverBuild || !here || serverBuild === here || serverBuild === 'unknown';
      out.push({
        label: 'This phone is running the latest build',
        ok: same,
        detail: same
          ? `yes · ${here || 'dev'} · checked ${when.slice(11, 16)}`
          : `this phone is on ${here || 'dev'} but the server is on ${serverBuild} — reload to update`,
      });
    }

    setChecks(out);
    setRanAt(when);
    setRunning(false);
  };

  const bad = checks.filter(c => c.ok === false).length;
  const unknown = checks.filter(c => c.ok === null).length;

  return (
    <div className="fixed inset-0 z-[95] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-[#141414] border border-white/10 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md p-5 pb-8 sm:pb-5 space-y-3 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center gap-2.5">
          <Wrench className="w-4 h-4 text-gold-brand" />
          <h3 className="text-sm font-black text-white uppercase tracking-widest">Check this till</h3>
        </div>
        <p className="text-[11px] text-zinc-400 font-medium leading-snug">
          Looks at the connection and anything still waiting to save. Changes nothing.
        </p>

        <button onClick={run} disabled={running}
          className="w-full min-h-[48px] rounded-xl bg-gold-brand text-black font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer">
          {running ? <><Loader2 className="w-4 h-4 animate-spin" /> Checking…</> : 'Run the check'}
        </button>

        {checks.length > 0 && (
          <ul className="space-y-1.5">
            {checks.map(c => (
              <li key={c.label} className="flex items-start gap-2 bg-[#0A0A0A] border border-white/5 rounded-xl px-3 py-2.5">
                {c.ok === null
                  ? <span className="w-4 h-4 rounded-full border border-zinc-600 shrink-0 mt-0.5" />
                  : c.ok
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    : <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />}
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-zinc-200">{c.label}</span>
                  {c.detail && <span className="block text-[10px] text-zinc-500 font-medium leading-snug mt-0.5">{c.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}

        {ranAt && (
          <p className={`text-[10px] font-bold uppercase tracking-widest ${bad ? 'text-rose-400' : 'text-emerald-400'}`}>
            {bad > 0
              ? `${bad} thing${bad === 1 ? '' : 's'} need attention`
              : unknown > 0
                ? 'Could not check everything'
                : 'All clear — nothing to fix here'}
          </p>
        )}

        <button onClick={onClose}
          className="w-full min-h-[44px] rounded-xl border border-white/10 text-zinc-300 text-xs font-black uppercase tracking-widest cursor-pointer">
          Close
        </button>
      </div>
    </div>
  );
}
