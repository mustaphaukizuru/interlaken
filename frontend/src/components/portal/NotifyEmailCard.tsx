import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useUrlFilters } from '@/hooks/useUrlFilters';
import { apiErrorMessage } from '@/lib/apiErrors';
import { authApi, type NotifyEmailState } from '@/services/api';

/**
 * «Correo para avisos» (owner, 2026-10-20): a personal address that also gets
 * this account's emails. It only receives mail once confirmed from the link we
 * send to it; the link lands here with `?verificar_correo=<token>`.
 */
export function NotifyEmailCard({ accountEmail }: { accountEmail?: string }) {
  const qc = useQueryClient();
  const { get, set } = useUrlFilters();
  const token = get('verificar_correo');
  const [draft, setDraft] = useState('');
  const { data } = useQuery({
    queryKey: ['notify-email'],
    queryFn: () => authApi.getNotifyEmail().then((r) => r.data),
  });
  const store = (next: NotifyEmailState) => qc.setQueryData(['notify-email'], next);

  const save = useMutation({
    mutationFn: (email: string) => authApi.setNotifyEmail(email),
    onSuccess: ({ data: next }) => {
      store(next);
      setDraft('');
      toast.success(`Le enviamos un enlace a ${next.email}. Ábralo para confirmar.`);
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'No se pudo guardar el correo.')),
  });
  const remove = useMutation({
    mutationFn: () => authApi.deleteNotifyEmail(),
    onSuccess: ({ data: next }) => { store(next); toast.success('Ya no se enviarán avisos a ese correo.'); },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });
  const verify = useMutation({
    mutationFn: (t: string) => authApi.verifyNotifyEmail(t),
    onSuccess: ({ data: next }) => { store(next); toast.success(`Listo: los avisos también llegarán a ${next.email}.`); },
    onError: (err) => toast.error(apiErrorMessage(err, 'No se pudo confirmar el correo.')),
    onSettled: () => set({ verificar_correo: null }),
  });

  // Confirm once when arriving from the email link (StrictMode runs effects twice).
  const verified = useRef('');
  useEffect(() => {
    if (token && verified.current !== token) {
      verified.current = token;
      verify.mutate(token);
    }
  }, [token, verify]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (draft.trim()) save.mutate(draft.trim());
  };

  return (
    <Card>
      <div className="mb-2 flex items-center gap-2">
        <Mail className="h-4 w-4 text-purple" aria-hidden="true" />
        <h2 className="font-head text-base font-semibold text-ink">Correo para avisos</h2>
      </div>
      <p className="mb-4 text-sm text-muted">
        Los avisos llegan a {accountEmail ? <strong className="font-semibold text-ink">{accountEmail}</strong> : 'el correo de la cuenta'}.
        Si prefiere recibirlos también en un correo personal, escríbalo aquí.
      </p>

      {data?.email && (
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-line bg-cream/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{data.email}</p>
            {data.verified ? (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-green-700"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Confirmado: recibe los avisos</p>
            ) : (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-amber"><Clock className="h-3.5 w-3.5" aria-hidden="true" /> Pendiente: abra el enlace que le enviamos a ese correo</p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            {!data.verified && (
              <Button variant="secondary" size="sm" onClick={() => save.mutate(data.email)} loading={save.isPending} className="min-h-[36px]">Reenviar enlace</Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => remove.mutate()} loading={remove.isPending} className="min-h-[36px]">Quitar</Button>
          </div>
        </div>
      )}

      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Input
          label={data?.email ? 'Cambiar por otro correo' : 'Correo personal'}
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={254}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="nombre@gmail.com"
          className="min-h-[44px] text-base"
        />
        <Button type="submit" variant="primary" disabled={!draft.trim()} loading={save.isPending} className="min-h-[44px] shrink-0">
          Enviar enlace
        </Button>
      </form>
    </Card>
  );
}

export default NotifyEmailCard;
