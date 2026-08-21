import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AlertTriangle, Check, Copy, KeyRound } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { portalApi } from '@/services/api';

export interface ResetPasswordTarget {
  /** User id of the account whose password is being reset. */
  id: number;
  email: string;
  /** Human label shown in the dialog, e.g. «Cuenta familiar» or the tutor's name. */
  label: string;
}

interface Props {
  target: ResetPasswordTarget | null;
  onClose: () => void;
}

type Mode = 'generate' | 'manual';
type Step = 'form' | 'confirm' | 'done';

interface SetPasswordResponse {
  detail: string;
  temporary_password?: string;
  sessions_revoked?: number;
}

function errorMessage(e: unknown): string {
  const data = (e as { response?: { data?: { detail?: string; password?: string[] } } })?.response
    ?.data;
  if (data?.password?.length) return data.password.join(' ');
  return data?.detail || 'No se pudo restablecer la contraseña. Intente de nuevo.';
}

/**
 * Admin-managed password reset for one family account.
 *
 * Two paths: a server-generated temporary password (default, and the one the
 * front desk should use) or an explicitly typed one. Applying it always takes
 * an extra confirmation step — it rewrites someone else's credential and signs
 * their open sessions out — and a generated password is displayed exactly once,
 * because the server never stores or echoes it again.
 *
 * The call site keys this component by target id, so opening it for a second
 * account remounts it and a previously revealed password can never survive
 * into the next reset.
 */
export function ResetPasswordDialog({ target, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('generate');
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [temporary, setTemporary] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const reset = useMutation({
    mutationFn: (payload: { password?: string; reason?: string }) =>
      portalApi.setUserPassword(target!.id, payload),
    onSuccess: (resp) => {
      const body = resp.data as SetPasswordResponse;
      if (body.temporary_password) {
        setTemporary(body.temporary_password);
        setStep('done');
      } else {
        toast.success('Contraseña actualizada. Se cerraron las sesiones abiertas.');
        onClose();
      }
    },
    onError: (e: unknown) => {
      const msg = errorMessage(e);
      setError(msg);
      setStep('form');
      toast.error(msg);
    },
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(temporary);
      setCopied(true);
      toast.success('Contraseña copiada al portapapeles.');
    } catch {
      toast.error('No se pudo copiar. Seleccione el texto y cópielo a mano.');
    }
  };

  const submit = () => {
    setError('');
    if (mode === 'manual' && password.trim().length < 10) {
      setError('La contraseña debe tener al menos 10 caracteres.');
      return;
    }
    setStep('confirm');
  };

  const apply = () => {
    reset.mutate({
      password: mode === 'manual' ? password : undefined,
      reason: reason.trim() || undefined,
    });
  };

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={step === 'done' ? 'Contraseña temporal' : 'Restablecer contraseña'}
      maxWidth={440}
    >
      {!target ? null : step === 'done' ? (
        <div className="space-y-4">
          <p className="text-sm text-ink">
            Entregue esta contraseña a la familia de{' '}
            <span className="font-semibold">{target.label}</span> ({target.email}).
          </p>
          <div className="rounded-2xl bg-cream/70 p-4 text-center">
            <span className="sr-only">Contraseña temporal:</span>
            <code className="block select-all break-all font-mono text-xl font-bold tracking-wide text-ink sm:text-2xl">
              {temporary}
            </code>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            aria-label="Copiar la contraseña temporal al portapapeles"
            onClick={copy}
          >
            {copied ? (
              <Check className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Copy className="h-4 w-4" aria-hidden="true" />
            )}
            {copied ? 'Copiada' : 'Copiar contraseña'}
          </Button>
          <div className="flex gap-3 rounded-2xl bg-coral-50 p-3 text-xs text-ink">
            <AlertTriangle className="h-4 w-4 shrink-0 text-coral-600" aria-hidden="true" />
            <p>
              Esta contraseña <strong>no se volverá a mostrar</strong>. Anótela antes de cerrar
              esta ventana y pida a la familia que la cambie al iniciar sesión, desde «Mi
              perfil». Las sesiones que ya estaban abiertas se cerraron.
            </p>
          </div>
          <Button type="button" className="w-full" onClick={onClose}>
            Listo, ya la anoté
          </Button>
        </div>
      ) : step === 'confirm' ? (
        <div className="space-y-4">
          <div className="flex gap-3 rounded-2xl bg-coral-50 p-3 text-sm text-ink">
            <AlertTriangle className="h-5 w-5 shrink-0 text-coral-600" aria-hidden="true" />
            <p>
              Se cambiará la contraseña de <strong>{target.label}</strong> ({target.email}) y se
              cerrarán todas sus sesiones abiertas. La contraseña anterior dejará de servir.
            </p>
          </div>
          <p className="text-sm text-subtle">
            {mode === 'generate'
              ? 'Se generará una contraseña temporal que se mostrará una sola vez.'
              : 'Se guardará la contraseña que usted escribió.'}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button
              type="button"
              variant="danger"
              className="sm:flex-1"
              loading={reset.isPending}
              disabled={reset.isPending}
              onClick={apply}
            >
              Sí, restablecer
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="sm:flex-1"
              disabled={reset.isPending}
              onClick={() => setStep('form')}
            >
              Volver
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <p className="text-sm text-subtle">
            Cuenta: <span className="font-medium text-ink">{target.label}</span>
            <span className="mt-0.5 block break-all text-xs">{target.email}</span>
          </p>

          <fieldset className="space-y-2">
            <legend className="label">¿Cómo desea restablecerla?</legend>
            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-2xl bg-cream/60 px-4 py-2.5 text-sm text-ink">
              <input
                type="radio"
                name="reset-mode"
                value="generate"
                checked={mode === 'generate'}
                onChange={() => setMode('generate')}
                className="h-4 w-4 accent-purple"
              />
              Generar contraseña temporal
            </label>
            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-2xl bg-cream/60 px-4 py-2.5 text-sm text-ink">
              <input
                type="radio"
                name="reset-mode"
                value="manual"
                checked={mode === 'manual'}
                onChange={() => setMode('manual')}
                className="h-4 w-4 accent-purple"
              />
              Escribir una contraseña
            </label>
          </fieldset>

          {mode === 'manual' && (
            <Input
              label="Nueva contraseña"
              type="text"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              hint="Mínimo 10 caracteres. No se mostrará después de guardarla."
            />
          )}

          <Input
            label="Motivo (opcional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="La mamá pidió acceso en recepción"
            hint="Queda registrado en la bitácora de auditoría."
          />

          {error && (
            <p role="alert" className="text-sm text-coral-600">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button type="submit" className="sm:flex-1">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              Continuar
            </Button>
            <Button type="button" variant="ghost" className="sm:flex-1" onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default ResetPasswordDialog;
