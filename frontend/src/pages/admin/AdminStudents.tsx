import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Users, Search } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { portalApi } from '@/services/api';
import type { StudentProfile } from '@/types';

export default function AdminStudents() {
  const [search, setSearch] = useState('');

  const { data: students, isLoading } = useQuery<StudentProfile[]>({
    queryKey: ['admin-students'],
    queryFn: async () => {
      const { data } = await portalApi.getStudents();
      return data.results ?? data;
    },
  });

  const filtered = students?.filter((s) =>
    !search ||
    s.user.full_name.toLowerCase().includes(search.toLowerCase()) ||
    s.student_id.toLowerCase().includes(search.toLowerCase()) ||
    s.grade.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-fluid-xl font-bold text-ink">Alumnos</h1>
        <p className="text-muted text-sm mt-0.5">Directorio de alumnos activos.</p>
      </div>

      <Card title={`${students?.length ?? 0} alumnos registrados`}>
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
          <input
            className="input-field pl-9"
            placeholder="Buscar por nombre, matrícula o grado…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {isLoading ? (
          <LoadingSpinner />
        ) : !filtered?.length ? (
          <EmptyState icon={Users} title="Sin alumnos" description="Los alumnos registrados aparecerán aquí." />
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

            {/* Desktop: table */}
            <div className="hidden md:block w-full overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th className="text-left py-2 pr-4 text-xs font-semibold text-muted">Nombre</th>
                    <th className="text-left py-2 pr-4 text-xs font-semibold text-muted">Matrícula</th>
                    <th className="text-left py-2 pr-4 text-xs font-semibold text-muted">Grado</th>
                    <th className="text-left py-2 pr-4 text-xs font-semibold text-muted">Grupo</th>
                    <th className="text-left py-2 text-xs font-semibold text-muted">Correo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filtered.map((s) => (
                    <tr key={s.id} className="hover:bg-cream">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                            {s.user.first_name[0]}
                          </div>
                          <span className="font-medium text-ink">{s.user.full_name}</span>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-muted">{s.student_id}</td>
                      <td className="py-3 pr-4 text-muted">{s.grade}</td>
                      <td className="py-3 pr-4 text-muted">{s.group}</td>
                      <td className="py-3 text-subtle text-xs">{s.user.email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
