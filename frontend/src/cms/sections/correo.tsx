/**
 * Confirmar correo para avisos (/confirmar-correo?token=…): the page the
 * «correo para avisos» e-mail opens, as a CMS page (slug confirmar-correo).
 * One locked section with every word editable. Opening the page changes
 * nothing, the button does (e-mail scanners pre-open links); the token is
 * never sent to another site (referrer meta). The editor preview shows the
 * page as a parent sees it before confirming, with sample data.
 *
 * Media round (owner 2026-11-22): before confirming, the card opens on the
 * envelope illustration; the outcomes keep their status badges.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
// Icons and button styles the main bundle does not share: importing the ErrorBoundary's ones
// (AlertTriangle, RefreshCw, <Button>) split them out of it and grew every page's download.
import { CheckCircle2, CircleAlert, Clock, Info, MailCheck, RotateCw } from 'lucide-react';
import Logo from '@/components/ui/Logo';
import { Illustration } from '@/components/ui/Illustration';
import { isIllustration } from '@/lib/illustrations';
import { api, type NotifyEmailLink } from '@/services/api';
import { useTokens, type CmsLink } from '../runtime';
import { useCmsPreview } from '../preview';
import { asLink, CmsAnchor, defineModule, f, fill, grouped, sectionsOf } from './kit';

const section = sectionsOf('correo');

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

type Copy = (key: string) => string;

/** <meta name="referrer" content="no-referrer"> while this page shows (the token is in its URL). */
function useNoReferrer() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
}

function Shell({ c, children }: { c: Copy; children: ReactNode }) {
  const email = c('helpEmail');
  useNoReferrer();
  return (
    <div className="flex min-h-screen flex-col bg-cream">
      {/* The token is in this page's URL: never send it to another site (spa.py also sends
          Referrer-Policy: no-referrer). noindex comes from the template SEO below. */}
      <div className="accent-bar" />
      <main id="contenido" className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center sm:py-14">
        <div className="w-full max-w-[460px]">
          <div className="mb-7 flex justify-center">
            <Link to="/" aria-label="Colegio Interlaken, inicio">
              <Logo variant="stacked" size={88} theme="light" eager />
            </Link>
          </div>
          <div className="rounded-md bg-white px-6 py-8 shadow-[0_20px_50px_-24px_rgba(64,26,142,0.35)] sm:px-8 sm:py-9">
            {children}
          </div>
          <p className="mt-6 text-center text-xs leading-relaxed text-subtle">
            {c('helpText')}{email && ' '}{email && <a href={`mailto:${email}`} className="font-semibold text-purple hover:underline">{email}</a>}
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
  return <span className={`mx-auto flex h-14 w-14 items-center justify-center rounded-md ${tones[tone]}`} aria-hidden="true">{children}</span>;
}

/** The facts the link confirms, as label/value rows. */
function Facts({ link, c }: { link: NotifyEmailLink; c: Copy }) {
  const rows: [string, string][] = [];
  if (link.account) {
    rows.push([link.account.is_student ? c('factStudent') : c('factAccount'),
      [link.account.name, link.account.detail].filter(Boolean).join(' · ')]);
  }
  if (link.email) rows.push([c('factEmail'), link.email]);
  rows.push([c('factReceives'), c('factReceivesValue')]);
  if (link.expires_at) rows.push([c('factExpires'), fmtExpiry(link.expires_at)]);
  return (
    <dl className="mt-6 divide-y divide-line overflow-hidden rounded-md bg-cream-2/60 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="grid gap-0.5 px-4 py-3 sm:grid-cols-[120px_1fr] sm:gap-3">
          <dt className="text-subtle">{k}</dt>
          <dd className="font-semibold text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** «… {correo}.» with the address in bold, as the page always showed it. */
function WithEmail({ text, email }: { text: string; email?: string | null }) {
  const parts = text.split('{correo}');
  return <>{parts.map((part, i) => <span key={i}>{i > 0 && <strong className="text-ink">{email}</strong>}{part}</span>)}</>;
}

function Outcome({ link, c, portal }: { link: NotifyEmailLink; c: Copy; portal: CmsLink }) {
  const heading = useRef<HTMLHeadingElement>(null);
  // Move focus to the outcome so screen readers announce it after the click.
  useEffect(() => { heading.current?.focus(); }, []);
  const whose = link.account?.is_student ? fill(c('whoseStudent'), { nombre: link.account.name }) : c('whoseAccount');

  if (link.state === 'confirmed') {
    return (
      <div className="text-center" role="status">
        <Badge tone="success"><CheckCircle2 size={28} /></Badge>
        <h1 ref={heading} tabIndex={-1} className="mt-5 font-head text-fluid-xl font-extrabold text-ink outline-none">{c('doneTitle')}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          <WithEmail text={fill(c('doneText'), { quien: whose })} email={link.email} />
        </p>
        <p className="mt-4 text-sm text-subtle">{c('doneClose')}</p>
      </div>
    );
  }
  const copy = {
    expired: { tone: 'warning' as const, icon: <Clock size={28} />, title: c('expiredTitle') },
    superseded: { tone: 'brand' as const, icon: <Info size={28} />, title: c('supersededTitle') },
    invalid: { tone: 'danger' as const, icon: <CircleAlert size={28} />, title: c('invalidTitle') },
    ready: { tone: 'brand' as const, icon: <MailCheck size={28} />, title: '' },
  }[link.state];
  return (
    <div className="text-center" role="status">
      <Badge tone={copy.tone}>{copy.icon}</Badge>
      <h1 ref={heading} tabIndex={-1} className="mt-5 font-head text-fluid-xl font-extrabold text-ink outline-none">{copy.title}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        {link.detail || c('invalidText')}
      </p>
      <CmsAnchor link={portal} className="btn-outline mt-6 inline-flex min-h-[44px] items-center justify-center px-5 text-sm" />
    </div>
  );
}

function Ready({ link, c, art, pending, failed, onConfirm }: { link: NotifyEmailLink; c: Copy; art: unknown; pending: boolean; failed: boolean; onConfirm: () => void }) {
  const whose = link.account?.is_student ? fill(c('whoseStudent'), { nombre: link.account.name }) : c('whoseAccount');
  // «none» shows the old badge; content saved before the field existed shows the envelope.
  const illustration = art === 'none' ? undefined : isIllustration(art) ? art : 'mensaje';
  return (
    <>
      <div className="text-center">
        {illustration
          ? <Illustration name={illustration} size={128} priority className="mx-auto -mt-2" />
          : <Badge tone="brand"><MailCheck size={28} /></Badge>}
        <h1 className="mt-5 font-head text-fluid-xl font-extrabold text-ink">{c('readyTitle')}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          <WithEmail text={fill(c('readyText'), { quien: whose })} email={link.email} />
        </p>
      </div>
      <Facts link={link} c={c} />
      {link.separate_account && (
        <p className="mt-4 flex gap-2.5 rounded-md border border-purple/20 bg-purple/[0.05] px-4 py-3 text-[13px] leading-relaxed text-ink">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-purple" aria-hidden="true" />
          <span>{c('separateAccount')}</span>
        </p>
      )}
      {failed && (
        <p className="mt-4 text-center text-sm text-coral-dark" role="alert">{c('confirmError')}</p>
      )}
      <button
        type="button"
        onClick={onConfirm}
        disabled={pending}
        aria-busy={pending}
        className="btn-primary mt-6 min-h-[48px] w-full disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? c('confirming') : c('confirmLabel')}
      </button>
      <p className="mt-4 text-center text-[13px] leading-relaxed text-subtle">
        {c('readyFootnote')}
      </p>
    </>
  );
}

/** What the editor preview shows (no token is read or spent there). */
const SAMPLE: NotifyEmailLink = {
  state: 'ready', email: 'familia@ejemplo.com', separate_account: false,
  expires_at: '2026-12-01T18:00:00Z',
  account: { name: 'Nombre del alumno', detail: 'Primaria · Grupo A', is_student: true },
} as NotifyEmailLink;

interface Props { portalLink?: CmsLink; [copy: string]: unknown }

function ConfirmEmailView(p: Props) {
  const t = useTokens();
  const c: Copy = (key) => t(p[key]);
  const preview = useCmsPreview();
  const portal = asLink(p.portalLink);
  const portalLink = { ...portal, label: t(portal.label) };
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const query = useQuery({
    queryKey: ['notify-email-link', token],
    queryFn: () => notifyEmailLinkApi.preview(token).then((r) => r.data),
    enabled: !!token && !preview,
    retry: 1,
  });
  const confirm = useMutation({
    mutationFn: () => notifyEmailLinkApi.confirm(token).then((r) => r.data),
  });

  if (preview) return <Shell c={c}><Ready link={SAMPLE} c={c} art={p.illustration} pending={false} failed={false} onConfirm={() => {}} /></Shell>;
  if (!token) return <Shell c={c}><Outcome link={{ state: 'invalid' }} c={c} portal={portalLink} /></Shell>;
  if (query.isLoading) {
    return (
      <Shell c={c}>
        <div className="flex flex-col items-center gap-3 py-8 text-sm text-muted" role="status">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-purple/25 border-t-purple" aria-hidden="true" />
          {c('checking')}
        </div>
      </Shell>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Shell c={c}>
        <div className="text-center" role="alert">
          <Badge tone="danger"><CircleAlert size={28} /></Badge>
          <h1 className="mt-5 font-head text-fluid-xl font-extrabold text-ink">{c('loadErrorTitle')}</h1>
          <p className="mt-2 text-[15px] text-muted">{c('loadErrorText')}</p>
          <button type="button" onClick={() => query.refetch()} className="btn-outline mt-6 min-h-[44px]">
            <RotateCw size={16} aria-hidden="true" /> {c('retryLabel')}
          </button>
        </div>
      </Shell>
    );
  }

  const done = confirm.data ?? linkOf(confirm.error);
  if (done) return <Shell c={c}><Outcome link={done} c={c} portal={portalLink} /></Shell>;
  const link = query.data;
  if (link.state !== 'ready') return <Shell c={c}><Outcome link={link} c={c} portal={portalLink} /></Shell>;

  return (
    <Shell c={c}>
      <Ready link={link} c={c} art={p.illustration} pending={confirm.isPending} failed={confirm.isError && !linkOf(confirm.error)} onConfirm={() => confirm.mutate()} />
    </Shell>
  );
}

export const sections = [
  section({
    type: 'confirm', label: 'Confirmar correo · Página del enlace', locked: true,
    description: 'La página que abre el correo «Confirme su correo para avisos». Aquí se editan todos sus textos; la confirmación no cambia. La vista previa muestra un ejemplo antes de confirmar.',
    component: ConfirmEmailView,
    fields: [
      ...grouped('Antes de confirmar', [
        f.text('readyTitle', 'Título'),
        f.textarea('readyText', 'Texto'),
        f.illustration('illustration', 'Ilustración', { hint: 'Arriba del título. Sin elegir, el sobre con avión de papel.' }),
        f.text('whoseAccount', '{quien} para la cuenta de un tutor'),
        f.text('whoseStudent', '{quien} para un alumno'),
        f.text('factStudent', 'Dato: alumno'), f.text('factAccount', 'Dato: cuenta'), f.text('factEmail', 'Dato: correo'),
        f.text('factReceives', 'Dato: qué recibirá'), f.text('factReceivesValue', 'Qué recibirá'), f.text('factExpires', 'Dato: vencimiento'),
        f.textarea('separateAccount', 'Aviso de cuentas separadas'),
        f.text('confirmLabel', 'Botón para confirmar'), f.text('confirming', 'Botón mientras confirma'),
        f.text('confirmError', 'Si no se pudo confirmar'),
        f.textarea('readyFootnote', 'Nota al pie'),
      ]),
      ...grouped('Después de confirmar', [
        f.text('doneTitle', 'Título'),
        f.textarea('doneText', 'Texto'),
        f.text('doneClose', 'Nota final'),
      ]),
      ...grouped('Enlaces vencidos o no válidos', [
        f.text('expiredTitle', 'Enlace vencido: título'), f.text('supersededTitle', 'Enlace reemplazado: título'),
        f.text('invalidTitle', 'Enlace no válido: título'),
        f.text('invalidText', 'Texto si el servidor no da el motivo'),
        f.link('portalLink', 'Botón al portal'),
      ]),
      ...grouped('Carga y ayuda', [
        f.text('checking', 'Mientras revisa el enlace'),
        f.text('loadErrorTitle', 'Error al revisar: título'), f.text('loadErrorText', 'Error al revisar: texto'), f.text('retryLabel', 'Botón para reintentar'),
        f.text('helpText', 'Ayuda al pie'), f.text('helpEmail', 'Correo de ayuda'),
      ]),
    ],
    defaults: {
      readyTitle: 'Confirme su correo para avisos', illustration: 'mensaje',
      readyText: 'Los avisos {quien} llegarán también a {correo}.',
      whoseAccount: 'de su cuenta', whoseStudent: 'de {nombre}',
      factStudent: 'Alumno', factAccount: 'Cuenta', factEmail: 'Correo', factReceives: 'Recibirá',
      factReceivesValue: 'Compras y recargas de cafetería, saldo bajo y comunicados del colegio', factExpires: 'El enlace vence',
      separateAccount: 'Este correo también tiene su propia cuenta en el portal. Son cuentas separadas: confirmar aquí no las une.',
      confirmLabel: 'Confirmar correo', confirming: 'Confirmando…', confirmError: 'No se pudo confirmar. Inténtelo de nuevo.',
      readyFootnote: 'No necesita iniciar sesión. Esto solo agrega una copia de los avisos: no crea una cuenta ni da acceso al portal. ¿No lo pidió? Cierre esta página; sin su confirmación no recibirá ningún aviso.',
      doneTitle: 'Listo, correo confirmado',
      doneText: 'Desde ahora, los avisos {quien} llegarán también a {correo}.',
      doneClose: 'Ya puede cerrar esta página.',
      expiredTitle: 'El enlace venció', supersededTitle: 'Este enlace ya no se usa', invalidTitle: 'El enlace no es válido',
      invalidText: 'Ábralo completo desde el correo que recibió.',
      portalLink: { label: 'Ir al Portal de Familias', href: '/portal/perfil?tab=avisos' },
      checking: 'Revisando el enlace…',
      loadErrorTitle: 'No pudimos revisar el enlace', loadErrorText: 'Revise su conexión e inténtelo de nuevo.', retryLabel: 'Reintentar',
      helpText: '¿Dudas? Escríbanos a', helpEmail: '{{correo}}',
    },
  }),
];

export const templates = [{
  slug: 'confirmar-correo', path: '/confirmar-correo', title: 'Confirmar correo', group: 'correo',
  // Outside PublicLayout (no RouteSeo): the template carries its own head; ROUTE_META has the same for the server.
  seo: { title: 'Confirmar correo para avisos', description: 'Confirme el correo en el que recibirá los avisos del Colegio Interlaken.', noindex: true },
  sections: ['correo.confirm'],
  // Sign-in and one-time links never wait for the CMS (TemplatePage).
  paintAtOnce: true,
}];

export default defineModule(sections, templates);
