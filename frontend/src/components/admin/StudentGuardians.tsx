import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Users, UserPlus, Unlink } from 'lucide-react';
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
    queryFn: async () => (await portalApi.listGuardians(studentId)).data as {
      guardians: Guardian[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-student-guardians', studentId] });
  };

  const link = useMutation({
    mutationFn: () =>
      portalApi.linkGuardian(studentId, {
        email: email.trim(),
        full_name: fullName.trim() || undefined,
        phone: phone.trim() || undefined,
        relationship: relationship.trim() || undefined,
      }),
    onSuccess: (resp) => {
      const body = resp.data as { created_user: boolean; already_linked: boolean };
      if (body.already_linked) {
        toast.success('Ese tutor ya estaba vinculado.');
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
      {open && (
        <form
          className="mb-5 grid gap-3 rounded-2xl bg-cream/60 p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!email.trim()) {
              toast.error('Indique el correo del tutor.');
              return;
            }
            link.mutate();
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
          description="Vincule el correo del padre o tutor para que vea cafetería, colegiaturas y comunicados."
        />
      ) : (
        <ul className="divide-y divide-cream">
          {guardians.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{g.full_name || g.email}</p>
                <p className="truncate text-xs text-subtle">
                  {g.email}
                  {g.relationship ? ` · ${g.relationship}` : ''}
                  {(g.phone || g.whatsapp) ? ` · ${g.phone || g.whatsapp}` : ''}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={unlink.isPending}
                onClick={() => {
                  if (window.confirm(`¿Desvincular a ${g.full_name || g.email} de este alumno?`)) {
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
