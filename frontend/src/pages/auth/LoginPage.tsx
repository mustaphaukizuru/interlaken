import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { api, authApi } from '@/services/api';
import Logo from '@/components/ui/Logo';
import toast from 'react-hot-toast';

const ROLE_PATHS: Record<string, string> = {
  parent: '/portal',
  student: '/alumno',
  admin: '/admin',
  staff: '/portal',
};

export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { setAuth, isAuthenticated, user } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Handle Google OAuth callback (tokens in URL params)
  useEffect(() => {
    const access = params.get('access');
    const refresh = params.get('refresh');
    if (access && refresh) {
      authApi.me()
        .then(({ data }) => {
          setAuth(data, access, refresh);
          navigate(ROLE_PATHS[data.role] ?? '/portal', { replace: true });
        })
        .catch(() => {
          toast.error('Error al iniciar sesión. Intente nuevamente.');
          navigate('/login', { replace: true });
        });
    }
  }, [params, setAuth, navigate]);

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
      default: return oauthError ? 'Ocurrió un error. Intente de nuevo.' : null;
    }
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const { data } = await api.post('/accounts/token/', { email, password });
      const access = data.access ?? data.token;
      const refresh = data.refresh ?? '';
      localStorage.setItem('access_token', access);
      const { data: me } = await authApi.me();
      setAuth(me, access, refresh);
      navigate(ROLE_PATHS[me.role] ?? '/portal', { replace: true });
    } catch {
      setFormError('Credenciales incorrectas o cuenta sin contraseña. Use Google si su cuenta es institucional.');
    } finally {
      setSubmitting(false);
    }
  };

  const alertMsg = formError ?? oauthMessage;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="accent-bar" />
      <div style={{ flex: 1, display: 'flex' }}>
        {/* Left dark panel */}
        <div
          className="hidden lg:flex"
          style={{ width: '48%', position: 'relative', background: '#080516', flexDirection: 'column', justifyContent: 'space-between', padding: '48px', overflow: 'hidden' }}
        >
          {/* blurred campus bg */}
          <img src="/assets/facade.webp" alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.16, filter: 'blur(2px)' }} onError={e => ((e.target as HTMLImageElement).style.display = 'none')} />
          <div style={{ position: 'absolute', top: -120, left: -100, width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(circle, rgba(64,26,142,0.6), rgba(8,5,22,0) 68%)' }} />
          <div style={{ position: 'absolute', bottom: -100, right: -80, width: 320, height: 320, borderRadius: '50%', background: 'radial-gradient(circle, rgba(29,162,171,0.22), rgba(8,5,22,0) 68%)' }} />

          <div style={{ position: 'relative' }}>
            <Logo size={46} theme="dark" />
          </div>
          <div style={{ position: 'relative' }}>
            <div className="section-label-pink" style={{ display: 'inline-flex' }}>Portal Escolar</div>
            <h1 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 900, fontSize: 44, lineHeight: 1.08, color: '#fff', letterSpacing: -1, marginTop: 12 }}>
              Formando Líderes<br />
              <span style={{ background: 'linear-gradient(100deg, #ef2558 0%, #b13bbf 55%, #5e3aad 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>con Excelencia</span>
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15, marginTop: 16, maxWidth: 420, lineHeight: 1.6 }}>
              Accede al portal de Colegio Interlaken para consultar calificaciones, asistencia, cafetería y pagos.
            </p>
          </div>
          <div style={{ position: 'relative', display: 'flex', gap: 28 }}>
            {[['40', 'Años'], ['1,200+', 'Alumnos'], ['95%', 'Aprovechamiento']].map(([n, l]) => (
              <div key={l}>
                <div style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 24, color: '#fff' }}>{n}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right form panel */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 24px', background: '#F5F4FA' }}>
          <div style={{ width: '100%', maxWidth: 400 }}>
            {/* Mobile logo */}
            <div className="lg:hidden" style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
              <Logo size={44} theme="light" />
            </div>

            <div style={{ background: '#fff', border: '1px solid #ECEAF3', borderRadius: 22, padding: '32px 28px', boxShadow: '0 20px 50px -24px rgba(64,26,142,0.35)' }}>
              <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 22, color: '#1A1130', textAlign: 'center' }}>Iniciar Sesión</h2>
              <p style={{ fontSize: 13, color: '#6E6885', textAlign: 'center', marginTop: 4, marginBottom: 24 }}>Bienvenido de vuelta a Interlaken</p>

              {alertMsg && (
                <div style={{ background: 'rgba(239,37,88,0.08)', border: '1px solid #ef2558', borderRadius: 12, padding: '11px 14px', fontSize: 13, color: '#d81a49', marginBottom: 18 }}>
                  {alertMsg}
                </div>
              )}

              <button
                onClick={() => authApi.googleLogin()}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, border: '1px solid #ECEAF3', borderRadius: 12, padding: '12px', fontSize: 14, fontWeight: 600, color: '#1A1130', background: '#fff', cursor: 'pointer' }}
              >
                <svg viewBox="0 0 24 24" style={{ width: 18, height: 18 }}>
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                Continuar con Google
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
                <div style={{ flex: 1, height: 1, background: '#ECEAF3' }} />
                <span style={{ fontSize: 11.5, color: '#9A93AE', fontWeight: 600 }}>O CON CORREO</span>
                <div style={{ flex: 1, height: 1, background: '#ECEAF3' }} />
              </div>

              <form onSubmit={handleSubmit}>
                <label className="label">Correo electrónico</label>
                <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="correo@interlaken.edu.mx" className="input-field" style={{ marginBottom: 14 }} />
                <label className="label">Contraseña</label>
                <input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" className="input-field" style={{ marginBottom: 20 }} />
                <button type="submit" disabled={submitting} className="btn-pink" style={{ width: '100%', justifyContent: 'center', opacity: submitting ? 0.7 : 1 }}>
                  {submitting ? 'Ingresando…' : 'Ingresar'}
                </button>
              </form>
            </div>

            <p style={{ textAlign: 'center', fontSize: 12.5, color: '#9A93AE', marginTop: 20 }}>
              ¿No tiene cuenta?{' '}
              <Link to="/pre-registro" style={{ color: '#401a8e', fontWeight: 600 }}>Iniciar pre-registro</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
