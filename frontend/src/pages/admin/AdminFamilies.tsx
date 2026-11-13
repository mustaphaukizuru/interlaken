import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Lightbulb, Link2, Plus, Unlink, UsersRound, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { parseSort, serializeSort, type SortState } from '@/components/ui/SortableTh';
import { ExportMenu } from '@/components/admin/ExportMenu';
import { FilterBar } from '@/components/admin/FilterBar';
import { StatusTabs } from '@/components/admin/StatusTabs';
import { BulkActionBar } from '@/components/admin/BulkActionBar';
import { BulkConfirmDialog } from '@/components/admin/BulkConfirmDialog';
import { FamilyLinkDialog } from '@/components/admin/families/FamilyLinkDialog';
import { FamilyPanel } from '@/components/admin/families/FamilyPanel';
import { ReasonChips } from '@/components/admin/families/StudentFamily';
import { CONFIDENCE, fromFamilyStudent, gradeLine, type FamilyLinkMode, type PickedStudent } from '@/components/admin/families/familyUtils';
import { useUrlFilters, useUrlPage } from '@/hooks/useUrlFilters';
import { useRowSelection } from '@/hooks/useRowSelection';
import {
  useFamiliesBulk, useFamiliesExport, useFamiliesList, useFamily, useFamilySuggestions, useSuggestionsBulk,
} from '@/hooks/queries/families';
import { idsParam, type BulkActionDef, type ExportFormat } from '@/services/dataOps';
import type { FamiliesListParams, FamilyRow, FamilyStudent, FamilySuggestion, SuggestionConfidence } from '@/services/familiesApi';

const SUGGESTIONS = 'sugerencias';
const SIZE_OPTIONS = [
  { value: '2', label: '2 hermanos' },
  { value: '3', label: '3 hermanos' },
  { value: '4', label: '4 o más' },
];
const CONFIDENCE_OPTIONS = [
  { value: 'alta', label: 'Confianza alta' },
  { value: 'media', label: 'Confianza media' },
];
const FAMILY_ACTIONS: BulkActionDef[] = [
  { name: 'dissolve', label: 'Disolver', danger: true, icon: Unlink, planVerb: 'Se disolverán' },
];
const ACCEPT: BulkActionDef = { name: 'accept', label: 'Vincular', icon: Link2, planVerb: 'Se vincularán', notifyOption: true };
const DISMISS: BulkActionDef = { name: 'dismiss', label: 'No son hermanos', icon: XCircle, planVerb: 'Se descartarán' };
const ROW_ACTION =
  'inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-purple hover:bg-cream-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 lg:min-h-[36px]';


/** «Ana · 3° Primaria A» chips, each opening the child's file. */
function Kids({ students }: { students: FamilyStudent[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {students.map((s) => (
        <li key={s.id}>
          <Link to={`/admin/alumnos/${s.id}`} title={`${s.name} · ${gradeLine(s)} · ${s.student_id}`}
            className="inline-flex min-h-[32px] items-center gap-1 rounded-full bg-cream px-2.5 text-xs text-ink hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40">
            <span className="font-semibold">{s.first_name || s.name}</span>
            <span className="text-subtle">· {gradeLine(s)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * /admin/familias — hermanos (2026-11-13). Two views of one page:
 *
 * * Familias: every family with its children, the accounts that see them,
 *   search (family, child, matrícula), size filter, sort, export, bulk
 *   «Disolver», and a detail dialog to add, remove, rename or dissolve.
 * * Sugerencias: probable siblings (same tutor, confirmed personal email,
 *   phone, both surnames) to link or dismiss one by one or in bulk; every link
 *   goes through the same preview of who gains access.
 */
export default function AdminFamilies() {
  const { get } = useUrlFilters();
  const view = get('vista') === SUGGESTIONS ? SUGGESTIONS : '';
  const [creating, setCreating] = useState(false);
  const { data: suggestionCount } = useFamilySuggestions({});
  const { data: familyCount } = useFamiliesList({ page: 1, page_size: 1 });

  return (
    <>
      <PageHeader
        title="Familias"
        subtitle="Hermanos agrupados: con cualquiera de sus cuentas, la familia ve a todos sus hijos en el portal."
        actions={(
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden="true" /> Nueva familia
          </Button>
        )}
      />

      <StatusTabs
        paramKey="vista"
        allLabel={null}
        label="Vista"
        className="mb-4"
        options={[
          { value: '', label: 'Familias', count: familyCount?.count },
          { value: SUGGESTIONS, label: 'Sugerencias', count: suggestionCount?.count },
        ]}
      />

      {view === SUGGESTIONS ? <SuggestionsView /> : <FamiliesView onCreate={() => setCreating(true)} />}

      <FamilyLinkDialog open={creating} onClose={() => setCreating(false)} mode={{ kind: 'new' }} />
    </>
  );
}

// ── Familias ─────────────────────────────────────────────────────────────────
function FamiliesView({ onCreate }: { onCreate: () => void }) {
  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const sort = parseSort(get('orden'));
  const filters: Omit<FamiliesListParams, 'page'> = {
    q: get('q') || undefined,
    size: get('tamano') || undefined,
    ordering: serializeSort(sort) || undefined,
  };
  const { data, isLoading, isError, refetch } = useFamiliesList({ page, ...filters });
  const exportFamilies = useFamiliesExport();
  const bulk = useFamiliesBulk();
  const rows = data?.results;
  const count = data?.count ?? 0;
  const selection = useRowSelection(count, JSON.stringify(filters));
  const [confirming, setConfirming] = useState<BulkActionDef | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const onSort = (next: SortState) => set({ orden: serializeSort(next), page: null });
  const anyFilter = !!(filters.q || filters.size);

  const fetchExport = (fmt: ExportFormat, { selectedOnly }: { selectedOnly: boolean }) =>
    exportFamilies.mutateAsync({ ...filters, fmt, ids: selectedOnly && !selection.allMatching ? idsParam(selection.ids) : undefined });

  const columns: Column<FamilyRow>[] = [
    {
      id: 'name', header: 'Familia', sortKey: 'name', hideable: false, minWidth: 190,
      cell: (f) => (
        <div className="min-w-0">
          <button type="button" onClick={() => setOpenId(f.id)}
            className="truncate text-left text-sm font-semibold text-ink hover:text-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40">
            {f.name}
          </button>
          {f.notes && <p className="truncate text-xs text-subtle" title={f.notes}>{f.notes}</p>}
        </div>
      ),
    },
    { id: 'children', header: 'Hermanos', sortKey: 'children', minWidth: 260, cell: (f) => <Kids students={f.students} /> },
    {
      id: 'logins', header: 'Cuentas con acceso', align: 'right', minWidth: 120, className: 'whitespace-nowrap text-sm text-muted',
      cell: (f) => `${f.logins_count} ${f.logins_count === 1 ? 'cuenta' : 'cuentas'}`,
    },
    {
      id: 'created', header: 'Creada', sortKey: 'created', defaultHidden: true, minWidth: 120, className: 'whitespace-nowrap text-xs text-muted',
      cell: (f) => (f.created_at ? new Date(f.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'),
    },
  ];

  return (
    <Card>
      <DataTable<FamilyRow>
        tableId="families"
        columns={columns}
        rows={rows}
        rowKey={(f) => f.id}
        rowLabel={(f) => f.name}
        caption="Familias"
        sort={sort}
        onSort={onSort}
        page={page}
        count={count}
        onPage={setPage}
        itemLabel="familias"
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        columnControls
        pinFirstColumn
        selection={selection}
        rowActions={(f) => (
          <button type="button" className={ROW_ACTION} onClick={() => setOpenId(f.id)} aria-label={`Abrir ${f.name}`}>
            <Eye className="h-4 w-4" aria-hidden="true" /> Abrir
          </button>
        )}
        toolbar={(
          <FilterBar
            search={{ placeholder: 'Familia, alumno o matrícula…', label: 'Buscar familias' }}
            selects={[{ key: 'tamano', label: 'Tamaño', options: SIZE_OPTIONS, allLabel: 'Cualquier tamaño' }]}
          >
            <ExportMenu filenamePrefix="familias" selectedCount={selection.count} fetch={fetchExport} />
          </FilterBar>
        )}
        bulkBar={(
          <BulkActionBar
            count={selection.count}
            allMatching={selection.allMatching}
            allMatchingCount={count}
            onSelectAllMatching={selection.onSelectAllMatching}
            onClear={selection.onClear}
            itemLabel="familias"
            actions={FAMILY_ACTIONS}
            onAction={setConfirming}
            busy={bulk.isPending}
            exportMenu={<ExportMenu label="Exportar seleccionadas" filenamePrefix="familias" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
          />
        )}
        empty={{
          icon: UsersRound,
          title: anyFilter ? 'Sin resultados' : 'Aún no hay familias',
          description: anyFilter
            ? 'Ninguna familia coincide. Pruebe con el apellido o la matrícula de uno de los hijos.'
            : 'Agrupe hermanos con «Nueva familia», desde la pestaña Familia de un alumno o aceptando una sugerencia.',
          action: anyFilter ? undefined : <Button size="sm" onClick={onCreate}><Plus size={16} aria-hidden="true" /> Nueva familia</Button>,
        }}
      />

      <BulkConfirmDialog
        open={!!confirming}
        onClose={() => setConfirming(null)}
        action={confirming}
        entityLabel="familias"
        ids={selection.ids}
        allMatching={selection.allMatching}
        filters={filters}
        execute={(body) => bulk.mutateAsync(body)}
        renderPlan={() => <p className="text-xs">Los hermanos dejarán de verse entre sí en el portal. Expedientes, saldos y cuentas no cambian.</p>}
        onDone={(r) => { if (!r.failed.length) selection.onClear(); }}
      />

      <FamilyDialog id={openId} onClose={() => setOpenId(null)} />
    </Card>
  );
}

/** One family on top of the table: the same panel as the student's Familia tab. */
function FamilyDialog({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data, isLoading, isError, refetch } = useFamily(id);
  const [adding, setAdding] = useState(false);
  const mode: FamilyLinkMode | null = data ? { kind: 'family', family: { id: data.id, name: data.name }, memberIds: data.students.map((s) => s.id) } : null;
  return (
    <>
      <Modal open={id != null && !adding} onClose={onClose} title={data?.name ?? 'Familia'} maxWidth={880}>
        {isLoading ? <ListSkeleton rows={3} /> : isError || !data ? <ErrorState onRetry={() => refetch()} /> : (
          <FamilyPanel family={data} onAdd={() => setAdding(true)} onGone={onClose} />
        )}
      </Modal>
      {mode && <FamilyLinkDialog open={adding} onClose={() => setAdding(false)} mode={mode} />}
    </>
  );
}

// ── Sugerencias ──────────────────────────────────────────────────────────────
function SuggestionsView() {
  const { get } = useUrlFilters();
  const params = {
    q: get('qs') || undefined,
    confidence: (get('confianza') || undefined) as SuggestionConfidence | undefined,
  };
  const { data, isLoading, isError, refetch } = useFamilySuggestions(params);
  const rows = data?.results;
  const count = data?.count ?? 0;
  const selection = useRowSelection(count, JSON.stringify(params));
  const bulk = useSuggestionsBulk();
  const [confirming, setConfirming] = useState<BulkActionDef | null>(null);
  const [subject, setSubject] = useState<FamilySuggestion | null>(null);
  const [reviewing, setReviewing] = useState<PickedStudent[] | null>(null);
  const anyFilter = !!(params.q || params.confidence);

  const names = (sg: FamilySuggestion) => sg.students.map((s) => s.first_name || s.name).join(', ');
  const openSingle = (sg: FamilySuggestion, action: BulkActionDef) => { setSubject(sg); setConfirming(action); };

  const columns: Column<FamilySuggestion>[] = [
    {
      id: 'students', header: 'Hermanos probables', hideable: false, minWidth: 260,
      cell: (sg) => (
        <div className="space-y-1.5">
          <Kids students={sg.students} />
          {sg.families.length > 0 && (
            <p className="text-xs text-subtle">Ya en {sg.families.map((f) => f.name).join(' y ')}</p>
          )}
        </div>
      ),
    },
    { id: 'reasons', header: 'Motivos', minWidth: 240, cell: (sg) => <ReasonChips reasons={sg.reasons} /> },
    {
      id: 'confidence', header: 'Confianza', minWidth: 120,
      cell: (sg) => <Badge variant={CONFIDENCE[sg.confidence].variant}>{CONFIDENCE[sg.confidence].short}</Badge>,
    },
  ];

  return (
    <Card>
      <div className="mb-4 flex gap-3 rounded-xl bg-amber/10 px-4 py-3 text-sm text-ink">
        <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-amber" aria-hidden="true" />
        <p>
          Alumnos activos que comparten tutor, correo personal confirmado, teléfono o ambos apellidos.
          <span className="text-muted"> Revise cada caso: un mismo apellido no siempre significa hermanos.</span>
        </p>
      </div>
      <DataTable<FamilySuggestion>
        tableId="family-suggestions"
        columns={columns}
        rows={rows}
        rowKey={(sg) => sg.key}
        rowLabel={(sg) => `sugerencia ${names(sg)}`}
        caption="Sugerencias de hermanos"
        itemLabel="sugerencias"
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        selection={selection}
        rowActions={(sg) => (
          <>
            <button type="button" className={ROW_ACTION} onClick={() => setReviewing(sg.students.map(fromFamilyStudent))}
              aria-label={`Revisar y vincular a ${names(sg)}`}>
              <Link2 className="h-4 w-4" aria-hidden="true" /> Revisar
            </button>
            <button type="button" className={`${ROW_ACTION} text-muted`} onClick={() => openSingle(sg, DISMISS)}
              aria-label={`Descartar la sugerencia de ${names(sg)}`}>
              <XCircle className="h-4 w-4" aria-hidden="true" /> No son hermanos
            </button>
          </>
        )}
        toolbar={(
          <FilterBar
            search={{ paramKey: 'qs', placeholder: 'Alumno, matrícula, teléfono o apellido…', label: 'Buscar sugerencias' }}
            selects={[{ key: 'confianza', label: 'Confianza', options: CONFIDENCE_OPTIONS, allLabel: 'Toda confianza' }]}
          />
        )}
        bulkBar={(
          <BulkActionBar
            count={selection.count}
            onClear={selection.onClear}
            itemLabel="sugerencias"
            actions={[ACCEPT, DISMISS]}
            onAction={(a) => { setSubject(null); setConfirming(a); }}
            busy={bulk.isPending}
          />
        )}
        empty={{
          icon: Lightbulb,
          title: anyFilter ? 'Sin resultados' : 'Sin sugerencias pendientes',
          description: anyFilter
            ? 'Ninguna sugerencia coincide con la búsqueda.'
            : 'No hay alumnos que parezcan hermanos sin estar en la misma familia.',
        }}
      />

      <BulkConfirmDialog
        open={!!confirming}
        onClose={() => { setConfirming(null); setSubject(null); }}
        action={confirming}
        entityLabel="sugerencias"
        ids={subject ? [subject.key] : selection.ids}
        subject={subject ? names(subject) : undefined}
        execute={(body) => bulk.mutateAsync(body)}
        renderPlan={() => (confirming?.name === 'accept'
          ? <p className="text-xs">Cada grupo queda como una familia; sus cuentas verán a todos los hermanos en el portal.</p>
          : <p className="text-xs">No se volverán a sugerir juntos.</p>)}
        onDone={(r) => { if (!r.failed.length) selection.onClear(); }}
      />

      <FamilyLinkDialog
        open={!!reviewing}
        onClose={() => setReviewing(null)}
        mode={{ kind: 'new' }}
        preselected={reviewing ?? undefined}
      />
    </Card>
  );
}
