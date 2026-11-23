/**
 * Iniciar sesión (/login): the portal's entry screen as a CMS page (slug
 * iniciar-sesion, docs/cms/full-coverage.md). One locked section: the screen
 * with every word editable. The sign-in logic (password, TOTP, Google OAuth
 * return, deep-link return, old «correo para avisos» links) is unchanged and
 * runs only on the site; the editor preview shows the screen at rest.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, LogIn } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/authStore';
import { api, authApi, bootstrapSession } from '@/services/api';
import Logo from '@/components/ui/Logo';
import { PasswordHelp } from '@/components/portal/PasswordHelp';
import { homePath } from '@/lib/areas';
import { Illustration } from '@/components/ui/Illustration';
import { isIllustration } from '@/lib/illustrations';
import type { User } from '@/types';
import { imageSrc, useTokens, type CmsLink } from '../runtime';
import { useCmsPreview } from '../preview';
import { asLink, asList, CmsAnchor, defineModule, f, grouped, sectionsOf } from './kit';

const section = sectionsOf('acceso');

type Copy = (key: string) => string;

/* ── The screen (presentational) ─────────────────────────────────────────── */
interface ViewState {
  email: string; password: string; totp: string; showPassword: boolean; needsTotp: boolean;
  submitting: boolean; bootstrapping: boolean; alert: string | null; formError: boolean;
}
interface ViewActions {
  onEmail: (v: string) => void; onPassword: (v: string) => void; onTotp: (v: string) => void;
  onTogglePassword: () => void; onSubmit: (e: FormEvent) => void; onGoogle: () => void;
}

function LoginView({ c, p, s, a }: { c: Copy; p: LoginProps; s: ViewState; a: ViewActions }) {
  const stats = asList<{ value?: string; label?: string }>(p.stats);
  const problems = asLink(p.problemsLink);
  const signup = asLink(p.signupLink);
  const t = useTokens();
  // «none» hides it; content saved before the field existed shows the padlock.
  const art = p.illustration === 'none' ? undefined : isIllustration(p.illustration) ? p.illustration : 'acceso';
  return (
    <div className="flex min-h-screen flex-col">
      <div className="accent-bar" />
      <div className="flex flex-1">
        {/* Left dark panel */}
        <div className="relative hidden w-[48%] flex-col justify-between overflow-hidden bg-dark p-12 lg:flex">
          {/* blurred campus bg */}
          {p.image ? (
            <img
              src={imageSrc(p.image)}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-[0.16] blur-[2px]"
              onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
            />
          ) : null}
          <div className="absolute -left-[100px] -top-[120px] h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(64,26,142,0.6),rgba(8,5,22,0)_68%)]" />
          <div className="absolute -bottom-[100px] -right-[80px] h-[320px] w-[320px] rounded-full bg-[radial-gradient(circle,rgba(71,160,40,0.22),rgba(8,5,22,0)_68%)]" />

          <div className="relative">
            <Link to="/" aria-label="Colegio Interlaken — Inicio">
              <Logo variant="stacked" size={120} theme="dark" eager />
            </Link>
          </div>
          <div className="relative">
            {art && (
              <div className="relative mb-8 flex h-44 w-44 items-center justify-center" aria-hidden="true">
                <span className="absolute inset-0 rounded-full bg-white/[0.06] ring-1 ring-white/10 backdrop-blur-sm" />
                <span
                  className="absolute inset-3 rounded-full"
                  style={{ background: 'radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--pink) 30%, transparent) 0%, transparent 70%)' }}
                />
                <Illustration name={art} size={144} className="relative drop-shadow-[0_16px_24px_rgba(8,5,22,0.5)]" />
              </div>
            )}
            {p.label && <div className="section-label-pink inline-flex">{c('label')}</div>}
            <h1 className="mt-3 font-head text-[44px] font-black leading-[1.08] tracking-[-1px] text-white">
              {c('title')}{p.titleAccent && <br />}
              {p.titleAccent && <span className="bg-[linear-gradient(100deg,var(--pink)_0%,var(--purple-mid)_100%)] bg-clip-text text-transparent">{c('titleAccent')}</span>}
            </h1>
            {p.text && (
              <p className="mt-4 max-w-[420px] text-[15px] leading-relaxed text-white/60">
                {c('text')}
              </p>
            )}
          </div>
          <div className="relative flex gap-7">
            {stats.map((st, i) => (
              <div key={i}>
                <div className="font-head text-2xl font-extrabold text-white">{t(st.value)}</div>
                <div className="text-xs text-white/50">{t(st.label)}</div>
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

            <div className="rounded-md bg-white px-6 py-8 shadow-[0_20px_50px_-24px_rgba(64,26,142,0.35)] sm:px-7 sm:py-9">
              <h2 className="text-center font-head text-fluid-xl font-extrabold text-ink">{c('heading')}</h2>
              <p className="mb-6 mt-1 text-center text-sm text-muted">{c('subheading')}</p>

              {s.bootstrapping && (
                <div
                  role="status"
                  aria-live="polite"
                  className="mb-[18px] rounded-sm bg-info-bg px-3.5 py-3 text-center text-sm text-ink"
                >
                  {c('googleBusy')}
                </div>
              )}

              {s.alert && !s.bootstrapping && (
                <div
                  id="login-error"
                  role="alert"
                  className="mb-[18px] rounded-sm bg-danger-bg px-3.5 py-2.5 text-sm font-medium text-danger"
                >
                  {s.alert}
                </div>
              )}

              <button
                type="button"
                disabled={s.bootstrapping}
                onClick={a.onGoogle}
                className="flex min-h-[44px] w-full items-center justify-center gap-2.5 rounded-sm border border-line bg-white px-3 py-3 text-sm font-semibold text-ink transition-colors hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:opacity-60"
              >
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                {c('googleButton')}
              </button>

              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-line" />
                <span className="text-[11.5px] font-semibold text-subtle">{c('divider')}</span>
                <div className="h-px flex-1 bg-line" />
              </div>

              <form onSubmit={a.onSubmit}>
                <label htmlFor="login-email" className="label">{c('emailLabel')}</label>
                <div className="relative mb-3.5">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
                  <input
                    id="login-email"
                    type="email" inputMode="email" autoComplete="email"
                    required
                    value={s.email}
                    onChange={(e) => a.onEmail(e.target.value)}
                    placeholder={c('emailPlaceholder')}
                    disabled={s.bootstrapping}
                    aria-invalid={s.formError ? true : undefined}
                    aria-describedby={s.formError ? 'login-error' : undefined}
                    className="input-field min-h-[44px] pl-10 text-base disabled:opacity-60"
                  />
                </div>
                <label htmlFor="login-password" className="label">{c('passwordLabel')}</label>
                <div className="relative mb-5">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
                  <input
                    id="login-password"
                    type={s.showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={s.password}
                    onChange={(e) => a.onPassword(e.target.value)}
                    placeholder={c('passwordPlaceholder')}
                    disabled={s.bootstrapping}
                    aria-invalid={s.formError ? true : undefined}
                    aria-describedby={s.formError ? 'login-error' : undefined}
                    className="input-field min-h-[44px] pl-10 pr-11 text-base disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={a.onTogglePassword}
                    disabled={s.bootstrapping}
                    aria-label={s.showPassword ? c('hidePassword') : c('showPassword')}
                    className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-sm text-subtle transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:opacity-60"
                  >
                    {s.showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </div>
                {s.needsTotp && (
                  <div>
                    <label htmlFor="login-totp" className="label">{c('totpLabel')}</label>
                    <input id="login-totp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} value={s.totp}
                      onChange={(e) => a.onTotp(e.target.value.replace(/[^0-9]/g, ''))} placeholder="123456"
                      className="input-field min-h-[44px] text-center text-lg tracking-[0.3em]" />
                  </div>
                )}
                <button
                  type="submit"
                  disabled={s.submitting || s.bootstrapping}
                  className="btn-pink min-h-[44px] w-full justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:opacity-70"
                >
                  {s.bootstrapping
                    ? c('completingLabel')
                    : s.submitting
                      ? c('submittingLabel')
                      : (<><LogIn className="h-4 w-4" aria-hidden="true" /> {c('submitLabel')}</>)}
                </button>
                <PasswordHelp
                  variant="inline"
                  email={s.email.trim() || undefined}
                  copy={{ before: c('pwBefore'), whatsapp: c('pwWhatsapp'), or: c('pwOr'), email: c('pwEmail'), after: c('pwAfter') }}
                />
                <p className="mt-2 text-center text-[12px] text-subtle">
                  {c('problemsText')}{' '}
                  <CmsAnchor link={problems} className="font-semibold text-purple hover:underline">{t(problems.label)}</CmsAnchor>
                </p>
              </form>
            </div>

            <p className="mt-5 text-center text-[12.5px] text-subtle">
              {c('signupText')}{' '}
              <CmsAnchor link={signup} className="font-semibold text-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 rounded-sm">{t(signup.label)}</CmsAnchor>
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

/* ── Sign-in logic (unchanged; only the words come from the copy) ────────── */
const OAUTH_ERRORS: Record<string, string> = {
  no_code: 'errNoCode', state_mismatch: 'errStateMismatch', no_email: 'errNoEmail',
  token_exchange_failed: 'errTokenExchange', userinfo_failed: 'errUserinfo',
  google_unreachable: 'errGoogleUnreachable', google_unavailable: 'errGoogleUnavailable',
  not_invited: 'errNotInvited', inactive: 'errInactive', email_unverified: 'errEmailUnverified',
  backend_unreachable: 'errBackendUnreachable',
};

function LoginLogic({ c, p }: { c: Copy; p: LoginProps }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  // ProtectedRoute sends the page the user tried to open (push/email deep
  // links); return there after login. ProtectedRoute re-checks the role.
  const from = (location.state as { from?: { pathname?: string; search?: string } } | null)?.from;
  const fromPath = from?.pathname && from.pathname.startsWith('/') && from.pathname !== '/login'
    ? `${from.pathname}${from.search ?? ''}`
    : null;
  // Families → /portal, admins → /admin, staff → their console area (or /staff).
  const homeFor = (who: Pick<User, 'role' | 'staff_areas'>) => fromPath ?? homePath(who);
  const { setAuth, setUser, isAuthenticated, user } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const oauthReturning = params.get('login') === 'ok';
  // Derived: we are bootstrapping while the OAuth return param is present and
  // the silent refresh hasn't failed (no setState needed inside the effect).
  const [bootstrapFailed, setBootstrapFailed] = useState(false);
  const oauthBootstrapping = oauthReturning && !bootstrapFailed;

  // Handle the Google OAuth return. The backend set the session as httpOnly
  // cookies and redirected here with ?login=ok (NO tokens in the URL); we mint
  // an in-memory access token from the cookie via a silent refresh.
  useEffect(() => {
    if (!oauthReturning) return;
    let cancelled = false;
    bootstrapSession()
      .then(async (ok) => {
        if (!ok) throw new Error('no-session');
        const { data } = await authApi.me();
        if (cancelled) return;
        setUser(data);
        navigate(homeFor(data), { replace: true });
      })
      .catch(() => {
        if (cancelled) return;
        toast.error(c('errOauthToast'));
        setBootstrapFailed(true);
        navigate('/login', { replace: true });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthReturning, setUser, navigate]);

  useEffect(() => {
    if (isAuthenticated && user) {
      navigate(homeFor(user), { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user, navigate, fromPath]);

  const oauthError = params.get('error');
  const oauthMessage = oauthError ? c(OAUTH_ERRORS[oauthError] ?? 'errOther') : null;

  const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const { data } = await api.post('/accounts/token/', { email, password, ...(totp ? { totp } : {}) });
      const access = data.access;
      // Set the in-memory token first so the /me call is authorized; the refresh
      // token was set as an httpOnly cookie by the server.
      useAuthStore.getState().setAccess(access);
      const { data: me } = await authApi.me();
      setAuth(me, access);
      navigate(homeFor(me), { replace: true });
    } catch (err) {
      const response = (err as { response?: { status?: number; data?: { totp_required?: boolean; detail?: string } } })?.response;
      const body = response?.data;
      if (body?.totp_required) {
        setNeedsTotp(true);
        setFormError(totp ? (body.detail ?? c('errTotp')) : null);
      } else if (!response) {
        // No answer at all (offline, DNS down): not a password problem.
        setFormError(c('errOffline'));
      } else if (response.status === 429) {
        setFormError(c('errTooMany'));
      } else if ((response.status ?? 0) >= 500) {
        setFormError(c('errUnavailable'));
      } else {
        setFormError(c('errCredentials'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // «Correo para avisos» links sent before 2026-11-08 open the profile page and land here
  // signed out. Confirming needs no sign-in now: go straight to the public page.
  const legacyToken = new URLSearchParams(from?.search ?? '').get('verificar_correo');
  if (legacyToken) return <Navigate to={`/confirmar-correo?token=${encodeURIComponent(legacyToken)}`} replace />;

  return (
    <LoginView
      c={c}
      p={p}
      s={{ email, password, totp, showPassword, needsTotp, submitting, bootstrapping: oauthBootstrapping, alert: formError ?? oauthMessage, formError: !!formError }}
      a={{
        onEmail: setEmail, onPassword: setPassword, onTotp: setTotp,
        onTogglePassword: () => setShowPassword((v) => !v), onSubmit: handleSubmit, onGoogle: () => authApi.googleLogin(),
      }}
    />
  );
}

/* ── The section ─────────────────────────────────────────────────────────── */
interface LoginProps { image?: number | string; stats?: unknown; problemsLink?: CmsLink; signupLink?: CmsLink; label?: string; titleAccent?: string; text?: string; illustration?: string; [copy: string]: unknown }

const PREVIEW: ViewState = { email: '', password: '', totp: '', showPassword: false, needsTotp: false, submitting: false, bootstrapping: false, alert: null, formError: false };
const NOOP: ViewActions = { onEmail: () => {}, onPassword: () => {}, onTotp: () => {}, onTogglePassword: () => {}, onSubmit: (e) => e.preventDefault(), onGoogle: () => {} };

function LoginScreen(p: LoginProps) {
  const t = useTokens();
  const preview = useCmsPreview();
  const c: Copy = (key) => t(p[key]);
  // The editor shows the screen at rest: it must never sign anyone in or redirect.
  return preview ? <LoginView c={c} p={p} s={PREVIEW} a={NOOP} /> : <LoginLogic c={c} p={p} />;
}

export const sections = [
  section({
    type: 'screen', label: 'Iniciar sesión · Pantalla de acceso', locked: true,
    description: 'La entrada al portal de familias y personal. Aquí se editan todos sus textos, la foto y las cifras del panel; el acceso con correo, contraseña y Google no cambia.',
    component: LoginScreen,
    fields: [
      ...grouped('Panel de bienvenida (computadora)', [
        f.text('label', 'Etiqueta superior'),
        f.text('title', 'Título'),
        f.text('titleAccent', 'Título (segunda línea, en degradado)'),
        f.textarea('text', 'Texto'),
        f.image('image', 'Foto de fondo'),
        f.illustration('illustration', 'Ilustración', { hint: 'Sobre el título del panel. Sin elegir, el candado con llave.' }),
        f.items('stats', 'Cifras', [f.text('value', 'Cifra'), f.text('label', 'Texto')]),
      ]),
      ...grouped('Tarjeta de acceso', [
        f.text('heading', 'Título'), f.text('subheading', 'Subtítulo'),
        f.text('googleButton', 'Botón de Google'), f.text('googleBusy', 'Aviso mientras entra con Google'),
        f.text('divider', 'Separador'),
        f.text('emailLabel', 'Correo: etiqueta'), f.text('emailPlaceholder', 'Correo: ejemplo dentro del campo'),
        f.text('passwordLabel', 'Contraseña: etiqueta'), f.text('passwordPlaceholder', 'Contraseña: texto dentro del campo'),
        f.text('showPassword', 'Botón «mostrar contraseña» (lectores de pantalla)'), f.text('hidePassword', 'Botón «ocultar contraseña» (lectores de pantalla)'),
        f.text('totpLabel', 'Código de verificación: etiqueta'),
        f.text('submitLabel', 'Botón para entrar'), f.text('submittingLabel', 'Botón mientras entra'), f.text('completingLabel', 'Botón mientras termina con Google'),
      ]),
      ...grouped('Ayuda y enlaces', [
        f.text('pwBefore', 'Contraseña olvidada: texto'), f.text('pwWhatsapp', 'Contraseña olvidada: enlace de WhatsApp'),
        f.text('pwOr', 'Contraseña olvidada: palabra entre los enlaces'), f.text('pwEmail', 'Contraseña olvidada: enlace de correo'),
        f.text('pwAfter', 'Contraseña olvidada: texto final'),
        f.text('problemsText', '¿Problemas?: texto'), f.link('problemsLink', '¿Problemas?: enlace'),
        f.text('signupText', 'Sin cuenta: texto'), f.link('signupLink', 'Sin cuenta: enlace'),
      ]),
      ...grouped('Mensajes de error', [
        f.text('errCredentials', 'Correo o contraseña incorrectos'), f.text('errOffline', 'Sin conexión'),
        f.text('errTooMany', 'Demasiados intentos'), f.text('errUnavailable', 'Servicio no disponible'),
        f.text('errTotp', 'Código de verificación incorrecto'), f.text('errOauthToast', 'Falló la entrada con Google (aviso emergente)'),
        f.text('errNoCode', 'Google: sin autorización'), f.text('errStateMismatch', 'Google: sesión caducada'),
        f.text('errNoEmail', 'Google: sin correo'), f.text('errTokenExchange', 'Google: error de comunicación'),
        f.text('errUserinfo', 'Google: sin perfil'), f.text('errGoogleUnreachable', 'Google: sin respuesta'),
        f.text('errGoogleUnavailable', 'Google: no disponible'), f.text('errNotInvited', 'Correo sin cuenta en el colegio'),
        f.text('errInactive', 'Cuenta desactivada'), f.text('errEmailUnverified', 'Correo de Google sin verificar'),
        f.text('errBackendUnreachable', 'Servidor no disponible'), f.text('errOther', 'Otro error'),
      ]),
    ],
    defaults: {
      label: 'Portal Escolar', title: 'Formando Líderes', titleAccent: 'con Excelencia',
      text: 'Acceda al portal de Colegio Interlaken para consultar cafetería y pagos en línea.',
      image: '/assets/facade.webp', illustration: 'acceso',
      stats: [{ value: '{{anios}}', label: 'Años' }, { value: '1,200+', label: 'Alumnos' }, { value: '95%', label: 'Aprovechamiento' }],
      heading: 'Iniciar Sesión', subheading: 'Acceso para familias y personal del colegio',
      googleButton: 'Continuar con Google', googleBusy: 'Completando acceso con Google…', divider: 'O CON CORREO',
      emailLabel: 'Correo electrónico', emailPlaceholder: 'correo@interlaken.com.mx',
      passwordLabel: 'Contraseña', passwordPlaceholder: '••••••••',
      showPassword: 'Mostrar contraseña', hidePassword: 'Ocultar contraseña',
      totpLabel: 'Código de verificación (app de autenticación)',
      submitLabel: 'Ingresar', submittingLabel: 'Ingresando…', completingLabel: 'Completando…',
      pwBefore: '¿Olvidó su contraseña? Solicítela al colegio por', pwWhatsapp: 'WhatsApp', pwOr: 'o', pwEmail: 'correo',
      pwAfter: 'Un administrador le enviará una nueva.',
      problemsText: '¿Problemas?', problemsLink: { label: 'Contacte al colegio', href: '/contacto' },
      signupText: '¿No tiene cuenta? Su cuenta se crea al inscribirse.', signupLink: { label: 'Conozca el proceso de admisión', href: '/admisiones' },
      errCredentials: 'Credenciales incorrectas o cuenta sin contraseña. Use Google si su cuenta es institucional.',
      errOffline: 'No hay conexión con el servidor. Revise su internet e intente de nuevo.',
      errTooMany: 'Demasiados intentos. Espere unos minutos e intente de nuevo.',
      errUnavailable: 'El servicio no está disponible en este momento. Intente más tarde.',
      errTotp: 'Código incorrecto.', errOauthToast: 'Error al iniciar sesión. Intente nuevamente.',
      errNoCode: 'No se recibió autorización de Google.',
      errStateMismatch: 'La sesión de Google caducó o no coincide. Intente de nuevo.',
      errNoEmail: 'No fue posible obtener su correo de Google.',
      errTokenExchange: 'Error al comunicarse con Google. Intente de nuevo.',
      errUserinfo: 'No fue posible obtener su perfil de Google. Intente de nuevo.',
      errGoogleUnreachable: 'No fue posible comunicarse con Google. Intente de nuevo.',
      errGoogleUnavailable: 'El acceso con Google no está disponible ahora. Use su correo y contraseña.',
      errNotInvited: 'No hay una cuenta registrada con este correo. Pida al colegio que lo invite o vincule como tutor.',
      errInactive: 'Esta cuenta está desactivada. Si cree que es un error, contacte al colegio.',
      errEmailUnverified: 'Su correo de Google no está verificado. Verifíquelo e intente de nuevo.',
      errBackendUnreachable: 'El servicio no está disponible en este momento. Intente más tarde.',
      errOther: 'Ocurrió un error. Intente de nuevo.',
    },
  }),
];

export const templates = [{
  slug: 'iniciar-sesion', path: '/login', title: 'Iniciar sesión', group: 'acceso',
  // Outside PublicLayout (no RouteSeo): the template carries its own head; ROUTE_META has the same for the server.
  seo: { title: 'Iniciar sesión', description: 'Acceso al portal del Colegio Interlaken para familias y personal: cafetería y pagos en línea.', noindex: true },
  sections: ['acceso.screen'],
  // Sign-in and one-time links never wait for the CMS (TemplatePage).
  paintAtOnce: true,
}];

export default defineModule(sections, templates);
