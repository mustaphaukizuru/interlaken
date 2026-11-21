import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ClipboardList, FileUp, FolderOpen, GraduationCap, Hourglass, KanbanSquare, UserPlus } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
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
import { FichaRowMenu, FichasZipMenu } from '@/components/admin/FichaDownloads';
import { StageChip } from '@/components/admin/admissions/StageChip';
import { NewProspectDialog } from '@/components/admin/admissions/NewProspectDialog';
import { fichaExportExtras } from '@/hooks/queries/fichaExports';
import { useUrlFilters, useUrlPage } from '@/hooks/useUrlFilters';
import { useRowSelection } from '@/hooks/useRowSelection';
import {
  PREREG_ENTITY, preRegistrationImportApi, useRegistrationBulk, useRegistrationExport, useRegistrationList,
  type RegistrationParams, type RegistrationRow,
} from '@/hooks/queries/admissions';
import { CASES_ENTITY, casesApi, useCaseList, type CaseListParams, type CaseRow } from '@/hooks/queries/cases';
import { useExport } from '@/hooks/queries/dataOpsHooks';
import { PREREG_LEVELS, STATUS_BADGE } from '@/lib/admissionsStatus';
import { ALL_STAGES, STAGE_TABS, isStale, waitingText } from '@/lib/caseStages';
import { idsParam, type BulkActionDef, type ExportFormat } from '@/services/dataOps';

const fmtDate = (iso: string | null | undefined) => (iso ? format(new Date(iso), 'd MMM yyyy', { locale: es }) : '—');

/** The running cycle and its neighbours ("2026-2027"), for the cycle filter. */
function cycleOptions(now = new Date()) {
  const y = now.getFullYear();
  return [y + 1, y, y - 1, y - 2].map((s) => ({ value: `${s}-${s + 1}`, label: `${s}-${s + 1}` }));
}

// Every filter param the two sections own; switching section clears them all.
const SECTION_PARAMS = ['q', 'etapa', 'estado', 'nivel', 'ciclo', 'visita', 'docs', 'desde', 'hasta', 'orden', 'page'];

type View = 'pre' | 'inscripciones';

/**
 * /admin/admisiones — the admission cases («Expedientes», Fase 5) and the
 * inscripciones (fichas) on the Data Ops table.
 */
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
        subtitle="Cada prospecto, de la primera llamada a la inscripción, y las fichas que envían las familias."
        actions={(
          <Link to="/admin/admisiones/pipeline" className="btn-secondary inline-flex min-h-[44px] items-center gap-2">
            <KanbanSquare size={16} aria-hidden="true" /> Pipeline
          </Link>
        )}
      />

      <div role="tablist" aria-label="Sección de admisiones" className="flex flex-wrap gap-2">
        {tab('pre', 'Expedientes', FolderOpen)}
        {tab('inscripciones', 'Inscripciones', GraduationCap)}
      </div>

      <div role="tabpanel" id={`adm-panel-${view}`} aria-labelledby={`adm-tab-${view}`}>
        {view === 'pre' ? <CasesSection /> : <RegistrationsSection onReview={setReviewId} />}
      </div>

      <RegistrationReviewModal id={reviewId} open={reviewId != null} onClose={() => setReviewId(null)} />
    </div>
  );
}

// ── Expedientes ──────────────────────────────────────────────────────────

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

/** The pre-registro export knows these orderings; the others export in its default order. */
const EXPORT_ORDERING = new Set(['created_at', '-created_at', 'child', '-child']);

/**
 * The admission cases (Fase 5) on the Data Ops table: stage chips with their
 * counts, child, tutor, grade and cycle, the stage, the next step and how
 * long the case has waited; a row opens its Expediente.
 *
 * The legacy bulk status actions («Marcar contactados / inscritos», «No
 * procedió», «Regresar a pendiente») and the row «Invitar» are gone: they
 * moved the stage without its outcome, skipped the «Marcar como inscrito»
 * gates, closed without a reason or sent the ficha before the exam. Each
 * now lives in the Expediente. Export (stage filter + «Etapa» column) and
 * the fair-sheet import stay.
 */
function CasesSection() {
  const navigate = useNavigate();
  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const sort = parseSort(get('orden'));
  const filters: Omit<CaseListParams, 'page'> = {
    q: get('q') || undefined,
    stage: get('etapa') || undefined,
    level: get('nivel') || undefined,
    cycle: get('ciclo') || undefined,
    from: get('desde') || undefined,
    to: get('hasta') || undefined,
    ordering: serializeSort(sort) || undefined,
  };
  const { data, isLoading, isError, refetch } = useCaseList({ page, ...filters });
  const rows = data?.results;
  const count = data?.count ?? 0;
  const counts = data?.counts ?? {};
  const allCount = ALL_STAGES.reduce((n, s) => n + (counts[s] ?? 0), 0);
  const selection = useRowSelection(count, JSON.stringify(filters));
  const onSort = (next: SortState) => set({ orden: serializeSort(next), page: null });
  const exportCases = useExport(CASES_ENTITY, casesApi.export);
  const [importOpen, setImportOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const fetchExport = (fmt: ExportFormat, { selectedOnly }: { selectedOnly: boolean }) =>
    exportCases.mutateAsync({
      q: filters.q, stage: filters.stage, level: filters.level, cycle: filters.cycle, from: filters.from, to: filters.to,
      ordering: filters.ordering && EXPORT_ORDERING.has(filters.ordering) ? filters.ordering : undefined,
      fmt,
      ids: selectedOnly && !selection.allMatching ? idsParam(selection.ids) : undefined,
    });

  const open = (row: CaseRow) => navigate(`/admin/admisiones/${row.id}`);

  const columns: Column<CaseRow>[] = [
    {
      id: 'child', header: 'Alumno', sortKey: 'child', hideable: false, minWidth: 170,
      cell: (c) => (
        <Link to={`/admin/admisiones/${c.id}`} className="font-semibold text-ink hover:text-purple hover:underline">{c.child_name}</Link>
      ),
    },
    {
      id: 'parent', header: 'Tutor', minWidth: 170,
      cell: (c) => (
        <>
          <div className="text-ink">{c.parent_name}</div>
          <div className="text-xs text-subtle">{c.parent_phone}</div>
        </>
      ),
    },
    {
      id: 'grade', header: 'Grado y ciclo', minWidth: 130,
      cell: (c) => (
        <>
          <div className="whitespace-nowrap text-muted">{c.grade_applying}</div>
          <div className="text-xs text-subtle">{c.cycle}</div>
        </>
      ),
    },
    { id: 'stage', header: 'Etapa', sortKey: 'stage', minWidth: 150, cell: (c) => <StageChip stage={c.stage} outcome={c.closed_outcome_label} short /> },
    {
      id: 'next', header: 'Siguiente paso', minWidth: 190,
      cell: (c) => (c.next_action ? <span className="text-sm text-ink">{c.next_action.label}</span> : ''),
    },
    {
      id: 'waiting', header: 'En la etapa', sortKey: 'stage_changed_at', minWidth: 110,
      cell: (c) => (c.stage === 'inscrito' || c.stage === 'cerrado' ? '' : (
        <span className={`inline-flex items-center gap-1 whitespace-nowrap ${isStale(c.days_waiting) ? 'font-semibold text-amber' : 'text-muted'}`}>
          {isStale(c.days_waiting) && <Hourglass size={13} aria-hidden="true" />}
          {waitingText(c.days_waiting)}
        </span>
      )),
    },
    { id: 'date', header: 'Alta', sortKey: 'created_at', minWidth: 110, defaultHidden: true, className: 'text-subtle whitespace-nowrap', cell: (c) => fmtDate(c.created_at) },
    { id: 'email', header: 'Correo', minWidth: 180, defaultHidden: true, truncate: 220, className: 'text-muted', cell: (c) => c.parent_email },
  ];

  const filtered = !!(filters.q || filters.stage || filters.level || filters.cycle || filters.from || filters.to);

  return (
    <Card
      title={`${count.toLocaleString('es-MX')} ${count === 1 ? 'expediente' : 'expedientes'}`}
      action={(
        <Button type="button" onClick={() => setCreating(true)}>
          <UserPlus size={16} aria-hidden="true" /> Nuevo prospecto
        </Button>
      )}
    >
      <DataTable<CaseRow>
        tableId="admissions-cases"
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        rowLabel={(c) => `expediente de ${c.child_name}`}
        caption="Expedientes de admisión"
        sort={sort}
        onSort={onSort}
        page={page}
        count={count}
        onPage={setPage}
        itemLabel="expedientes"
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        columnControls
        resizable
        pinFirstColumn
        selection={selection}
        onRowClick={open}
        toolbar={(
          <FilterBar
            search={{ placeholder: 'Alumno, tutor, correo, teléfono o colegio…', label: 'Buscar expedientes' }}
            tabs={{
              paramKey: 'etapa',
              options: STAGE_TABS.map((t) => ({ ...t, count: counts[t.value] ?? 0 })),
              allLabel: 'Todos',
              allCount,
              label: 'Filtrar por etapa',
            }}
            selects={[
              { key: 'nivel', label: 'Nivel', options: PREREG_LEVELS, allLabel: 'Todos los niveles' },
              { key: 'ciclo', label: 'Ciclo', options: cycleOptions(), allLabel: 'Todos los ciclos' },
            ]}
            dateRange={{ idPrefix: 'expedientes' }}
          >
            <ExportMenu filenamePrefix="expedientes" selectedCount={selection.count} fetch={fetchExport} />
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
            itemLabel="expedientes"
            gender="m"
            exportMenu={<ExportMenu label="Exportar seleccionados" filenamePrefix="expedientes" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
          />
        )}
        empty={{
          icon: ClipboardList,
          title: filtered ? 'Sin resultados' : 'Sin expedientes',
          description: filtered
            ? 'Ningún expediente coincide con los filtros.'
            : 'Registre la primera llamada con «Nuevo prospecto»; los pre-registros del sitio también llegan aquí.',
        }}
      />

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Importar pre-registros"
        entity={PREREG_ENTITY}
        api={preRegistrationImportApi}
        headers={IMPORT_HEADERS}
        templatePrefix="plantilla_pre-registros"
        description="Hojas de registro de ferias y eventos. Cada fila crea un expediente en «Informes» del ciclo actual; no se envían correos. Los duplicados solo se avisan. Fecha de nacimiento en formato DD/MM/AAAA."
      />
      <NewProspectDialog open={creating} onClose={() => setCreating(false)} />
    </Card>
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
  // Fase 3: «Concentrado de fichas» and the blank form ride in the Exportar menu.
  const fichaExtras = fichaExportExtras(filters, selection.allMatching ? undefined : idsParam(selection.ids));
  const selectedIds = selection.ids.map(Number);

  const columns: Column<RegistrationRow>[] = [
    { id: 'child', header: 'Alumno', sortKey: 'child', hideable: false, minWidth: 160, className: 'font-medium text-ink', cell: (r) => r.child_name },
    {
      id: 'status', header: 'Estado', sortKey: 'status', minWidth: 120,
      cell: (r) => { const meta = STATUS_BADGE[r.status] ?? STATUS_BADGE.draft; return <Badge variant={meta.variant}>{meta.label}</Badge>; },
    },
    { id: 'submitted', header: 'Enviada', sortKey: 'submitted_at', minWidth: 110, className: 'text-subtle whitespace-nowrap', cell: (r) => fmtDate(r.submitted_at) },
    { id: 'grade', header: 'Grado', minWidth: 110, className: 'whitespace-nowrap text-muted', cell: (r) => r.grade_applying },
    { id: 'level', header: 'Nivel', sortKey: 'level', minWidth: 100, defaultHidden: true, className: 'text-muted capitalize', cell: (r) => r.level || '—' },
    { id: 'cycle', header: 'Ciclo', minWidth: 100, defaultHidden: true, className: 'text-muted whitespace-nowrap', cell: (r) => r.cycle },
    {
      id: 'parent', header: 'Tutor', minWidth: 180,
      cell: (r) => (
        <>
          <div className="text-muted">{r.parent1_name}</div>
          <div className="max-w-[240px] truncate text-xs text-subtle" title={r.parent1_email}>{r.parent1_email}</div>
        </>
      ),
    },
    { id: 'curp', header: 'CURP', minWidth: 150, defaultHidden: true, className: 'font-mono text-xs text-subtle', cell: (r) => r.child_curp || '—' },
    { id: 'docs', header: 'Docs', label: 'Documentos verificados', align: 'right', minWidth: 70, className: 'text-muted', cell: (r) => `${r.doc_verified}/${r.doc_count}` },
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
          <>
            <button type="button" onClick={() => onReview(r.id)} aria-label={`Revisar expediente de ${r.child_name}`}
              className="inline-flex min-h-[44px] items-center rounded-lg bg-cream px-3 text-xs font-semibold text-ink hover:bg-line sm:min-h-[36px]">
              Revisar
            </button>
            {r.pre_registration ? (
              <Link to={`/admin/admisiones/${r.pre_registration}`} aria-label={`Abrir el expediente de admisión de ${r.child_name}`}
                className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-3 text-xs font-semibold text-purple hover:bg-purple/5 sm:min-h-[36px]">
                <FolderOpen size={14} aria-hidden="true" /> Expediente
              </Link>
            ) : null}
            <FichaRowMenu id={r.id} childName={r.child_name} />
          </>
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
            <ExportMenu filenamePrefix="inscripciones" selectedCount={selection.count} fetch={fetchExport} extraItems={fichaExtras} />
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
            exportMenu={(
              <>
                <ExportMenu label="Exportar seleccionadas" filenamePrefix="inscripciones" selectedCount={selection.count} forceSelected fetch={fetchExport} />
                <FichasZipMenu ids={selectedIds} allMatching={selection.allMatching} />
              </>
            )}
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
        Cada ficha se inscribe desde su expediente de admisión, con «Marcar como inscrito» en la etapa «Inscripción».
      </p>
    </Card>
  );
}
