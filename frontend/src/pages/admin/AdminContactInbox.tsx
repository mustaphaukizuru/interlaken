import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox, Search, Check, Undo2, Mail, MessageCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { ADMIN_PAGE_SIZE, toPaged } from '@/lib/pagination';
import { useUrlFilters, useUrlPage, useUrlSyncedSearch } from '@/hooks/useUrlFilters';
import { coreApi, type ContactMessage } from '@/services/api';

/** /admin/mensajes — website contact + facturación inbox (BACKLOG P1-G7, AF-4 gap 2). */
export default function AdminContactInbox() {
  const qc = useQueryClient();
  const { input: q, setInput: setQ, search: debouncedQ } = useUrlSyncedSearch('q');
  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const handled = get('estado') || '0';

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['contact-inbox', page, debouncedQ, handled],
    queryFn: async () => toPaged<ContactMessage>((await coreApi.getContactMessages({ page, q: debouncedQ || undefined, handled: handled === 'all' ? undefined : handled })).data),
    placeholderData: keepPreviousData,
  });
  const toggle = useMutation({
    mutationFn: ({ id, is_handled }: { id: number; is_handled: boolean }) => coreApi.setContactHandled(id, is_handled),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contact-inbox'] }); qc.invalidateQueries({ queryKey: ['badges'] }); },
    onError: () => toast.error('No se pudo actualizar.'),
  });
  const rows = data?.results ?? [];

  return (
    <>
      <PageHeader title="Mensajes del sitio" subtitle="Formulario de contacto y solicitudes de factura. Responda por correo o WhatsApp y marque como atendido." />
      <Card title={`${data?.count ?? 0} mensajes`}>
        <div className="mb-4 flex flex-wrap gap-2">
          {([['0', 'Pendientes'], ['1', 'Atendidos'], ['all', 'Todos']] as const).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={handled === v} onClick={() => set({ estado: v === '0' ? null : v, page: null })}
              className={`min-h-[40px] rounded-full px-4 text-sm font-semibold ${handled === v ? 'bg-purple text-white' : 'border border-line bg-white text-muted hover:text-ink'}`}>
              {label}
            </button>
          ))}
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
            <input className="input-field pl-9" placeholder="Nombre, correo o asunto…" aria-label="Buscar mensajes" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        {isError ? <ErrorState onRetry={() => refetch()} /> : isLoading ? <ListSkeleton /> : !rows.length ? (
          <EmptyState icon={Inbox} title="Sin mensajes" description="Los mensajes del formulario de contacto y facturación aparecerán aquí." />
        ) : (
          <>
            <ul className="divide-y divide-cream">
              {rows.map((m) => (
                <li key={m.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-ink">{m.subject}</p>
                        {m.subject.startsWith('[Facturación]') && <Badge variant="info">Factura</Badge>}
                        {m.is_handled ? <Badge variant="success">Atendido</Badge> : <Badge variant="warning">Pendiente</Badge>}
                      </div>
                      <p className="text-xs text-subtle">{m.name} · {m.email} · {new Date(m.created_at).toLocaleString('es-MX')}</p>
                      <p className="mt-2 whitespace-pre-line text-sm text-muted">{m.message}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      <a href={`mailto:${m.email}?subject=${encodeURIComponent('Re: ' + m.subject)}`} className="btn-outline min-h-[36px] px-3 text-xs"><Mail className="h-3.5 w-3.5" aria-hidden="true" /> Responder</a>
                      <Button size="sm" variant={m.is_handled ? 'ghost' : 'secondary'} loading={toggle.isPending && toggle.variables?.id === m.id}
                        onClick={() => toggle.mutate({ id: m.id, is_handled: !m.is_handled })}>
                        {m.is_handled ? <><Undo2 className="h-4 w-4" aria-hidden="true" /> Reabrir</> : <><Check className="h-4 w-4" aria-hidden="true" /> Marcar atendido</>}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} count={data?.count ?? 0} onChange={setPage} itemLabel="mensajes" />
          </>
        )}
      </Card>
      <p className="mt-3 text-xs text-subtle"><MessageCircle className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />Consejo: los mensajes de facturación llegan también al buzón de facturación por correo.</p>
    </>
  );
}
