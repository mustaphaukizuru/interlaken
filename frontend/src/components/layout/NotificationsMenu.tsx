import { useState } from 'react';
import { Bell, CheckCheck, ChevronRight } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Dropdown } from '@/components/ui/Dropdown';
import { NotificationList } from '@/components/portal/NotificationList';
import { BottomSheet } from '@/components/portal/BottomSheet';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { fetchNotifications, notifDestination, NOTIFICATIONS_KEY, type Notif } from '@/lib/notifications';
import { portalApi } from '@/services/api';
import { HEADER_ICON_BUTTON } from './navConfig';

/**
 * Header bell («Avisos»). Desktop: anchored popover. Phones (< md): a bottom
 * sheet portalled to <body> with 44 px targets (BACKLOG P1-B2). Both list
 * unread urgent alerts first and link to the full /portal/notificaciones page.
 */
export function NotificationsMenu() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isMobile = !useMediaQuery('(min-width: 768px)');
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data: feed } = useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: fetchNotifications,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const data = feed?.items ?? [];
  const unread = feed?.unread ?? 0;
  // The sidebar/tab-bar badge counts the same avisos: refresh it with the bell.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['badges'] });
  };
  const markRead = useMutation({ mutationFn: (id: number) => portalApi.markNotificationRead(id), onSuccess: invalidate });
  const markAll = useMutation({ mutationFn: () => portalApi.markAllNotificationsRead(), onSuccess: invalidate });

  const openNotif = (n: Notif, close: () => void) => {
    if (!n.is_read) markRead.mutate(n.id);
    navigate(notifDestination(n));
    close();
  };

  const bell = (open: boolean, toggle: () => void) => (
    <button
      type="button"
      onClick={toggle}
      aria-label={unread > 0 ? `Avisos, ${unread} sin leer` : 'Avisos'}
      aria-expanded={open}
      aria-haspopup="dialog"
      className={HEADER_ICON_BUTTON}
    >
      <Bell size={24} aria-hidden="true" />
      {unread > 0 && (
        <span aria-hidden="true" className="absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-coral px-1 text-[11px] font-bold leading-none text-white ring-2 ring-cream">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  );

  // Disabled (not hidden) with nothing unread: the action stays where people look for it.
  const markAllButton = (
    <button
      type="button"
      onClick={() => markAll.mutate()}
      disabled={unread === 0 || markAll.isPending}
      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-sm px-2.5 text-[13px] font-semibold text-purple transition-colors hover:bg-purple/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:cursor-not-allowed disabled:text-subtle disabled:hover:bg-transparent"
    >
      <CheckCheck size={16} aria-hidden="true" /> Marcar todo como leído
    </button>
  );

  const footer = (close: () => void) => (
    <Link
      to="/portal/notificaciones"
      onClick={close}
      className="flex min-h-[48px] items-center justify-center gap-1 border-t border-line text-sm font-semibold text-purple hover:bg-cream focus-visible:bg-cream focus-visible:outline-none"
    >
      Ver todos los avisos <ChevronRight size={16} aria-hidden="true" />
    </Link>
  );

  if (isMobile) {
    const close = () => setSheetOpen(false);
    return (
      <>
        {bell(sheetOpen, () => setSheetOpen((v) => !v))}
        <BottomSheet open={sheetOpen} onClose={close} title="Avisos" headerExtra={markAllButton} footer={footer(close)}>
          <NotificationList items={data} onOpen={(n) => openNotif(n, close)} limit={30} />
        </BottomSheet>
      </>
    );
  }

  return (
    <Dropdown width={400} trigger={({ open, toggle }) => bell(open, toggle)}>
      {({ close }) => (
        <>
          <div className="flex min-h-[56px] items-center justify-between gap-3 border-b border-line pl-4 pr-1.5">
            <h2 className="font-head text-sm font-bold text-ink">Avisos</h2>
            {markAllButton}
          </div>
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
