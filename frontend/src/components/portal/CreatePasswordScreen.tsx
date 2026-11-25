import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Check, Circle, KeyRound, LogOut } from 'lucide-react';
import Logo from '@/components/ui/Logo';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { authApi } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { apiErrorMessage, fieldErrorsOrNull } from '@/lib/apiErrors';
import { useSingleFlight } from '@/hooks/useSingleFlight';

/** Django's MinimumLengthValidator (settings AUTH_PASSWORD_VALIDATORS). */
export const MIN_PASSWORD_LENGTH = 10;

type Errors = { current?: string; next?: string; confirm?: string; alert?: string };

/**
 * «Cree su contraseña» (2026-11-24): the full screen an account sees while it
 * still uses a temporary password an administrator handed out. ProtectedRoute
 * shows it instead of any portal or console page; the API refuses everything
 * else meanwhile (403 `password_change_required`). Saving clears the flag and
 * the page the person was going to appears.
 *
 * The rules the browser can check (length, not only digits, different from
 * the temporary one) tick as the person types; the server checks the rest
 * (similar to the email or name, common passwords) and says which failed.
 */
export function CreatePasswordScreen() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const once = useSingleFlight();

  const save = useMutation({
    mutationFn: async () => (await authApi.changePassword(current, next)).data,
    onSuccess: (data) => {
      // Requests a page made before the screen appeared were left pending
      // (api.ts): start every query afresh for the page that comes next.
      void qc.resetQueries();
      setUser({ ...(user ?? data.user), ...data.user, password_change_required: false });
      toast.success('Su contraseña quedó guardada.');
    },
    onError: (err) => {
      const fields = fieldErrorsOrNull(err);
      if (fields && (fields.current_password || fields.new_password)) {
        setErrors({ current: fields.current_password, next: fields.new_password });
      } else {
        setErrors({ alert: apiErrorMessage(err, 'No se pudo guardar la contraseña. Inténtelo de nuevo.') });
      }
    },
  });

  const longEnough = next.length >= MIN_PASSWORD_LENGTH;
  const notOnlyDigits = next.length > 0 && !/^\d+$/.test(next);
  const differs = next.length > 0 && next !== current;
  const rules = [
    { ok: longEnough, label: `Al menos ${MIN_PASSWORD_LENGTH} caracteres` },
    { ok: notOnlyDigits, label: 'No solo números' },
    { ok: differs, label: 'Distinta de la contraseña temporal' },
  ];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found: Errors = {};
    if (!current) found.current = 'Escriba la contraseña temporal que le dio el colegio.';
    if (!next) found.next = 'Escriba su contraseña nueva.';
    else if (!longEnough || !notOnlyDigits || !differs) found.next = 'Revise los requisitos de la lista.';
    if (next && confirm !== next) found.confirm = 'Las dos contraseñas no coinciden.';
    setErrors(found);
    if (Object.keys(found).length) return;
    once(() => save.mutateAsync());
  };

  const type = show ? 'text' : 'password';
  return (
    <div className="flex min-h-screen flex-col bg-cream">
      <div className="accent-bar" />
      <main id="contenido" className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center sm:px-8">
        <div className="w-full max-w-[440px]">
          <div className="mb-6 flex justify-center">
            <Logo variant="stacked" size={88} theme="light" eager />
          </div>
          <div className="rounded-md bg-white px-5 py-7 shadow-[0_20px_50px_-24px_rgba(64,26,142,0.35)] sm:px-7">
            <div className="mb-3 flex justify-center" aria-hidden="true">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-purple">
                <KeyRound className="h-6 w-6" />
              </span>
            </div>
            <h1 className="text-center font-head text-fluid-xl font-extrabold text-ink">Cree su contraseña</h1>
            <p className="mt-2 text-center text-sm text-muted">
              Entró con una contraseña temporal que le dio el colegio. Antes de continuar, cree una propia que solo
              usted conozca.
            </p>
            {user?.email && (
              <p className="mt-2 break-all text-center text-sm font-semibold text-ink">{user.email}</p>
            )}

            {errors.alert && (
              <div role="alert" className="mt-5 rounded-sm bg-danger-bg px-3.5 py-2.5 text-sm font-medium text-danger">
                {errors.alert}
              </div>
            )}

            <form onSubmit={submit} noValidate className="mt-6 space-y-4">
              {/* For password managers: the account this password belongs to. */}
              <input type="email" name="username" autoComplete="username" value={user?.email ?? ''} readOnly hidden />
              <Input
                label="Contraseña temporal"
                type={type}
                autoComplete="current-password"
                value={current}
                onChange={(e) => { setCurrent(e.target.value); setErrors((x) => ({ ...x, current: undefined, alert: undefined })); }}
                error={errors.current}
                className="min-h-[44px] text-base"
              />
              <div>
                <Input
                  id="create-password-new"
                  label="Contraseña nueva"
                  type={type}
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => { setNext(e.target.value); setErrors((x) => ({ ...x, next: undefined, alert: undefined })); }}
                  error={errors.next}
                  // Input's own description is the error; the rules list joins it.
                  aria-describedby={errors.next ? 'create-password-new-error create-password-rules' : 'create-password-rules'}
                  className="min-h-[44px] text-base"
                />
                <ul id="create-password-rules" aria-label="Requisitos de la contraseña" className="mt-2 space-y-1 text-sm">
                  {rules.map((r) => (
                    <li key={r.label} className={r.ok ? 'flex items-start gap-2 text-success' : 'flex items-start gap-2 text-muted'}>
                      {r.ok
                        ? <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        : <Circle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                      <span>{r.label}<span className="sr-only">{r.ok ? ': cumplido' : ': pendiente'}</span></span>
                    </li>
                  ))}
                  <li className="flex items-start gap-2 text-muted">
                    <Circle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>Que no se parezca a su correo ni a su nombre, y que no sea una contraseña común como 1234567890</span>
                  </li>
                </ul>
              </div>
              <Input
                label="Confirme la contraseña nueva"
                type={type}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => { setConfirm(e.target.value); setErrors((x) => ({ ...x, confirm: undefined })); }}
                error={errors.confirm}
                className="min-h-[44px] text-base"
              />
              <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="h-4 w-4" />
                Mostrar las contraseñas
              </label>
              <Button type="submit" loading={save.isPending} disabled={save.isPending} className="min-h-[44px] w-full justify-center">
                Guardar y continuar
              </Button>
            </form>
            <p className="mt-4 text-center text-xs text-subtle">
              El colegio nunca le pedirá esta contraseña. Si la olvida, pida una nueva al colegio.
            </p>
            <div className="mt-3 flex justify-center">
              <Button type="button" variant="ghost" size="sm" onClick={() => void authApi.logout()} className="min-h-[44px]">
                <LogOut className="h-4 w-4" aria-hidden="true" /> Salir
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default CreatePasswordScreen;
