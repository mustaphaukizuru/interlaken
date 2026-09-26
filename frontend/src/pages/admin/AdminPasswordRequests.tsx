import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Check, Copy, MessageCircle, Mail, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { parseSort, serializeSort, type SortState } from '@/components/ui/SortableTh';
import { ExportMenu } from '@/components/admin/ExportMenu';
import { FilterBar } from '@/components/admin/FilterBar';
import { BulkActionBar } from '@/components/admin/BulkActionBar';
import { BulkConfirmDialog } from '@/components/admin/BulkConfirmDialog';
import { portalApi, type PasswordRequest, type PasswordRequestResolved } from '@/services/api';
import { idsParam, type BulkActionDef, type ExportFormat } from '@/services/dataOps';
import { mailtoDeliveryHref, whatsappDeliveryHref } from '@/lib/credentialTemplates';
import { apiErrorMessage } from '@/lib/apiErrors';
import { useUrlFilters, useUrlPage } from '@/hooks/useUrlFilters';
import { useRowSelection } from '@/hooks/useRowSelection';
import { adminKeys } from '@/hooks/queries/keys';
import {
  PASSWORD_REQUESTS_ENTITY, usePasswordRequestsBulk, usePasswordRequestsExport, usePasswordRequestsList,
  type PasswordRequestsListParams,
} from '@/hooks/queries/passwordRequests';

const CHANNEL: Record<string, string> = { whatsapp: 'WhatsApp', email: 'Correo', phone: 'Teléfono', in_person: 'Presencial' };
const CHANNEL_OPTIONS = Object.entries(CHANNEL).map(([value, label]) => ({ value, label }));
const STATUS: Record<string, { label: string; variant: 'warning' | 'success' | 'neutral' }> = {
  open: { label: 'Pendiente', variant: 'warning' },
  resolved: { label: 'Resuelta', variant: 'success' },
  rejected: { label: 'Rechazada', variant: 'neutral' },
};
/** No `estado` in the URL = the inbox (Pendientes); `todas` lifts the filter. */
const ALL = 'todas';
const BULK_ACTIONS: BulkActionDef[] = [
  { name: 'reject', label: 'Rechazar', danger: true, requiresNote: true, icon: XCircle, planVerb: 'Se rechazarán' },
];
const ROW_ACTION =
  'inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-purple hover:bg-cream-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-[36px]';

/**
 * /admin/contrasenas — password request inbox (BACKLOG P1-A4) on the Data Ops UI
 * foundation. Families cannot reset their own password; every WhatsApp/email/phone
 * request is logged here. "Generar contraseña" stays one row at a time (the
 * password is shown once); rejecting works in bulk with a required note.
 */
export default function AdminPasswordRequests() {
  const qc = useQueryClient();
  const [logOpen, setLogOpen] = useState(() => new URLSearchParams(window.location.search).get('nuevo') === '1');
  const [toReject, setToReject] = useState<PasswordRequest | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [toResolve, setToResolve] = useState<PasswordRequest | null>(null);
  const [resolved, setResolved] = useState<PasswordRequestResolved | null>(null);
  const [confirming, setConfirming] = useState<BulkActionDef | null>(null);

  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const estado = get('estado');
  const sort = parseSort(get('orden'));
  const filters: Omit<PasswordRequestsListParams, 'page'> = {
    q: get('q') || undefined,
    status: estado === ALL ? undefined : estado || 'open',
    channel: get('canal') || undefined,
    from: get('desde') || undefined,
    to: get('hasta') || undefined,
    ordering: serializeSort(sort) || undefined,
  };
  const { data, isLoading, isError, refetch } = usePasswordRequestsList({ page, ...filters });
  const exportRequests = usePasswordRequestsExport();
  const bulk = usePasswordRequestsBulk();
  const rows = data?.results;
  const count = data?.count ?? 0;
  const selection = useRowSelection(count, JSON.stringify(filters));
  const onSort = (next: SortState) => set({ orden: serializeSort(next), page: null });
  const invalidate = () => qc.invalidateQueries({ queryKey: adminKeys.entity(PASSWORD_REQUESTS_ENTITY) });

  const reject = useMutation({
    mutationFn: ({ r, note }: { r: PasswordRequest; note: string }) => portalApi.updatePasswordRequest(r.id, { action: 'reject', note: note.trim() || undefined }),
    onSuccess: () => { toast.success('Solicitud rechazada.'); setToReject(null); setRejectNote(''); invalidate(); },
    onError: (e: unknown) => toast.error(apiErrorMessage(e, 'No se pudo rechazar.')),
  });
  const resolve = useMutation({
    mutationFn: (r: PasswordRequest) =>
      portalApi.updatePasswordRequest(r.id, { action: 'resolve', delivered_via: r.channel }),
    onSuccess: ({ data }) => { setToResolve(null); setResolved(data as PasswordRequestResolved); invalidate(); },
    onError: (e: unknown) => toast.error(apiErrorMessage(e, 'No se pudo resolver la solicitud.')),
  });

  const fetchExport = (fmt: ExportFormat, { selectedOnly }: { selectedOnly: boolean }) =>
    exportRequests.mutateAsync({ ...filters, fmt, ids: selectedOnly && !selection.allMatching ? idsParam(selection.ids) : undefined });

  const openCount = data?.open_count;
  const tabs = [
    { value: '', label: 'Pendientes', count: openCount },
    { value: 'resolved', label: 'Resueltas' },
    { value: 'rejected', label: 'Rechazadas' },
    { value: ALL, label: 'Todas' },
  ];

  const columns: Column<PasswordRequest>[] = [
    {
      id: 'created_at', header: 'Fecha', sortKey: 'created_at', hideable: false, minWidth: 140, className: 'whitespace-nowrap text-xs text-muted',
      cell: (r) => new Date(r.created_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }),
    },
    {
      id: 'who', header: 'Cuenta', sortKey: 'requested_email', hideable: false, minWidth: 200,
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">
            {r.user_name || r.requester_name || r.requested_email}
            {!r.user && <span className="ml-2 text-xs font-normal text-coral-600">(sin cuenta vinculada)</span>}
          </p>
          <p className="truncate text-xs text-subtle">{r.user_email || r.requested_email}</p>
        </div>
      ),
    },
    { id: 'requester', header: 'Solicitante', minWidth: 130, className: 'text-xs text-muted', cell: (r) => r.requester_name || '—' },
    { id: 'channel', header: 'Canal', sortKey: 'channel', minWidth: 100, className: 'text-xs text-muted', cell: (r) => CHANNEL[r.channel] ?? r.channel },
    {
      id: 'status', header: 'Estado', sortKey: 'status', minWidth: 110,
      cell: (r) => <Badge variant={STATUS[r.status]?.variant ?? 'neutral'}>{STATUS[r.status]?.label ?? r.status}</Badge>,
    },
    { id: 'note', header: 'Nota', minWidth: 160, className: 'max-w-xs truncate text-xs text-muted', cell: (r) => <span title={r.note}>{r.note || '—'}</span> },
    {
      id: 'resolved', header: 'Atendió', sortKey: 'resolved_at', defaultHidden: true, minWidth: 140, className: 'text-xs text-subtle',
      cell: (r) => (r.resolved_at ? `${r.resolved_by_name || '—'} · ${new Date(r.resolved_at).toLocaleDateString('es-MX')}` : '—'),
    },
  ];

  const anyFilter = !!(filters.q || filters.channel || filters.from || filters.to);

  return (
    <>
      <PageHeader
        title="Solicitudes de contraseña"
        subtitle="Las familias piden su contraseña por WhatsApp o correo; aquí se registra y se resuelve cada solicitud."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setLogOpen(true)}><Plus size={16} aria-hidden="true" /> Registrar solicitud</Button>
            <ExportMenu filenamePrefix="solicitudes_contrasena" selectedCount={selection.count} fetch={fetchExport} />
          </div>
        )}
      />

      <Card>
        <DataTable<PasswordRequest>
          tableId="password-requests"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          rowLabel={(r) => `solicitud de ${r.user_email || r.requested_email}`}
          caption="Solicitudes de contraseña"
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
          selection={selection}
          rowActions={(r) => (r.status !== 'open' ? null : (
            <>
              <button type="button" className={ROW_ACTION} onClick={() => setToResolve(r)} disabled={!r.user} aria-label={`Generar contraseña para ${r.user_email || r.requested_email}`}>
                <KeyRound className="h-4 w-4" aria-hidden="true" /> Generar contraseña
              </button>
              <button type="button" className={ROW_ACTION} onClick={() => setToReject(r)} aria-label={`Rechazar la solicitud de ${r.user_email || r.requested_email}`}>
                <XCircle className="h-4 w-4" aria-hidden="true" /> Rechazar
              </button>
            </>
          ))}
          toolbar={(
            <FilterBar
              search={{ placeholder: 'Correo, solicitante o cuenta…', label: 'Buscar solicitudes' }}
              tabs={{ paramKey: 'estado', options: tabs, allLabel: null, label: 'Filtrar por estado' }}
              selects={[{ key: 'canal', label: 'Canal', options: CHANNEL_OPTIONS, allLabel: 'Todos los canales' }]}
              dateRange={{ idPrefix: 'contrasenas' }}
            />
          )}
          bulkBar={(
            <BulkActionBar
              count={selection.count}
              allMatching={selection.allMatching}
              allMatchingCount={count}
              onSelectAllMatching={selection.onSelectAllMatching}
              onClear={selection.onClear}
              itemLabel="solicitudes"
              actions={BULK_ACTIONS}
              onAction={setConfirming}
              busy={bulk.isPending}
              exportMenu={<ExportMenu label="Exportar seleccionadas" filenamePrefix="solicitudes_contrasena" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
            />
          )}
          empty={{
            icon: KeyRound,
            title: anyFilter ? 'Sin resultados' : 'Sin solicitudes',
            description: anyFilter ? 'Ninguna solicitud coincide con los filtros.' : 'Registre una solicitud cuando una familia pida su contraseña.',
          }}
        />
      </Card>

      <LogRequestModal open={logOpen} onClose={() => setLogOpen(false)} onSaved={invalidate} />
      <BulkConfirmDialog
        open={!!confirming}
        onClose={() => setConfirming(null)}
        action={confirming}
        entityLabel="solicitudes"
        ids={selection.ids}
        allMatching={selection.allMatching}
        filters={filters}
        execute={(body) => bulk.mutateAsync(body)}
        onDone={(r) => { if (!r.failed.length) selection.onClear(); }}
      />

      <Modal open={!!toReject} onClose={() => { setToReject(null); setRejectNote(''); }} title="Rechazar solicitud" maxWidth={440}>
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => { e.preventDefault(); if (toReject) reject.mutate({ r: toReject, note: rejectNote }); }}
        >
          <p className="text-sm text-muted">La solicitud quedará registrada como rechazada (por ejemplo, si no se pudo verificar la identidad).</p>
          <Input label="Motivo (opcional)" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} maxLength={300} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => { setToReject(null); setRejectNote(''); }}>Cancelar</Button>
            <Button type="submit" variant="danger" size="sm" loading={reject.isPending}>Rechazar</Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={!!toResolve}
        onClose={() => setToResolve(null)}
        onConfirm={() => toResolve && resolve.mutate(toResolve)}
        title="Generar nueva contraseña"
        message={`Se generará una contraseña temporal para ${toResolve?.user_email ?? ''} y se cerrarán sus sesiones abiertas. Verifique la identidad antes de continuar.`}
        confirmLabel="Generar"
        loading={resolve.isPending}
      />

      <DeliveryModal resolved={resolved} onClose={() => setResolved(null)} />
    </>
  );
}

function LogRequestModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Registrar solicitud" maxWidth={480}>
      <LogRequestForm key={String(open)} onClose={onClose} onSaved={onSaved} />
    </Modal>
  );
}

function LogRequestForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [channel, setChannel] = useState('whatsapp');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const create = useMutation({
    mutationFn: () => portalApi.createPasswordRequest({ requested_email: email.trim(), requester_name: name.trim(), channel, note: note.trim() }),
    onSuccess: ({ data }) => {
      toast.success(data.user ? 'Solicitud registrada.' : 'Registrada sin cuenta vinculada: verifique el correo.');
      onSaved(); onClose();
    },
    onError: () => toast.error('No se pudo registrar la solicitud.'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) { setError('Correo inválido.'); return; }
    create.mutate();
  };
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Input label="Correo de la cuenta" type="email" inputMode="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }} error={error} required />
      <Input label="Quién solicita" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del padre/tutor" />
      <div>
        <label className="label" htmlFor="pr-channel">Canal</label>
        <select id="pr-channel" className="input-field min-h-[44px]" value={channel} onChange={(e) => setChannel(e.target.value)}>
          {Object.entries(CHANNEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <Input label="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onClose} className="min-h-[44px]">Cancelar</Button>
        <Button type="submit" loading={create.isPending} className="min-h-[44px]">Registrar</Button>
      </div>
    </form>
  );
}

function DeliveryModal({ resolved, onClose }: { resolved: PasswordRequestResolved | null; onClose: () => void }) {
  const [copied, setCopied] = useState<'pw' | 'msg' | null>(null);
  if (!resolved) return null;
  const t = resolved.templates;
  const wa = whatsappDeliveryHref(resolved.whatsapp_number, t);
  const mail = mailtoDeliveryHref(resolved.user_email, t);
  const copy = async (what: 'pw' | 'msg') => {
    try {
      await navigator.clipboard.writeText(what === 'pw' ? resolved.temporary_password : t.whatsapp_text);
      setCopied(what); setTimeout(() => setCopied(null), 1500);
    } catch { toast.error('No se pudo copiar.'); }
  };
  return (
    <Modal open onClose={onClose} title="Contraseña generada" maxWidth={520}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Envíe el acceso a <strong>{resolved.user_name || resolved.user_email}</strong> por el mismo medio en que lo pidió.
          La contraseña <strong>no se volverá a mostrar</strong>.
        </p>
        <div className="rounded-2xl bg-cream/70 p-4 text-center">
          <code className="block select-all break-all font-mono text-xl font-bold tracking-wide text-ink">{resolved.temporary_password}</code>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" onClick={() => copy('pw')}>
            {copied === 'pw' ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />} Copiar contraseña
          </Button>
          <Button variant="secondary" onClick={() => copy('msg')}>
            {copied === 'msg' ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />} Copiar mensaje
          </Button>
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-secondary justify-center text-sm">
              <MessageCircle className="h-4 w-4" aria-hidden="true" /> Enviar por WhatsApp
            </a>
          )}
          <a href={mail} className="btn-outline justify-center text-sm">
            <Mail className="h-4 w-4" aria-hidden="true" /> Enviar por correo
          </a>
        </div>
        <textarea readOnly className="input-field h-40 text-xs" value={t.whatsapp_text} aria-label="Mensaje para la familia" />
        <Button className="w-full" onClick={onClose}>Listo, ya lo envié</Button>
      </div>
    </Modal>
  );
}
