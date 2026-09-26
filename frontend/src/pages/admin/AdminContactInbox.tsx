import { useState } from 'react';
import { Check, Inbox, Mail, MessageCircle, Undo2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { parseSort, serializeSort, type SortState } from '@/components/ui/SortableTh';
import { ExportMenu } from '@/components/admin/ExportMenu';
import { FilterBar } from '@/components/admin/FilterBar';
import { BulkActionBar } from '@/components/admin/BulkActionBar';
import { BulkConfirmDialog } from '@/components/admin/BulkConfirmDialog';
import { useUrlFilters, useUrlPage } from '@/hooks/useUrlFilters';
import { useRowSelection } from '@/hooks/useRowSelection';
import {
  useContactMessagesBulk,
  useContactMessagesExport,
  useContactMessagesList,
  useSetContactHandled,
  type ContactMessagesListParams,
} from '@/hooks/queries/contactMessages';
import { apiErrorMessage } from '@/lib/apiErrors';
import { idsParam, type BulkActionDef, type ExportFormat } from '@/services/dataOps';
import type { ContactMessage } from '@/services/api';

/** `?estado=` (URL) → `handled` (API). Absent = the pending queue, the page's default. */
const HANDLED_PARAM: Record<string, string | undefined> = { '': '0', '1': '1', all: undefined };

const TABS = [
  { value: '', label: 'Pendientes' },
  { value: '1', label: 'Atendidos' },
  { value: 'all', label: 'Todos' },
];

const BULK_ACTIONS: BulkActionDef[] = [
  { name: 'mark_handled', label: 'Marcar atendidos', planVerb: 'Se marcarán como atendidos', icon: Check },
  { name: 'reopen', label: 'Reabrir', planVerb: 'Se reabrirán', icon: Undo2 },
];

const isInvoice = (m: ContactMessage) => m.subject.startsWith('[Facturación]');
const when = (iso: string) => new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
const replyHref = (m: ContactMessage) => `mailto:${m.email}?subject=${encodeURIComponent(`Re: ${m.subject}`)}`;

function StatusBadge({ m }: { m: ContactMessage }) {
  return m.is_handled ? <Badge variant="success">Atendido</Badge> : <Badge variant="warning">Pendiente</Badge>;
}

const COLUMNS: Column<ContactMessage>[] = [
  { id: 'date', header: 'Fecha', sortKey: 'date', hideable: false, minWidth: 150, className: 'whitespace-nowrap text-muted', cell: (m) => when(m.created_at) },
  { id: 'name', header: 'Nombre', sortKey: 'name', minWidth: 140, className: 'font-medium text-ink', cell: (m) => m.name },
  { id: 'email', header: 'Correo', sortKey: 'email', minWidth: 160, className: 'text-muted max-w-[220px] truncate', cell: (m) => m.email },
  {
    id: 'subject', header: 'Asunto', sortKey: 'subject', hideable: false, minWidth: 200,
    cell: (m) => (
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-ink">{m.subject}</span>
          {isInvoice(m) && <Badge variant="info">Factura</Badge>}
        </div>
        <p className="line-clamp-1 text-xs text-subtle">{m.message}</p>
      </div>
    ),
  },
  { id: 'handled', header: 'Estado', sortKey: 'handled', minWidth: 110, cell: (m) => <StatusBadge m={m} /> },
];

/** /admin/mensajes — website contact + facturación inbox (BACKLOG P1-G7) on the Data Ops
 *  list: URL-synced tabs, search, dates and sort; selection with bulk "Marcar atendidos" /
 *  "Reabrir"; export of the current view or the selection; a message drawer. */
export default function AdminContactInbox() {
  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const q = get('q');
  const estado = get('estado');
  const from = get('desde');
  const to = get('hasta');
  const sort = parseSort(get('orden'));
  const filters: Omit<ContactMessagesListParams, 'page'> = {
    q: q || undefined,
    handled: estado in HANDLED_PARAM ? HANDLED_PARAM[estado] : '0',
    from: from || undefined,
    to: to || undefined,
    ordering: serializeSort(sort) || undefined,
  };

  const { data, isLoading, isError, refetch } = useContactMessagesList({ page, ...filters });
  const exportMessages = useContactMessagesExport();
  const bulk = useContactMessagesBulk();
  const toggle = useSetContactHandled();
  const rows = data?.results;
  const count = data?.count ?? 0;
  const selection = useRowSelection(count, JSON.stringify(filters));
  const [action, setAction] = useState<BulkActionDef | null>(null);
  const [open, setOpen] = useState<ContactMessage | null>(null);
  const onSort = (next: SortState) => set({ orden: serializeSort(next), page: null });

  const fetchExport = (fmt: ExportFormat, { selectedOnly }: { selectedOnly: boolean }) =>
    exportMessages.mutateAsync({ ...filters, fmt, ids: selectedOnly && !selection.allMatching ? idsParam(selection.ids) : undefined });

  const setHandled = (m: ContactMessage, isHandled: boolean) =>
    toggle.mutate(
      { id: m.id, is_handled: isHandled },
      {
        onSuccess: (res) => {
          toast.success(isHandled ? 'Mensaje marcado como atendido.' : 'Mensaje reabierto.');
          setOpen((cur) => (cur && cur.id === m.id ? res.data : cur));
        },
        onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo actualizar.')),
      },
    );

  const anyFilter = !!(q || from || to || estado);

  return (
    <>
      <PageHeader
        title="Mensajes del sitio"
        subtitle="Formulario de contacto y solicitudes de factura. Responda por correo y marque como atendido."
        actions={<ExportMenu filenamePrefix="mensajes" selectedCount={selection.count} fetch={fetchExport} />}
      />
      <Card title={`${count.toLocaleString('es-MX')} mensajes`}>
        <DataTable<ContactMessage>
          tableId="contact-messages"
          columns={COLUMNS}
          rows={rows}
          rowKey={(m) => m.id}
          rowLabel={(m) => `mensaje de ${m.name}: ${m.subject}`}
          caption="Mensajes del sitio"
          sort={sort}
          onSort={onSort}
          page={page}
          count={count}
          onPage={setPage}
          itemLabel="mensajes"
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          columnControls
          resizable
          selection={selection}
          onRowClick={setOpen}
          rowActions={(m) => (
            <div className="flex flex-wrap justify-end gap-1.5">
              <a href={replyHref(m)} className="btn-outline min-h-[44px] px-3 text-xs sm:min-h-[36px]" aria-label={`Responder a ${m.name}`}>
                <Mail className="h-3.5 w-3.5" aria-hidden="true" /> Responder
              </a>
              <Button
                size="sm"
                variant={m.is_handled ? 'ghost' : 'secondary'}
                loading={toggle.isPending && toggle.variables?.id === m.id}
                onClick={() => setHandled(m, !m.is_handled)}
                aria-label={m.is_handled ? `Reabrir mensaje de ${m.name}` : `Marcar atendido el mensaje de ${m.name}`}
              >
                {m.is_handled ? <><Undo2 className="h-4 w-4" aria-hidden="true" /> Reabrir</> : <><Check className="h-4 w-4" aria-hidden="true" /> Atendido</>}
              </Button>
            </div>
          )}
          toolbar={(
            <FilterBar
              search={{ placeholder: 'Nombre, correo, asunto o texto…', label: 'Buscar mensajes' }}
              tabs={{ paramKey: 'estado', options: TABS, allLabel: null, label: 'Filtrar por estado' }}
              dateRange={{ idPrefix: 'mensajes' }}
            />
          )}
          bulkBar={(
            <BulkActionBar
              count={selection.count}
              allMatching={selection.allMatching}
              allMatchingCount={count}
              onSelectAllMatching={selection.onSelectAllMatching}
              onClear={selection.onClear}
              actions={BULK_ACTIONS}
              onAction={setAction}
              itemLabel="mensajes"
              gender="m"
              busy={bulk.isPending}
              exportMenu={<ExportMenu label="Exportar seleccionados" filenamePrefix="mensajes" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
            />
          )}
          empty={{
            icon: Inbox,
            title: anyFilter ? 'Sin resultados' : 'Sin mensajes pendientes',
            description: anyFilter
              ? 'Ningún mensaje coincide con los filtros.'
              : 'Los mensajes del formulario de contacto y facturación aparecerán aquí.',
          }}
        />
      </Card>
      <p className="mt-3 text-xs text-subtle">
        <MessageCircle className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
        Consejo: los mensajes de facturación llegan también al buzón de facturación por correo.
      </p>

      <BulkConfirmDialog
        open={!!action}
        onClose={() => setAction(null)}
        action={action}
        entityLabel="mensajes"
        gender="m"
        ids={selection.ids}
        allMatching={selection.allMatching}
        filters={{ q: filters.q, handled: filters.handled, from: filters.from, to: filters.to }}
        execute={bulk.run}
        onDone={(r) => { if (r.ok > 0) selection.onClear(); }}
      />

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.subject ?? ''} maxWidth={600}>
        {open && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge m={open} />
              {isInvoice(open) && <Badge variant="info">Factura</Badge>}
            </div>
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5">
              <dt className="text-subtle">De</dt>
              <dd className="text-ink">{open.name}</dd>
              <dt className="text-subtle">Correo</dt>
              <dd className="break-all text-ink">{open.email}</dd>
              <dt className="text-subtle">Recibido</dt>
              <dd className="text-ink">{when(open.created_at)}</dd>
            </dl>
            <p className="whitespace-pre-line rounded-lg bg-cream-2 p-3 text-ink">{open.message}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <a href={replyHref(open)} className="btn-outline min-h-[44px] text-sm">
                <Mail className="h-4 w-4" aria-hidden="true" /> Responder por correo
              </a>
              <Button loading={toggle.isPending} onClick={() => setHandled(open, !open.is_handled)}>
                {open.is_handled ? <><Undo2 className="h-4 w-4" aria-hidden="true" /> Reabrir</> : <><Check className="h-4 w-4" aria-hidden="true" /> Marcar atendido</>}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
