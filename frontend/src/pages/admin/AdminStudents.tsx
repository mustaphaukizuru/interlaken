import { useMutation, useQuery, keepPreviousData } from '@tanstack/react-query';
import { useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { Users, Search, FileUp, Link2, Download, FileDown, Plus } from 'lucide-react';
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
import { useMediaQuery } from '@/hooks/useMediaQuery';
import AdminStudentDetail from './AdminStudentDetail';
import { Badge } from '@/components/ui/Badge';
import type { StudentProfile } from '@/types';

export default function AdminStudents() {
  // URL-synced filters (shareable, survive refresh); search writes are
  // debounced (300 ms) so the URL doesn't churn per keystroke.
  const { input: search, setInput: setSearch, search: debouncedSearch } = useUrlSyncedSearch('q');
  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const estado = get('estado');
  const acceso = get('acceso');
  const [importOpen, setImportOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(() => new URLSearchParams(window.location.search).get('nuevo') === '1');
  const [importLoyverseOpen, setImportLoyverseOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-students', page, debouncedSearch, estado, acceso],
    queryFn: async () =>
      toPaged<StudentProfile>(
        (await portalApi.getStudents({ page, search: debouncedSearch || undefined, estado: estado || undefined, acceso: acceso || undefined })).data),
    placeholderData: keepPreviousData,
  });

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

  return (
    <div className={twoPane && selectedId ? 'grid gap-6 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : 'space-y-6'}>
    <div className="space-y-6 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-head text-fluid-xl font-bold leading-tight tracking-[-0.3px] text-ink">Alumnos</h1>
          <p className="text-muted text-sm mt-0.5">Directorio de alumnos activos.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-pink" onClick={() => setCreateOpen(true)}>
            <Plus size={16} aria-hidden="true" /> Nuevo alumno
          </button>
          <button type="button" className="btn-outline" onClick={() => setImportLoyverseOpen(true)}>
            <Download size={16} aria-hidden="true" /> Importar desde Loyverse
          </button>
          <button type="button" className="btn-outline" onClick={() => setLinkOpen(true)}>
            <Link2 size={16} aria-hidden="true" /> Vincular Loyverse
          </button>
          <button type="button" className="btn-outline" onClick={() => setImportOpen(true)}>
            <FileUp size={16} aria-hidden="true" /> Importar CSV
          </button>
          <Button variant="secondary" loading={exportCsv.isPending} onClick={() => exportCsv.mutate()}>
            <FileDown size={16} aria-hidden="true" /> Exportar CSV
          </Button>
        </div>
      </div>
      <StudentFormModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => refetch()} />
      <ImportStudentsModal open={importOpen} onClose={() => setImportOpen(false)} />
      <ImportLoyverseModal
        open={importLoyverseOpen}
        onClose={() => setImportLoyverseOpen(false)}
        onImported={() => refetch()}
      />
      <LinkLoyverseModal open={linkOpen} onClose={() => setLinkOpen(false)} onLinked={() => refetch()} />

      <Card title={`${count} alumnos registrados`}>
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
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:max-w-xl">
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
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Matrícula</th>
                    <th>Grado</th>
                    <th>Grupo</th>
                    <th>Correo</th>
                    <th>Estado</th>
                    <th>Último acceso</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                            {s.user.first_name[0]}
                          </div>
                          <Link to={`/admin/alumnos/${s.id}`} onClick={(e) => openStudent(e, s.id)} className="font-medium text-ink hover:text-purple hover:underline" aria-current={selectedId === s.id ? 'true' : undefined}>{s.user.full_name}</Link>
                        </div>
                      </td>
                      <td className="text-muted">{s.student_id}</td>
                      <td className="text-muted">{s.grade}</td>
                      <td className="text-muted">{s.group}</td>
                      <td className="text-subtle text-xs">{s.user.email}</td>
                      <td><Badge variant={STUDENT_STATUS[s.status ?? 'active']?.variant ?? 'neutral'}>{STUDENT_STATUS[s.status ?? 'active']?.label ?? s.status}</Badge></td>
                      <td className="text-subtle text-xs">{s.user.last_login ? new Date(s.user.last_login).toLocaleDateString('es-MX') : <span className="text-coral-600">Nunca</span>}</td>
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
