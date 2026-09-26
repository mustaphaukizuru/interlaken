import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ClipboardList, Copy, FileUp, GraduationCap, KanbanSquare, Send, X } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { parseSort, serializeSort, type SortState } from '@/components/ui/SortableTh';
import { ExportMenu } from '@/components/admin/ExportMenu';
import { FilterBar } from '@/components/admin/FilterBar';
import { BulkActionBar } from '@/components/admin/BulkActionBar';
import { BulkConfirmDialog } from '@/components/admin/BulkConfirmDialog';
import { ImportDialog, type ImportHeader } from '@/components/admin/ImportDialog';
import { RegistrationReviewModal } from '@/components/admin/RegistrationReviewModal';
import { useUrlFilters, useUrlPage } from '@/hooks/useUrlFilters';
import { useRowSelection } from '@/hooks/useRowSelection';
import {
  PREREG_ENTITY, preRegistrationImportApi, usePreRegistrationBulk, usePreRegistrationExport,
  usePreRegistrationInvite, usePreRegistrationList, usePreRegistrationStatus, useRegistrationBulk,
  useRegistrationExport, useRegistrationList,
  type PreRegistrationParams, type PreRegistrationRow, type RegistrationParams, type RegistrationRow,
} from '@/hooks/queries/admissions';
import { apiErrorMessage } from '@/lib/apiErrors';
import {
  PREREG_LEVELS, PREREG_STATUS, PREREG_TRANSITIONS, STATUS_BADGE, isReverseTransition,
} from '@/lib/admissionsStatus';
import { idsParam, type BulkActionDef, type BulkRequest, type ExportFormat } from '@/services/dataOps';

async function copyToClipboard(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

const fmtDate = (iso: string | null | undefined) => (iso ? format(new Date(iso), 'd MMM yyyy', { locale: es }) : '—');

/** The running cycle and its neighbours ("2026-2027"), for the cycle filter. */
function cycleOptions(now = new Date()) {
  const y = now.getFullYear();
  return [y + 1, y, y - 1, y - 2].map((s) => ({ value: `${s}-${s + 1}`, label: `${s}-${s + 1}` }));
}

// Every filter param the two sections own; switching section clears them all.
const SECTION_PARAMS = ['q', 'estado', 'nivel', 'ciclo', 'visita', 'docs', 'desde', 'hasta', 'orden', 'page'];

type View = 'pre' | 'inscripciones';

/** /admin/admisiones — pre-registros and inscripciones on the Data Ops table (Phase 4). */
export default function AdminAdmissions() {
  const { get, set } = useUrlFilters();
  const view: View = get('vista') === 'inscripciones' ? 'inscripciones' : 'pre';
  const [reviewId, setReviewId] = useState<number | null>(null);

  // ?inscripcion=<id> deep link (pipeline card → review modal); consumed once.
  const [searchParams, setSearchParams] = useSearchParams();
  const wantsReview = searchParams.get('inscripcion');
  useEffect(() => {
    if (!wantsReview) return;
    const id = Number(wantsReview);
    // Suppressed: one-shot URL command consumed (deleted) right after.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (Number.isInteger(id) && id > 0) setReviewId(id);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('inscripcion');
      next.set('vista', 'inscripciones');
      return next;
    }, { replace: true });
  }, [wantsReview, setSearchParams]);

  const switchTo = (next: View) => {
    if (next === view) return;
    const updates: Record<string, string | null> = Object.fromEntries(SECTION_PARAMS.map((k) => [k, null]));
    updates.vista = next === 'pre' ? null : 'inscripciones';
    set(updates);
  };

  const tabRefs = useRef<Record<View, HTMLButtonElement | null>>({ pre: null, inscripciones: null });
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next: View = view === 'pre' ? 'inscripciones' : 'pre';
    switchTo(next);
    tabRefs.current[next]?.focus();
  };

  const tab = (value: View, label: string, Icon: typeof ClipboardList) => (
    <button
      ref={(el) => { tabRefs.current[value] = el; }}
      type="button"
      role="tab"
      id={`adm-tab-${value}`}
      aria-selected={view === value}
      aria-controls={`adm-panel-${value}`}
      tabIndex={view === value ? 0 : -1}
      onClick={() => switchTo(value)}
      onKeyDown={onTabKey}
      className={`inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 ${
        view === value ? 'bg-purple text-white' : 'bg-white text-muted ring-1 ring-line hover:text-ink'
      }`}
    >
      <Icon size={16} aria-hidden="true" /> {label}
    </button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admisiones"
        subtitle="Pre-registros e inscripciones recibidas."
        actions={(
          <Link to="/admin/admisiones/pipeline" className="btn-secondary inline-flex min-h-[44px] items-center gap-2">
            <KanbanSquare size={16} aria-hidden="true" /> Pipeline
          </Link>
        )}
      />

      <div role="tablist" aria-label="Sección de admisiones" className="flex flex-wrap gap-2">
        {tab('pre', 'Pre-registros', ClipboardList)}
        {tab('inscripciones', 'Inscripciones', GraduationCap)}
      </div>

      <div role="tabpanel" id={`adm-panel-${view}`} aria-labelledby={`adm-tab-${view}`}>
        {view === 'pre' ? <PreRegistrationsSection /> : <RegistrationsSection onReview={setReviewId} />}
      </div>

      <RegistrationReviewModal id={reviewId} open={reviewId != null} onClose={() => setReviewId(null)} />
    </div>
  );
}

// ── Pre-registros ─────────────────────────────────────────────────────────

const PREREG_STATUS_OPTIONS = Object.entries(PREREG_STATUS).map(([value, m]) => ({ value, label: m.label }));

const IMPORT_HEADERS: ImportHeader[] = [
  { key: 'nombre_alumno', required: true },
  { key: 'apellidos_alumno', required: true },
  { key: 'fecha_nacimiento', required: true },
  { key: 'nivel' },
  { key: 'grado', required: true },
  { key: 'nombre_tutor', required: true },
  { key: 'correo', required: true },
  { key: 'telefono' },
  { key: 'origen' },
  { key: 'mensaje' },
];

/** Bulk status actions share one API action (`set_status`); the target rides in the name. */
const statusAction = (target: string, label: string, extra: Partial<BulkActionDef> = {}): BulkActionDef => ({
  name: `status:${target}`, label, ...extra,
});

const PREREG_ACTIONS: BulkActionDef[] = [
  statusAction('contacted', 'Marcar contactados', { planVerb: 'Se marcarán como contactados' }),
  { name: 'invite', label: 'Invitar a inscripción', planVerb: 'Se enviará la invitación a' },
  statusAction('enrolled', 'Marcar inscritos', { planVerb: 'Se marcarán como inscritos' }),
  statusAction('rejected', 'No procedió', { danger: true, planVerb: 'Se marcarán como «No procedió»' }),
  statusAction('pending', 'Regresar a pendiente', { requiresNote: true, planVerb: 'Regresarán a pendiente' }),
];

/** Turn the UI action into the API body (`status:<target>` → `set_status` + payload.status). */
function preRegBody(body: BulkRequest): BulkRequest {
  if (!body.action.startsWith('status:')) return body;
  return { ...body, action: 'set_status', payload: { ...(body.payload ?? {}), status: body.action.slice('status:'.length) } };
}

function PreRegistrationsSection() {
  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const sort = parseSort(get('orden'));
  const filters: Omit<PreRegistrationParams, 'page'> = {
    q: get('q') || undefined,
    status: get('estado') || undefined,
    level: get('nivel') || undefined,
    cycle: get('ciclo') || undefined,
    wants_visit: get('visita') || undefined,
    from: get('desde') || undefined,
    to: get('hasta') || undefined,
    ordering: serializeSort(sort) || undefined,
  };
  const { data, isLoading, isError, refetch } = usePreRegistrationList({ page, ...filters });
  const rows = data?.results;
  const count = data?.count ?? 0;
  const selection = useRowSelection(count, JSON.stringify(filters));
  const onSort = (next: SortState) => set({ orden: serializeSort(next), page: null });

  const exportPre = usePreRegistrationExport();
  const bulk = usePreRegistrationBulk();
  const updateStatus = usePreRegistrationStatus();
  const invite = usePreRegistrationInvite();

  const [bulkAction, setBulkAction] = useState<BulkActionDef | null>(null);
  // A single-row reverse transition (needs a note) reuses the bulk dialog for that one row.
  const [rowTarget, setRowTarget] = useState<{ id: number; action: BulkActionDef } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [invitedLink, setInvitedLink] = useState<{ name: string; url: string } | null>(null);

  const fetchExport = (fmt: ExportFormat, { selectedOnly }: { selectedOnly: boolean }) =>
    exportPre.mutateAsync({ ...filters, fmt, ids: selectedOnly && !selection.allMatching ? idsParam(selection.ids) : undefined });

  const changeStatus = (row: PreRegistrationRow, target: string) => {
    if (isReverseTransition('preregistration', row.status, target)) {
      const def = PREREG_ACTIONS.find((a) => a.name === `status:${target}`);
      if (def) setRowTarget({ id: row.id, action: def });
      return;
    }
    updateStatus.mutate({ id: row.id, status: target }, {
      onSuccess: () => toast.success('Estado actualizado.'),
      onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo actualizar el estado.')),
    });
  };

  const doInvite = (row: PreRegistrationRow) =>
    invite.mutate({ id: row.id, name: row.child_name }, {
      onSuccess: async ({ data: res }) => {
        const url = res.invite_url as string;
        const copied = await copyToClipboard(url);
        setInvitedLink({ name: row.child_name, url });
        toast.success(copied ? 'Invitación generada. Enlace copiado.' : 'Invitación generada.');
      },
      onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo generar la invitación.')),
    });
  const invitingId = invite.isPending ? invite.variables?.id : undefined;
  const savingId = updateStatus.isPending ? updateStatus.variables?.id : undefined;

  const columns: Column<PreRegistrationRow>[] = [
    { id: 'child', header: 'Alumno', sortKey: 'child', hideable: false, minWidth: 160, className: 'font-medium text-ink', cell: (p) => p.child_name },
    { id: 'grade', header: 'Grado', sortKey: 'grade', minWidth: 110, className: 'text-muted', cell: (p) => p.grade_applying },
    { id: 'level', header: 'Nivel', sortKey: 'level', minWidth: 100, defaultHidden: true, className: 'text-muted', cell: (p) => PREREG_LEVELS.find((l) => l.value === p.level)?.label ?? p.level },
    { id: 'cycle', header: 'Ciclo', minWidth: 100, defaultHidden: true, className: 'text-muted whitespace-nowrap', cell: (p) => p.cycle ?? '—' },
    { id: 'parent', header: 'Tutor', sortKey: 'parent', minWidth: 140, className: 'text-muted', cell: (p) => p.parent_name },
    {
      id: 'contact', header: 'Contacto', minWidth: 180,
      cell: (p) => (
        <>
          <div className="break-all text-muted">{p.parent_email}</div>
          <div className="text-xs text-subtle">{p.parent_phone}</div>
        </>
      ),
    },
    { id: 'visit', header: 'Visita', minWidth: 80, defaultHidden: true, className: 'text-muted', cell: (p) => (p.wants_visit ? 'Sí' : 'No') },
    { id: 'source', header: 'Origen', minWidth: 120, defaultHidden: true, className: 'text-muted', cell: (p) => p.referral_source || '—' },
    { id: 'date', header: 'Fecha', sortKey: 'created_at', minWidth: 110, className: 'text-subtle whitespace-nowrap', cell: (p) => fmtDate(p.created_at) },
    {
      id: 'status', header: 'Estado', sortKey: 'status', minWidth: 140,
      cell: (p) => <StatusSelect row={p} disabled={savingId === p.id} onChange={(t) => changeStatus(p, t)} />,
    },
  ];

  return (
    <Card title={`${count.toLocaleString('es-MX')} pre-registros`}>
      {invitedLink && (
        <div className="mb-4 rounded-xl2 border border-brand-600/25 bg-brand-50 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">
                Invitación generada{invitedLink.name ? ` para ${invitedLink.name}` : ''}
              </p>
              <p className="mt-1 break-all text-xs text-muted">{invitedLink.url}</p>
              <p className="mt-1 text-xs text-subtle">También se envió por correo al tutor. Comparta el enlace por WhatsApp si lo prefiere.</p>
            </div>
            <button type="button" onClick={() => setInvitedLink(null)} aria-label="Descartar"
              className="-mr-1 -mt-1 inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg p-1 text-subtle hover:bg-white hover:text-ink">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <button type="button" onClick={() => copyToClipboard(invitedLink.url).then((ok) => ok && toast.success('Enlace copiado.'))}
            className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-brand-700 ring-1 ring-brand-600/20 hover:bg-brand-50">
            <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copiar enlace
          </button>
        </div>
      )}

      <DataTable<PreRegistrationRow>
        tableId="admissions-preregistrations"
        columns={columns}
        rows={rows}
        rowKey={(p) => p.id}
        rowLabel={(p) => `pre-registro de ${p.child_name}`}
        caption="Pre-registros"
        sort={sort}
        onSort={onSort}
        page={page}
        count={count}
        onPage={setPage}
        itemLabel="pre-registros"
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        columnControls
        resizable
        pinFirstColumn
        selection={selection}
        rowActions={(p) => (
          <button type="button" disabled={invitingId === p.id || p.status === 'enrolled' || p.status === 'rejected'}
            onClick={() => doInvite(p)}
            aria-label={`Invitar a inscripción: ${p.child_name}`}
            className="inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-lg bg-purple/10 px-3 text-xs font-semibold text-purple hover:bg-purple/15 disabled:opacity-50 sm:min-h-[36px]">
            <Send className="h-3.5 w-3.5" aria-hidden="true" /> {invitingId === p.id ? 'Generando…' : 'Invitar'}
          </button>
        )}
        toolbar={(
          <FilterBar
            search={{ placeholder: 'Alumno, tutor, correo o teléfono…', label: 'Buscar pre-registros' }}
            tabs={{ paramKey: 'estado', options: PREREG_STATUS_OPTIONS, allLabel: 'Todos', label: 'Filtrar por estado' }}
            selects={[
              { key: 'nivel', label: 'Nivel', options: PREREG_LEVELS, allLabel: 'Todos los niveles' },
              { key: 'ciclo', label: 'Ciclo', options: cycleOptions(), allLabel: 'Todos los ciclos' },
              { key: 'visita', label: 'Visita', options: [{ value: 'true', label: 'Desea visita' }, { value: 'false', label: 'Sin visita' }], allLabel: 'Visita: todos' },
            ]}
            dateRange={{ idPrefix: 'prereg' }}
          >
            <ExportMenu filenamePrefix="pre-registros" selectedCount={selection.count} fetch={fetchExport} />
            <button type="button" onClick={() => setImportOpen(true)} className="btn-secondary inline-flex min-h-[44px] items-center gap-2">
              <FileUp size={16} aria-hidden="true" /> Importar
            </button>
          </FilterBar>
        )}
        bulkBar={(
          <BulkActionBar
            count={selection.count}
            allMatching={selection.allMatching}
            allMatchingCount={count}
            onSelectAllMatching={selection.onSelectAllMatching}
            onClear={selection.onClear}
            itemLabel="pre-registros"
            gender="m"
            actions={PREREG_ACTIONS}
            onAction={setBulkAction}
            busy={bulk.isPending}
            exportMenu={<ExportMenu label="Exportar seleccionados" filenamePrefix="pre-registros" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
          />
        )}
        empty={{
          icon: ClipboardList,
          title: filters.q || filters.status || filters.level ? 'Sin resultados' : 'Sin pre-registros',
          description: filters.q || filters.status || filters.level
            ? 'Ningún pre-registro coincide con los filtros.'
            : 'Los pre-registros aparecerán aquí cuando se reciban.',
        }}
      />

      <BulkConfirmDialog
        open={!!bulkAction}
        onClose={() => setBulkAction(null)}
        action={bulkAction}
        entityLabel="pre-registros"
        gender="m"
        ids={selection.ids}
        allMatching={selection.allMatching}
        filters={{ ...filters, ordering: undefined }}
        execute={(body) => bulk.mutateAsync(preRegBody(body))}
        onDone={(r) => { if (!r.failed.length) selection.onClear(); }}
      />
      <BulkConfirmDialog
        open={!!rowTarget}
        onClose={() => setRowTarget(null)}
        action={rowTarget?.action ?? null}
        entityLabel="pre-registros"
        gender="m"
        ids={rowTarget ? [rowTarget.id] : []}
        execute={(body) => bulk.mutateAsync(preRegBody(body))}
      />

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Importar pre-registros"
        entity={PREREG_ENTITY}
        api={preRegistrationImportApi}
        headers={IMPORT_HEADERS}
        templatePrefix="plantilla_pre-registros"
        description="Hojas de registro de ferias y eventos. Cada fila crea un pre-registro pendiente del ciclo actual; no se envían correos. Los duplicados solo se avisan. Fecha de nacimiento en formato DD/MM/AAAA."
      />
    </Card>
  );
}

const VARIANT_CLASS: Record<string, string> = {
  warning: 'border-amber/40 text-amber',
  info:    'border-purple/40 text-purple',
  success: 'border-green/50 text-green-dark',
  error:   'border-coral/50 text-coral-dark',
};

/** Inline status control: only the transitions the table allows are offered. */
function StatusSelect({ row, onChange, disabled }: { row: PreRegistrationRow; onChange: (v: string) => void; disabled?: boolean }) {
  const meta = PREREG_STATUS[row.status] ?? PREREG_STATUS.pending;
  const targets = PREREG_TRANSITIONS[row.status] ?? [];
  return (
    <select
      value={row.status}
      disabled={disabled || targets.length === 0}
      onChange={(e) => onChange(e.target.value)}
      aria-label={`Cambiar estado del pre-registro de ${row.child_name}`}
      className={`min-h-[44px] rounded-lg border bg-white px-2 py-1 text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:opacity-60 sm:min-h-0 sm:text-xs ${VARIANT_CLASS[meta.variant] ?? 'border-line text-muted'}`}
    >
      <option value={row.status}>{meta.label}</option>
      {targets.map((t) => (
        <option key={t} value={t}>{PREREG_STATUS[t]?.label ?? t}</option>
      ))}
    </select>
  );
}

// ── Inscripciones ─────────────────────────────────────────────────────────

const REG_STATUS_OPTIONS = Object.entries(STATUS_BADGE).map(([value, m]) => ({ value, label: m.label }));

const REG_ACTIONS: BulkActionDef[] = [
  { name: 'approve', label: 'Aprobar', notifyOption: true, planVerb: 'Se aprobarán' },
  { name: 'request_docs', label: 'Solicitar documentos', planVerb: 'Se pedirán los documentos faltantes de' },
  { name: 'reviewing', label: 'Pasar a revisión', requiresNote: true, planVerb: 'Pasarán a revisión' },
  { name: 'reject', label: 'Rechazar', danger: true, requiresNote: true, notifyOption: true, planVerb: 'Se rechazarán' },
];

function RegistrationsSection({ onReview }: { onReview: (id: number) => void }) {
  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const sort = parseSort(get('orden'));
  const filters: Omit<RegistrationParams, 'page'> = {
    q: get('q') || undefined,
    status: get('estado') || undefined,
    level: get('nivel') || undefined,
    cycle: get('ciclo') || undefined,
    documents_pending: get('docs') || undefined,
    from: get('desde') || undefined,
    to: get('hasta') || undefined,
    ordering: serializeSort(sort) || undefined,
  };
  const { data, isLoading, isError, refetch } = useRegistrationList({ page, ...filters });
  const rows = data?.results;
  const count = data?.count ?? 0;
  const selection = useRowSelection(count, JSON.stringify(filters));
  const onSort = (next: SortState) => set({ orden: serializeSort(next), page: null });
  const exportRegs = useRegistrationExport();
  const bulk = useRegistrationBulk();
  const [bulkAction, setBulkAction] = useState<BulkActionDef | null>(null);

  const fetchExport = (fmt: ExportFormat, { selectedOnly }: { selectedOnly: boolean }) =>
    exportRegs.mutateAsync({ ...filters, fmt, ids: selectedOnly && !selection.allMatching ? idsParam(selection.ids) : undefined });

  const columns: Column<RegistrationRow>[] = [
    { id: 'child', header: 'Alumno', sortKey: 'child', hideable: false, minWidth: 160, className: 'font-medium text-ink', cell: (r) => r.child_name },
    { id: 'grade', header: 'Grado', minWidth: 110, className: 'text-muted', cell: (r) => r.grade_applying },
    { id: 'level', header: 'Nivel', sortKey: 'level', minWidth: 100, defaultHidden: true, className: 'text-muted capitalize', cell: (r) => r.level || '—' },
    { id: 'cycle', header: 'Ciclo', minWidth: 100, defaultHidden: true, className: 'text-muted whitespace-nowrap', cell: (r) => r.cycle },
    {
      id: 'parent', header: 'Tutor', minWidth: 180,
      cell: (r) => (
        <>
          <div className="text-muted">{r.parent1_name}</div>
          <div className="break-all text-xs text-subtle">{r.parent1_email}</div>
        </>
      ),
    },
    { id: 'curp', header: 'CURP', minWidth: 150, defaultHidden: true, className: 'font-mono text-xs text-subtle', cell: (r) => r.child_curp || '—' },
    { id: 'docs', header: 'Docs', minWidth: 70, className: 'text-muted whitespace-nowrap tabular-nums', cell: (r) => `${r.doc_verified}/${r.doc_count}` },
    {
      id: 'status', header: 'Estado', sortKey: 'status', minWidth: 120,
      cell: (r) => { const meta = STATUS_BADGE[r.status] ?? STATUS_BADGE.draft; return <Badge variant={meta.variant}>{meta.label}</Badge>; },
    },
    { id: 'submitted', header: 'Enviada', sortKey: 'submitted_at', minWidth: 110, className: 'text-subtle whitespace-nowrap', cell: (r) => fmtDate(r.submitted_at) },
    { id: 'created', header: 'Creada', sortKey: 'created_at', minWidth: 110, defaultHidden: true, className: 'text-subtle whitespace-nowrap', cell: (r) => fmtDate(r.created_at) },
    { id: 'updated', header: 'Actualizada', sortKey: 'updated_at', minWidth: 110, defaultHidden: true, className: 'text-subtle whitespace-nowrap', cell: (r) => fmtDate(r.updated_at) },
  ];

  return (
    <Card title={`${count.toLocaleString('es-MX')} inscripciones`} subtitle="Expedientes de inscripción para revisión y verificación de documentos.">
      <DataTable<RegistrationRow>
        tableId="admissions-registrations"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        rowLabel={(r) => `inscripción de ${r.child_name}`}
        caption="Inscripciones"
        sort={sort}
        onSort={onSort}
        page={page}
        count={count}
        onPage={setPage}
        itemLabel="inscripciones"
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        columnControls
        resizable
        pinFirstColumn
        selection={selection}
        rowActions={(r) => (
          <button type="button" onClick={() => onReview(r.id)} aria-label={`Revisar expediente de ${r.child_name}`}
            className="inline-flex min-h-[44px] items-center rounded-lg bg-cream px-3 text-xs font-semibold text-ink hover:bg-line sm:min-h-[36px]">
            Revisar
          </button>
        )}
        toolbar={(
          <FilterBar
            search={{ placeholder: 'Alumno, CURP, correo o teléfono…', label: 'Buscar inscripciones' }}
            tabs={{ paramKey: 'estado', options: REG_STATUS_OPTIONS, allLabel: 'Todas', label: 'Filtrar por estado' }}
            selects={[
              { key: 'nivel', label: 'Nivel', options: PREREG_LEVELS, allLabel: 'Todos los niveles' },
              { key: 'ciclo', label: 'Ciclo', options: cycleOptions(), allLabel: 'Todos los ciclos' },
              { key: 'docs', label: 'Documentos', options: [{ value: 'true', label: 'Con documentos pendientes' }, { value: 'false', label: 'Documentos completos' }], allLabel: 'Documentos: todos' },
            ]}
            dateRange={{ idPrefix: 'inscripciones' }}
          >
            <ExportMenu filenamePrefix="inscripciones" selectedCount={selection.count} fetch={fetchExport} />
          </FilterBar>
        )}
        bulkBar={(
          <BulkActionBar
            count={selection.count}
            allMatching={selection.allMatching}
            allMatchingCount={count}
            onSelectAllMatching={selection.onSelectAllMatching}
            onClear={selection.onClear}
            itemLabel="inscripciones"
            actions={REG_ACTIONS}
            onAction={setBulkAction}
            busy={bulk.isPending}
            exportMenu={<ExportMenu label="Exportar seleccionadas" filenamePrefix="inscripciones" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
          />
        )}
        empty={{
          icon: GraduationCap,
          title: filters.q || filters.status ? 'Sin resultados' : 'Sin inscripciones',
          description: filters.q || filters.status
            ? 'Ninguna inscripción coincide con los filtros.'
            : 'Las inscripciones enviadas por las familias aparecerán aquí para su revisión.',
        }}
      />

      <BulkConfirmDialog
        open={!!bulkAction}
        onClose={() => setBulkAction(null)}
        action={bulkAction}
        entityLabel="inscripciones"
        ids={selection.ids}
        allMatching={selection.allMatching}
        filters={{ ...filters, ordering: undefined }}
        execute={(body) => bulk.mutateAsync(body)}
        onDone={(r) => { if (!r.failed.length) selection.onClear(); }}
      />
      <p className="mt-3 text-xs text-subtle">
        Los expedientes aprobados se convierten en alumnos desde el{' '}
        <Link to="/admin/admisiones/pipeline" className="font-semibold text-purple hover:underline">pipeline</Link>.
      </p>
    </Card>
  );
}
