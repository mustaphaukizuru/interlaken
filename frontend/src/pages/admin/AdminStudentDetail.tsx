import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import StudentCard from '@/components/portal/StudentCard';
import { cafeteriaApi } from '@/services/api';
import type { CafeteriaCard } from '@/types';
import { Printer } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Coffee, Pencil } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageHeader } from '@/components/layout/PageHeader';
import { StudentGuardians } from '@/components/admin/StudentGuardians';
import { StudentFormModal } from '@/components/admin/StudentFormModal';
import { Badge } from '@/components/ui/Badge';
import { STUDENT_STATUS } from '@/lib/studentStatus';
import { portalApi } from '@/services/api';
import type { StudentProfile } from '@/types';

/**
 * /admin/alumnos/:studentId — student file: identity, guardians and the
 * cafetería shortcut. (The app does not bill tuition, so there is no ledger.)
 */
export default function AdminStudentDetail() {
  const { studentId } = useParams();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-student', studentId],
    queryFn: async () => (await portalApi.getStudent(Number(studentId))).data as StudentProfile,
    enabled: !!studentId,
  });

  return (
    <>
      <Link to="/admin/alumnos" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Alumnos
      </Link>

      {isLoading ? (
        <LoadingSpinner />
      ) : isError || !data ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <StudentDetailBody student={data} />
      )}
    </>
  );
}

/** Staff view of the digital credencial (BACKLOG P1-A9): preview + print. */
function CredencialCard({ studentId }: { studentId: number }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-student-card', studentId],
    queryFn: async () => (await cafeteriaApi.getStudentCard(studentId)).data as CafeteriaCard[],
  });
  const card = data?.[0];
  return (
    <Card title="Credencial de cafetería" action={card ? (
      <button type="button" className="btn-outline print:hidden" onClick={() => window.print()}>
        <Printer size={16} aria-hidden="true" /> Imprimir
      </button>
    ) : undefined}>
      {isLoading ? <LoadingSpinner /> : isError || !card ? <ErrorState onRetry={() => refetch()} /> : (
        <div className="print-only-card">
          <StudentCard card={card} />
          {!card.linked && (
            <p className="mt-3 text-xs text-coral-600">Sin vínculo con Loyverse: el código mostrado es la matrícula. Vincule al alumno desde Cafetería para que el POS lo reconozca.</p>
          )}
        </div>
      )}
    </Card>
  );
}

function StudentDetailBody({ student }: { student: StudentProfile }) {
  const [editOpen, setEditOpen] = useState(false);
  return (
    <>
      <StudentFormModal open={editOpen} onClose={() => setEditOpen(false)} student={student} />
      <PageHeader
        title={student.user.full_name}
        subtitle={`Matrícula ${student.student_id} · ${student.grade}${student.group ? ` ${student.group}` : ''}`}
        actions={(
          <>
            <button type="button" className="btn-outline" onClick={() => setEditOpen(true)}>
              <Pencil size={16} aria-hidden="true" /> Editar
            </button>
            <Link to={`/admin/cafeteria/${student.id}`} className="btn-outline">
              <Coffee size={16} aria-hidden="true" /> Cafetería
            </Link>
          </>
        )}
      />

      <Card title="Datos del alumno">
        <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">Matrícula</dt>
            <dd className="mt-1 text-sm font-medium text-ink">{student.student_id || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">Grado y grupo</dt>
            <dd className="mt-1 text-sm font-medium text-ink">
              {student.grade}{student.group ? ` · ${student.group}` : ''}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">Correo</dt>
            <dd className="mt-1 truncate text-sm font-medium text-ink" title={student.user.email}>
              {student.user.email || '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">Ingreso</dt>
            <dd className="mt-1 text-sm font-medium text-ink">{student.enrollment_date || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">Estado</dt>
            <dd className="mt-1"><Badge variant={STUDENT_STATUS[student.status ?? 'active']?.variant ?? 'neutral'}>{STUDENT_STATUS[student.status ?? 'active']?.label ?? 'Activo'}</Badge></dd>
          </div>
        </dl>
      </Card>

      <div className="mt-6 space-y-6">
        <StudentGuardians studentId={student.id} />
        <CredencialCard studentId={student.id} />
      </div>
    </>
  );
}
