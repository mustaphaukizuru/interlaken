import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Clock, Send } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { NOTIF_META } from '@/lib/notifications';
import { portalApi } from '@/services/api';

/** Where the notification's subject lives, when it lives somewhere. */
function related(n: { notif_type: string; announcement: number | null }): { to: string; label: string } | null {
  if (n.announcement) return { to: `/portal/comunicados/${n.announcement}`, label: 'Abrir el comunicado' };
  if (n.notif_type === 'payment') return { to: '/portal/pagos', label: 'Ver mis pagos' };
  if (n.notif_type === 'cafeteria') return { to: '/portal/cafeteria', label: 'Ver la cafetería' };
  return null;
}

/**
 * /portal/notificaciones/:id — one notification in full.
 *
 * The list clamps the body to two lines, so an aviso longer than that had
 * nowhere to be read: tapping an 'info' notification did nothing at all. This
 * page shows the whole message, when it was sent, and a link to whatever it is
 * about. Opening it marks the notification read, which is what tapping a
 * notification is understood to mean.
 */
export default function NotificationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const notifId = Number(id);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['notification', notifId],
    queryFn: async () => (await portalApi.getNotification(notifId)).data,
    enabled: Number.isFinite(notifId),
  });

  const markRead = useMutation({
    mutationFn: () => portalApi.markNotificationRead(notifId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['notifications-page'] });
      qc.invalidateQueries({ queryKey: ['notification', notifId] });
    },
  });

  // Reading it is what marks it read; fire once, only when it is still unread.
  const unread = data?.is_read === false;
  useEffect(() => {
    if (unread) markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread, notifId]);

  const meta = data ? (NOTIF_META[data.notif_type] ?? NOTIF_META.info) : NOTIF_META.info;
  const Icon = meta.icon;
  const link = data ? related(data) : null;
  const created = data ? new Date(data.created_at) : null;

  return (
    <>
      <PageHeader
        title="Notificación"
        actions={(
          <Button variant="secondary" onClick={() => navigate('/portal/notificaciones')}>
            <ArrowLeft size={16} aria-hidden="true" /> Todas
          </Button>
        )}
      />

      {isError ? (
        <Card><ErrorState onRetry={() => refetch()} description="No se pudo abrir la notificación." /></Card>
      ) : isLoading || !data ? (
        <Card><ListSkeleton /></Card>
      ) : (
        <Card>
          <div className="flex items-start gap-3">
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${meta.cls}`}>
              <Icon size={20} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="neutral">{data.type_label || meta.label}</Badge>
                {!data.is_read && <Badge variant="warning">Sin leer</Badge>}
              </div>
              <h2 className="mt-2 font-head text-fluid-lg font-bold leading-snug text-ink">{data.title}</h2>
              {created && (
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted">
                  <span>{format(created, "d 'de' MMMM 'de' yyyy, HH:mm", { locale: es })}</span>
                  <span className="text-subtle">· {formatDistanceToNow(created, { addSuffix: true, locale: es })}</span>
                </p>
              )}
            </div>
          </div>

          {/* whitespace-pre-line: notification bodies are composed with real
              line breaks (balance alerts list the children one per line). */}
          <p className="mt-5 whitespace-pre-line text-[15px] leading-relaxed text-ink">{data.message}</p>

          {data.announcement_title && (
            <p className="mt-4 rounded-xl border border-line bg-cream-2 px-4 py-3 text-sm text-muted">
              Comunicado relacionado: <span className="font-semibold text-ink">{data.announcement_title}</span>
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            {link && (
              <Link to={link.to} className="btn btn-primary min-h-[44px]">
                {link.label} <ArrowRight size={16} aria-hidden="true" />
              </Link>
            )}
            <Link to="/portal/notificaciones" className="btn-outline min-h-[44px]">Volver a la lista</Link>
          </div>

          <dl className="mt-5 grid gap-2 text-xs text-subtle sm:grid-cols-2">
            <div className="flex items-center gap-1.5">
              <Clock size={13} aria-hidden="true" />
              <dt className="font-semibold">Creada:</dt>
              <dd>{created ? format(created, 'd MMM yyyy HH:mm', { locale: es }) : '—'}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              {data.delivered_at ? <Send size={13} aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}
              <dt className="font-semibold">Envío:</dt>
              <dd>
                {data.delivered_at
                  ? `Correo y push enviados el ${format(new Date(data.delivered_at), 'd MMM yyyy HH:mm', { locale: es })}`
                  : 'Solo en el portal (sin envío externo)'}
              </dd>
            </div>
          </dl>
        </Card>
      )}
    </>
  );
}
