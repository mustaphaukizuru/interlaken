import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ClipboardList, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/layout/PageHeader';
import { admissionsApi } from '@/services/api';

interface ParentRegistration {
  id: number;
  child_name: string;
  grade_applying: string;
  cycle: string;
  status: string;
  status_label: string;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

const statusVariant: Record<string, 'neutral' | 'info' | 'warning' | 'success' | 'error'> = {
  draft: 'neutral',
  submitted: 'info',
  reviewing: 'warning',
  approved: 'success',
  rejected: 'error',
  complete: 'success',
};

/**
 * Parent application status — lists registrations whose parent1/parent2 email
 * matches the logged-in account (GET /admissions/my-registrations/).
 */
export default function InscripcionesPage() {
  const { data, isLoading, isError, refetch } = useQuery<ParentRegistration[]>({
    queryKey: ['my-registrations'],
    queryFn: async () => (await admissionsApi.getMyRegistrations()).data,
  });

  return (
    <>
      <PageHeader
        title="Inscripciones"
        subtitle="Consulte el estado de las solicitudes de inscripción vinculadas a su correo."
      />

      <Card>
        {isError ? (
          <ErrorState
            title="No se pudieron cargar las inscripciones"
            description="Verifique su conexión e intente de nuevo. Si el problema continúa, contacte al colegio."
            onRetry={() => refetch()}
          />
        ) : isLoading ? (
          <ListSkeleton />
        ) : !data?.length ? (
          <EmptyState
            icon={ClipboardList}
            title="Sin inscripciones"
            description="Cuando inicie o complete una inscripción con este correo, el estado aparecerá aquí."
            action={
              <Link to="/pre-registro" className="btn-primary inline-flex min-h-[44px] items-center">
                Ir a pre-registro
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-line" aria-label="Solicitudes de inscripción">
            {data.map((reg) => (
              <li key={reg.id} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{reg.child_name}</p>
                  <p className="text-sm text-muted">
                    {reg.grade_applying}
                    {reg.cycle ? ` · Ciclo ${reg.cycle}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-subtle">
                    {reg.submitted_at
                      ? `Enviada ${format(new Date(reg.submitted_at), "d MMM yyyy", { locale: es })} · `
                      : ''}
                    Actualizado{' '}
                    {format(new Date(reg.updated_at), "d MMM yyyy", { locale: es })}
                  </p>
                </div>
                <Badge variant={statusVariant[reg.status] ?? 'neutral'}>
                  {reg.status_label || reg.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="mt-4 flex items-start gap-2 text-sm text-muted">
        <ExternalLink className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
        <span>
          ¿Aún no tiene una solicitud? Comience por el{' '}
          <Link to="/pre-registro" className="font-medium text-green-dark underline">
            pre-registro
          </Link>
          {' '}o escriba a{' '}
          <Link to="/contacto" className="font-medium text-green-dark underline">
            contacto
          </Link>.
        </span>
      </p>
    </>
  );
}
