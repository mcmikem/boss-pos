// Area workspace configs: what each business area shows on its TODAY
// surface. Same shape for tailor, printer, bench and diary — the till learns
// a new trade by adding one config here, never a new screen.
import { Scissors, Palette, Wrench, CalendarCheck } from 'lucide-react';
import type { AreaHomeConfig } from './AreaHome';
import type { TailoringOrder, DesignOrder, RepairJob, Booking } from '../types';
import { tailoringOrderApi, designOrderApi, repairJobApi, bookingApi } from '../api';
import { todayLocalKey } from '../utils/dates';
import { tailorBalanceDue } from '../utils/tailoring';

const num = (n: number) => Math.max(0, Math.round(n || 0));

export const tailorHomeConfig: AreaHomeConfig<TailoringOrder> = {
  workspace: 'Tailoring today',
  title: 'Today — Tailoring',
  subtitle: 'Orders • balances due • ready',
  icon: Scissors,
  iconWrap: 'bg-amber-950/40 border-amber-800/40',
  iconColor: 'text-amber-400',
  fetchList: () => tailoringOrderApi.list(),
  stats: (orders, fmt) => {
    const open = orders.filter(o => o.status === 'pending' || o.status === 'in_progress');
    const ready = orders.filter(o => o.status === 'completed');
    const due = ready.filter(o => tailorBalanceDue(o) > 0).length;
    return [
      { label: 'Being sewn', value: open.length > 0 ? String(open.length) : '—', tone: 'white' },
      { label: 'Ready to collect', value: ready.length > 0 ? String(ready.length) : '—', tone: 'emerald' },
      {
        label: 'Balances still due', value: fmt(open.reduce((s, o) => s + tailorBalanceDue(o), 0)),
        tone: 'gold', wide: true, sub: due > 0 ? `${due} ready to collect` : undefined,
      },
    ];
  },
  rows: (orders, fmt) => {
    const ready = orders.filter(o => o.status === 'completed');
    return ready.slice(0, 4).map(o => ({
      key: o.id,
      title: `${o.customerName} — ${o.workDescription || o.workType}`,
      amount: fmt(tailorBalanceDue(o)),
    }));
  },
  listEmpty: 'No orders on the books',
  primaryLabel: 'New order',
};

export const printHomeConfig: AreaHomeConfig<DesignOrder> = {
  workspace: 'Printing today',
  title: 'Today — Printing',
  subtitle: 'Jobs • balances due • ready',
  icon: Palette,
  iconWrap: 'bg-cyan-950/40 border-cyan-800/40',
  iconColor: 'text-cyan-400',
  fetchList: () => designOrderApi.list(),
  stats: (jobs, fmt) => {
    const active = jobs.filter(o => o.status === 'pending' || o.status === 'in_progress' || o.status === 'review');
    const ready = jobs.filter(o => o.status === 'completed');
    const dueN = active.filter(o => (o.expectedDate || '').slice(0, 10) <= todayLocalKey()).length;
    return [
      { label: 'In progress', value: active.length > 0 ? String(active.length) : '—', tone: 'white', sub: dueN > 0 ? `${dueN} due` : undefined },
      { label: 'Ready to collect', value: ready.length > 0 ? String(ready.length) : '—', tone: 'emerald' },
      {
        label: 'Balances still due',
        value: fmt(active.reduce((s, o) => s + num((o.totalAmount || 0) - (o.depositPaid || 0)), 0)),
        tone: 'gold', wide: true,
      },
    ];
  },
  rows: (jobs, fmt) => {
    const today = todayLocalKey();
    const active = jobs
      .filter(o => o.status === 'pending' || o.status === 'in_progress' || o.status === 'review')
      .sort((a, b) => (a.expectedDate || '').localeCompare(b.expectedDate || ''));
    const ready = jobs.filter(o => o.status === 'completed');
    const urgent = active.filter(o => (o.expectedDate || '').slice(0, 10) <= today);
    const rest = active.filter(o => (o.expectedDate || '').slice(0, 10) > today);
    return [
      ...urgent.map(o => ({
        key: o.id,
        title: `${o.customerName} — ${o.designBrief || o.orderType}`,
        meta: (o.expectedDate || '').slice(0, 10) < today ? `overdue ${o.expectedDate.slice(0, 10)}` : 'due today',
        hot: true,
        amount: fmt(num((o.totalAmount || 0) - (o.depositPaid || 0))),
      })),
      ...rest.slice(0, Math.max(0, 2 - urgent.length)).map(o => ({
        key: o.id,
        title: `${o.customerName} — ${o.designBrief || o.orderType}`,
        meta: `due ${o.expectedDate.slice(0, 10)}`,
        amount: fmt(num((o.totalAmount || 0) - (o.depositPaid || 0))),
      })),
      ...ready.slice(0, 2).map(o => ({
        key: o.id,
        title: `${o.customerName} — ${o.designBrief || o.orderType}`,
        meta: 'ready — collect',
        amount: fmt(num((o.totalAmount || 0) - (o.depositPaid || 0))),
      })),
    ].slice(0, 4);
  },
  listEmpty: 'No jobs on the board',
  primaryLabel: 'New job',
};

export const repairHomeConfig: AreaHomeConfig<RepairJob> = {
  workspace: 'Repairs today',
  title: 'Today — Repairs',
  subtitle: 'Bench • ready • balances due',
  icon: Wrench,
  iconWrap: 'bg-orange-950/40 border-orange-800/40',
  iconColor: 'text-orange-400',
  fetchList: () => repairJobApi.list(),
  stats: (jobs, fmt) => {
    const inShop = jobs.filter(r => r.status === 'received' || r.status === 'in_progress');
    const ready = jobs.filter(r => r.status === 'ready');
    const parts = jobs.filter(r => r.status !== 'collected').reduce((s, r) => s + num(r.partsCost || 0), 0);
    return [
      { label: 'On the bench', value: inShop.length > 0 ? String(inShop.length) : '—', tone: 'white' },
      { label: 'Ready to collect', value: ready.length > 0 ? String(ready.length) : '—', tone: 'emerald' },
      {
        label: 'Balances still due',
        value: fmt(jobs.filter(r => r.status !== 'collected').reduce((s, r) => s + num((r.price || 0) - (r.deposit || 0)), 0)),
        tone: 'gold', wide: true, sub: parts > 0 ? `parts tied up ${fmt(parts)}` : undefined,
      },
    ];
  },
  rows: (jobs, fmt) => {
    const ready = jobs.filter(r => r.status === 'ready');
    const inShop = jobs.filter(r => r.status === 'received' || r.status === 'in_progress');
    return [
      ...ready.slice(0, 2).map(r => ({
        key: r.id,
        title: `${r.customerName} — ${r.itemLabel}`,
        meta: 'ready — collect',
        amount: fmt(num((r.price || 0) - (r.deposit || 0))),
      })),
      ...inShop.slice(0, 2).map(r => ({
        key: r.id,
        title: `${r.customerName} — ${r.itemLabel}`,
        meta: r.status === 'received' ? 'diagnose next' : 'on the bench',
        amount: fmt(num((r.price || 0) - (r.deposit || 0))),
      })),
    ].slice(0, 4);
  },
  listEmpty: 'Bench is clear',
  primaryLabel: 'New intake',
  bookLabel: 'Open book',
};

export const bookingHomeConfig: AreaHomeConfig<Booking> = {
  workspace: 'Bookings today',
  title: 'Today — Bookings',
  subtitle: 'Chairs • done • new booking',
  icon: CalendarCheck,
  iconWrap: 'bg-emerald-950/40 border-emerald-800/40',
  iconColor: 'text-emerald-400',
  fetchList: () => bookingApi.list(),
  stats: (bookings) => {
    const today = todayLocalKey();
    const chairs = bookings.filter(b => b.date === today && b.status === 'booked');
    const done = bookings.filter(b => b.date === today && b.status === 'done').length;
    return [
      { label: 'Chairs today', value: chairs.length > 0 ? String(chairs.length) : '—', tone: 'white' },
      { label: 'Done', value: done > 0 ? String(done) : '—', tone: 'cyan' },
    ];
  },
  rows: (bookings) => {
    const today = todayLocalKey();
    return bookings
      .filter(b => b.date === today && b.status === 'booked')
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
      .slice(0, 6)
      .map(b => ({ key: b.id, title: `${b.customerName} — ${b.service}`, meta: b.time || '' }));
  },
  listEmpty: 'No chairs booked today',
  primaryLabel: 'New booking',
};
