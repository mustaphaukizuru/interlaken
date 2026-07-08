import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ClipboardList, Search } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
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

  const { data: preRegs, isLoading, isError, refetch } = useQuery<PreReg[]>({
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
        <h1 className="text-fluid-xl font-bold text-ink">Admisiones</h1>
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
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : !filtered?.length ? (
          <EmptyState
            icon={ClipboardList}
            title={search ? 'Sin resultados' : 'Sin pre-registros'}
            description={search ? 'Ningún pre-registro coincide con la búsqueda.' : 'Los pre-registros aparecerán aquí cuando se reciban.'}
          />
        ) : (
          <>
            {/* Mobile: stacked cards */}
            <ul className="space-y-3 md:hidden">
              {filtered.map((p) => {
                const meta = statusMeta[p.status] ?? statusMeta.pending;
                return (
                  <li key={p.id} className="rounded-xl2 border border-line p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{p.child_name}</p>
                        <p className="text-xs text-subtle">Grado: {p.grade_applying}</p>
                      </div>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </div>
                    <dl className="mt-3 space-y-1 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Tutor</dt>
                        <dd className="text-ink text-right">{p.parent_name}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Correo</dt>
                        <dd className="text-ink text-right break-all">{p.email}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Teléfono</dt>
                        <dd className="text-ink text-right">{p.phone}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Fecha</dt>
                        <dd className="text-subtle text-right">{format(new Date(p.created_at), 'd MMM yyyy', { locale: es })}</dd>
                      </div>
                    </dl>
                  </li>
                );
              })}
            </ul>

            {/* Desktop: dense table */}
            <div className="admin-table-wrap hidden md:block">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Alumno</th>
                    <th>Grado</th>
                    <th>Tutor</th>
                    <th>Contacto</th>
                    <th>Fecha</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const meta = statusMeta[p.status] ?? statusMeta.pending;
                    return (
                      <tr key={p.id}>
                        <td className="font-medium text-ink">{p.child_name}</td>
                        <td className="text-muted">{p.grade_applying}</td>
                        <td className="text-muted">{p.parent_name}</td>
                        <td>
                          <div className="text-muted">{p.email}</div>
                          <div className="text-subtle text-xs">{p.phone}</div>
                        </td>
                        <td className="text-subtle whitespace-nowrap">
                          {format(new Date(p.created_at), 'd MMM yyyy', { locale: es })}
                        </td>
                        <td>
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
