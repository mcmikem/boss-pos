import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Bell, CheckCheck, Trash2, X } from 'lucide-react';
import {
  listNotices, unreadCount, markNoticeRead, markAllRead, deleteNotice, clearRead,
  type AppNotice, type NoticeTab,
} from '../utils/notifications';
import { useDialogFocus } from './Sheet';

const KIND_DOT: Record<string, string> = {
  'low-stock': 'bg-amber-400',
  'negative-stock': 'bg-rose-500',
  expiry: 'bg-orange-400',
  unaccounted: 'bg-rose-500',
  'no-production': 'bg-amber-400',
  momo: 'bg-emerald-400',
  shrinkage: 'bg-amber-400',
  sync: 'bg-cyan-400',
  info: 'bg-zinc-500',
};

export default function NotificationsBell({ onNavigate }: { onNavigate?: (tab: NoticeTab) => void }) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [notices, setNotices] = useState<AppNotice[]>(() => {
    try { return listNotices(); } catch { return []; }
  });
  const [unread, setUnread] = useState(() => {
    try { return unreadCount(); } catch { return 0; }
  });
  useDialogFocus(open, panelRef, () => setOpen(false));

  const refresh = () => {
    try {
      setNotices(listNotices());
      setUnread(unreadCount());
    } catch {}
  };

  useEffect(() => {
    refresh();
    const handleUpdate = () => refresh();
    window.addEventListener('boss-pos-notices-updated', handleUpdate);
    const interval = setInterval(refresh, 30000);
    return () => {
      window.removeEventListener('boss-pos-notices-updated', handleUpdate);
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { if (!open) refresh(); setOpen(!open); }}
        className="relative p-2 bg-[#0A0A0A] border border-white/5 hover:border-gold-brand/40 text-zinc-400 hover:text-gold-brand rounded-xl transition-all cursor-pointer"
        title={unread > 0 ? `${unread} unread notifications` : 'Notifications'}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="notifications-popover"
      >
        <Bell className="w-4 h-4" aria-hidden="true" />
        {unread > 0 && (
          <span aria-hidden="true" className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white text-[9px] font-black min-w-4 h-4 px-1 rounded-full flex items-center justify-center border border-[#0F0F0F]">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[120]"
          onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}
        >
          <div
            ref={panelRef}
            id="notifications-popover"
            role="dialog"
            aria-modal="false"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="absolute right-2 top-16 w-[min(92vw,380px)] max-h-[70vh] flex flex-col bg-[#141414] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <p id={titleId} className="text-xs font-black text-white uppercase tracking-widest">
                Notifications {unread > 0 && <span className="text-rose-400">({unread})</span>}
              </p>
              <div className="flex items-center gap-1">
                {unread > 0 && (
                  <button
                    type="button"
                    onClick={() => { markAllRead(); refresh(); }}
                    className="p-1.5 text-zinc-500 hover:text-emerald-400 rounded-lg hover:bg-white/5 cursor-pointer"
                    title="Mark all read"
                    aria-label="Mark all notifications as read"
                  >
                    <CheckCheck className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
                {notices.some(n => n.read) && (
                  <button
                    type="button"
                    onClick={() => { clearRead(); refresh(); }}
                    className="px-2 h-7 text-[10px] font-black uppercase tracking-wider text-zinc-500 hover:text-rose-400 rounded-lg hover:bg-white/5 cursor-pointer"
                    title="Remove all read notifications"
                    aria-label="Remove all read notifications"
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close notifications"
                  data-dialog-initial-focus
                  className="p-1.5 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 cursor-pointer"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-white/5" role="region" aria-label="Notification list" aria-live="polite">
              {notices.length === 0 && (
                <p className="text-[11px] text-zinc-600 font-bold uppercase text-center py-8 px-4">
                  All clear — important alerts land here, once a day max.
                </p>
              )}
              {notices.map(notice => (
                <div key={notice.id} className={`px-4 py-3 flex items-start gap-2.5 ${notice.read ? 'opacity-60' : 'bg-white/[0.02]'}`}>
                  <span aria-hidden="true" className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${KIND_DOT[notice.kind] || 'bg-zinc-500'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-black text-white leading-snug">{notice.title}</p>
                    {notice.body && <p className="text-[11px] text-zinc-500 font-bold mt-0.5 leading-snug">{notice.body}</p>}
                    {notice.action && onNavigate && (
                      <button
                        type="button"
                        onClick={() => { markNoticeRead(notice.id); setOpen(false); refresh(); onNavigate(notice.action!.tab); }}
                        className="mt-1.5 h-8 px-3 rounded-lg bg-gold-brand/15 border border-gold-brand/40 text-gold-brand text-[10px] font-black uppercase tracking-wider hover:bg-gold-brand/25 active:scale-95 transition-all cursor-pointer flex items-center gap-1.5"
                      >
                        {notice.action.label} <ArrowRight className="w-3 h-3" aria-hidden="true" />
                      </button>
                    )}
                    <p className="text-[9px] text-zinc-600 font-bold uppercase mt-1">
                      {new Date(notice.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      {!notice.read && <span className="text-rose-400 ml-1.5">• new</span>}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    {!notice.read && (
                      <button
                        type="button"
                        onClick={() => { markNoticeRead(notice.id); refresh(); }}
                        className="text-[9px] font-black uppercase text-emerald-400 hover:text-emerald-300 px-1.5 py-1 cursor-pointer"
                        aria-label={`Mark ${notice.title} as read`}
                      >
                        Read
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => { deleteNotice(notice.id); refresh(); }}
                      className="p-1 text-zinc-600 hover:text-rose-400 rounded cursor-pointer"
                      title="Delete"
                      aria-label={`Delete ${notice.title}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <p className="px-4 py-2 text-[9px] text-zinc-600 font-bold uppercase border-t border-white/5">
              Timed alerts only — repeats suppressed for 24h.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
