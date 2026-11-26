import { Fragment, useMemo, useState, type MouseEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Users, FileUp, Link2, Download, Plus, MoreHorizontal, RefreshCw, GraduationCap, UsersRound, UserCog, Wallet, Eye, Pencil, ArrowRight, AlertTriangle, House, Briefcase, ShieldCheck, ShieldOff, type LucideIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { ImportLoyverseModal } from '@/components/admin/ImportLoyverseModal';
import { ImportStaffModal } from '@/components/admin/ImportStaffModal';
import { LinkLoyverseModal } from '@/components/admin/LinkLoyverseModal';
import { StudentFormModal } from '@/components/admin/StudentFormModal';
import { ExportMenu } from '@/components/admin/ExportMenu';
import { FilterBar } from '@/components/admin/FilterBar';
import { BulkActionBar } from '@/components/admin/BulkActionBar';
import { BulkConfirmDialog } from '@/components/admin/BulkConfirmDialog';
import { BulkValueDialog, type BulkValueOption } from '@/components/admin/BulkValueDialog';
import { ImportDialog } from '@/components/admin/ImportDialog';
import { FamilyLinkDialog } from '@/components/admin/families/FamilyLinkDialog';
import { fromRoster, type PickedStudent } from '@/components/admin/families/familyUtils';
import { ARCHIVE_ACTION, DELETE_ACTION, RESTORE_ACTION, removalPlanNote } from '@/components/admin/studentActions';
import { RowActionsMenu, type RowMenuItem } from '@/components/admin/RowActionsMenu';
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
  STUDENTS_RELATED, studentsImportApi, useStudentsBulk, useStudentsExport, useStudentsList,
  type RosterStudent, type StudentsListParams,
} from '@/hooks/queries/students';
import { STUDENT_STATUS } from '@/lib/studentStatus';
import { GRADES, NIVELES } from '@/lib/grades';
import { formatMXN } from '@/lib/format';
import { shortDate } from '@/lib/tableFormat';
import { canOpen, isAdmin } from '@/lib/areas';
import { PUESTO_LABEL, PUESTO_OPTIONS, consoleAction } from '@/lib/people';
import { plural } from '@/lib/plural';
import { useAuthStore } from '@/store/authStore';
import { idsParam, type BulkActionDef, type ExportFormat } from '@/services/dataOps';
import { ConsoleAccessCell, GrantConsoleAccessModal, RemoveConsoleAccessDialog, type ConsolePerson } from '@/components/admin/ConsoleAccess';
import type { StaffPuesto } from '@/types';
import AdminStudentDetail from './AdminStudentDetail';

type StatusKey = keyof typeof STUDENT_STATUS;

const STATUS_OPTIONS = (Object.entries(STUDENT_STATUS) as [StatusKey, (typeof STUDENT_STATUS)[StatusKey]][])
  .map(([value, m]) => ({ value, label: m.label }));
/** The roster opens on who is here today; "Todos" shows everyone on the lists, bajas included. */
const ALL_STATUSES = 'todos';
/** Archived students are off every other tab; this one lists only them, with Restaurar. */
const ARCHIVED = 'archivados';
const ACCESS_OPTIONS = [
  { value: 'never', label: 'Nunca ha iniciado sesión' },
  { value: 'nopass', label: 'Sin contraseña asignada' },
  { value: 'active', label: 'Ya inició sesión' },
];
const MISSING = 'missing';
const LINKED_OPTIONS = [
  { value: '1', label: 'Vinculados a Loyverse' },
  { value: '0', label: 'Sin vínculo con Loyverse' },
  { value: MISSING, label: 'Sin cliente en Loyverse' },
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
/** First in the bar: select the siblings, then the family preview (who joins, who gains access). */
const FAMILY_ACTION: BulkActionDef = { name: 'family', label: 'Vincular como hermanos', icon: House };
/** «Personal» (2026-11-25): every staff member starts «Sin asignar»; this is the office's first job. */
const PUESTO_ACTION: BulkActionDef = { name: 'puesto', label: 'Cambiar puesto', icon: Briefcase };

// A column of icons wide enough to stay pinned beside the data; below lg the
// table moves them into its overflow menu, where the words show too.
const ROW_ACTION_BASE =
  'inline-flex min-h-[44px] items-center gap-1.5 rounded-sm px-2.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 lg:min-h-[36px] lg:px-2';
const ROW_ACTION = `${ROW_ACTION_BASE} text-purple hover:bg-cream-2`;
// Below lg the table already folds the row into a menu, so the items show as plain buttons there;
// the destructive one is coral, behind a divider (one color class each: Tailwind order would pick the winner).
const MENU_BUTTON = `${ROW_ACTION} w-full justify-start`;
const MENU_BUTTON_DANGER = `${ROW_ACTION_BASE} w-full justify-start text-coral-700 hover:bg-coral-50`;

function RowActionLabel({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <>
      <Icon size={16} aria-hidden="true" />
      <span className="lg:hidden">{label}</span>
    </>
  );
}

function initial(s: RosterStudent) {
  return (s.user.first_name || s.user.full_name || '?').charAt(0).toUpperCase();
}

type RosterMode = 'alumno' | 'personal';

/**
 * /admin/alumnos and /admin/personal — the roster on the Data Ops UI
 * foundation: FilterBar (search, estado tabs, nivel/grado/acceso/vínculo,
 * grupo), DataTable v2 (server sort on every mapped column, column controls
 * persisted per list, pinned name), selection with bulk status/grade/group/sync,
 * export CSV/Excel/PDF of the view or the selection, and the generic
 * ImportDialog. Opens on the active people. Archivar takes someone off every
 * list (Archivados tab, Restaurar); an admin's Eliminar erases a record with
 * nothing to keep and archives the rest (server rules: student_delete.py). On
 * 2xl screens a row opens the detail pane.
 *
 * «Personal» (owner, 2026-11-25: its own menu entry, it used to be a tab of
 * Alumnos) lists the staff cafetería accounts with their puesto (filter and
 * bulk «Cambiar puesto») and who of them uses the console: an admin gives or
 * takes away console access on the person's own login (ConsoleAccess.tsx).
 */
export default function AdminStudents({ mode = 'alumno' }: { mode?: RosterMode } = {}) {
  const location = useLocation();
  // Bookmarks of the old «Personal» tab (/admin/alumnos?tipo=personal) keep working.
  const params = new URLSearchParams(location.search);
  if (mode === 'alumno' && params.get('tipo') === 'personal') {
    params.delete('tipo');
    const rest = params.toString();
    return <Navigate to={`/admin/personal${rest ? `?${rest}` : ''}`} replace />;
  }
  // Two routes, one component: the key gives each list its own state.
  return <Roster key={mode} personal={mode === 'personal'} />;
}

function Roster({ personal }: { personal: boolean }) {
  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const sort = parseSort(get('orden'));
  const estado = get('estado');
  const vinculado = get('vinculado');
  const me = useAuthStore((s) => s.user);
  const canDelete = isAdmin(me);
  // Secretaría without the cafetería area was bounced from that link silently.
  const canCafeteria = canOpen(me, '/admin/cafeteria');
  const navigate = useNavigate();
  // Staff cafetería accounts are never in the pupils' list (2026-11-18).
  const tipoParam = personal ? 'personal' : undefined;
  const base = personal ? '/admin/personal' : '/admin/alumnos';
  const filters: Omit<StudentsListParams, 'page'> = {
    tipo: tipoParam,
    q: get('q') || undefined,
    status: estado === ALL_STATUSES || estado === ARCHIVED ? undefined : estado || 'active',
    archived: estado === ARCHIVED ? '1' : undefined,
    access: get('acceso') || undefined,
    level: personal ? undefined : get('nivel') || undefined,
    grade: personal ? undefined : get('grado') || undefined,
    group: personal ? undefined : get('grupo') || undefined,
    puesto: personal ? get('puesto') || undefined : undefined,
    linked: vinculado || undefined,
    ordering: serializeSort(sort) || undefined,
  };
  const nivel = get('nivel');
  const grupo = get('grupo');

  const { data, isLoading, isError, refetch } = useStudentsList({ page, ...filters });
  const { data: missing } = useStudentsList({ page: 1, page_size: 1, status: 'active', linked: MISSING, tipo: tipoParam });
  const missingCount = missing?.count ?? 0;
  const { data: archivedList } = useStudentsList({ page: 1, page_size: 1, archived: '1', tipo: tipoParam });
  const archivedCount = archivedList?.count ?? 0;
  const [granting, setGranting] = useState<ConsolePerson | null>(null);
  const [removing, setRemoving] = useState<ConsolePerson | null>(null);
  const personOf = (s: RosterStudent): ConsolePerson => ({ userId: s.user.id, name: s.user.full_name, email: s.user.email });
  // What the people in this list are called, in the counts, toasts and dialogs.
  const noun = personal
    ? { one: 'persona', many: 'personas', gender: 'f' as const }
    : { one: 'alumno', many: 'alumnos', gender: 'm' as const };
  const viewingArchived = estado === ARCHIVED;
  const isLg = useMediaQuery('(min-width: 1024px)');
  const exportStudents = useStudentsExport();
  const bulk = useStudentsBulk();
  const students = data?.results;
  const count = data?.count ?? 0;
  const selection = useRowSelection(count, JSON.stringify(filters));
  const [linkFamily, setLinkFamily] = useState<PickedStudent[] | null>(null);
  const onSort = (next: SortState) => set({ orden: serializeSort(next), page: null });

  const [createOpen, setCreateOpen] = useState(() => new URLSearchParams(window.location.search).get('nuevo') === '1');
  const [importOpen, setImportOpen] = useState(false);
  const [importLoyverseOpen, setImportLoyverseOpen] = useState(false);
  const [importStaffOpen, setImportStaffOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [editing, setEditing] = useState<RosterStudent | null>(null);
  const [picking, setPicking] = useState<BulkActionDef | null>(null);
  const [confirming, setConfirming] = useState<{ action: BulkActionDef; payload?: Record<string, unknown>; one?: RosterStudent } | null>(null);

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

  const statusTabs = [
    ...STATUS_OPTIONS,
    { value: ALL_STATUSES, label: 'Todos' },
    { value: ARCHIVED, label: 'Archivados', count: archivedCount },
  ];
  const bulkActions: BulkActionDef[] = viewingArchived
    ? [RESTORE_ACTION, ...(canDelete ? [DELETE_ACTION] : [])]
    : personal
      // Staff: no families, grades or groups (a puesto instead).
      ? [PUESTO_ACTION, ARCHIVE_ACTION, ...(canDelete ? [DELETE_ACTION] : []), ...BULK_ACTIONS.filter((a) => ['status', 'sync_loyverse'].includes(a.name))]
      : [FAMILY_ACTION, ARCHIVE_ACTION, ...(canDelete ? [DELETE_ACTION] : []), ...BULK_ACTIONS];

  const columns = useMemo<Column<RosterStudent>[]>(() => [
    {
      id: 'name', header: 'Nombre', sortKey: 'name', hideable: false, minWidth: 200,
      cell: (s) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700" aria-hidden="true">
            {initial(s)}
          </span>
          <Link
            to={`${base}/${s.id}`}
            onClick={(e) => openStudent(e, s.id)}
            className="font-medium text-ink hover:text-purple hover:underline"
            aria-current={selectedId === s.id ? 'true' : undefined}
          >
            {s.user.full_name}
          </Link>
        </div>
      ),
    },
    // What the office compares against Loyverse: the code exactly as the POS spells it (ci09932).
    // Under the matrícula by default, so the table leaves room for the balance on a laptop.
    {
      id: 'student_id', header: personal ? 'Código' : 'Matrícula', sortKey: 'student_id', minWidth: 100, className: 'text-muted',
      cell: (s) => (
        <>
          {s.student_id}
          {s.loyverse_code && s.loyverse_code !== s.student_id && <span className="block font-mono text-xs text-subtle">{s.loyverse_code}</span>}
        </>
      ),
    },
    { id: 'loyverse_code', header: 'Código Loyverse', defaultHidden: true, minWidth: 120, className: 'font-mono text-xs text-muted', cell: (s) => s.loyverse_code || s.student_id },
    ...(personal
      ? [
        { id: 'puesto', header: 'Puesto', sortKey: 'puesto', minWidth: 140, className: 'text-muted', cell: (s: RosterStudent) => s.puesto_label || 'Sin asignar' },
        // Who of the staff also uses the console, and for what (2026-11-25).
        { id: 'console', header: 'Consola', minWidth: 170, cell: (s: RosterStudent) => <ConsoleAccessCell user={s.user} /> },
      ]
      : [
        { id: 'grade', header: 'Grado', sortKey: 'grade', minWidth: 120, className: 'text-muted', cell: (s: RosterStudent) => s.grade },
        { id: 'group', header: 'Grupo', sortKey: 'group', minWidth: 70, className: 'text-muted', cell: (s: RosterStudent) => s.group || '—' },
      ]),
    {
      id: 'status', header: 'Estado', sortKey: 'status', minWidth: 120,
      cell: (s) => {
        const meta = STUDENT_STATUS[(s.status ?? 'active') as StatusKey];
        if (s.archived_at) {
          return (
            <span title={`Archivado el ${new Date(s.archived_at).toLocaleDateString('es-MX')}`}>
              <Badge variant="neutral">Archivado</Badge>
            </span>
          );
        }
        return (
          <div className="flex flex-wrap gap-1">
            <Badge variant={meta?.variant ?? 'neutral'}>{meta?.label ?? s.status}</Badge>
            {/* One badge per row: the second fact reads as a quiet warning line. */}
            {s.is_active !== false && s.loyverse_missing_since && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
                <AlertTriangle size={16} aria-hidden="true" /> Sin cliente en Loyverse
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: 'balance', header: 'Saldo', sortKey: 'balance', align: 'right', minWidth: 100, className: 'font-medium text-ink',
      cell: (s) => (s.balance === undefined || s.balance === null ? '—' : formatMXN(s.balance)),
    },
    ...(personal ? [] : [{
      // Siblings grouped by the office (Familias): the family opens filtered on its name.
      id: 'family', header: 'Familia', minWidth: 150,
      cell: (s: RosterStudent) => (s.family ? (
        <Link to={`/admin/familias?q=${encodeURIComponent(s.family.name)}`} title={`Ver ${s.family.name}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex max-w-full items-center gap-1.5 rounded-sm bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40">
          <House className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{s.family.name}</span>
        </Link>
      ) : '—'),
    }]),
    // A staff member signs in with this address: shown by default in «Personal».
    { id: 'email', header: 'Correo', defaultHidden: !personal, minWidth: 180, className: 'text-xs text-subtle', cell: (s) => s.user.email },
    {
      id: 'enrollment_date', header: 'Ingreso', sortKey: 'enrollment_date', defaultHidden: true, minWidth: 110, className: 'whitespace-nowrap text-xs text-subtle',
      cell: (s) => shortDate(s.enrollment_date),
    },
    {
      // The pupil's own login (families use theirs): secondary, one click away in «Columnas».
      id: 'last_login', header: 'Acceso', label: 'Último acceso', sortKey: 'last_login', defaultHidden: true, minWidth: 120, className: 'whitespace-nowrap text-xs text-subtle',
      cell: (s) => (s.user.last_login ? shortDate(s.user.last_login) : <span className="text-coral-600">Nunca</span>),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [twoPane, selectedId, personal, base]);

  const fetchExport = (fmt: ExportFormat, { selectedOnly }: { selectedOnly: boolean }) =>
    exportStudents.mutateAsync({
      ...filters,
      fmt,
      ids: selectedOnly && !selection.allMatching ? idsParam(selection.ids) : undefined,
    });

  const startBulk = (action: BulkActionDef) => {
    if (action.name === 'family') {
      if (selection.allMatching) { toast.error('Elija a los hermanos uno por uno.'); return; }
      const ids = selection.ids.map(Number);
      if (ids.length < 2) { toast.error('Elija al menos dos alumnos.'); return; }
      if (ids.length > 10) { toast.error('Una familia admite hasta 10 alumnos.'); return; }
      const byId = new Map((students ?? []).map((s) => [s.id, s]));
      setLinkFamily(ids.map((id) => {
        const s = byId.get(id);
        return s ? fromRoster(s) : { id, name: '', grade: '', group: '', student_id: '', family: null };
      }));
      return;
    }
    if (['archive', 'restore', 'delete', 'sync_loyverse'].includes(action.name)) setConfirming({ action, payload: action.payload });
    else setPicking(action);
  };
  const pickedValue = (value: string) => {
    if (!picking) return;
    const labelFor = picking.name === 'status' ? STUDENT_STATUS[value as StatusKey]?.label ?? value
      : picking.name === 'puesto' ? PUESTO_LABEL[value as StaffPuesto] ?? value
      : value;
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
    if (picking?.name === 'status') {
      return {
        label: 'Nuevo estado', options: STATUS_OPTIONS,
        hint: personal
          ? '«Baja definitiva» deja a la persona en la pestaña de bajas y su saldo se muestra antes de confirmar. Para quitarla de las listas use Archivar.'
          : '«Baja definitiva» deja al alumno en la pestaña de bajas y su saldo se muestra antes de confirmar. Para quitarlo de las listas use Archivar.',
      };
    }
    if (picking?.name === 'puesto') return { label: 'Nuevo puesto', options: PUESTO_OPTIONS, hint: 'Solo cambia el puesto que se ve en la lista y en la credencial; no da acceso a la consola.' };
    if (picking?.name === 'grade') return { label: 'Nuevo grado', options: GRADES.map((g) => ({ value: g, label: g })), freeText: true, maxLength: 20 };
    return { label: 'Nuevo grupo', options: groupOptions, freeText: true, maxLength: 5, uppercase: true, hint: 'Elija un grupo existente o escriba uno nuevo.' };
  })();

  // «Personal» brings its people from Loyverse; Alumnos imports files and pupils.
  const SECONDARY = personal
    ? [
      // A3: admins only (the endpoint refuses everyone else).
      ...(canDelete ? [{ key: 'staff', label: 'Importar personal desde Loyverse', icon: Briefcase, run: () => setImportStaffOpen(true) }] : []),
      { key: 'link', label: 'Vincular Loyverse', icon: Link2, run: () => setLinkOpen(true) },
    ]
    : [
      { key: 'import', label: 'Importar archivo', icon: FileUp, run: () => setImportOpen(true) },
      { key: 'loyverse', label: 'Importar desde Loyverse', icon: Download, run: () => setImportLoyverseOpen(true) },
      { key: 'link', label: 'Vincular Loyverse', icon: Link2, run: () => setLinkOpen(true) },
    ];
  const anyFilter = !!estado || Object.entries(filters).some(([k, v]) => k !== 'ordering' && k !== 'status' && k !== 'tipo' && v);
  const startOne = (action: BulkActionDef, one: RosterStudent) => setConfirming({ action, payload: action.payload, one });
  const lifecycleItems = (s: RosterStudent): RowMenuItem[] => [
    s.archived_at
      ? { key: 'restore', label: 'Restaurar', icon: RESTORE_ACTION.icon, onSelect: () => startOne(RESTORE_ACTION, s) }
      : { key: 'archive', label: 'Archivar', icon: ARCHIVE_ACTION.icon, onSelect: () => startOne(ARCHIVE_ACTION, s) },
    ...(canDelete ? [{ key: 'delete', label: 'Eliminar', icon: DELETE_ACTION.icon, danger: true, onSelect: () => startOne(DELETE_ACTION, s) }] : []),
  ];
  // Who uses the console is a Usuarios decision: admins only, like the API.
  const consoleItems = (s: RosterStudent): RowMenuItem[] => {
    if (!personal || !canDelete || s.archived_at) return [];
    const kind = consoleAction(s.user);
    if (kind === 'grant') {
      return [{ key: 'console', label: 'Dar acceso a la consola', icon: ShieldCheck, ariaLabel: `Dar acceso a la consola a ${s.user.full_name}`, onSelect: () => setGranting(personOf(s)) }];
    }
    if (kind === 'remove') {
      return [{ key: 'console', label: 'Quitar acceso a la consola', icon: ShieldOff, ariaLabel: `Quitar acceso a la consola a ${s.user.full_name}`, onSelect: () => setRemoving(personOf(s)) }];
    }
    return [];
  };

  // Archiving a few named rows can be undone from the toast; a whole filtered
  // view is restored from the Archivados tab instead.
  const afterAction = (action: BulkActionDef, ids: number[], result: { ok: number }) => {
    if (action.name !== 'archive' || result.ok === 0) return;
    toast((t) => (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span>{personal
          ? (result.ok === 1 ? 'Persona archivada.' : `${plural(result.ok, 'persona archivada', 'personas archivadas')}.`)
          : (result.ok === 1 ? 'Alumno archivado.' : `${plural(result.ok, 'alumno archivado', 'alumnos archivados')}.`)}</span>
        {ids.length > 0 && (
          <button
            type="button"
            className="font-semibold text-purple underline-offset-2 hover:underline"
            onClick={() => {
              toast.dismiss(t.id);
              // undo: each student gets back the status they had before (not «Baja definitiva»).
              void bulk.mutateAsync({ action: 'restore', ids, all_matching: false, payload: { undo: true }, dry_run: false })
                .then(() => toast.success('Listo: volvieron a la lista como estaban.'))
                .catch(() => toast.error('No se pudo deshacer. Restáurelos desde Archivados.'));
            }}
          >
            Deshacer
          </button>
        )}
        <Link to={`${base}?estado=${ARCHIVED}`} onClick={() => toast.dismiss(t.id)} className="font-semibold text-purple underline-offset-2 hover:underline">
          Ver archivados
        </Link>
      </span>
    ), { duration: 7000 });
  };

  return (
    <div className={twoPane && selectedId ? 'grid gap-6 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : 'space-y-6'}>
      <div className="min-w-0 space-y-6">
        <PageHeader
          title={personal ? 'Personal' : 'Alumnos'}
          subtitle={personal
            ? 'Personal del colegio que compra en cafetería: mismo saldo, recargas, estado de cuenta y credencial que los alumnos. Aquí también decide quién entra a la consola.'
            : 'Directorio de alumnos: búsqueda, filtros, acciones en lote, importación y exportación.'}
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-pink" onClick={() => setCreateOpen(true)}>
                <Plus size={16} aria-hidden="true" /> {personal ? 'Nuevo personal' : 'Nuevo alumno'}
              </button>
              <ExportMenu filenamePrefix={personal ? 'personal' : 'alumnos'} selectedCount={selection.count} fetch={fetchExport} />
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
                        className="flex min-h-[44px] w-full items-center gap-2 rounded-sm px-3 text-left text-sm text-ink hover:bg-cream-2"
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

        <StudentFormModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => refetch()} defaultTipo={personal ? 'personal' : 'alumno'} />
        <StudentFormModal open={!!editing} student={editing} onClose={() => setEditing(null)} onSaved={() => refetch()} />
        <ImportDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          title="Importar alumnos"
          entity="students"
          related={STUDENTS_RELATED}
          api={studentsImportApi}
          headers={IMPORT_HEADERS}
          templatePrefix="alumnos"
          description={<>Cree o actualice alumnos por matrícula (se aceptan <code>ci09932</code> y <code>09932</code>) y vincule a sus tutores por correo. CSV o Excel.</>}
        />
        <FamilyLinkDialog
          open={!!linkFamily}
          onClose={() => setLinkFamily(null)}
          mode={{ kind: 'new' }}
          preselected={linkFamily ?? undefined}
          onDone={() => selection.onClear()}
        />
        <ImportLoyverseModal open={importLoyverseOpen} onClose={() => setImportLoyverseOpen(false)} onImported={() => refetch()} />
        {importStaffOpen && <ImportStaffModal open onClose={() => setImportStaffOpen(false)} onImported={() => { void refetch(); if (!personal) navigate('/admin/personal'); }} />}
        <LinkLoyverseModal open={linkOpen} onClose={() => setLinkOpen(false)} onLinked={() => refetch()} />
        <GrantConsoleAccessModal person={granting} onClose={() => setGranting(null)} />
        <RemoveConsoleAccessDialog person={removing} onClose={() => setRemoving(null)} />

        {personal && (
          <p className="-mt-3 text-sm text-muted">
            No cuentan como alumnos ni reciben comunicados de familias.
            {canDelete && <> Para traer al personal de Loyverse use <button type="button" className="font-semibold text-purple underline-offset-2 hover:underline" onClick={() => setImportStaffOpen(true)}>Importar personal desde Loyverse</button>.</>}
          </p>
        )}

        {/* The note leaves once nobody is left to review (the table says «Sin resultados»). */}
        {vinculado === MISSING ? (isLoading || count > 0) && (
          <div role="note" className="flex flex-col gap-3 rounded-md border border-amber/40 bg-amber/[0.08] px-4 py-3 text-sm text-ink sm:flex-row sm:items-center sm:justify-between">
            <p>
              <strong>{personal ? 'Estas personas ya no existen en Loyverse' : 'Estos alumnos ya no existen en Loyverse'}</strong>, así que no pueden comprar en cafetería.{' '}
              {canDelete
                ? <>Selecciónelos y use <strong>Eliminar</strong>: se borran por completo quienes no tienen nada que conservar, y se archivan los demás (salen de la lista y su historial se conserva).</>
                : <>Selecciónelos y use <strong>Archivar</strong>: salen de la lista y su historial se conserva.</>}
            </p>
            {count > 0 && (
              <button type="button" className="btn-outline min-h-[44px] shrink-0 sm:min-h-[40px]" onClick={selection.onSelectAllMatching}>
                Seleccionar {count === 1 ? (personal ? 'a la persona' : 'al alumno') : `${personal ? 'las' : 'los'} ${count.toLocaleString('es-MX')}`}
              </button>
            )}
          </div>
        ) : missingCount > 0 && (
          <Link
            to={`${base}?vinculado=${MISSING}`}
            className="flex flex-col gap-2 rounded-md border border-amber/40 bg-amber/[0.08] px-4 py-3 text-sm text-ink transition hover:border-amber focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="flex items-center gap-2.5">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber" aria-hidden="true" />
              <span>
                <strong>{plural(missingCount, noun.one, noun.many)}</strong> ya no {missingCount === 1 ? 'tiene' : 'tienen'} cliente en Loyverse:{' '}
                {personal ? 'probablemente ya no trabajan aquí.' : 'probablemente ya no estudian aquí.'}
              </span>
            </span>
            <span className="flex items-center gap-1 font-semibold text-purple">Revisarlos <ArrowRight className="h-4 w-4" aria-hidden="true" /></span>
          </Link>
        )}

        <Card title={personal
          ? `${count.toLocaleString('es-MX')} ${count === 1 ? 'persona del personal' : 'personas del personal'}`
          : `${count.toLocaleString('es-MX')} ${count === 1 ? 'alumno' : 'alumnos'}`}>
          {/* «1 alumno encontrado», never «1 alumnos encontrados» (QA 2026-11-24). */}
          <p role="status" aria-live="polite" className="sr-only">
            {count === 1
              ? (personal ? '1 persona del personal encontrada' : '1 alumno encontrado')
              : `${count} ${personal ? 'personas del personal encontradas' : 'alumnos encontrados'}`}
          </p>
          <DataTable<RosterStudent>
            // Each list keeps its own column choices (their columns differ).
            tableId={personal ? 'staff-roster' : 'students'}
            columns={columns}
            rows={students}
            rowKey={(s) => s.id}
            rowLabel={(s) => s.user.full_name}
            caption={personal ? 'Directorio del personal' : 'Directorio de alumnos'}
            sort={sort}
            onSort={onSort}
            page={page}
            count={count}
            onPage={setPage}
            itemLabel={noun.many}
            isLoading={isLoading}
            isError={isError}
            onRetry={() => refetch()}
            columnControls
            resizable
            pinFirstColumn
            pinActions
            selection={selection}
            // 2xl: the student opens in the panel beside the list; closing it points at the row.
            openKey={twoPane ? selectedId : null}
            rowActions={(s) => (
              <>
                {/* From lg the name is this link, and the pinned column has no room to spare. */}
                <Link to={`${base}/${s.id}`} className={`${ROW_ACTION} lg:hidden`} title="Ver ficha" aria-label={`Ver ficha de ${s.user.full_name}`}>
                  <RowActionLabel icon={Eye} label="Ficha" />
                </Link>
                <button type="button" onClick={() => setEditing(s)} className={ROW_ACTION} title="Editar" aria-label={`Editar a ${s.user.full_name}`}>
                  <RowActionLabel icon={Pencil} label="Editar" />
                </button>
                {/* From lg one inline action (Editar) plus the menu; below lg the
                    table folds everything into its «Acciones» popover anyway. */}
                {canCafeteria && !isLg && (
                  <Link to={`/admin/cafeteria/${s.id}`} className={ROW_ACTION} title="Cafetería" aria-label={`Cafetería de ${s.user.full_name}`}>
                    <RowActionLabel icon={Wallet} label="Cafetería" />
                  </Link>
                )}
                {isLg ? (
                  <RowActionsMenu
                    label={`Más acciones para ${s.user.full_name}`}
                    items={[
                      ...(canCafeteria ? [{
                        key: 'cafeteria', label: 'Cafetería', icon: Wallet, ariaLabel: `Cafetería de ${s.user.full_name}`,
                        onSelect: () => navigate(`/admin/cafeteria/${s.id}`),
                      }] : []),
                      ...consoleItems(s),
                      ...lifecycleItems(s),
                    ]}
                  />
                ) : [...consoleItems(s), ...lifecycleItems(s)].map((it) => {
                  const Icon = it.icon!;
                  return (
                    <Fragment key={it.key}>
                      {it.danger && <div role="separator" className="my-0.5 h-px bg-line" />}
                      <button type="button" onClick={it.onSelect} className={it.danger ? MENU_BUTTON_DANGER : MENU_BUTTON} aria-label={it.ariaLabel ?? `${it.label} a ${s.user.full_name}`}>
                        <Icon size={16} aria-hidden="true" /> {it.label}
                      </button>
                    </Fragment>
                  );
                })}
              </>
            )}
            toolbar={(
              <FilterBar
                search={personal
                  ? { placeholder: 'Buscar por nombre, código o correo…', label: 'Buscar personal' }
                  : { placeholder: 'Buscar por nombre, matrícula, correo o grado…', label: 'Buscar alumnos' }}
                tabs={{ paramKey: 'estado', options: statusTabs, allLabel: null, defaultValue: 'active', label: 'Filtrar por estado' }}
                selects={[
                  ...(personal ? [
                    { key: 'puesto', label: 'Puesto', options: PUESTO_OPTIONS, allLabel: 'Todos los puestos' },
                  ] : [
                    { key: 'nivel', label: 'Nivel', options: NIVELES.map(([value, label]) => ({ value, label })), allLabel: 'Todos los niveles' },
                    {
                      key: 'grado', label: 'Grado', allLabel: 'Todos los grados',
                      options: GRADES.filter((g) => !nivel || g.toLowerCase().includes(nivel)).map((g) => ({ value: g, label: g })),
                    },
                  ]),
                  { key: 'acceso', label: 'Acceso al portal', options: ACCESS_OPTIONS, allLabel: 'Acceso: todos' },
                  { key: 'vinculado', label: 'Loyverse', options: LINKED_OPTIONS, allLabel: 'Loyverse: todos' },
                ]}
                extraChips={grupo ? [{ key: 'grupo', label: `Grupo: ${grupo}`, onClear: () => set({ grupo: null, page: null }) }] : []}
              >
                {!personal && (
                  <input
                    className="input-field w-24"
                    aria-label="Grupo"
                    placeholder="Grupo"
                    maxLength={5}
                    autoComplete="off"
                    value={grupo}
                    onChange={(e) => set({ grupo: e.target.value.toUpperCase() || null, page: null })}
                  />
                )}
              </FilterBar>
            )}
            bulkBar={(
              <BulkActionBar
                count={selection.count}
                allMatching={selection.allMatching}
                allMatchingCount={count}
                onSelectAllMatching={selection.onSelectAllMatching}
                onClear={selection.onClear}
                itemLabel={noun.many}
                gender={noun.gender}
                actions={bulkActions}
                inline={6}
                onAction={startBulk}
                busy={bulk.isPending}
                exportMenu={<ExportMenu label={personal ? 'Exportar seleccionadas' : 'Exportar seleccionados'} filenamePrefix={personal ? 'personal' : 'alumnos'} selectedCount={selection.count} forceSelected fetch={fetchExport} />}
              />
            )}
            empty={personal ? {
              icon: Briefcase,
              title: viewingArchived ? 'No hay personal archivado' : anyFilter ? 'Sin resultados' : 'Sin personal registrado',
              description: anyFilter || viewingArchived
                ? 'Nadie del personal coincide con los filtros.'
                : 'El personal que compra en cafetería aparecerá aquí.',
              action: anyFilter || viewingArchived || !canDelete ? undefined : (
                <button type="button" className="btn-outline" onClick={() => setImportStaffOpen(true)}>
                  <Download size={16} aria-hidden="true" /> Importar personal desde Loyverse
                </button>
              ),
            } : {
              icon: Users,
              title: viewingArchived ? 'No hay alumnos archivados' : anyFilter ? 'Sin resultados' : 'Sin alumnos',
              description: viewingArchived
                ? 'Los alumnos que archive aparecerán aquí, con la opción de restaurarlos.'
                : anyFilter ? 'Ningún alumno coincide con los filtros.' : 'Los alumnos registrados aparecerán aquí.',
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
          title={picking ? `${picking.label}: ${plural(selection.count, noun.one, noun.many)}` : ''}
          onSubmit={pickedValue}
          {...pickerProps}
        />
        <BulkConfirmDialog
          open={!!confirming}
          onClose={() => setConfirming(null)}
          action={confirming?.action ?? null}
          payload={confirming?.payload}
          entityLabel={noun.many}
          gender={noun.gender}
          ids={confirming?.one ? [confirming.one.id] : selection.ids}
          allMatching={confirming?.one ? false : selection.allMatching}
          subject={confirming?.one?.user.full_name}
          filters={filters}
          execute={(body) => bulk.mutateAsync(body)}
          renderPlan={removalPlanNote(confirming?.action)}
          onDone={(r) => {
            const action = confirming?.action;
            const ids = confirming?.one ? [confirming.one.id] : selection.allMatching ? [] : selection.ids.map(Number);
            if (!r.failed.length) selection.onClear();
            if (action && ['archive', 'delete'].includes(action.name)) setSelectedId(null);
            if (action) afterAction(action, ids, r);
          }}
        />
      </div>
      {twoPane && selectedId && (
        <aside className="min-w-0 rounded-md bg-white p-5 2xl:sticky 2xl:top-20 2xl:max-h-[calc(100svh-6rem)] 2xl:overflow-y-auto shadow-card" aria-label={personal ? 'Detalle de la persona' : 'Detalle del alumno'}>
          <div className="mb-2 flex justify-end"><button type="button" className="text-xs text-subtle hover:text-ink" onClick={() => setSelectedId(null)}>Cerrar panel</button></div>
          <AdminStudentDetail id={selectedId} embedded onDeleted={() => setSelectedId(null)} />
        </aside>
      )}
    </div>
  );
}
