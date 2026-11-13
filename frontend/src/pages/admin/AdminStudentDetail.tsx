import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import StudentCard from '@/components/portal/StudentCard';
import { cafeteriaApi } from '@/services/api';
import type { CafeteriaCard } from '@/types';
import { Printer } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowLeft, Coffee, Pencil } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageHeader } from '@/components/layout/PageHeader';
import { StudentGuardians } from '@/components/admin/StudentGuardians';
import { StudentFamily } from '@/components/admin/families/StudentFamily';
import { StudentFormModal } from '@/components/admin/StudentFormModal';
import { BulkConfirmDialog } from '@/components/admin/BulkConfirmDialog';
import { ARCHIVE_ACTION, DELETE_ACTION, RESTORE_ACTION, removalPlanNote } from '@/components/admin/studentActions';
import { AuditTimeline } from '@/components/admin/AuditTimeline';
import { Badge } from '@/components/ui/Badge';
import { STUDENT_STATUS } from '@/lib/studentStatus';
import { studentDetailKey } from '@/hooks/queries/studentKeys';
import { useStudentsBulk } from '@/hooks/queries/students';
import { isAdmin } from '@/lib/areas';
import { useAuthStore } from '@/store/authStore';
import { portalApi } from '@/services/api';
import type { BulkActionDef } from '@/services/api';
import type { StudentProfile } from '@/types';

/**
 * /admin/alumnos/:studentId — student file: identity, guardians, family
 * (hermanos), the cafetería shortcut and the Historial of changes, with Archivar / Restaurar and (admins)
 * Eliminar. (The app does not bill tuition, so there is no ledger.)
 */
/** Full page at /admin/alumnos/:id, or embedded as the right pane of the 2xl two-pane roster (BACKLOG P1-B10). */
export default function AdminStudentDetail({ id, embedded = false, onDeleted }: { id?: number; embedded?: boolean; onDeleted?: () => void } = {}) {
  const params = useParams();
  const studentId = id ?? params.studentId;
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: studentDetailKey(studentId ?? ''),
    queryFn: async () => (await portalApi.getStudent(Number(studentId))).data as StudentProfile,
    enabled: !!studentId,
  });

  return (
    <>
      {!embedded && (
        <Link to="/admin/alumnos" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Alumnos
        </Link>
      )}

      {isLoading ? (
        <LoadingSpinner />
      ) : isError || !data ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <StudentDetailBody student={data} onDeleted={onDeleted} />
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

type Tab = 'datos' | 'tutores' | 'familia' | 'cafeteria' | 'historial';
// `short` keeps the five tabs on one phone-width row (the strip scrolls if it must).
const TABS: { key: Tab; label: string; short?: string }[] = [
  { key: 'datos', label: 'Datos' },
  { key: 'tutores', label: 'Tutores' },
  { key: 'familia', label: 'Familia' },
  { key: 'cafeteria', label: 'Cafetería y credencial', short: 'Cafetería' },
  { key: 'historial', label: 'Historial' },
];

const DANGER_OUTLINE =
  'btn-outline border-coral-600 text-coral-700 hover:border-coral-700 hover:bg-coral-50 hover:text-coral-700';

/** Who changed this file and when (Auditoría rows for the file and its login). */
function StudentHistory({ studentId }: { studentId: number }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [...studentDetailKey(studentId), 'history'],
    queryFn: async () => (await portalApi.getStudentHistory(studentId)).data,
  });
  return (
    <Card title="Historial de cambios">
      {isLoading ? <LoadingSpinner /> : isError || !data ? <ErrorState onRetry={() => refetch()} /> : (
        <AuditTimeline entries={data} empty="Este expediente no tiene cambios registrados todavía." />
      )}
    </Card>
  );
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-ink break-words">{value === null || value === undefined || value === '' ? '—' : value}</dd>
    </div>
  );
}

function StudentDetailBody({ student, onDeleted }: { student: StudentProfile; onDeleted?: () => void }) {
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('datos');
  const [confirming, setConfirming] = useState<BulkActionDef | null>(null);
  const canDelete = isAdmin(useAuthStore((s) => s.user));
  const bulk = useStudentsBulk();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const archived = !!student.archived_at;
  const ArchiveIcon = ARCHIVE_ACTION.icon!;
  const RestoreIcon = RESTORE_ACTION.icon!;
  const DeleteIcon = DELETE_ACTION.icon!;
  return (
    <>
      <StudentFormModal open={editOpen} onClose={() => setEditOpen(false)} student={student} />
      <BulkConfirmDialog
        open={!!confirming}
        onClose={() => setConfirming(null)}
        action={confirming}
        payload={confirming?.payload}
        entityLabel="alumnos"
        gender="m"
        ids={[student.id]}
        subject={student.user.full_name}
        execute={(body) => bulk.mutateAsync(body)}
        renderPlan={removalPlanNote(confirming)}
        onDone={(r) => {
          if (r.outcomes?.erased) {
            // The file is gone: leave the page (or close the two-pane panel).
            toast.success('Alumno eliminado.');
            setConfirming(null);
            if (onDeleted) onDeleted();
            else navigate('/admin/alumnos');
            return;
          }
          void qc.invalidateQueries({ queryKey: studentDetailKey(student.id) });
        }}
      />
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
            {/* An archived file offers Restaurar in its banner, next to the explanation. */}
            {!archived && (
              <button type="button" className="btn-outline" onClick={() => setConfirming(ARCHIVE_ACTION)}>
                <ArchiveIcon size={16} aria-hidden="true" /> {ARCHIVE_ACTION.label}
              </button>
            )}
            {canDelete && (
              <button type="button" className={DANGER_OUTLINE} onClick={() => setConfirming(DELETE_ACTION)}>
                <DeleteIcon size={16} aria-hidden="true" /> Eliminar
              </button>
            )}
          </>
        )}
      />

      {archived && (
        <div role="status" className="mb-4 flex flex-col gap-3 rounded-xl2 border border-line bg-cream-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2.5 text-sm text-ink">
            <Archive className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
            <span>
              <strong>Archivado el {new Date(student.archived_at!).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}.</strong>{' '}
              No aparece en las listas ni puede entrar al portal; su historial y su saldo se conservan.
            </span>
          </p>
          <button type="button" className="btn-outline min-h-[44px] shrink-0 sm:min-h-[40px]" onClick={() => setConfirming(RESTORE_ACTION)}>
            <RestoreIcon size={16} aria-hidden="true" /> Restaurar
          </button>
        </div>
      )}

      <div role="tablist" aria-label="Secciones del expediente" className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-cream-2 p-1">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} aria-label={t.label}
            className={`min-h-[44px] whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors sm:min-h-[40px] sm:px-4 ${tab === t.key ? 'bg-white text-ink shadow-card' : 'text-muted hover:text-ink'}`}>
            {t.short ? <><span className="sm:hidden">{t.short}</span><span className="hidden sm:inline">{t.label}</span></> : t.label}
          </button>
        ))}
      </div>

      {tab === 'datos' && (<>
      <Card title="Datos del alumno">
        <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">Matrícula</dt>
            <dd className="mt-1 text-sm font-medium text-ink">{student.student_id || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">Código Loyverse</dt>
            <dd className="mt-1 font-mono text-sm font-medium text-ink">{student.loyverse_code || student.student_id || '—'}</dd>
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

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Datos personales">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label="Fecha de nacimiento" value={student.birth_date} />
            <Field label="Edad" value={student.age != null ? `${student.age} años` : null} />
            <Field label="CURP" value={student.curp} />
          </dl>
        </Card>
        <Card title="Contacto de emergencia">
          <dl className="grid gap-4 sm:grid-cols-3">
            <Field label="Nombre" value={student.emergency_name} />
            <Field label="Teléfono" value={student.emergency_phone} />
            <Field label="Parentesco" value={student.emergency_rel} />
          </dl>
        </Card>
        <Card title="Datos médicos (confidencial)" className="lg:col-span-2 border-coral/30">
          <dl className="grid gap-4 sm:grid-cols-3">
            <Field label="Tipo de sangre" value={student.blood_type} />
            <Field label="Alergias" value={student.allergies} />
            <Field label="Notas médicas" value={student.medical_notes} />
          </dl>
        </Card>
      </div>
      </>)}

      {tab === 'tutores' && <StudentGuardians studentId={student.id} />}

      {tab === 'familia' && <StudentFamily studentId={student.id} />}

      {tab === 'historial' && <StudentHistory studentId={student.id} />}

      {tab === 'cafeteria' && (
        <div className="space-y-6">
          <CredencialCard studentId={student.id} />
          <Link to={`/admin/cafeteria/${student.id}`} className="btn-outline"><Coffee size={16} aria-hidden="true" /> Abrir saldo y movimientos</Link>
        </div>
      )}
    </>
  );
}
