import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ClipboardList, Search } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { api } from '@/services/api';

interface PreReg {
  id: number;
  child_name: string;
  grade_applying: string;
  parent_name: string;
  email: string;
  phone: string;
  status: string;
  created_at: string;
}

const statusMeta: Record<string, { label: string; variant: any }> = {
  pending:   { label: 'Pendiente',  variant: 'warning' },
  contacted: { label: 'Contactado', variant: 'info' },
  enrolled:  { label: 'Inscrito',   variant: 'success' },
  rejected:  { label: 'Rechazado',  variant: 'error' },
};

export default function AdminAdmissions() {
  const [search, setSearch] = useState('');

  const { data: preRegs, isLoading } = useQuery<PreReg[]>({
    queryKey: ['admin-preregistrations'],
    queryFn: async () => {
      const { data } = await api.get('/admissions/pre-register/');
      return data.results ?? data;
    },
  });

  const filtered = preRegs?.filter((p) =>
    !search ||
    p.child_name.toLowerCase().includes(search.toLowerCase()) ||
    p.parent_name.toLowerCase().includes(search.toLowerCase()) ||
    p.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink">Admisiones</h1>
        <p className="text-muted text-sm mt-0.5">Pre-registros e inscripciones recibidas.</p>
      </div>

      <Card title="Pre-registros">
        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
          <input
            className="input-field pl-9"
            placeholder="Buscar por nombre, correo…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {isLoading ? (
          <LoadingSpinner />
        ) : !filtered?.length ? (
          <EmptyState icon={ClipboardList} title="Sin pre-registros" description="Los pre-registros aparecerán aquí cuando se reciban." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-muted">Alumno</th>
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-muted">Grado</th>
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-muted">Tutor</th>
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-muted">Contacto</th>
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-muted">Fecha</th>
                  <th className="text-left py-2 text-xs font-semibold text-muted">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((p) => {
                  const meta = statusMeta[p.status] ?? statusMeta.pending;
                  return (
                    <tr key={p.id} className="hover:bg-cream">
                      <td className="py-3 pr-4 font-medium text-ink">{p.child_name}</td>
                      <td className="py-3 pr-4 text-muted">{p.grade_applying}</td>
                      <td className="py-3 pr-4 text-muted">{p.parent_name}</td>
                      <td className="py-3 pr-4">
                        <div className="text-muted">{p.email}</div>
                        <div className="text-subtle text-xs">{p.phone}</div>
                      </td>
                      <td className="py-3 pr-4 text-subtle whitespace-nowrap">
                        {format(new Date(p.created_at), 'd MMM yyyy', { locale: es })}
                      </td>
                      <td className="py-3">
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
