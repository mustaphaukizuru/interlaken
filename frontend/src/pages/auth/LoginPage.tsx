import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { api, authApi, bootstrapSession } from '@/services/api';
import Logo from '@/components/ui/Logo';
import { SCHOOL_YEARS } from '@/lib/siteMeta';
import { Mail, Lock, Eye, EyeOff, LogIn } from 'lucide-react';
import toast from 'react-hot-toast';

const ROLE_PATHS: Record<string, string> = {
  parent: '/portal',
  student: '/portal', // student == family login (shared account) → the family portal
  admin: '/admin',
  staff: '/staff',
};

export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { setAuth, setUser, isAuthenticated, user } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Handle the Google OAuth return. The backend set the session as httpOnly
  // cookies and redirected here with ?login=ok (NO tokens in the URL); we mint
  // an in-memory access token from the cookie via a silent refresh.
  useEffect(() => {
    if (params.get('login') !== 'ok') return;
    bootstrapSession()
      .then(async (ok) => {
        if (!ok) throw new Error('no-session');
        const { data } = await authApi.me();
        setUser(data);
        navigate(ROLE_PATHS[data.role] ?? '/portal', { replace: true });
      })
      .catch(() => {
        toast.error('Error al iniciar sesión. Intente nuevamente.');
        navigate('/login', { replace: true });
      });
  }, [params, setUser, navigate]);

  useEffect(() => {
    if (isAuthenticated && user) {
      navigate(ROLE_PATHS[user.role] ?? '/portal', { replace: true });
    }
  }, [isAuthenticated, user, navigate]);

  const oauthError = params.get('error');
  const oauthMessage = (() => {
    switch (oauthError) {
      case 'no_code': return 'No se recibió autorización de Google.';
      case 'no_email': return 'No fue posible obtener su correo de Google.';
      case 'token_exchange_failed': return 'Error al comunicarse con Google. Intente de nuevo.';
      case 'userinfo_failed': return 'No fue posible obtener su perfil de Google. Intente de nuevo.';
      case 'google_unreachable': return 'No fue posible comunicarse con Google. Intente de nuevo.';
      case 'google_unavailable': return 'El acceso con Google no está disponible ahora. Use su correo y contraseña.';
      case 'not_invited': return 'No hay una cuenta registrada con este correo. Pida al colegio que lo invite o vincule como tutor.';
      case 'email_unverified': return 'Su correo de Google no está verificado. Verifíquelo e intente de nuevo.';
      case 'backend_unreachable': return 'El servicio no está disponible en este momento. Intente más tarde.';
      default: return oauthError ? 'Ocurrió un error. Intente de nuevo.' : null;
    }
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const { data } = await api.post('/accounts/token/', { email, password });
      const access = data.access;
      // Set the in-memory token first so the /me call is authorized; the refresh
      // token was set as an httpOnly cookie by the server.
      useAuthStore.getState().setAccess(access);
      const { data: me } = await authApi.me();
      setAuth(me, access);
      navigate(ROLE_PATHS[me.role] ?? '/portal', { replace: true });
    } catch {
      setFormError('Credenciales incorrectas o cuenta sin contraseña. Use Google si su cuenta es institucional.');
    } finally {
      setSubmitting(false);
    }
  };

  const alertMsg = formError ?? oauthMessage;

  return (
    <div className="flex min-h-screen flex-col">
      <div className="accent-bar" />
      <div className="flex flex-1">
        {/* Left dark panel */}
        <div className="relative hidden w-[48%] flex-col justify-between overflow-hidden bg-dark p-12 lg:flex">
          {/* blurred campus bg */}
          <img
            src="/assets/facade.webp"
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-[0.16] blur-[2px]"
            onError={e => ((e.target as HTMLImageElement).style.display = 'none')}
          />
          <div className="absolute -left-[100px] -top-[120px] h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(64,26,142,0.6),rgba(8,5,22,0)_68%)]" />
          <div className="absolute -bottom-[100px] -right-[80px] h-[320px] w-[320px] rounded-full bg-[radial-gradient(circle,rgba(71,160,40,0.22),rgba(8,5,22,0)_68%)]" />

          <div className="relative">
            <Link to="/" aria-label="Colegio Interlaken — Inicio">
              <Logo variant="stacked" size={120} theme="dark" eager />
            </Link>
          </div>
          <div className="relative">
            <div className="section-label-pink inline-flex">Portal Escolar</div>
            <h1 className="mt-3 font-head text-[44px] font-black leading-[1.08] tracking-[-1px] text-white">
              Formando Líderes<br />
              <span className="bg-[linear-gradient(100deg,var(--pink)_0%,var(--purple-mid)_100%)] bg-clip-text text-transparent">con Excelencia</span>
            </h1>
            <p className="mt-4 max-w-[420px] text-[15px] leading-relaxed text-white/60">
              Acceda al portal de Colegio Interlaken para consultar colegiaturas, cafetería y pagos en línea.
            </p>
          </div>
          <div className="relative flex gap-7">
            {[[String(SCHOOL_YEARS), 'Años'], ['1,200+', 'Alumnos'], ['95%', 'Aprovechamiento']].map(([n, l]) => (
              <div key={l}>
                <div className="font-head text-2xl font-extrabold text-white">{n}</div>
                <div className="text-xs text-white/50">{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right form panel */}
        <main id="contenido" className="flex flex-1 items-center justify-center bg-cream px-6 py-8 sm:px-8 sm:py-10">
          <div className="w-full max-w-[400px]">
            {/* Mobile logo */}
            <div className="mb-7 flex justify-center lg:hidden">
              <Link to="/" aria-label="Colegio Interlaken — Inicio">
                <Logo variant="stacked" size={96} theme="light" eager />
              </Link>
            </div>

            <div className="rounded-[22px] border border-line bg-white px-6 py-8 shadow-[0_20px_50px_-24px_rgba(64,26,142,0.35)] sm:px-7 sm:py-9">
              <h2 className="text-center font-head text-fluid-xl font-extrabold text-ink">Iniciar Sesión</h2>
              <p className="mb-6 mt-1 text-center text-[13px] text-muted">Acceso para familias y personal del colegio</p>

              {alertMsg && (
                <div className="mb-[18px] rounded-xl border border-pink bg-pink/[0.08] px-3.5 py-2.5 text-[13px] text-pink-dark">
                  {alertMsg}
                </div>
              )}

              <button
                type="button"
                onClick={() => authApi.googleLogin()}
                className="flex min-h-[44px] w-full items-center justify-center gap-2.5 rounded-xl border border-line bg-white px-3 py-3 text-sm font-semibold text-ink transition-colors hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
              >
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                Continuar con Google
              </button>

              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-line" />
                <span className="text-[11.5px] font-semibold text-subtle">O CON CORREO</span>
                <div className="h-px flex-1 bg-line" />
              </div>

              <form onSubmit={handleSubmit}>
                <label htmlFor="login-email" className="label">Correo electrónico</label>
                <div className="relative mb-3.5">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
                  <input
                    id="login-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="correo@interlaken.edu.mx"
                    className="input-field min-h-[44px] pl-10 text-base"
                  />
                </div>
                <label htmlFor="login-password" className="label">Contraseña</label>
                <div className="relative mb-5">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="input-field min-h-[44px] pl-10 pr-11 text-base"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-subtle transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-pink min-h-[44px] w-full justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:opacity-70"
                >
                  {submitting ? 'Ingresando…' : (<><LogIn className="h-4 w-4" aria-hidden="true" /> Ingresar</>)}
                </button>
                <p className="mt-3.5 text-center text-[12px] text-subtle">
                  ¿Olvidó su contraseña o es su primer acceso?{' '}
                  <Link to="/olvide-contrasena" className="font-semibold text-purple hover:underline">
                    Activar / restablecer
                  </Link>
                </p>
                <p className="mt-2 text-center text-[12px] text-subtle">
                  ¿Problemas?{' '}
                  <Link to="/contacto" className="font-semibold text-purple hover:underline">Contacte al colegio</Link>
                </p>
              </form>
            </div>

            <p className="mt-5 text-center text-[12.5px] text-subtle">
              ¿No tiene cuenta?{' '}
              <Link to="/pre-registro" className="font-semibold text-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 rounded">Inicie su pre-registro</Link>
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
