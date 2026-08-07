import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Lock, Eye, EyeOff } from 'lucide-react';
import Logo from '@/components/ui/Logo';
import { authApi } from '@/services/api';

/** Confirm password reset / first-time activation from email link. */
export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const uid = params.get('uid') ?? '';
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linkOk = Boolean(uid && token);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setSubmitting(true);
    try {
      await authApi.confirmPasswordReset({ uid, token, password });
      toast.success('Contraseña actualizada. Ya puede iniciar sesión.');
      navigate('/login', { replace: true });
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { detail?: string; password?: string[] } } })?.response?.data;
      setError(data?.password?.[0] || data?.detail || 'Enlace inválido o expirado.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Logo className="h-12 w-auto" />
          <h1 className="font-head text-xl font-bold text-ink">Nueva contraseña</h1>
          <p className="text-sm text-muted">Elija una contraseña segura para su cuenta familiar.</p>
        </div>

        {!linkOk ? (
          <div className="space-y-3 text-center text-sm">
            <p className="text-ink">Este enlace no es válido. Solicite uno nuevo.</p>
            <Link to="/olvide-contrasena" className="font-semibold text-purple hover:underline">
              Solicitar enlace
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {error && (
              <p className="rounded-lg bg-coral/10 px-3 py-2 text-sm text-coral" role="alert">{error}</p>
            )}
            <div>
              <label className="label" htmlFor="rp-pass">Contraseña</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
                <input
                  id="rp-pass"
                  type={show ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  className="input-field min-h-[44px] pl-10 pr-10 text-base"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? 'Ocultar' : 'Mostrar'}
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="rp-confirm">Confirmar</label>
              <input
                id="rp-confirm"
                type={show ? 'text' : 'password'}
                required
                autoComplete="new-password"
                className="input-field min-h-[44px] text-base"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary flex w-full min-h-[44px] items-center justify-center"
            >
              {submitting ? 'Guardando…' : 'Guardar contraseña'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
