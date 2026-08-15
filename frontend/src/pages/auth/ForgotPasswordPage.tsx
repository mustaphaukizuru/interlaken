import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Mail, ArrowLeft } from 'lucide-react';
import Logo from '@/components/ui/Logo';
import { SITE_NAME } from '@/lib/siteMeta';
import { authApi } from '@/services/api';

/** Request a password-reset / account-activation email. */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  // Rendered outside PublicLayout (no <RouteSeo>), so set the title directly.
  useEffect(() => {
    document.title = `Recuperar contraseña · ${SITE_NAME}`;
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await authApi.requestPasswordReset(email.trim());
      setSent(true);
      toast.success('Si el correo está registrado, enviamos un enlace.');
    } catch {
      toast.error('No se pudo enviar. Intente de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Logo className="h-12 w-auto" />
          <h1 className="font-head text-xl font-bold text-ink">Restablecer o activar cuenta</h1>
          <p className="text-sm text-muted">
            Ingrese su correo. Si tiene cuenta (incluida una importada sin contraseña), recibirá un enlace.
          </p>
        </div>

        {sent ? (
          <div className="space-y-4 text-center" role="status">
            <p className="text-sm text-ink">
              Revise su bandeja de entrada (y spam). El enlace caduca en 24 horas.
            </p>
            <Link to="/login" className="inline-flex items-center gap-1 text-sm font-semibold text-purple hover:underline">
              <ArrowLeft className="h-4 w-4" /> Volver a iniciar sesión
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label" htmlFor="fp-email">Correo</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
                <input
                  id="fp-email"
                  type="email"
                  required
                  autoComplete="email"
                  className="input-field min-h-[44px] pl-10 text-base"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              className="btn-primary flex w-full min-h-[44px] items-center justify-center"
            >
              {submitting ? 'Enviando…' : 'Enviar enlace'}
            </button>
            <p className="text-center text-sm">
              <Link to="/login" className="font-semibold text-purple hover:underline">Volver al acceso</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
