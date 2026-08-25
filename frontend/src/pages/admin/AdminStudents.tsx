import { useMutation, useQuery, keepPreviousData } from '@tanstack/react-query';
import { useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { Users, Search, FileUp, Link2, Download, FileDown, Plus, ArrowUp, ArrowDown, ArrowUpDown, Columns3, Rows3, MoreHorizontal } from 'lucide-react';
import toast from 'react-hot-toast';
import { ImportStudentsModal } from '@/components/admin/ImportStudentsModal';
import { ImportLoyverseModal } from '@/components/admin/ImportLoyverseModal';
import { LinkLoyverseModal } from '@/components/admin/LinkLoyverseModal';
import { StudentFormModal } from '@/components/admin/StudentFormModal';
import { ActiveFilterChips } from '@/components/admin/ActiveFilterChips';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TableSkeleton } from '@/components/ui/TableSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { portalApi, downloadBlob } from '@/services/api';
import { toPaged, ADMIN_PAGE_SIZE } from '@/lib/pagination';
import { useUrlFilters, useUrlPage, useUrlSyncedSearch } from '@/hooks/useUrlFilters';
import { STUDENT_STATUS } from '@/lib/studentStatus';
import { GRADES, NIVELES, ROSTER_COLUMNS, nextOrdering, readPrefs, sortIndicator, writePrefs, type RosterColumn } from '@/lib/rosterTable';
import { Dropdown } from '@/components/ui/Dropdown';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import AdminStudentDetail from './AdminStudentDetail';
import { Badge } from '@/components/ui/Badge';
import type { StudentProfile } from '@/types';
import { PageHeader } from '@/components/layout/PageHeader';

export default function AdminStudents() {
  // URL-synced filters (shareable, survive refresh); search writes are
  // debounced (300 ms) so the URL doesn't churn per keystroke.
  const { input: search, setInput: setSearch, search: debouncedSearch } = useUrlSyncedSearch('q');
  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const estado = get('estado');
  const acceso = get('acceso');
  const nivel = get('nivel');
  const grado = get('grado');
  const grupo = get('grupo');
  const ordering = get('orden');
  const [prefs, setPrefs] = useState(readPrefs);
  const updatePrefs = (p: Partial<typeof prefs>) => { const n = { ...prefs, ...p }; setPrefs(n); writePrefs(n); };
  const visible = (k: RosterColumn) => !prefs.hidden.includes(k);
  const [selected, setSelected] = useState<number[]>([]);
  const [bulk, setBulk] = useState<{ action: 'status' | 'group' | 'grade'; value: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(() => new URLSearchParams(window.location.search).get('nuevo') === '1');
  const [importLoyverseOpen, setImportLoyverseOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-students', page, debouncedSearch, estado, acceso, nivel, grado, grupo, ordering],
    queryFn: async () =>
      toPaged<StudentProfile>(
        (await portalApi.getStudents({ page, search: debouncedSearch || undefined, estado: estado || undefined, acceso: acceso || undefined, nivel: nivel || undefined, grado: grado || undefined, grupo: grupo || undefined, ordering: ordering || undefined })).data),
    placeholderData: keepPreviousData,
  });

  const bulkMutation = useMutation({
    mutationFn: (d: { action: 'status' | 'group' | 'grade'; value: string }) => portalApi.bulkStudents({ ids: selected, ...d }),
    onSuccess: ({ data: r }) => { toast.success(`${r.updated} alumnos actualizados.`); setSelected([]); setBulk(null); refetch(); },
    onError: () => toast.error('No se pudo aplicar el cambio.'),
  });
  const sortBy = (key?: string) => { if (!key) return; set({ orden: nextOrdering(ordering, key), page: null }); };
  const SortHeader = ({ col }: { col: (typeof ROSTER_COLUMNS)[number] }) => {
    const ind = col.sort ? sortIndicator(ordering, col.sort) : null;
    return (
      <th aria-sort={ind === 'asc' ? 'ascending' : ind === 'desc' ? 'descending' : undefined}>
        {col.sort ? (
          <button type="button" onClick={() => sortBy(col.sort)} className="inline-flex items-center gap-1 hover:text-ink">{col.label}{ind === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : ind === 'desc' ? <ArrowDown size={12} aria-hidden="true" /> : <ArrowUpDown size={12} className="opacity-40" aria-hidden="true" />}</button>
        ) : col.label}
      </th>
    );
  };

  const exportCsv = useMutation({
    mutationFn: async () =>
      (await portalApi.exportStudents(debouncedSearch || undefined)).data as Blob,
    onSuccess: (blob) => downloadBlob(blob, 'alumnos.csv'),
    onError: () => toast.error('No se pudo generar el archivo.'),
  });

  // Server-side search across the whole roster (SearchFilter on the viewset).
  const students = data?.results;
  const count = data?.count ?? 0;

  // Large screens (2xl, docs/RESPONSIVE.md): list on the left, detail on the right, no navigation.
  const twoPane = useMediaQuery('(min-width: 1536px)');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const openStudent = (e: MouseEvent, id: number) => {
    if (!twoPane || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    setSelectedId(id);
  };

  const SECONDARY = [
    { key: 'loyverse', label: 'Importar desde Loyverse', icon: Download },
    { key: 'link', label: 'Vincular Loyverse', icon: Link2 },
    { key: 'csv-in', label: 'Importar CSV', icon: FileUp },
    { key: 'csv-out', label: 'Exportar CSV', icon: FileDown },
  ] as const;
  const runSecondary = (key: (typeof SECONDARY)[number]['key']) => {
    if (key === 'loyverse') setImportLoyverseOpen(true);
    else if (key === 'link') setLinkOpen(true);
    else if (key === 'csv-in') setImportOpen(true);
    else exportCsv.mutate();
  };

  return (
    <div className={twoPane && selectedId ? 'grid gap-6 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : 'space-y-6'}>
    <div className="space-y-6 min-w-0">
      <PageHeader
        title="Alumnos"
        subtitle="Directorio de alumnos activos."
        actions={(
          <>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-pink" onClick={() => setCreateOpen(true)}>
              <Plus size={16} aria-hidden="true" /> Nuevo alumno
            </button>
            {/* Five stacked full-width buttons filled the entire first screen at
                390px before a single alumno was visible. The primary action
                stays; the rest collapse into one menu on phones. */}
            <div className="hidden flex-wrap gap-2 sm:flex">
              {SECONDARY.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  className="btn-outline"
                  disabled={key === 'csv-out' && exportCsv.isPending}
                  onClick={() => runSecondary(key)}
                >
                  <Icon size={16} aria-hidden="true" /> {key === 'csv-out' && exportCsv.isPending ? 'Exportando…' : label}
                </button>
              ))}
            </div>
            <div className="sm:hidden">
              <Dropdown
                width={260}
                trigger={({ open, toggle }) => (
                  <button
                    type="button"
                    className="btn-outline"
                    aria-haspopup="true"
                    aria-expanded={open}
                    onClick={toggle}
                  >
                    <MoreHorizontal size={16} aria-hidden="true" /> Más acciones
                  </button>
                )}
              >
                {({ close }) => (
                  <div className="py-1">
                    {SECONDARY.map(({ key, label, icon: Icon }) => (
                      <button
                        key={key}
                        type="button"
                        className="flex min-h-[44px] w-full items-center gap-2 px-4 text-left text-sm text-ink hover:bg-cream disabled:opacity-60"
                        disabled={key === 'csv-out' && exportCsv.isPending}
                        onClick={() => { close(); runSecondary(key); }}
                      >
                        <Icon size={16} aria-hidden="true" /> {key === 'csv-out' && exportCsv.isPending ? 'Exportando…' : label}
                      </button>
                    ))}
                  </div>
                )}
              </Dropdown>
            </div>
          </div>
          </>
        )}
      />
      <StudentFormModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => refetch()} />
      <ImportStudentsModal open={importOpen} onClose={() => setImportOpen(false)} />
      <ImportLoyverseModal
        open={importLoyverseOpen}
        onClose={() => setImportLoyverseOpen(false)}
        onImported={() => refetch()}
      />
      <LinkLoyverseModal open={linkOpen} onClose={() => setLinkOpen(false)} onLinked={() => refetch()} />

      <Card title={`${count} alumnos registrados`}>
        <p role="status" aria-live="polite" className="sr-only">{count} alumnos encontrados</p>
        <div className="relative mb-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
          <input
            className="input-field pl-9"
            placeholder="Buscar por nombre, matrícula, correo o grado…"
            aria-label="Buscar alumnos"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <p className="mb-3 text-xs text-subtle">Busca en todo el directorio de alumnos.</p>
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div>
            <label className="label" htmlFor="f-nivel">Nivel</label>
            <select id="f-nivel" className="input-field min-h-[44px]" value={nivel} onChange={(e) => set({ nivel: e.target.value || null, grado: null, page: null })}>
              <option value="">Todos</option>
              {NIVELES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="f-grado">Grado</label>
            <select id="f-grado" className="input-field min-h-[44px]" value={grado} onChange={(e) => set({ grado: e.target.value || null, page: null })}>
              <option value="">Todos</option>
              {GRADES.filter((g) => !nivel || g.toLowerCase().includes(nivel)).map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="f-grupo">Grupo</label>
            <input id="f-grupo" className="input-field min-h-[44px]" value={grupo} maxLength={5} placeholder="A" onChange={(e) => set({ grupo: e.target.value.toUpperCase() || null, page: null })} />
          </div>
          <div>
            <label className="label" htmlFor="f-estado">Estado</label>
            <select id="f-estado" className="input-field min-h-[44px]" value={estado} onChange={(e) => set({ estado: e.target.value || null, page: null })}>
              <option value="">Todos</option>
              {Object.entries(STUDENT_STATUS).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="f-acceso">Acceso al portal</label>
            <select id="f-acceso" className="input-field min-h-[44px]" value={acceso} onChange={(e) => set({ acceso: e.target.value || null, page: null })}>
              <option value="">Todos</option>
              <option value="never">Nunca ha iniciado sesión</option>
              <option value="nopass">Sin contraseña asignada</option>
            </select>
          </div>
        </div>

        <ActiveFilterChips
          chips={[
            ...(debouncedSearch ? [{ key: 'q', label: `Búsqueda: “${debouncedSearch}”`, onClear: () => setSearch('') }] : []),
            ...(estado ? [{ key: 'estado', label: `Estado: ${STUDENT_STATUS[estado as keyof typeof STUDENT_STATUS]?.label ?? estado}`, onClear: () => set({ estado: null }) }] : []),
            ...(acceso ? [{ key: 'acceso', label: acceso === 'never' ? 'Nunca ha iniciado sesión' : 'Sin contraseña', onClear: () => set({ acceso: null }) }] : []),
          ]}
          onClearAll={() => { setSearch(''); set({ estado: null, acceso: null }); }}
        />

        {isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : isLoading ? (
          <TableSkeleton />
        ) : !students?.length ? (
          <EmptyState
            icon={Users}
            title={debouncedSearch ? 'Sin resultados' : 'Sin alumnos'}
            description={debouncedSearch ? 'Ningún alumno coincide con la búsqueda.' : 'Los alumnos registrados aparecerán aquí.'}
            action={debouncedSearch ? undefined : (
              <button type="button" className="btn-outline" onClick={() => setImportOpen(true)}>
                <FileUp size={16} aria-hidden="true" /> Importar CSV
              </button>
            )}
          />
        ) : (
          <>
            {/* Table tools (P1-A8): column chooser + density; bulk bar when rows are selected */}
            <div className="mb-2 hidden flex-wrap items-center justify-between gap-2 md:flex">
              <div className="flex items-center gap-2 text-sm text-muted">
                {selected.length > 0 ? (
                  <>
                    <span className="font-semibold text-ink">{selected.length} seleccionados</span>
                    <select className="input-field !min-h-[36px] !py-1 text-sm" aria-label="Acción masiva" value={bulk ? `${bulk.action}:${bulk.value}` : ''} onChange={(e) => { const [action, value] = e.target.value.split(':'); setBulk(action ? { action: action as 'status' | 'group' | 'grade', value } : null); }}>
                      <option value="">Acción…</option>
                      <optgroup label="Cambiar estado">{Object.entries(STUDENT_STATUS).map(([v, m]) => <option key={v} value={`status:${v}`}>{m.label}</option>)}</optgroup>
                      <optgroup label="Cambiar grupo">{['A', 'B', 'C'].map((g) => <option key={g} value={`group:${g}`}>Grupo {g}</option>)}</optgroup>
                      <optgroup label="Cambiar grado">{GRADES.map((g) => <option key={g} value={`grade:${g}`}>{g}</option>)}</optgroup>
                    </select>
                    <Button size="sm" disabled={!bulk} loading={bulkMutation.isPending} onClick={() => bulk && bulkMutation.mutate(bulk)}>Aplicar</Button>
                    <button type="button" className="text-xs text-subtle hover:text-ink" onClick={() => setSelected([])}>Quitar selección</button>
                  </>
                ) : <span>Seleccione filas para acciones masivas.</span>}
              </div>
              <div className="flex items-center gap-1">
                <button type="button" aria-pressed={prefs.dense} aria-label="Vista compacta" title="Vista compacta" onClick={() => updatePrefs({ dense: !prefs.dense })} className={`rounded-lg p-2 ${prefs.dense ? 'bg-purple/10 text-purple' : 'text-subtle hover:text-ink'}`}><Rows3 size={16} /></button>
                <Dropdown width={220} trigger={({ toggle, open }) => (
                  <button type="button" onClick={toggle} aria-expanded={open} aria-label="Columnas" title="Columnas" className="rounded-lg p-2 text-subtle hover:text-ink"><Columns3 size={16} /></button>
                )}>
                  {() => (
                    <div className="p-2" role="group" aria-label="Columnas visibles">
                      {ROSTER_COLUMNS.map((c) => (
                        <label key={c.key} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-cream-2">
                          <input type="checkbox" checked={visible(c.key)} onChange={(e) => updatePrefs({ hidden: e.target.checked ? prefs.hidden.filter((k) => k !== c.key) : [...prefs.hidden, c.key] })} /> {c.label}
                        </label>
                      ))}
                    </div>
                  )}
                </Dropdown>
              </div>
            </div>

            {/* Mobile: stacked cards */}
            <ul className="space-y-3 md:hidden">
              {students.map((s) => (
                <li key={s.id} className="rounded-xl2 border border-line p-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                      {s.user.first_name[0]}
                    </div>
                    <div className="min-w-0">
                      <Link to={`/admin/alumnos/${s.id}`} onClick={(e) => openStudent(e, s.id)} className="block truncate font-medium text-ink hover:text-purple hover:underline">{s.user.full_name}</Link>
                      <p className="text-subtle text-xs truncate">{s.user.email}</p>
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-xs font-semibold text-muted">Matrícula</dt>
                      <dd className="text-muted">{s.student_id}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-muted">Grado</dt>
                      <dd className="text-muted">{s.grade}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-muted">Grupo</dt>
                      <dd className="text-muted">{s.group}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>

            {/* Desktop: dense table */}
            <div className="admin-table-wrap hidden md:block">
              <table className={`admin-table ${prefs.dense ? 'admin-table--dense' : ''}`}>
                <thead>
                  <tr>
                    <th className="w-8"><input type="checkbox" aria-label="Seleccionar todos" checked={students.length > 0 && students.every((s) => selected.includes(s.id))} onChange={(e) => setSelected(e.target.checked ? Array.from(new Set([...selected, ...students.map((s) => s.id)])) : selected.filter((id) => !students.some((s) => s.id === id)))} /></th>
                    <th aria-sort={sortIndicator(ordering, 'name') === 'asc' ? 'ascending' : sortIndicator(ordering, 'name') === 'desc' ? 'descending' : undefined}>
                      <button type="button" onClick={() => sortBy('name')} className="inline-flex items-center gap-1 hover:text-ink">Nombre{sortIndicator(ordering, 'name') === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : sortIndicator(ordering, 'name') === 'desc' ? <ArrowDown size={12} aria-hidden="true" /> : <ArrowUpDown size={12} className="opacity-40" aria-hidden="true" />}</button>
                    </th>
                    {ROSTER_COLUMNS.filter((c) => visible(c.key)).map((c) => <SortHeader key={c.key} col={c} />)}
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.id} className={selected.includes(s.id) ? 'bg-purple/[0.04]' : undefined}>
                      <td><input type="checkbox" aria-label={`Seleccionar ${s.user.full_name}`} checked={selected.includes(s.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, s.id] : selected.filter((id) => id !== s.id))} /></td>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                            {s.user.first_name[0]}
                          </div>
                          <Link to={`/admin/alumnos/${s.id}`} onClick={(e) => openStudent(e, s.id)} className="font-medium text-ink hover:text-purple hover:underline" aria-current={selectedId === s.id ? 'true' : undefined}>{s.user.full_name}</Link>
                        </div>
                      </td>
                      {visible('student_id') && <td className="text-muted">{s.student_id}</td>}
                      {visible('grade') && <td className="text-muted">{s.grade}</td>}
                      {visible('group') && <td className="text-muted">{s.group}</td>}
                      {visible('email') && <td className="text-subtle text-xs">{s.user.email}</td>}
                      {visible('status') && <td><Badge variant={STUDENT_STATUS[s.status ?? 'active']?.variant ?? 'neutral'}>{STUDENT_STATUS[s.status ?? 'active']?.label ?? s.status}</Badge></td>}
                      {visible('last_login') && <td className="text-subtle text-xs">{s.user.last_login ? new Date(s.user.last_login).toLocaleDateString('es-MX') : <span className="text-coral-600">Nunca</span>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} count={count} onChange={setPage} itemLabel="alumnos" />
      </Card>
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
