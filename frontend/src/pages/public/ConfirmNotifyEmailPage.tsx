import { useEffect, useRef, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
// Icons and button styles the main bundle does not share: importing the ErrorBoundary's ones
// (AlertTriangle, RefreshCw, <Button>) split them out of it and grew every page's download.
import { CheckCircle2, CircleAlert, Clock, Info, MailCheck, RotateCw } from 'lucide-react';
import { Seo } from '@/components/seo/Seo';
import Logo from '@/components/ui/Logo';
import { api, type NotifyEmailLink } from '@/services/api';

/** Public calls, kept in this lazy page so the shared API chunk every page loads does not grow. */
export const notifyEmailLinkApi = {
  /** What the link confirms; changes nothing. */
  preview: (token: string) => api.get<NotifyEmailLink>('/accounts/notify-email/confirm/', { params: { token } }),
  /** The click: the signed token is the proof, no session needed. */
  confirm: (token: string) => api.post<NotifyEmailLink>('/accounts/notify-email/confirm/', { token }),
};

const fmtExpiry = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}, ${d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
};

const linkOf = (err: unknown): NotifyEmailLink | null => {
  const data = (err as { response?: { data?: NotifyEmailLink } })?.response?.data;
  return data && typeof data.state === 'string' ? data : null;
};

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-cream">
      <Seo title="Confirmar correo para avisos" description="Confirme el correo en el que recibirá los avisos del Colegio Interlaken.">
        <meta name="robots" content="noindex, nofollow" />
        {/* The token is in this page's URL: never send it to another site. */}
        <meta name="referrer" content="no-referrer" />
      </Seo>
      <div className="accent-bar" />
      <main id="contenido" className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center sm:py-14">
        <div className="w-full max-w-[460px]">
          <div className="mb-7 flex justify-center">
            <Link to="/" aria-label="Colegio Interlaken, inicio">
              <Logo variant="stacked" size={88} theme="light" eager />
            </Link>
          </div>
          <div className="rounded-[22px] border border-line bg-white px-6 py-8 shadow-[0_20px_50px_-24px_rgba(64,26,142,0.35)] sm:px-8 sm:py-9">
            {children}
          </div>
          <p className="mt-6 text-center text-xs leading-relaxed text-subtle">
            ¿Dudas? Escríbanos a <a href="mailto:info@interlaken.com.mx" className="font-semibold text-purple hover:underline">info@interlaken.com.mx</a>
          </p>
        </div>
      </main>
    </div>
  );
}

function Badge({ tone, children }: { tone: 'brand' | 'success' | 'warning' | 'danger'; children: ReactNode }) {
  const tones = {
    brand: 'bg-purple/10 text-purple',
    success: 'bg-green/15 text-green-dark',
    warning: 'bg-amber/15 text-amber',
    danger: 'bg-coral/10 text-coral-dark',
  };
  return <span className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${tones[tone]}`} aria-hidden="true">{children}</span>;
}

/** The facts the link confirms, as label/value rows. */
function Facts({ link }: { link: NotifyEmailLink }) {
  const rows: [string, string][] = [];
  if (link.account) {
    rows.push([link.account.is_student ? 'Alumno' : 'Cuenta',
      [link.account.name, link.account.detail].filter(Boolean).join(' · ')]);
  }
  if (link.email) rows.push(['Correo', link.email]);
  rows.push(['Recibirá', 'Compras y recargas de cafetería, saldo bajo y comunicados del colegio']);
  if (link.expires_at) rows.push(['El enlace vence', fmtExpiry(link.expires_at)]);
  return (
    <dl className="mt-6 divide-y divide-line overflow-hidden rounded-xl border border-line bg-cream-2/60 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="grid gap-0.5 px-4 py-3 sm:grid-cols-[120px_1fr] sm:gap-3">
          <dt className="text-subtle">{k}</dt>
          <dd className="font-semibold text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Outcome({ link }: { link: NotifyEmailLink }) {
  const heading = useRef<HTMLHeadingElement>(null);
  // Move focus to the outcome so screen readers announce it after the click.
  useEffect(() => { heading.current?.focus(); }, []);
  const whose = link.account?.is_student ? `de ${link.account.name}` : 'de su cuenta';

  if (link.state === 'confirmed') {
    return (
      <div className="text-center" role="status">
        <Badge tone="success"><CheckCircle2 size={28} /></Badge>
        <h1 ref={heading} tabIndex={-1} className="mt-5 font-head text-fluid-xl font-extrabold text-ink outline-none">Listo, correo confirmado</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          Desde ahora, los avisos {whose} llegarán también a <strong className="text-ink">{link.email}</strong>.
        </p>
        <p className="mt-4 text-sm text-subtle">Ya puede cerrar esta página.</p>
      </div>
    );
  }
  const copy = {
    expired: { tone: 'warning' as const, icon: <Clock size={28} />, title: 'El enlace venció' },
    superseded: { tone: 'brand' as const, icon: <Info size={28} />, title: 'Este enlace ya no se usa' },
    invalid: { tone: 'danger' as const, icon: <CircleAlert size={28} />, title: 'El enlace no es válido' },
    ready: { tone: 'brand' as const, icon: <MailCheck size={28} />, title: '' },
  }[link.state];
  return (
    <div className="text-center" role="status">
      <Badge tone={copy.tone}>{copy.icon}</Badge>
      <h1 ref={heading} tabIndex={-1} className="mt-5 font-head text-fluid-xl font-extrabold text-ink outline-none">{copy.title}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        {link.detail || 'Ábralo completo desde el correo que recibió.'}
      </p>
      <Link to="/portal/perfil?tab=avisos" className="btn-outline mt-6 inline-flex min-h-[44px] items-center justify-center px-5 text-sm">
        Ir al Portal de Familias
      </Link>
    </div>
  );
}

/**
 * /confirmar-correo?token=… — the page the «correo para avisos» email opens
 * (owner, 2026-11-08). Public: the signed token proves the mailbox and names
 * the account, so a parent confirms from their own phone without signing in,
 * signed out or signed into another account. Opening the page changes nothing;
 * the button does (email scanners pre-open links).
 */
export default function ConfirmNotifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const preview = useQuery({
    queryKey: ['notify-email-link', token],
    queryFn: () => notifyEmailLinkApi.preview(token).then((r) => r.data),
    enabled: !!token,
    retry: 1,
  });
  const confirm = useMutation({
    mutationFn: () => notifyEmailLinkApi.confirm(token).then((r) => r.data),
  });

  if (!token) return <Shell><Outcome link={{ state: 'invalid' }} /></Shell>;
  if (preview.isLoading) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-8 text-sm text-muted" role="status">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-purple/25 border-t-purple" aria-hidden="true" />
          Revisando el enlace…
        </div>
      </Shell>
    );
  }
  if (preview.isError || !preview.data) {
    return (
      <Shell>
        <div className="text-center" role="alert">
          <Badge tone="danger"><CircleAlert size={28} /></Badge>
          <h1 className="mt-5 font-head text-fluid-xl font-extrabold text-ink">No pudimos revisar el enlace</h1>
          <p className="mt-2 text-[15px] text-muted">Revise su conexión e inténtelo de nuevo.</p>
          <button type="button" onClick={() => preview.refetch()} className="btn-outline mt-6 min-h-[44px]">
            <RotateCw size={16} aria-hidden="true" /> Reintentar
          </button>
        </div>
      </Shell>
    );
  }

  const done = confirm.data ?? linkOf(confirm.error);
  if (done) return <Shell><Outcome link={done} /></Shell>;
  const link = preview.data;
  if (link.state !== 'ready') return <Shell><Outcome link={link} /></Shell>;

  const whose = link.account?.is_student ? `de ${link.account.name}` : 'de su cuenta';
  return (
    <Shell>
      <div className="text-center">
        <Badge tone="brand"><MailCheck size={28} /></Badge>
        <h1 className="mt-5 font-head text-fluid-xl font-extrabold text-ink">Confirme su correo para avisos</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          Los avisos {whose} llegarán también a <strong className="text-ink">{link.email}</strong>.
        </p>
      </div>
      <Facts link={link} />
      {link.separate_account && (
        <p className="mt-4 flex gap-2.5 rounded-xl border border-purple/20 bg-purple/[0.05] px-4 py-3 text-[13px] leading-relaxed text-ink">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-purple" aria-hidden="true" />
          <span>Este correo también tiene su propia cuenta en el portal. Son cuentas separadas: confirmar aquí no las une.</span>
        </p>
      )}
      {confirm.isError && !linkOf(confirm.error) && (
        <p className="mt-4 text-center text-sm text-coral-dark" role="alert">No se pudo confirmar. Inténtelo de nuevo.</p>
      )}
      <button
        type="button"
        onClick={() => confirm.mutate()}
        disabled={confirm.isPending}
        aria-busy={confirm.isPending}
        className="btn-primary mt-6 min-h-[48px] w-full disabled:cursor-wait disabled:opacity-70"
      >
        {confirm.isPending ? 'Confirmando…' : 'Confirmar correo'}
      </button>
      <p className="mt-4 text-center text-[13px] leading-relaxed text-subtle">
        No necesita iniciar sesión. Esto solo agrega una copia de los avisos: no crea una cuenta ni da acceso al portal.
        ¿No lo pidió? Cierre esta página; sin su confirmación no recibirá ningún aviso.
      </p>
    </Shell>
  );
}
