import { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { CredentialsSummary } from '@/components/admin/admissions/CredentialsSummary';
import { apiErrorCode, type FieldErrorMap } from '@/lib/apiErrors';
import { useEnroll, type CaseDetail, type EnrollResult, type GateItem } from '@/hooks/queries/cases';
import { ErrorSummary, SelectField, TextareaField, errorsFrom } from './formKit';
import { GateList, gradeOptionsWith } from './caseBits';

const LABELS: Record<string, string> = {
  student_id: 'Matrícula', grade: 'Grado', group: 'Grupo', override_reason: 'Motivo de la dispensa',
};

/**
 * «Marcar como inscrito»: matrícula (automatic when empty), grade and group,
 * and, for an administrator when only the documents are missing, the
 * waiver with its reason. On success it shows what was created: the
 * student, and each family login with its password ready to send.
 */
export function EnrollDialog({ open, onClose, detail, isAdmin }: { open: boolean; onClose: () => void; detail: CaseDetail; isAdmin: boolean }) {
  const [result, setResult] = useState<EnrollResult | null>(null);
  const close = () => { setResult(null); onClose(); };
  return (
    <Modal open={open} onClose={close} title={result ? 'Alumno inscrito' : `Marcar como inscrito: ${detail.child_name}`} maxWidth={560}>
      {result ? (
        <div className="space-y-4">
          <p className="text-sm text-muted" role="status">
            {result.already ? 'El alumno ya existía; el expediente quedó inscrito.' : 'Se crearon el alumno y las cuentas de la familia.'}
          </p>
          <CredentialsSummary result={result} phone={detail.parent_phone} />
          <div className="flex justify-end"><Button onClick={close}>Listo</Button></div>
        </div>
      ) : (
        <EnrollForm detail={detail} isAdmin={isAdmin} onCancel={close} onDone={setResult} />
      )}
    </Modal>
  );
}

function EnrollForm({ detail, isAdmin, onCancel, onDone }: {
  detail: CaseDetail; isAdmin: boolean; onCancel: () => void; onDone: (r: EnrollResult) => void;
}) {
  const [studentId, setStudentId] = useState('');
  const [grade, setGrade] = useState(detail.grade_applying);
  const [group, setGroup] = useState('');
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const [gates, setGates] = useState<GateItem[] | null>(null);
  const enroll = useEnroll(detail.id);
  const items = gates ?? detail.inscrito.gates.items;
  const docsMissing = items.some((g) => g.key === 'documents' && !g.ok);
  const ready = items.every((g) => g.ok) || (override && items.every((g) => g.ok || g.key === 'documents'));

  const submit = () => {
    if (override && !reason.trim()) { setErrors({ override_reason: 'Escriba por qué se dispensan los documentos.' }); return; }
    setErrors({});
    enroll.mutate({
      student_id: studentId.trim() || undefined,
      grade: grade !== detail.grade_applying ? grade : undefined,
      group: group.trim() || undefined,
      ...(override ? { override_documents: true, override_reason: reason.trim() } : {}),
    }, {
      onSuccess: (r) => {
        if (r.unlinked?.length) toast.success('Alumno inscrito. Revise los tutores que no se vincularon.');
        else toast.success('Alumno inscrito y cuentas creadas.');
        onDone(r);
      },
      onError: (e) => {
        if (apiErrorCode(e) === 'gates') {
          const body = (e as { response?: { data?: { gates?: { items?: GateItem[] } } } }).response?.data;
          setGates(body?.gates?.items ?? null);
        }
        setErrors(errorsFrom(e, 'No se pudo marcar como inscrito.'));
      },
    });
  };

  return (
    <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <p className="text-sm text-muted">
        Se crea el alumno con los datos de la ficha (incluidos los médicos), su acceso escolar y las cuentas de madre y padre.
        Las contraseñas nuevas se muestran una sola vez para que usted las envíe.
      </p>
      <GateList items={items} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Input id="enroll-student-id" label="Matrícula (opcional)" value={studentId} placeholder="Automática" autoComplete="off"
          onChange={(e) => setStudentId(e.target.value)} error={errors.student_id} />
        <SelectField id="enroll-grade" label="Grado" value={grade} options={gradeOptionsWith(detail.grade_applying)}
          onChange={(e) => setGrade(e.target.value)} error={errors.grade} />
        <Input id="enroll-group" label="Grupo (opcional)" value={group} placeholder="A" maxLength={5} autoComplete="off"
          onChange={(e) => setGroup(e.target.value.toUpperCase())} error={errors.group} />
      </div>
      {docsMissing && isAdmin && (
        <div className="space-y-2 rounded-md bg-amber/10 p-3">
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
            <input type="checkbox" className="h-4 w-4 rounded-sm border-line text-purple focus:ring-purple/40"
              checked={override} onChange={(e) => setOverride(e.target.checked)} />
            Inscribir sin los documentos completos (administrador)
          </label>
          {override && (
            <TextareaField id="enroll-override-reason" label="Motivo (obligatorio)" value={reason} maxLength={500}
              onChange={(e) => { setReason(e.target.value); setErrors({}); }} error={errors.override_reason}
              placeholder="Entrega el certificado de primaria en agosto." />
          )}
        </div>
      )}
      <ErrorSummary errors={errors} labels={LABELS} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" variant="green" loading={enroll.isPending} disabled={!ready}>
          Crear alumno y cuentas
        </Button>
      </div>
    </form>
  );
}

export default EnrollDialog;
