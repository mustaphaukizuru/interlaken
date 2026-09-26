import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Clock, Eye, Plus, RotateCcw, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { parseSort, serializeSort, type SortState } from '@/components/ui/SortableTh';
import { ExportMenu } from '@/components/admin/ExportMenu';
import { FilterBar } from '@/components/admin/FilterBar';
import { BulkActionBar } from '@/components/admin/BulkActionBar';
import { BulkConfirmDialog } from '@/components/admin/BulkConfirmDialog';
import { legalApi, type ArcoRequest } from '@/services/api';
import { idsParam, type BulkActionDef, type ExportFormat } from '@/services/dataOps';
import { apiErrorMessage, apiFieldErrors } from '@/lib/apiErrors';
import { useUrlFilters, useUrlPage } from '@/hooks/useUrlFilters';
import { useRowSelection } from '@/hooks/useRowSelection';
import { useArcoBulk, useArcoExport, useArcoList, useInvalidateArco, useSetArcoStatus, type ArcoListParams } from '@/hooks/queries/arco';

const TYPE: Record<string, string> = { access: 'Acceso', rectification: 'Rectificación', cancellation: 'Cancelación', opposition: 'Oposición' };
const STATUS: Record<string, { label: string; tone: 'info' | 'warning' | 'success' | 'error' }> = {
  received: { label: 'Recibida', tone: 'info' }, in_review: { label: 'En revisión', tone: 'warning' }, resolved: { label: 'Resuelta', tone: 'success' }, rejected: { label: 'Rechazada', tone: 'error' },
};
const CHANNEL: Record<string, string> = { portal: 'Portal', email: 'Correo', whatsapp: 'WhatsApp', in_person: 'Presencial' };

/** `?estado=` tabs; absent = the open queue (received + in review), the page's default. */
const TABS = [
  { value: '', label: 'Abiertas' },
  { value: 'received', label: 'Recibidas' },
  { value: 'in_review', label: 'En revisión' },
  { value: 'resolved', label: 'Resueltas' },
  { value: 'rejected', label: 'Rechazadas' },
  { value: 'all', label: 'Todas' },
];
const TYPE_OPTIONS = Object.entries(TYPE).map(([value, label]) => ({ value, label }));
const OVERDUE_OPTIONS = [{ value: '1', label: 'Solo vencidas' }, { value: '0', label: 'Dentro de plazo' }];

const BULK_ACTIONS: BulkActionDef[] = [
  { name: 'in_review', label: 'Marcar en revisión', planVerb: 'Se marcarán en revisión', icon: Eye },
];

type Target = 'in_review' | 'resolved' | 'rejected';
const isOpen = (r: Pick<ArcoRequest, 'status'>) => r.status === 'received' || r.status === 'in_review';

/** Days-left label for the statutory deadline (20 business days). */
export function deadlineLabel(r: Pick<ArcoRequest, 'status' | 'days_left' | 'is_overdue'>): string {
  if (r.status === 'resolved' || r.status === 'rejected') return 'Cerrada';
  if (r.is_overdue) return `Vencida hace ${Math.abs(r.days_left)} d`;
  if (r.days_left === 0) return 'Vence hoy';
  return `${r.days_left} d restantes`;
}

const COLUMNS: Column<ArcoRequest>[] = [
  {
    id: 'date', header: 'Recibida', sortKey: 'date', minWidth: 120, className: 'whitespace-nowrap text-muted',
    cell: (r) => new Date(r.created_at).toLocaleDateString('es-MX', { dateStyle: 'medium' }),
  },
  { id: 'type', header: 'Derecho', sortKey: 'type', hideable: false, minWidth: 120, className: 'font-semibold text-ink', cell: (r) => TYPE[r.request_type] ?? r.request_type },
  {
    id: 'requester', header: 'Solicitante', sortKey: 'requester', hideable: false, minWidth: 180,
    cell: (r) => (
      <div className="min-w-0">
        <p className="truncate font-medium text-ink">{r.requester_name || r.requester_email}</p>
        {r.requester_name && <p className="truncate text-xs text-subtle">{r.requester_email}</p>}
      </div>
    ),
  },
  { id: 'channel', header: 'Canal', minWidth: 100, className: 'text-muted', cell: (r) => CHANNEL[r.channel] ?? r.channel },
  { id: 'status', header: 'Estado', sortKey: 'status', minWidth: 110, cell: (r) => <Badge variant={STATUS[r.status]?.tone ?? 'neutral'}>{STATUS[r.status]?.label ?? r.status}</Badge> },
  {
    id: 'deadline', header: 'Plazo', sortKey: 'deadline', minWidth: 130,
    cell: (r) => (
      <span className={`inline-flex items-center gap-1 text-xs ${r.is_overdue ? 'font-semibold text-coral-600' : 'text-subtle'}`}>
        <Clock size={12} aria-hidden="true" /> {deadlineLabel(r)}
      </span>
    ),
  },
  { id: 'details', header: 'Detalle', minWidth: 200, defaultHidden: true, className: 'max-w-xs truncate text-xs text-muted', cell: (r) => r.details || '—' },
  { id: 'resolution', header: 'Resolución', minWidth: 200, defaultHidden: true, className: 'max-w-xs truncate text-xs text-muted', cell: (r) => r.resolution_note || '—' },
];

/** /admin/arco — ARCO workflow + privacidad@ intake (BACKLOG P5-5) on the Data Ops list:
 *  URL-synced tabs, search, type/overdue/date filters and sort; the "vencidas" banner counts
 *  the whole filtered set (server-side); bulk "En revisión"; export; resolve/reject/reopen stay
 *  single-row with a required note. */
export default function AdminArco() {
  const { get, set } = useUrlFilters();
  const [page, setPage] = useUrlPage();
  const q = get('q');
  // `status` was the pre-Data-Ops param; bookmarks keep working.
  const estado = get('estado') || get('status');
  const tipo = get('tipo');
  const vencidas = get('vencidas');
  const from = get('desde');
  const to = get('hasta');
  const sort = parseSort(get('orden'));
  const filters: Omit<ArcoListParams, 'page'> = {
    q: q || undefined,
    status: estado === 'all' ? undefined : estado || 'open',
    type: tipo || undefined,
    overdue: vencidas || undefined,
    from: from || undefined,
    to: to || undefined,
    ordering: serializeSort(sort) || undefined,
  };

  const { data, isLoading, isError, refetch } = useArcoList({ page, ...filters });
  const exportArco = useArcoExport();
  const bulk = useArcoBulk();
  const setStatus = useSetArcoStatus();
  const invalidate = useInvalidateArco();
  const rows = data?.results;
  const count = data?.count ?? 0;
  const overdue = data?.overdue_count ?? 0;
  const selection = useRowSelection(count, JSON.stringify(filters));
  const [bulkAction, setBulkAction] = useState<BulkActionDef | null>(null);
  const [intake, setIntake] = useState(false);
  const [resolving, setResolving] = useState<{ r: ArcoRequest; status: Target } | null>(null);
  const [note, setNote] = useState('');
  const onSort = (next: SortState) => set({ orden: serializeSort(next), page: null });

  const fetchExport = (fmt: ExportFormat, { selectedOnly }: { selectedOnly: boolean }) =>
    exportArco.mutateAsync({ ...filters, fmt, ids: selectedOnly && !selection.allMatching ? idsParam(selection.ids) : undefined });

  const openDialog = (r: ArcoRequest, status: Target) => { setResolving({ r, status }); setNote(''); };
  const reopening = !!resolving && !isOpen(resolving.r);
  const noteRequired = !!resolving && (resolving.status !== 'in_review' || reopening);
  const submitStatus = () => {
    if (!resolving) return;
    setStatus.mutate(
      { id: resolving.r.id, status: resolving.status, note: note.trim() },
      {
        onSuccess: () => {
          toast.success(resolving.status === 'in_review' ? 'Solicitud en revisión.' : 'Solicitud actualizada; se notificó al solicitante.');
          setResolving(null);
          setNote('');
        },
        onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo actualizar.')),
      },
    );
  };

  const dialogTitle = resolving?.status === 'resolved' ? 'Resolver solicitud'
    : resolving?.status === 'rejected' ? 'Rechazar solicitud'
      : reopening ? 'Reabrir solicitud' : 'Marcar en revisión';

  return (
    <>
      <PageHeader
        title="Solicitudes ARCO"
        subtitle="Acceso, rectificación, cancelación y oposición. Plazo legal: 20 días hábiles desde la recepción. Las que llegan a privacidad@ o por WhatsApp se registran aquí."
        actions={(
          <div className="flex flex-wrap gap-2">
            <ExportMenu filenamePrefix="solicitudes_arco" selectedCount={selection.count} fetch={fetchExport} />
            <Button onClick={() => setIntake(true)}><Plus size={16} aria-hidden="true" /> Registrar solicitud recibida</Button>
          </div>
        )}
      />
      {overdue > 0 && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-coral-200 bg-coral-50 px-4 py-2 text-sm text-coral-700" role="alert">
          <AlertTriangle size={16} aria-hidden="true" /> {overdue} {overdue === 1 ? 'solicitud vencida' : 'solicitudes vencidas'}: responda hoy y documente la causa del retraso.
        </p>
      )}
      <Card>
        <DataTable<ArcoRequest>
          tableId="arco"
          columns={COLUMNS}
          rows={rows}
          rowKey={(r) => r.id}
          rowLabel={(r) => `solicitud ${r.id} de ${r.requester_name || r.requester_email}`}
          caption="Solicitudes ARCO"
          sort={sort}
          onSort={onSort}
          page={page}
          count={count}
          onPage={setPage}
          itemLabel="solicitudes"
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          columnControls
          resizable
          selection={selection}
          rowClassName={(r) => (r.is_overdue ? 'bg-coral-50/40' : '')}
          rowActions={(r) => (
            <div className="flex flex-wrap justify-end gap-1.5">
              {r.status === 'received' && <Button size="sm" variant="ghost" onClick={() => openDialog(r, 'in_review')}>En revisión</Button>}
              {isOpen(r) ? (
                <>
                  <Button size="sm" variant="secondary" onClick={() => openDialog(r, 'resolved')}>Resolver</Button>
                  <Button size="sm" variant="ghost" onClick={() => openDialog(r, 'rejected')}>Rechazar</Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => openDialog(r, 'in_review')}><RotateCcw size={14} aria-hidden="true" /> Reabrir</Button>
              )}
            </div>
          )}
          toolbar={(
            <FilterBar
              search={{ placeholder: 'Correo, nombre o detalle…', label: 'Buscar solicitudes' }}
              tabs={{ paramKey: 'estado', options: TABS, allLabel: null, label: 'Filtrar por estado' }}
              selects={[
                { key: 'tipo', label: 'Derecho', options: TYPE_OPTIONS, allLabel: 'Todos los derechos' },
                { key: 'vencidas', label: 'Plazo', options: OVERDUE_OPTIONS, allLabel: 'Cualquier plazo' },
              ]}
              dateRange={{ idPrefix: 'arco' }}
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
              onAction={setBulkAction}
              itemLabel="solicitudes"
              busy={bulk.isPending}
              exportMenu={<ExportMenu label="Exportar seleccionadas" filenamePrefix="solicitudes_arco" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
            />
          )}
          empty={{ icon: ShieldCheck, title: 'Sin solicitudes', description: 'Cuando una familia ejerza sus derechos ARCO aparecerá aquí con su fecha límite.' }}
        />
      </Card>

      <BulkConfirmDialog
        open={!!bulkAction}
        onClose={() => setBulkAction(null)}
        action={bulkAction}
        entityLabel="solicitudes"
        ids={selection.ids}
        allMatching={selection.allMatching}
        filters={{ q: filters.q, status: filters.status, type: filters.type, overdue: filters.overdue, from: filters.from, to: filters.to }}
        execute={bulk.run}
        onDone={(r) => { if (r.ok > 0) selection.onClear(); }}
      />

      <IntakeModal open={intake} onClose={() => setIntake(false)} onSaved={() => { setIntake(false); invalidate(); }} />
      <Modal open={!!resolving} onClose={() => setResolving(null)} title={dialogTitle} maxWidth={480}>
        <div className="space-y-3">
          <p className="text-sm text-muted">
            {resolving?.status === 'in_review'
              ? reopening ? 'La solicitud vuelve a la cola abierta. El motivo queda en la bitácora de auditoría.' : 'Sin correo al solicitante.'
              : 'El solicitante recibirá un correo con esta nota.'}
          </p>
          {noteRequired && (
            <div>
              <label className="label" htmlFor="arco-note">
                {resolving?.status === 'rejected' ? 'Motivo (obligatorio)' : reopening ? 'Motivo de la reapertura (obligatorio)' : 'Qué se hizo (obligatorio)'}
              </label>
              <textarea id="arco-note" className="input-field" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setResolving(null)}>Cancelar</Button>
            <Button onClick={submitStatus} loading={setStatus.isPending} disabled={noteRequired && !note.trim()}>Confirmar</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function IntakeModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ requester_email: '', requester_name: '', request_type: 'access', channel: 'email', details: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: () => legalApi.adminIntakeArco(form),
    onSuccess: () => { toast.success('Solicitud registrada; se envió acuse con la fecha límite.'); setForm({ requester_email: '', requester_name: '', request_type: 'access', channel: 'email', details: '' }); onSaved(); },
    onError: (e) => setErrors(apiFieldErrors(e)),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setErrors({}); create.mutate(); };
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Modal open={open} onClose={onClose} title="Registrar solicitud recibida" maxWidth={520}>
      <form onSubmit={submit} className="space-y-3">
        <Input label="Correo del solicitante" type="email" required value={form.requester_email} onChange={(e) => set('requester_email', e.target.value)} error={errors.requester_email} />
        <Input label="Nombre (opcional)" value={form.requester_name} onChange={(e) => set('requester_name', e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="arco-type">Derecho</label><select id="arco-type" className="input-field" value={form.request_type} onChange={(e) => set('request_type', e.target.value)}>{Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div><label className="label" htmlFor="arco-channel">Llegó por</label><select id="arco-channel" className="input-field" value={form.channel} onChange={(e) => set('channel', e.target.value)}>{Object.entries(CHANNEL).filter(([k]) => k !== 'portal').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        </div>
        <div><label className="label" htmlFor="arco-details">Detalle de la solicitud</label><textarea id="arco-details" className="input-field" rows={3} value={form.details} onChange={(e) => set('details', e.target.value)} /></div>
        {errors.detail && <p className="text-sm text-coral-600">{errors.detail}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={create.isPending}>Registrar y enviar acuse</Button></div>
      </form>
    </Modal>
  );
}
