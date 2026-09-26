import { useMemo, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { Users, FileUp, Link2, Download, Plus, MoreHorizontal, RefreshCw, GraduationCap, UsersRound, UserCog, Wallet } from 'lucide-react';
import { ImportLoyverseModal } from '@/components/admin/ImportLoyverseModal';
import { LinkLoyverseModal } from '@/components/admin/LinkLoyverseModal';
import { StudentFormModal } from '@/components/admin/StudentFormModal';
import { ExportMenu } from '@/components/admin/ExportMenu';
import { FilterBar } from '@/components/admin/FilterBar';
import { BulkActionBar } from '@/components/admin/BulkActionBar';
import { BulkConfirmDialog } from '@/components/admin/BulkConfirmDialog';
import { BulkValueDialog, type BulkValueOption } from '@/components/admin/BulkValueDialog';
import { ImportDialog } from '@/components/admin/ImportDialog';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Dropdown } from '@/components/ui/Dropdown';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { parseSort, serializeSort, type SortState } from '@/components/ui/SortableTh';
import { PageHeader } from '@/components/layout/PageHeader';
import { useUrlFilters, useUrlPage } from '@/hooks/useUrlFilters';
import { useRowSelection } from '@/hooks/useRowSelection';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import {
  studentsImportApi, useStudentsBulk, useStudentsExport, useStudentsList,
  type RosterStudent, type StudentsListParams,
} from '@/hooks/queries/students';
import { STUDENT_STATUS } from '@/lib/studentStatus';
import { GRADES, NIVELES } from '@/lib/grades';
import { formatMXN } from '@/lib/format';
import { idsParam, type BulkActionDef, type ExportFormat } from '@/services/dataOps';
import AdminStudentDetail from './AdminStudentDetail';

type StatusKey = keyof typeof STUDENT_STATUS;

const STATUS_OPTIONS = (Object.entries(STUDENT_STATUS) as [StatusKey, (typeof STUDENT_STATUS)[StatusKey]][])
  .map(([value, m]) => ({ value, label: m.label }));
const ACCESS_OPTIONS = [
  { value: 'never', label: 'Nunca ha iniciado sesión' },
  { value: 'nopass', label: 'Sin contraseña asignada' },
  { value: 'active', label: 'Ya inició sesión' },
];
const LINKED_OPTIONS = [
  { value: '1', label: 'Vinculados a Loyverse' },
  { value: '0', label: 'Sin vínculo con Loyverse' },
];
const IMPORT_HEADERS = [
  { key: 'matricula', required: true }, { key: 'nombre', required: true }, { key: 'apellidos', required: true },
  { key: 'grado', required: true }, { key: 'grupo' }, { key: 'email_alumno' }, { key: 'loyverse_id' },
  { key: 'nombre_padre' }, { key: 'email_padre' }, { key: 'telefono_padre' },
];

/** Bulk actions of the roster (C5). Status/grade/group ask for the value first. */
const BULK_ACTIONS: BulkActionDef[] = [
  { name: 'status', label: 'Cambiar estado', icon: UserCog },
  { name: 'grade', label: 'Cambiar grado', icon: GraduationCap },
  { name: 'group', label: 'Cambiar grupo', icon: UsersRound },
  { name: 'sync_loyverse', label: 'Sincronizar con Loyverse', icon: RefreshCw, planVerb: 'Se sincronizará el saldo inicial de' },
];

const ROW_ACTION =
  'inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-purple hover:bg-cream-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 lg:min-h-[36px]';

function initial(s: RosterStudent) {
  return (s.user.first_name || s.user.full_name || '?').charAt(0).toUpperCase();
}

/**
 * /admin/alumnos — the roster on the Data Ops UI foundation: FilterBar (search,
 * estado tabs, nivel/grado/acceso/vínculo, grupo), DataTable v2 (server sort on
 * every mapped column, column controls persisted as `students`, pinned name),
 * selection with bulk status/grade/group/sync, export CSV/Excel/PDF of the view
 * or the selection, and the generic ImportDialog. There is no delete: "Baja
 * definitiva" is the archive. On 2xl screens a row opens the detail pane.
 */
export default function AdminStudents() {
  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const sort = parseSort(get('orden'));
  const filters: Omit<StudentsListParams, 'page'> = {
    q: get('q') || undefined,
    status: get('estado') || undefined,
    access: get('acceso') || undefined,
    level: get('nivel') || undefined,
    grade: get('grado') || undefined,
    group: get('grupo') || undefined,
    linked: get('vinculado') || undefined,
    ordering: serializeSort(sort) || undefined,
  };
  const nivel = get('nivel');
  const grupo = get('grupo');

  const { data, isLoading, isError, refetch } = useStudentsList({ page, ...filters });
  const exportStudents = useStudentsExport();
  const bulk = useStudentsBulk();
  const students = data?.results;
  const count = data?.count ?? 0;
  const selection = useRowSelection(count, JSON.stringify(filters));
  const onSort = (next: SortState) => set({ orden: serializeSort(next), page: null });

  const [createOpen, setCreateOpen] = useState(() => new URLSearchParams(window.location.search).get('nuevo') === '1');
  const [importOpen, setImportOpen] = useState(false);
  const [importLoyverseOpen, setImportLoyverseOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [editing, setEditing] = useState<RosterStudent | null>(null);
  const [picking, setPicking] = useState<BulkActionDef | null>(null);
  const [confirming, setConfirming] = useState<{ action: BulkActionDef; payload?: Record<string, unknown> } | null>(null);

  // Large screens (2xl, docs/RESPONSIVE.md): list on the left, detail on the right, no navigation.
  const twoPane = useMediaQuery('(min-width: 1536px)');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const openStudent = (e: MouseEvent, id: number) => {
    if (!twoPane || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    setSelectedId(id);
  };

  // Groups that exist in the data on screen, offered as suggestions (free text allowed).
  const groupOptions = useMemo<BulkValueOption[]>(() => {
    const seen = new Set((students ?? []).map((s) => s.group).filter(Boolean));
    ['A', 'B', 'C'].forEach((g) => seen.add(g));
    return Array.from(seen).sort().map((g) => ({ value: g, label: `Grupo ${g}` }));
  }, [students]);

  const columns = useMemo<Column<RosterStudent>[]>(() => [
    {
      id: 'name', header: 'Nombre', sortKey: 'name', hideable: false, minWidth: 200,
      cell: (s) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700" aria-hidden="true">
            {initial(s)}
          </span>
          <Link
            to={`/admin/alumnos/${s.id}`}
            onClick={(e) => openStudent(e, s.id)}
            className="font-medium text-ink hover:text-purple hover:underline"
            aria-current={selectedId === s.id ? 'true' : undefined}
          >
            {s.user.full_name}
          </Link>
        </div>
      ),
    },
    { id: 'student_id', header: 'Matrícula', sortKey: 'student_id', minWidth: 100, className: 'text-muted', cell: (s) => s.student_id },
    // What the office compares against Loyverse: the code exactly as the POS spells it (ci09932).
    { id: 'loyverse_code', header: 'Código Loyverse', minWidth: 120, className: 'font-mono text-xs text-muted', cell: (s) => s.loyverse_code || s.student_id },
    { id: 'grade', header: 'Grado', sortKey: 'grade', minWidth: 120, className: 'text-muted', cell: (s) => s.grade },
    { id: 'group', header: 'Grupo', sortKey: 'group', minWidth: 70, className: 'text-muted', cell: (s) => s.group || '—' },
    { id: 'email', header: 'Correo', defaultHidden: true, minWidth: 180, className: 'text-xs text-subtle', cell: (s) => s.user.email },
    {
      id: 'status', header: 'Estado', sortKey: 'status', minWidth: 120,
      cell: (s) => {
        const meta = STUDENT_STATUS[(s.status ?? 'active') as StatusKey];
        return <Badge variant={meta?.variant ?? 'neutral'}>{meta?.label ?? s.status}</Badge>;
      },
    },
    {
      id: 'balance', header: 'Saldo', sortKey: 'balance', align: 'right', minWidth: 100,
      cell: (s) => (s.balance === undefined || s.balance === null ? '—' : formatMXN(s.balance)),
    },
    {
      id: 'enrollment_date', header: 'Ingreso', sortKey: 'enrollment_date', defaultHidden: true, minWidth: 110, className: 'text-xs text-subtle',
      cell: (s) => (s.enrollment_date ? new Date(`${s.enrollment_date}T12:00:00`).toLocaleDateString('es-MX') : '—'),
    },
    {
      id: 'last_login', header: 'Último acceso', sortKey: 'last_login', minWidth: 120, className: 'text-xs text-subtle',
      cell: (s) => (s.user.last_login ? new Date(s.user.last_login).toLocaleDateString('es-MX') : <span className="text-coral-600">Nunca</span>),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [twoPane, selectedId]);

  const fetchExport = (fmt: ExportFormat, { selectedOnly }: { selectedOnly: boolean }) =>
    exportStudents.mutateAsync({
      ...filters,
      fmt,
      ids: selectedOnly && !selection.allMatching ? idsParam(selection.ids) : undefined,
    });

  const startBulk = (action: BulkActionDef) => {
    if (action.name === 'sync_loyverse') setConfirming({ action });
    else setPicking(action);
  };
  const pickedValue = (value: string) => {
    if (!picking) return;
    const labelFor = picking.name === 'status' ? STUDENT_STATUS[value as StatusKey]?.label ?? value : value;
    const withdraw = picking.name === 'status' && value === 'withdrawn';
    setConfirming({
      action: {
        ...picking,
        label: `${picking.label} a «${labelFor}»`,
        danger: withdraw,
        planVerb: withdraw ? 'Se darán de baja' : `Se cambiará a «${labelFor}» a`,
      },
      payload: { value },
    });
    setPicking(null);
  };

  const pickerProps = (() => {
    if (picking?.name === 'status') return { label: 'Nuevo estado', options: STATUS_OPTIONS, hint: '«Baja definitiva» archiva al alumno: no se borra nada y su saldo se muestra antes de confirmar.' };
    if (picking?.name === 'grade') return { label: 'Nuevo grado', options: GRADES.map((g) => ({ value: g, label: g })), freeText: true, maxLength: 20 };
    return { label: 'Nuevo grupo', options: groupOptions, freeText: true, maxLength: 5, uppercase: true, hint: 'Elija un grupo existente o escriba uno nuevo.' };
  })();

  const SECONDARY = [
    { key: 'import', label: 'Importar archivo', icon: FileUp, run: () => setImportOpen(true) },
    { key: 'loyverse', label: 'Importar desde Loyverse', icon: Download, run: () => setImportLoyverseOpen(true) },
    { key: 'link', label: 'Vincular Loyverse', icon: Link2, run: () => setLinkOpen(true) },
  ];
  const anyFilter = Object.entries(filters).some(([k, v]) => k !== 'ordering' && v);

  return (
    <div className={twoPane && selectedId ? 'grid gap-6 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : 'space-y-6'}>
      <div className="min-w-0 space-y-6">
        <PageHeader
          title="Alumnos"
          subtitle="Directorio de alumnos: búsqueda, filtros, acciones en lote, importación y exportación."
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-pink" onClick={() => setCreateOpen(true)}>
                <Plus size={16} aria-hidden="true" /> Nuevo alumno
              </button>
              <ExportMenu filenamePrefix="alumnos" selectedCount={selection.count} fetch={fetchExport} />
              <Dropdown
                width={260}
                trigger={({ open, toggle }) => (
                  <button type="button" className="btn-outline min-h-[44px] sm:min-h-[40px]" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
                    <MoreHorizontal size={16} aria-hidden="true" /> Más acciones
                  </button>
                )}
              >
                {({ close }) => (
                  <div role="menu" aria-label="Más acciones" className="p-1.5">
                    {SECONDARY.map(({ key, label, icon: Icon, run }) => (
                      <button
                        key={key}
                        type="button"
                        role="menuitem"
                        className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-ink hover:bg-cream-2"
                        onClick={() => { close(); run(); }}
                      >
                        <Icon size={16} aria-hidden="true" /> {label}
                      </button>
                    ))}
                  </div>
                )}
              </Dropdown>
            </div>
          )}
        />

        <StudentFormModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => refetch()} />
        <StudentFormModal open={!!editing} student={editing} onClose={() => setEditing(null)} onSaved={() => refetch()} />
        <ImportDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          title="Importar alumnos"
          entity="students"
          related={['cafeteria']}
          api={studentsImportApi}
          headers={IMPORT_HEADERS}
          templatePrefix="alumnos"
          description={<>Cree o actualice alumnos por matrícula (se aceptan <code>ci09932</code> y <code>09932</code>) y vincule a sus tutores por correo. CSV o Excel.</>}
        />
        <ImportLoyverseModal open={importLoyverseOpen} onClose={() => setImportLoyverseOpen(false)} onImported={() => refetch()} />
        <LinkLoyverseModal open={linkOpen} onClose={() => setLinkOpen(false)} onLinked={() => refetch()} />

        <Card title={`${count.toLocaleString('es-MX')} alumnos`}>
          <p role="status" aria-live="polite" className="sr-only">{count} alumnos encontrados</p>
          <DataTable<RosterStudent>
            tableId="students"
            columns={columns}
            rows={students}
            rowKey={(s) => s.id}
            rowLabel={(s) => s.user.full_name}
            caption="Directorio de alumnos"
            sort={sort}
            onSort={onSort}
            page={page}
            count={count}
            onPage={setPage}
            itemLabel="alumnos"
            isLoading={isLoading}
            isError={isError}
            onRetry={() => refetch()}
            columnControls
            resizable
            pinFirstColumn
            selection={selection}
            rowActions={(s) => (
              <>
                <Link to={`/admin/alumnos/${s.id}`} className={ROW_ACTION} aria-label={`Ver ficha de ${s.user.full_name}`}>
                  Ficha
                </Link>
                <button type="button" onClick={() => setEditing(s)} className={ROW_ACTION} aria-label={`Editar a ${s.user.full_name}`}>
                  Editar
                </button>
                <Link to={`/admin/cafeteria/${s.id}`} className={ROW_ACTION} aria-label={`Cafetería de ${s.user.full_name}`}>
                  <Wallet size={14} aria-hidden="true" /> Cafetería
                </Link>
              </>
            )}
            toolbar={(
              <FilterBar
                search={{ placeholder: 'Buscar por nombre, matrícula, correo o grado…', label: 'Buscar alumnos' }}
                tabs={{ paramKey: 'estado', options: STATUS_OPTIONS, allLabel: 'Todos', label: 'Filtrar por estado' }}
                selects={[
                  { key: 'nivel', label: 'Nivel', options: NIVELES.map(([value, label]) => ({ value, label })), allLabel: 'Todos los niveles' },
                  {
                    key: 'grado', label: 'Grado', allLabel: 'Todos los grados',
                    options: GRADES.filter((g) => !nivel || g.toLowerCase().includes(nivel)).map((g) => ({ value: g, label: g })),
                  },
                  { key: 'acceso', label: 'Acceso al portal', options: ACCESS_OPTIONS, allLabel: 'Acceso: todos' },
                  { key: 'vinculado', label: 'Loyverse', options: LINKED_OPTIONS, allLabel: 'Loyverse: todos' },
                ]}
                extraChips={grupo ? [{ key: 'grupo', label: `Grupo: ${grupo}`, onClear: () => set({ grupo: null, page: null }) }] : []}
              >
                <input
                  className="input-field w-24"
                  aria-label="Grupo"
                  placeholder="Grupo"
                  maxLength={5}
                  autoComplete="off"
                  value={grupo}
                  onChange={(e) => set({ grupo: e.target.value.toUpperCase() || null, page: null })}
                />
              </FilterBar>
            )}
            bulkBar={(
              <BulkActionBar
                count={selection.count}
                allMatching={selection.allMatching}
                allMatchingCount={count}
                onSelectAllMatching={selection.onSelectAllMatching}
                onClear={selection.onClear}
                itemLabel="alumnos"
                gender="m"
                actions={BULK_ACTIONS}
                onAction={startBulk}
                busy={bulk.isPending}
                exportMenu={<ExportMenu label="Exportar seleccionados" filenamePrefix="alumnos" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
              />
            )}
            empty={{
              icon: Users,
              title: anyFilter ? 'Sin resultados' : 'Sin alumnos',
              description: anyFilter ? 'Ningún alumno coincide con los filtros.' : 'Los alumnos registrados aparecerán aquí.',
              action: anyFilter ? undefined : (
                <button type="button" className="btn-outline" onClick={() => setImportOpen(true)}>
                  <FileUp size={16} aria-hidden="true" /> Importar archivo
                </button>
              ),
            }}
          />
        </Card>

        <BulkValueDialog
          open={!!picking}
          onClose={() => setPicking(null)}
          title={picking ? `${picking.label}: ${selection.count.toLocaleString('es-MX')} alumnos` : ''}
          onSubmit={pickedValue}
          {...pickerProps}
        />
        <BulkConfirmDialog
          open={!!confirming}
          onClose={() => setConfirming(null)}
          action={confirming?.action ?? null}
          payload={confirming?.payload}
          entityLabel="alumnos"
          gender="m"
          ids={selection.ids}
          allMatching={selection.allMatching}
          filters={filters}
          execute={(body) => bulk.mutateAsync(body)}
          onDone={(r) => { if (!r.failed.length) selection.onClear(); }}
        />
      </div>
      {twoPane && selectedId && (
        <aside className="min-w-0 rounded-xl2 border border-line bg-white p-5 2xl:sticky 2xl:top-20 2xl:max-h-[calc(100svh-6rem)] 2xl:overflow-y-auto" aria-label="Detalle del alumno">
          <div className="mb-2 flex justify-end"><button type="button" className="text-xs text-subtle hover:text-ink" onClick={() => setSelectedId(null)}>Cerrar panel</button></div>
          <AdminStudentDetail id={selectedId} embedded />
        </aside>
      )}
    </div>
  );
}
