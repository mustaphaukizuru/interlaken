import { Bell } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { es } from 'date-fns/locale';
import { groupNotifs, NOTIF_META, pinUrgent, type Notif } from '@/lib/notifications';
import { notifPreview } from '@/lib/notificationText';

interface Props {
  items: Notif[];
  onOpen: (n: Notif) => void;
  /** Cap rendered items (menu) or show everything (page). */
  limit?: number;
  emptyText?: string;
}

/**
 * Grouped tappable list shared by the bell sheet and the page: unread urgent
 * alerts pinned in «Urgentes», then Hoy / Esta semana / Anteriores.
 *
 * Each row is a preview: icon, title (two lines at most), the opening of the
 * message (two lines at most), category and time. Unread reads as one thing
 * only: a dot (with its text for screen readers). The whole text lives on the
 * notification's own page.
 */
export function NotificationList({ items, onOpen, limit, emptyText = 'Sin avisos por ahora.' }: Props) {
  const pinned = pinUrgent(items);
  const visible = limit ? pinned.slice(0, limit) : pinned;
  if (visible.length === 0) {
    return (
      <div className="px-4 py-12 text-center">
        <Bell size={24} className="mx-auto mb-2 text-subtle" aria-hidden="true" />
        <p className="text-sm text-muted">{emptyText}</p>
      </div>
    );
  }
  return (
    <div>
      {groupNotifs(visible).map((g) => (
        <section key={g.label} aria-label={g.label}>
          <h3 className={`sticky top-0 z-10 bg-white px-4 py-1.5 text-xs font-bold uppercase tracking-[1.2px] ${g.label === 'Urgentes' ? 'text-warning' : 'text-subtle'}`}>
            {g.label}
          </h3>
          <ul>
            {g.items.map((n) => {
              const m = NOTIF_META[n.notif_type] ?? NOTIF_META.info;
              const Icon = m.icon;
              const preview = notifPreview(n.message);
              const when = formatDistanceToNowStrict(new Date(n.created_at), { addSuffix: true, locale: es });
              return (
                <li key={n.id} className="border-b border-line last:border-0">
                  <button
                    type="button"
                    onClick={() => onOpen(n)}
                    className="flex min-h-[56px] w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-cream focus-visible:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple/40 active:bg-cream"
                  >
                    <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-sm ${m.cls}`}>
                      <Icon size={20} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start gap-2">
                        <span className={`line-clamp-2 min-w-0 flex-1 break-words text-[14px] leading-snug text-ink ${n.is_read ? 'font-medium' : 'font-semibold'}`}>
                          {n.title}
                        </span>
                        {!n.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-coral" aria-label="Sin leer" role="img" />}
                      </span>
                      {preview && (
                        <span className="mt-0.5 line-clamp-2 break-words text-[13px] leading-snug text-muted">{preview}</span>
                      )}
                      <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-subtle">
                        <span>{m.label}</span>
                        <span aria-hidden="true">·</span>
                        <time dateTime={n.created_at}>{when}</time>
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
