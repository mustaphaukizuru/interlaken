import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { NotificationList } from '@/components/portal/NotificationList';
import { NOTIF_META, notifDestination, type Notif } from '@/lib/notifications';
import { portalApi } from '@/services/api';
import { toPaged } from '@/lib/pagination';
import { useStalePageReset, useUrlFilters, useUrlPage } from '@/hooks/useUrlFilters';
import { useBadges } from '@/hooks/useBadges';

const PAGE_SIZE = 20;

/** /portal/notificaciones — «Avisos»: every notification, filterable, paginated (BACKLOG P1-B3). */
export default function NotificationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const type = get('tipo');
  const unreadOnly = get('sin_leer') === '1';
  const [busy, setBusy] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['notifications-page', page, type, unreadOnly],
    queryFn: async () => toPaged<Notif>((await portalApi.getNotifications({ page, type: type || undefined, unread: unreadOnly ? '1' : undefined })).data),
    placeholderData: keepPreviousData,
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['notifications-page'] });
    qc.invalidateQueries({ queryKey: ['badges'] });
  };
  // Anything unread: on this page, or anywhere (the server's unread count).
  const unreadBadge = useBadges().notificaciones ?? 0;
  const markRead = useMutation({ mutationFn: (id: number) => portalApi.markNotificationRead(id), onSuccess: invalidate });
  const markAll = useMutation({
    mutationFn: () => portalApi.markAllNotificationsRead(),
    onMutate: () => setBusy(true),
    onSettled: () => { setBusy(false); invalidate(); },
  });

  const open = (n: Notif) => {
    if (!n.is_read) markRead.mutate(n.id);
    navigate(notifDestination(n));
  };

  // Marking everything read under ?sin_leer=1 empties the later pages.
  useStalePageReset(error, page, setPage);

  const items = data?.results ?? [];
  const count = data?.count ?? 0;
  const filtered = Boolean(type) || unreadOnly;
  const anyUnread = unreadBadge > 0 || items.some((n) => !n.is_read);

  return (
    <>
      <PageHeader
        title="Avisos"
        subtitle="Comunicados del colegio, cafetería y pagos de su familia."
        actions={(
          <Button variant="secondary" loading={busy} disabled={!anyUnread} onClick={() => markAll.mutate()} className="min-h-[44px]">
            <CheckCheck size={20} aria-hidden="true" /> Marcar todo como leído
          </Button>
        )}
      />

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filtrar avisos">
        <Chip active={!type} onClick={() => set({ tipo: null, page: null })}>Todos</Chip>
        {(Object.keys(NOTIF_META) as Notif['notif_type'][]).map((k) => (
          <Chip key={k} active={type === k} onClick={() => set({ tipo: k, page: null })}>{NOTIF_META[k].label}</Chip>
        ))}
        <Chip active={unreadOnly} onClick={() => set({ sin_leer: unreadOnly ? null : '1', page: null })}>Sin leer</Chip>
      </div>

      <Card className="overflow-hidden p-0">
        {isError ? <div className="p-4"><ErrorState onRetry={() => refetch()} /></div>
          : isLoading ? <div className="p-4"><ListSkeleton /></div>
          : !items.length ? (
            <EmptyState
              icon={Bell}
              title={unreadOnly ? 'Está al día' : filtered ? 'Sin avisos de este tipo' : 'Sin avisos'}
              description={unreadOnly ? 'No tiene avisos sin leer.' : 'Aquí aparecerán los avisos del colegio, la cafetería y los pagos.'}
              action={filtered ? (
                <Button variant="secondary" size="sm" className="min-h-[44px]" onClick={() => set({ tipo: null, sin_leer: null, page: null })}>
                  Ver todos los avisos
                </Button>
              ) : undefined}
            />
          )
          : (
            <>
              <NotificationList items={items} onOpen={open} />
              {count > PAGE_SIZE && (
                <div className="border-t border-line px-4 py-3">
                  <Pagination page={page} pageSize={PAGE_SIZE} count={count} onChange={setPage} itemLabel="avisos" />
                </div>
              )}
            </>
          )}
      </Card>
    </>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-[44px] rounded-sm px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 ${active ? 'bg-purple text-white' : 'bg-white text-muted hover:bg-purple-light hover:text-ink'}`}
    >
      {children}
    </button>
  );
}
