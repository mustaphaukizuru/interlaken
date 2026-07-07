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
        <h1 className="text-xl font-bold text-slate-900">Alumnos</h1>
        <p className="text-slate-500 text-sm mt-0.5">Directorio de alumnos activos.</p>
      </div>

      <Card title={`${students?.length ?? 0} alumnos registrados`}>
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-slate-500">Nombre</th>
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-slate-500">Matrícula</th>
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-slate-500">Grado</th>
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-slate-500">Grupo</th>
                  <th className="text-left py-2 text-xs font-semibold text-slate-500">Correo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/50">
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                          {s.user.first_name[0]}
                        </div>
                        <span className="font-medium text-slate-900">{s.user.full_name}</span>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-slate-500">{s.student_id}</td>
                    <td className="py-3 pr-4 text-slate-700">{s.grade}</td>
                    <td className="py-3 pr-4 text-slate-700">{s.group}</td>
                    <td className="py-3 text-slate-400 text-xs">{s.user.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
