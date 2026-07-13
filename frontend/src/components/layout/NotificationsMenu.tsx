import { Bell, Info, AlertTriangle, Receipt, Coffee, Check, type LucideIcon } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { Dropdown } from '@/components/ui/Dropdown';
import { portalApi } from '@/services/api';

interface Notif {
  id: number;
  notif_type: 'info' | 'warning' | 'payment' | 'cafeteria';
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

const META: Record<Notif['notif_type'], { icon: LucideIcon; cls: string }> = {
  info:      { icon: Info,          cls: 'bg-purple/10 text-purple' },
  warning:   { icon: AlertTriangle, cls: 'bg-amber/10 text-amber' },
  payment:   { icon: Receipt,       cls: 'bg-coral/10 text-coral' },
  cafeteria: { icon: Coffee,        cls: 'bg-green/10 text-green-dark' },
};

/** Header bell + live notifications panel (unread badge, tap-to-read, mark-all). */
export function NotificationsMenu() {
  const qc = useQueryClient();
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
  const markRead = useMutation({
    mutationFn: (id: number) => portalApi.markNotificationRead(id),
    onSuccess: invalidate,
  });
  const markAll = useMutation({
    mutationFn: async () => {
      await Promise.all(data.filter((n) => !n.is_read).map((n) => portalApi.markNotificationRead(n.id)));
    },
    onSuccess: invalidate,
  });

  return (
    <Dropdown
      width={370}
      label="Notificaciones"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={unread > 0 ? `Notificaciones, ${unread} sin leer` : 'Notificaciones'}
          aria-expanded={open}
          className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-white text-muted shadow-card transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
        >
          <Bell size={19} />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-coral px-1 text-[10px] font-bold text-white ring-2 ring-cream">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      )}
    >
      {() => (
        <>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="font-head text-sm font-bold text-ink">Notificaciones</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markAll.mutate()}
                className="inline-flex items-center gap-1 text-xs font-semibold text-purple transition-colors hover:text-purple-mid"
              >
                <Check size={13} /> Marcar todas
              </button>
            )}
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {data.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <Bell size={22} className="mx-auto mb-2 text-subtle" />
                <p className="text-sm text-muted">Sin notificaciones</p>
              </div>
            ) : (
              data.slice(0, 15).map((n) => {
                const m = META[n.notif_type] ?? META.info;
                const Icon = m.icon;
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => !n.is_read && markRead.mutate(n.id)}
                    className={`flex w-full items-start gap-3 border-b border-line/70 px-4 py-3 text-left transition-colors last:border-0 hover:bg-cream ${
                      n.is_read ? '' : 'bg-purple/[0.035]'
                    }`}
                  >
                    <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${m.cls}`}>
                      <Icon size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-semibold text-ink">{n.title}</span>
                        {!n.is_read && <span className="h-2 w-2 shrink-0 rounded-full bg-coral" aria-hidden="true" />}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{n.message}</span>
                      <span className="mt-1 block text-[11px] text-subtle">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: es })}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
    </Dropdown>
  );
}

export default NotificationsMenu;
