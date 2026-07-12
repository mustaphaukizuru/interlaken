import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useState } from 'react';
import { ClipboardList, Search } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { TableSkeleton } from '@/components/ui/TableSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { api } from '@/services/api';
import { toPaged, ADMIN_PAGE_SIZE } from '@/lib/pagination';

interface PreReg {
  id: number;
  child_name: string;
  level: string;
  grade_applying: string;
  parent_name: string;
  parent_email: string;
  parent_phone: string;
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
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-preregistrations', page],
    queryFn: async () => toPaged<PreReg>((await api.get('/admissions/pre-register/', { params: { page } })).data),
    placeholderData: keepPreviousData,
  });

  const qc = useQueryClient();
  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api.patch(`/admissions/pre-register/${id}/`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-preregistrations'] });
      toast.success('Estado actualizado.');
    },
    onError: () => toast.error('No se pudo actualizar el estado.'),
  });

  const preRegs = data?.results;
  const count = data?.count ?? 0;

  const filtered = preRegs?.filter((p) =>
    !search ||
    p.child_name.toLowerCase().includes(search.toLowerCase()) ||
    p.parent_name.toLowerCase().includes(search.toLowerCase()) ||
    p.parent_email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-fluid-xl font-bold text-ink">Admisiones</h1>
        <p className="text-muted text-sm mt-0.5">Pre-registros e inscripciones recibidas.</p>
      </div>

      <Card title="Pre-registros">
        {/* Search */}
        <div className="relative mb-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
          <input
            className="input-field pl-9"
            placeholder="Buscar por nombre, correo…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <p className="mb-4 text-xs text-subtle">La búsqueda filtra la página actual.</p>

        {isLoading ? (
          <TableSkeleton />
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
                      <StatusSelect value={p.status} variant={meta.variant} disabled={updateStatus.isPending} onChange={(status) => updateStatus.mutate({ id: p.id, status })} />
                    </div>
                    <dl className="mt-3 space-y-1 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Tutor</dt>
                        <dd className="text-ink text-right">{p.parent_name}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Correo</dt>
                        <dd className="text-ink text-right break-all">{p.parent_email}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Teléfono</dt>
                        <dd className="text-ink text-right">{p.parent_phone}</dd>
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
                          <div className="text-muted">{p.parent_email}</div>
                          <div className="text-subtle text-xs">{p.parent_phone}</div>
                        </td>
                        <td className="text-subtle whitespace-nowrap">
                          {format(new Date(p.created_at), 'd MMM yyyy', { locale: es })}
                        </td>
                        <td>
                          <StatusSelect value={p.status} variant={meta.variant} disabled={updateStatus.isPending} onChange={(status) => updateStatus.mutate({ id: p.id, status })} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} count={count} onChange={setPage} itemLabel="pre-registros" />
      </Card>
    </div>
  );
}

const VARIANT_CLASS: Record<string, string> = {
  warning: 'border-amber/40 text-amber',
  info:    'border-purple/40 text-purple',
  success: 'border-green/50 text-green-dark',
  error:   'border-coral/50 text-coral-dark',
};

/** Inline status control — moves a pre-registration through the pipeline. */
function StatusSelect({ value, variant, onChange, disabled }: {
  value: string; variant: string; onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Cambiar estado del pre-registro"
      className={`rounded-lg border bg-white px-2 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:opacity-50 ${VARIANT_CLASS[variant] ?? 'border-line text-muted'}`}
    >
      {Object.entries(statusMeta).map(([k, m]) => (
        <option key={k} value={k}>{m.label}</option>
      ))}
    </select>
  );
}
