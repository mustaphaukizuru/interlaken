import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Search, FileUp, Link2, Download } from 'lucide-react';
import { ImportStudentsModal } from '@/components/admin/ImportStudentsModal';
import { ImportLoyverseModal } from '@/components/admin/ImportLoyverseModal';
import { LinkLoyverseModal } from '@/components/admin/LinkLoyverseModal';
import { Card } from '@/components/ui/Card';
import { TableSkeleton } from '@/components/ui/TableSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { portalApi } from '@/services/api';
import { toPaged, ADMIN_PAGE_SIZE } from '@/lib/pagination';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { StudentProfile } from '@/types';

export default function AdminStudents() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);
  const [importLoyverseOpen, setImportLoyverseOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  // Debounced so typing fires one server search, not one per keystroke.
  const debouncedSearch = useDebouncedValue(search.trim(), 350);

  // A new search always starts from page 1.
  useEffect(() => { setPage(1); }, [debouncedSearch]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-students', page, debouncedSearch],
    queryFn: async () =>
      toPaged<StudentProfile>(
        (await portalApi.getStudents({ page, search: debouncedSearch || undefined })).data),
    placeholderData: keepPreviousData,
  });

  // Server-side search across the whole roster (SearchFilter on the viewset).
  const students = data?.results;
  const count = data?.count ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-head text-fluid-xl font-bold leading-tight tracking-[-0.3px] text-ink">Alumnos</h1>
          <p className="text-muted text-sm mt-0.5">Directorio de alumnos activos.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-outline" onClick={() => setImportLoyverseOpen(true)}>
            <Download size={16} aria-hidden="true" /> Importar desde Loyverse
          </button>
          <button type="button" className="btn-outline" onClick={() => setLinkOpen(true)}>
            <Link2 size={16} aria-hidden="true" /> Vincular Loyverse
          </button>
          <button type="button" className="btn-outline" onClick={() => setImportOpen(true)}>
            <FileUp size={16} aria-hidden="true" /> Importar CSV
          </button>
        </div>
      </div>
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
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <p className="mb-4 text-xs text-subtle">Busca en todo el directorio de alumnos.</p>

        {isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : isLoading ? (
          <TableSkeleton />
        ) : !students?.length ? (
          <EmptyState
            icon={Users}
            title={debouncedSearch ? 'Sin resultados' : 'Sin alumnos'}
            description={debouncedSearch ? 'Ningún alumno coincide con la búsqueda.' : 'Los alumnos registrados aparecerán aquí.'}
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
                      <Link to={`/admin/alumnos/${s.id}`} className="block truncate font-medium text-ink hover:text-purple hover:underline">{s.user.full_name}</Link>
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
                          <Link to={`/admin/alumnos/${s.id}`} className="font-medium text-ink hover:text-purple hover:underline">{s.user.full_name}</Link>
                        </div>
                      </td>
                      <td className="text-muted">{s.student_id}</td>
                      <td className="text-muted">{s.grade}</td>
                      <td className="text-muted">{s.group}</td>
                      <td className="text-subtle text-xs">{s.user.email}</td>
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
  );
}
