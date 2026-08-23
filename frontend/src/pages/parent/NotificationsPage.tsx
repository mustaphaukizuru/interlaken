import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { NotificationList } from '@/components/portal/NotificationList';
import { NOTIF_META, notifDestination, type Notif } from '@/lib/notifications';
import { portalApi } from '@/services/api';
import { toPaged } from '@/lib/pagination';
import { useUrlFilters, useUrlPage } from '@/hooks/useUrlFilters';

const PAGE_SIZE = 20;

/** /portal/notificaciones — every notification, filterable, paginated (BACKLOG P1-B3). */
export default function NotificationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const type = get('tipo');
  const unreadOnly = get('sin_leer') === '1';
  const [busy, setBusy] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['notifications-page', page, type, unreadOnly],
    queryFn: async () => toPaged<Notif>((await portalApi.getNotifications({ page, type: type || undefined, unread: unreadOnly ? '1' : undefined })).data),
    placeholderData: keepPreviousData,
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['notifications-page'] });
  };
  const markRead = useMutation({ mutationFn: (id: number) => portalApi.markNotificationRead(id), onSuccess: invalidate });
  const markAll = useMutation({
    mutationFn: () => portalApi.markAllNotificationsRead(),
    onMutate: () => setBusy(true),
    onSettled: () => { setBusy(false); invalidate(); },
  });

  const open = (n: Notif) => {
    if (!n.is_read) markRead.mutate(n.id);
    const dest = notifDestination(n);
    if (dest) navigate(dest);
  };

  const items = data?.results ?? [];
  const count = data?.count ?? 0;

  return (
    <>
      <PageHeader
        title="Notificaciones"
        subtitle="Avisos, alertas de cafetería y pagos de tu familia."
        actions={<Button variant="secondary" loading={busy} onClick={() => markAll.mutate()}><Check size={16} aria-hidden="true" /> Marcar todas como leídas</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filtros">
        <Chip active={!type} onClick={() => set({ tipo: null, page: null })}>Todas</Chip>
        {(Object.keys(NOTIF_META) as Notif['notif_type'][]).map((k) => (
          <Chip key={k} active={type === k} onClick={() => set({ tipo: k, page: null })}>{NOTIF_META[k].label}</Chip>
        ))}
        <Chip active={unreadOnly} onClick={() => set({ sin_leer: unreadOnly ? null : '1', page: null })}>Sin leer</Chip>
      </div>

      <Card className="overflow-hidden p-0">
        {isError ? <div className="p-4"><ErrorState onRetry={() => refetch()} /></div>
          : isLoading ? <div className="p-4"><ListSkeleton /></div>
          : (
            <>
              <NotificationList items={items} onOpen={open} emptyText={unreadOnly ? 'No tienes notificaciones sin leer.' : 'Sin notificaciones.'} />
              {count > PAGE_SIZE && (
                <div className="border-t border-line px-4 py-3">
                  <Pagination page={page} pageSize={PAGE_SIZE} count={count} onChange={setPage} itemLabel="notificaciones" />
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
      className={`min-h-[40px] rounded-full px-4 text-sm font-semibold transition-colors ${active ? 'bg-purple text-white' : 'border border-line bg-white text-muted hover:text-ink'}`}
    >
      {children}
    </button>
  );
}
