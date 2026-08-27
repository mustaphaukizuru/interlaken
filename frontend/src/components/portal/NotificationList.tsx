import { Bell } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { groupNotifs, NOTIF_META, type Notif } from '@/lib/notifications';

interface Props {
  items: Notif[];
  onOpen: (n: Notif) => void;
  /** Cap rendered items (menu) or show everything (page). */
  limit?: number;
  emptyText?: string;
}

/** Grouped (Hoy / Esta semana / Anteriores) tappable list shared by the bell sheet and the page. */
export function NotificationList({ items, onOpen, limit, emptyText = 'Sin notificaciones' }: Props) {
  const visible = limit ? items.slice(0, limit) : items;
  if (visible.length === 0) {
    return (
      <div className="px-4 py-12 text-center">
        <Bell size={22} className="mx-auto mb-2 text-subtle" />
        <p className="text-sm text-muted">{emptyText}</p>
      </div>
    );
  }
  return (
    <div>
      {groupNotifs(visible).map((g) => (
        <section key={g.label} aria-label={g.label}>
          <h3 className="sticky top-0 z-[1] bg-white/95 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[1.4px] text-subtle backdrop-blur">
            {g.label}
          </h3>
          <ul>
            {g.items.map((n) => {
              const m = NOTIF_META[n.notif_type] ?? NOTIF_META.info;
              const Icon = m.icon;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(n)}
                    className={`flex min-h-[56px] w-full items-start gap-3 border-b border-line/70 px-4 py-3 text-left transition-colors last:border-0 hover:bg-cream focus-visible:bg-cream focus-visible:outline-none active:bg-cream ${
                      n.is_read ? '' : 'bg-purple/[0.035]'
                    }`}
                  >
                    <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${m.cls}`}>
                      <Icon size={17} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[14px] font-semibold text-ink">{n.title}</span>
                        {!n.is_read && <span className="h-2 w-2 shrink-0 rounded-full bg-coral" aria-label="Sin leer" />}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted">{n.message}</span>
                      <span className="mt-1 block text-[12px] text-subtle">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: es })}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default NotificationList;
