import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Coffee } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageHeader } from '@/components/layout/PageHeader';
import { StudentGuardians } from '@/components/admin/StudentGuardians';
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

function StudentDetailBody({ student }: { student: StudentProfile }) {
  return (
    <>
      <PageHeader
        title={student.user.full_name}
        subtitle={`Matrícula ${student.student_id} · ${student.grade}${student.group ? ` ${student.group}` : ''}`}
        actions={(
          <Link to={`/admin/cafeteria/${student.id}`} className="btn-outline">
            <Coffee size={16} aria-hidden="true" /> Cafetería
          </Link>
        )}
      />

      <Card title="Datos del alumno">
        <dl className="grid gap-4 sm:grid-cols-3">
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
        </dl>
      </Card>

      <div className="mt-6 space-y-6">
        <StudentGuardians studentId={student.id} />
      </div>
    </>
  );
}
