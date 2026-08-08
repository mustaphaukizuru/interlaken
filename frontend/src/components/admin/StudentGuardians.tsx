import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Users, UserPlus, Unlink, Link2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { portalApi } from '@/services/api';

interface Guardian {
  id: number;
  email: string;
  full_name: string;
  phone?: string;
  whatsapp?: string;
  relationship?: string;
  is_self?: boolean;
}

interface GuardiansResponse {
  student: {
    id: number;
    user_id: number;
    name: string;
    email: string;
    student_id: string;
    grade: string;
  };
  guardians: Guardian[];
}

interface Props {
  studentId: number;
}

export function StudentGuardians({ studentId }: Props) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState('Padre/Madre');
  const [open, setOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-student-guardians', studentId],
    queryFn: async () => (await portalApi.listGuardians(studentId)).data as GuardiansResponse,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-student-guardians', studentId] });
  };

  const link = useMutation({
    mutationFn: (payload: {
      email: string;
      full_name?: string;
      phone?: string;
      relationship?: string;
    }) => portalApi.linkGuardian(studentId, payload),
    onSuccess: (resp) => {
      const body = resp.data as {
        created_user: boolean;
        already_linked: boolean;
        guardian?: Guardian;
      };
      if (body.already_linked) {
        toast.success(
          body.guardian?.is_self
            ? 'La cuenta familiar ya estaba vinculada.'
            : 'Ese tutor ya estaba vinculado.',
        );
      } else if (body.guardian?.is_self) {
        toast.success('Cuenta familiar del alumno vinculada.');
      } else if (body.created_user) {
        toast.success('Tutor creado y vinculado. Puede activar su cuenta con «Olvidé mi contraseña».');
      } else {
        toast.success('Tutor vinculado al alumno.');
      }
      setEmail('');
      setFullName('');
      setPhone('');
      setRelationship('Padre/Madre');
      setOpen(false);
      invalidate();
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg || 'No se pudo vincular el tutor.');
    },
  });

  const unlink = useMutation({
    mutationFn: (userId: number) => portalApi.unlinkGuardian(studentId, userId),
    onSuccess: () => {
      toast.success('Tutor desvinculado.');
      invalidate();
    },
    onError: () => toast.error('No se pudo desvincular el tutor.'),
  });

  const guardians = data?.guardians ?? [];
  const studentEmail = data?.student?.email ?? '';
  const selfLinked = guardians.some((g) => g.is_self);

  return (
    <Card
      title="Padres y tutores"
      action={
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          {open ? 'Cerrar' : 'Vincular'}
        </Button>
      }
    >
      {!selfLinked && studentEmail && !isLoading && !isError && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-cream/60 px-4 py-3">
          <p className="min-w-0 text-sm text-ink">
            En Interlaken la familia entra con el correo escolar del alumno.
            <span className="mt-0.5 block truncate text-xs text-subtle">{studentEmail}</span>
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={link.isPending}
            disabled={link.isPending}
            onClick={() => link.mutate({ email: studentEmail })}
          >
            <Link2 className="h-4 w-4" aria-hidden="true" />
            Vincular cuenta del alumno
          </Button>
        </div>
      )}

      {open && (
        <form
          className="mb-5 grid gap-3 rounded-2xl bg-cream/60 p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!email.trim()) {
              toast.error('Indique el correo del tutor.');
              return;
            }
            link.mutate({
              email: email.trim(),
              full_name: fullName.trim() || undefined,
              phone: phone.trim() || undefined,
              relationship: relationship.trim() || undefined,
            });
          }}
        >
          <Input
            label="Correo del tutor"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            hint="Si no existe, se crea la cuenta (sin contraseña usable)."
          />
          <Input
            label="Nombre completo"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Ana García"
          />
          <Input
            label="Teléfono / WhatsApp"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
          />
          <Input
            label="Parentesco"
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
            placeholder="Madre, Padre, Tutor…"
          />
          <div className="sm:col-span-2">
            <Button type="submit" loading={link.isPending} disabled={link.isPending}>
              Vincular tutor
            </Button>
          </div>
        </form>
      )}

      {isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : isLoading ? (
        <ListSkeleton rows={2} />
      ) : !guardians.length ? (
        <EmptyState
          icon={Users}
          title="Sin tutores vinculados"
          description="Vincule la cuenta escolar del alumno o el correo de un padre/tutor."
        />
      ) : (
        <ul className="divide-y divide-cream">
          {guardians.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">
                  {g.is_self ? 'Cuenta familiar' : g.full_name || g.email}
                </p>
                <p className="truncate text-xs text-subtle">
                  {g.email}
                  {g.relationship ? ` · ${g.relationship}` : ''}
                  {!g.is_self && (g.phone || g.whatsapp) ? ` · ${g.phone || g.whatsapp}` : ''}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={unlink.isPending}
                onClick={() => {
                  const label = g.is_self
                    ? 'la cuenta familiar'
                    : (g.full_name || g.email);
                  if (window.confirm(`¿Desvincular a ${label} de este alumno?`)) {
                    unlink.mutate(g.id);
                  }
                }}
              >
                <Unlink className="h-4 w-4" aria-hidden="true" />
                Desvincular
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
