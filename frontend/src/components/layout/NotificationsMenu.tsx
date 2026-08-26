import { useEffect, useState } from 'react';
import { Bell, Check, X, ChevronRight } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Dropdown } from '@/components/ui/Dropdown';
import { NotificationList } from '@/components/portal/NotificationList';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { notifDestination, type Notif } from '@/lib/notifications';
import { portalApi } from '@/services/api';

/**
 * Header bell. Desktop: anchored popover. Mobile (< md): a bottom sheet with
 * 44px targets, safe-area padding and scroll lock (BACKLOG P1-B2). Both link
 * to the full /portal/notificaciones page (P1-B3).
 */
export function NotificationsMenu() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isMobile = !useMediaQuery('(min-width: 768px)');
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const r = await portalApi.getNotifications();
      return (r.data.results ?? r.data) as Notif[];
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const unread = data.filter((n) => !n.is_read).length;
  const invalidate = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const markRead = useMutation({ mutationFn: (id: number) => portalApi.markNotificationRead(id), onSuccess: invalidate });
  const markAll = useMutation({ mutationFn: () => portalApi.markAllNotificationsRead(), onSuccess: invalidate });

  const openNotif = (n: Notif, close: () => void) => {
    if (!n.is_read) markRead.mutate(n.id);
    navigate(notifDestination(n));
    close();
  };

  // Scroll lock + Escape for the sheet.
  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheetOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [sheetOpen]);

  const bell = (open: boolean, toggle: () => void) => (
    <button
      type="button"
      onClick={toggle}
      aria-label={unread > 0 ? `Notificaciones, ${unread} sin leer` : 'Notificaciones'}
      aria-expanded={open}
      aria-haspopup="dialog"
      className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-white text-muted shadow-card transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
    >
      <Bell size={19} />
      {unread > 0 && (
        <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-coral px-1 text-[10px] font-bold text-white ring-2 ring-cream">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  );

  const header = (close: () => void, withClose: boolean) => (
    <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
      <span className="font-head text-sm font-bold text-ink">Notificaciones</span>
      <div className="flex items-center gap-3">
        {unread > 0 && (
          <button
            type="button"
            onClick={() => markAll.mutate()}
            className="inline-flex min-h-[32px] items-center gap-1 rounded text-xs font-semibold text-purple transition-colors hover:text-purple-mid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
          >
            <Check size={13} /> Marcar todas
          </button>
        )}
        {withClose && (
          <button type="button" onClick={close} aria-label="Cerrar" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-cream hover:text-ink">
            <X size={18} />
          </button>
        )}
      </div>
    </div>
  );

  const footer = (close: () => void) => (
    <Link
      to="/portal/notificaciones"
      onClick={close}
      className="flex min-h-[48px] items-center justify-center gap-1 border-t border-line text-sm font-semibold text-purple hover:bg-cream"
    >
      Ver todas <ChevronRight size={16} aria-hidden="true" />
    </Link>
  );

  if (isMobile) {
    const close = () => setSheetOpen(false);
    return (
      <>
        {bell(sheetOpen, () => setSheetOpen((v) => !v))}
        {sheetOpen && (
          <div className="fixed inset-0 z-[60] md:hidden" role="dialog" aria-modal="true" aria-label="Notificaciones">
            <button type="button" aria-label="Cerrar" onClick={close} className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" />
            <div className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-2xl bg-white shadow-[0_-12px_40px_-12px_rgba(16,12,40,0.45)] pb-[env(safe-area-inset-bottom)]">
              <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-line" aria-hidden="true" />
              {header(close, true)}
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <NotificationList items={data} onOpen={(n) => openNotif(n, close)} limit={30} />
              </div>
              {footer(close)}
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <Dropdown width={400} trigger={({ open, toggle }) => bell(open, toggle)}>
      {({ close }) => (
        <>
          {header(close, false)}
          <div className="max-h-[420px] overflow-y-auto">
            <NotificationList items={data} onOpen={(n) => openNotif(n, close)} limit={15} />
          </div>
          {footer(close)}
        </>
      )}
    </Dropdown>
  );
}

export default NotificationsMenu;
