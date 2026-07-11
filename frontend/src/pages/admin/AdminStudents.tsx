import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useState } from 'react';
import { Users, Search, FileUp } from 'lucide-react';
import { ImportStudentsModal } from '@/components/admin/ImportStudentsModal';
import { Card } from '@/components/ui/Card';
import { TableSkeleton } from '@/components/ui/TableSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { portalApi } from '@/services/api';
import { toPaged, ADMIN_PAGE_SIZE } from '@/lib/pagination';
import type { StudentProfile } from '@/types';

export default function AdminStudents() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-students', page],
    queryFn: async () => toPaged<StudentProfile>((await portalApi.getStudents({ page })).data),
    placeholderData: keepPreviousData,
  });

  const students = data?.results;
  const count = data?.count ?? 0;

  // Server-side search needs `search_fields` on the viewset (follow-up); today the
  // box filters the loaded page only.
  const filtered = students?.filter((s) =>
    !search ||
    s.user.full_name.toLowerCase().includes(search.toLowerCase()) ||
    s.student_id.toLowerCase().includes(search.toLowerCase()) ||
    s.grade.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-fluid-xl font-bold text-ink">Alumnos</h1>
          <p className="text-muted text-sm mt-0.5">Directorio de alumnos activos.</p>
        </div>
        <button type="button" className="btn-outline" onClick={() => setImportOpen(true)}>
          <FileUp size={16} aria-hidden="true" /> Importar CSV
        </button>
      </div>
      <ImportStudentsModal open={importOpen} onClose={() => setImportOpen(false)} />

      <Card title={`${count} alumnos registrados`}>
        <div className="relative mb-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
          <input
            className="input-field pl-9"
            placeholder="Buscar por nombre, matrícula o grado…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <p className="mb-4 text-xs text-subtle">La búsqueda filtra la página actual.</p>

        {isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : isLoading ? (
          <TableSkeleton />
        ) : !filtered?.length ? (
          <EmptyState
            icon={Users}
            title={search ? 'Sin resultados' : 'Sin alumnos'}
            description={search ? 'Ningún alumno coincide en esta página.' : 'Los alumnos registrados aparecerán aquí.'}
          />
        ) : (
          <>
            {/* Mobile: stacked cards */}
            <ul className="space-y-3 md:hidden">
              {filtered.map((s) => (
                <li key={s.id} className="rounded-xl2 border border-line p-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                      {s.user.first_name[0]}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-ink truncate">{s.user.full_name}</p>
                      <p className="text-subtle text-xs truncate">{s.user.email}</p>
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
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
                  {filtered.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                            {s.user.first_name[0]}
                          </div>
                          <span className="font-medium text-ink">{s.user.full_name}</span>
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
