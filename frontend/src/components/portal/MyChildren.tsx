import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowLeft, Check, Mail, ShieldCheck, UserPlus } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { apiErrorMessage } from '@/lib/apiErrors';
import { myFamilyApi, type CodeSent } from '@/services/myFamilyApi';

const gradeLine = (s: { grade: string; group: string }) => `${s.grade}${s.group ? ` ${s.group}` : ''}`;
const initial = (name: string) => (name.trim().charAt(0) || '?').toUpperCase();

/**
 * «Mis hijos» (Mi perfil): the children this login sees and «Agregar otro
 * hijo», without the office. Two steps: the other child's school email or
 * matrícula → a 6-digit code arrives in that child's mailbox → typing it links
 * the children, so either login sees all of them.
 */
export function MyChildren() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['my-family'],
    queryFn: async () => (await myFamilyApi.get()).data,
  });
  const [adding, setAdding] = useState(false);

  if (isLoading) return <Card title="Mis hijos"><ListSkeleton rows={2} /></Card>;
  if (isError || !data) return <Card title="Mis hijos"><ErrorState onRetry={() => refetch()} /></Card>;

  return (
    <Card title="Mis hijos" subtitle="Con cualquiera de las cuentas de su familia verá a todos sus hijos en el portal.">
      <ul className="divide-y divide-cream" aria-label="Hijos en esta cuenta">
        {data.children.map((c) => (
          <li key={c.id} className="flex items-center gap-3 py-3 first:pt-0">
            <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-purple">
              {initial(c.name)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink">{c.name}</span>
              <span className="block truncate text-xs text-subtle">{gradeLine(c)} · Matrícula {c.student_id}</span>
            </span>
          </li>
        ))}
      </ul>

      {!adding ? (
        data.can_add && (
          <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-cream-2 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-ink">
              ¿Tiene otro hijo en el Colegio Interlaken?
              <span className="block text-xs text-muted">Agréguelo aquí para ver su saldo, recargar y recibir sus avisos desde esta misma cuenta.</span>
            </p>
            <Button type="button" onClick={() => setAdding(true)} className="shrink-0">
              <UserPlus className="h-4 w-4" aria-hidden="true" /> Agregar otro hijo
            </Button>
          </div>
        )
      ) : (
        <AddChild
          onCancel={() => setAdding(false)}
          onDone={(name) => {
            setAdding(false);
            toast.success(`${name} ya aparece en su cuenta.`);
            // Every family view (inicio, cafetería, credencial, pagos) now has one more child.
            void qc.invalidateQueries();
          }}
        />
      )}
    </Card>
  );
}

function AddChild({ onCancel, onDone }: { onCancel: () => void; onDone: (name: string) => void }) {
  const studentId = useId();
  const codeId = useId();
  const [student, setStudent] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<CodeSent | null>(null);
  const [error, setError] = useState('');

  const send = useMutation({
    mutationFn: async () => (await myFamilyApi.add(student.trim())).data,
    onSuccess: (d) => { setSent(d); setCode(''); setError(''); },
    onError: (e) => setError(apiErrorMessage(e, 'No se pudo enviar el código.')),
  });
  const confirm = useMutation({
    mutationFn: async () => (await myFamilyApi.confirm(student.trim(), code)).data,
    onSuccess: (d) => onDone(d.linked),
    onError: (e) => setError(apiErrorMessage(e, 'No se pudo vincular.')),
  });

  if (!sent) {
    return (
      <form
        className="mt-4 space-y-4 rounded-2xl border border-line p-4"
        onSubmit={(e) => { e.preventDefault(); if (student.trim()) send.mutate(); }}
        aria-labelledby={`${studentId}-title`}
      >
        <h3 id={`${studentId}-title`} className="font-semibold text-ink">Agregar otro hijo</h3>
        <div>
          <label htmlFor={studentId} className="label">Correo escolar o matrícula de su otro hijo</label>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the form opens for this field */}
          <input id={studentId} className="input-field min-h-[44px] text-base" autoFocus autoComplete="off"
            inputMode="email" placeholder="ci09628@interlaken.com.mx o ci09628"
            value={student} onChange={(e) => { setStudent(e.target.value); setError(''); }}
            aria-invalid={!!error} aria-describedby={`${studentId}-hint${error ? ` ${studentId}-err` : ''}`} />
          <p id={`${studentId}-hint`} className="mt-1 text-xs text-subtle">
            Le enviaremos un código a ese correo escolar. Así sabemos que es su familia.
          </p>
          {error && <p id={`${studentId}-err`} className="mt-1 text-sm text-coral-700" role="alert">{error}</p>}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button type="submit" loading={send.isPending} disabled={!student.trim() || send.isPending}>
            <Mail className="h-4 w-4" aria-hidden="true" /> Enviar código
          </Button>
        </div>
      </form>
    );
  }

  const digits = code.replace(/\D/g, '');
  return (
    <form
      className="mt-4 space-y-4 rounded-2xl border border-line p-4"
      onSubmit={(e) => { e.preventDefault(); if (digits.length === 6) confirm.mutate(); }}
      aria-labelledby={`${codeId}-title`}
    >
      <h3 id={`${codeId}-title`} className="font-semibold text-ink">Escriba el código</h3>
      <div className="flex gap-3 rounded-xl bg-brand-50 px-3 py-3 text-sm text-brand-700" role="status">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p>
          Enviamos un código a <strong>{sent.sent_to.join(', ')}</strong>, el correo de{' '}
          <strong>{sent.student.name}</strong> ({gradeLine(sent.student)}). Vence en {sent.expires_in_minutes} minutos.
        </p>
      </div>
      <div>
        <label htmlFor={codeId} className="label">Código de 6 números</label>
        {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the next step starts here */}
        <input id={codeId} autoFocus className="input-field min-h-[48px] max-w-[220px] text-center font-mono text-xl tracking-[0.3em]"
          inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="000000"
          value={code} onChange={(e) => { setCode(e.target.value.replace(/[^\d ]/g, '')); setError(''); }}
          aria-invalid={!!error} aria-describedby={error ? `${codeId}-err` : undefined} />
        {error && <p id={`${codeId}-err`} className="mt-1 text-sm text-coral-700" role="alert">{error}</p>}
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => { setSent(null); setError(''); }}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Cambiar alumno
          </Button>
          <Button type="button" variant="ghost" size="sm" loading={send.isPending} onClick={() => send.mutate()}>
            Enviar otro código
          </Button>
        </div>
        <Button type="submit" loading={confirm.isPending} disabled={digits.length !== 6 || confirm.isPending}>
          <Check className="h-4 w-4" aria-hidden="true" /> Agregar a {sent.student.first_name || sent.student.name}
        </Button>
      </div>
    </form>
  );
}

export default MyChildren;
