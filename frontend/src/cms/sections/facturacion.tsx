/**
 * Comunidad → Facturación (/comunidad/facturacion): designed sections
 * (docs/CMS-COMPLETION-PLAN.md). Bitácora 13/10/2026, ref. 8: mismos avisos y
 * campos que el formulario oficial del colegio (interlaken.com.mx/index-7.html).
 * The CFDI request form is a locked section (components/public/FacturacionForm).
 *
 * Media round (owner 2026-11-22): each card carries its 3D illustration (the
 * checklist, the folder, the receipt) on a soft wash; the notices read as a
 * list with markers and the form opens on an illustrated header.
 */
import type { ReactNode } from 'react';
import { ArrowUpRight, Info, Mail, ReceiptText } from 'lucide-react';
import { FACTURACION_FORM_DEFAULTS, FacturacionForm, type FacturacionFormCopy } from '@/components/public/FacturacionForm';
import { Section } from '@/components/ui/Section';
import { Reveal } from '@/components/ui/Reveal';
import { Illustration, wash } from '@/components/ui/Illustration';
import { isIllustration, type IllustrationName } from '@/lib/illustrations';
import { useCmsImage, useTokens, type CmsLink } from '../runtime';
import { asLink, asList, CmsAnchor, defineModule, f, grouped, Lines, sectionsOf } from './kit';

const section = sectionsOf('facturacion');

/** The illustration chosen in the editor; «none» hides it; nothing chosen (saved before the field existed) uses the fallback. */
const artOr = (chosen: unknown, fallback: IllustrationName): IllustrationName | undefined =>
  chosen === 'none' ? undefined : isIllustration(chosen) ? chosen : fallback;

const artField = (hint: string) => f.illustration('illustration', 'Ilustración', { hint });

/*
 * The three cards share one white band with 20px between them. Each card is
 * its own section, so the band is rebuilt with sibling selectors: a card
 * followed by another drops its bottom padding, a card after another keeps
 * only the 20px gap. Any card can be hidden or moved and the band still fits.
 */
const CARD_BAND = '[&:has(+[data-fx-card])]:!pb-0 [[data-fx-card]+&]:!pt-5';
function CardBand({ children }: { children: ReactNode }) {
  return (
    <Section bg="white" containerSize="md" className={CARD_BAND} data-fx-card="">
      {children}
    </Section>
  );
}

/* ── Portada ────────────────────────────────────────────────────────────── */
interface HeroProps { label?: string; title?: string; text?: string; image?: number | string }
function FacturacionHeroView(p: HeroProps) {
  const t = useTokens();
  const img = useCmsImage(p.image, '', { full: true });
  return (
    <section className="relative overflow-hidden bg-dark text-white">
      {img.src && (
        <img
          src={img.src}
          srcSet={img.srcSet}
          sizes="100vw"
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-30"
          loading="eager"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-dark/92 via-dark/75 to-dark/45" />
      <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16 lg:py-[72px]">
        {p.label && <span className="section-label-green inline-flex">{t(p.label)}</span>}
        <h1 className="mt-3 font-head text-fluid-4xl font-black tracking-[-0.03em]">
          <Lines text={t(p.title)} />
        </h1>
        {p.text && (
          <p className="mt-3 max-w-2xl text-[15.5px] leading-relaxed text-white/75 sm:text-base">
            {t(p.text)}
          </p>
        )}
      </div>
    </section>
  );
}

/* ── Antes de solicitar ─────────────────────────────────────────────────── */
function FacturacionNoticesView(p: { title?: string; items?: { text?: string }[]; illustration?: string }) {
  const t = useTokens();
  const art = artOr(p.illustration, 'examen');
  return (
    <CardBand>
      <Reveal>
        <div className="relative overflow-hidden rounded-md p-6 sm:p-8" style={{ background: wash('var(--coral)', 6) }}>
          <span aria-hidden="true" className="absolute -right-14 -top-16 h-48 w-48 rounded-full" style={{ background: wash('var(--coral)', 14), opacity: 0.6 }} />
          {/* Phones: the art beside the title. From sm: a column of its own beside the list. */}
          <div className="relative flex items-center gap-8">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-4">
                <h2 className="flex items-center gap-2.5 font-head text-lg font-bold text-ink sm:text-xl">
                  {!art && (
                    <span className="flex h-10 w-10 items-center justify-center rounded-md bg-coral/10 text-coral-700">
                      <Info size={19} aria-hidden="true" />
                    </span>
                  )}
                  {t(p.title)}
                </h2>
                {art && <Illustration name={art} size={80} className="-my-3 shrink-0 sm:hidden" />}
              </div>
              <ul className="mt-4 space-y-3 sm:mt-5">
                {asList<{ text?: string }>(p.items).map((n, i) => (
                  <li key={i} className="flex gap-3 text-base leading-relaxed text-ink/85">
                    <span aria-hidden="true" className="mt-[9px] h-2 w-2 shrink-0 rounded-full bg-coral" />
                    <span>{t(n.text)}</span>
                  </li>
                ))}
              </ul>
            </div>
            {art && <Illustration name={art} size={144} className="hidden shrink-0 sm:block" />}
          </div>
        </div>
      </Reveal>
    </CardBand>
  );
}

/* ── Solicitud (bloqueado) ──────────────────────────────────────────────── */
function FacturacionRequestView(p: { title?: string; text?: string; email?: string; illustration?: string }) {
  const t = useTokens();
  const email = t(p.email).trim() || 'facturas@interlaken.com.mx';
  const art = artOr(p.illustration, 'documentos');
  const formCopy = Object.fromEntries(Object.keys(FACTURACION_FORM_DEFAULTS).map((k) => [k, t((p as Record<string, unknown>)[k])])) as Partial<FacturacionFormCopy>;
  return (
    <CardBand>
      <Reveal delay={70}>
        <div className="overflow-hidden rounded-md bg-white shadow-card">
          <div
            className="relative flex min-h-[104px] items-center justify-between gap-4 overflow-hidden px-6 py-5 sm:px-8"
            style={{ background: `radial-gradient(120% 140% at 85% 30%, ${wash('var(--green)', 18)} 0%, ${wash('var(--green)', 6)} 70%)` }}
          >
            <span aria-hidden="true" className="absolute -right-8 -top-14 h-44 w-44 rounded-full bg-white/45" />
            <h2 className="relative flex items-center gap-2.5 font-head text-lg font-bold text-ink sm:text-xl">
              {!art && (
                <span className="flex h-10 w-10 items-center justify-center rounded-md bg-green/15 text-green-dark">
                  <Mail size={18} aria-hidden="true" />
                </span>
              )}
              {t(p.title)}
            </h2>
            {art && <Illustration name={art} size={112} fluid className="relative -my-3 w-[84px] shrink-0 sm:w-[104px]" />}
          </div>
          <div className="p-6 sm:p-8">
            {/* The «Su solicitud llega a …» line left the page (owner, 2026-11-08); it
                only shows again when the school writes a text before the address. */}
            {p.text?.trim() && (
              <p className="mb-5 text-base leading-relaxed text-muted">
                {t(p.text)}{' '}
                <a href={`mailto:${email}`} className="font-medium text-green-dark underline">{email}</a>.
              </p>
            )}
            <FacturacionForm billingEmail={email} copy={formCopy} />
          </div>
        </div>
      </Reveal>
    </CardBand>
  );
}

/* ── Descargar facturas ─────────────────────────────────────────────────── */
function FacturacionDownloadView(p: { title?: string; text?: string; link?: CmsLink; srHint?: string; illustration?: string }) {
  const t = useTokens();
  const link = asLink(p.link);
  const art = artOr(p.illustration, 'pagos');
  return (
    <CardBand>
      <Reveal delay={140}>
        <div className="flex flex-col overflow-hidden rounded-md bg-white shadow-card sm:flex-row">
          {art && (
            <div
              aria-hidden="true"
              className="relative flex items-center justify-center overflow-hidden py-6 sm:w-[34%] sm:shrink-0 sm:py-8"
              style={{ background: `radial-gradient(120% 100% at 50% 35%, ${wash('var(--purple)', 16)} 0%, ${wash('var(--purple)', 5)} 72%)` }}
            >
              <span className="absolute -bottom-12 -left-8 h-28 w-28 rounded-full" style={{ background: wash('var(--purple)', 22), opacity: 0.4 }} />
              <Illustration name={art} size={136} className="relative" />
            </div>
          )}
          <div className="flex flex-1 flex-col justify-center p-6 sm:p-8">
            <h2 className="flex items-center gap-2.5 font-head text-lg font-bold text-ink sm:text-xl">
              {!art && (
                <span className="flex h-10 w-10 items-center justify-center rounded-md bg-purple/10 text-purple">
                  <ReceiptText size={18} aria-hidden="true" />
                </span>
              )}
              {t(p.title)}
            </h2>
            {p.text && (
              <p className="mt-2 text-base leading-relaxed text-muted">
                {t(p.text)}
              </p>
            )}
            <CmsAnchor link={link} className="btn-outline mt-5 self-start">
              {t(link.label)} <ArrowUpRight size={15} aria-hidden="true" />
              {p.srHint && <span className="sr-only"> {t(p.srHint)}</span>}
            </CmsAnchor>
          </div>
        </div>
      </Reveal>
    </CardBand>
  );
}

export const sections = [
  section({
    type: 'hero', label: 'Facturación · Portada', description: 'Portada oscura con foto, etiqueta, título y texto.',
    component: FacturacionHeroView,
    fields: [f.text('label', 'Etiqueta superior'), f.textarea('title', 'Título', { required: true, hint: 'Un salto de línea aquí es un salto de línea en el título.' }), f.textarea('text', 'Texto'), f.image('image', 'Foto de fondo')],
    defaults: {
      label: 'Pagos', title: 'Facturación',
      text: 'Solicite sus facturas (CFDI) una sola vez: a partir de entonces las recibirá cada mes, después de realizar sus pagos.',
      image: '/assets/court-wide.webp',
    },
  }),
  section({
    type: 'notices', label: 'Facturación · Antes de solicitar', description: 'Recuadro con los avisos que la familia debe leer antes de pedir su factura.',
    component: FacturacionNoticesView,
    fields: [
      f.text('title', 'Título'),
      f.items('items', 'Avisos', [f.textarea('text', 'Aviso', { required: true })]),
      artField('Junto al título. Sin elegir, la lista con lápiz.'),
    ],
    defaults: {
      title: 'Antes de solicitar', illustration: 'examen',
      items: [
        { text: 'Solo se emiten facturas del mes en curso. No es posible cancelar ni cambiar facturas fuera del mes en que se realizó el pago.' },
        { text: 'Una vez que recibamos su solicitud, recibirá sus facturas todos los meses, 24 horas hábiles después de realizar sus pagos.' },
        { text: 'Capture sus datos tal como vienen en su constancia de situación fiscal: un dato erróneo hace que el SAT rechace la factura y no nos permite emitirla.' },
      ],
    },
  }),
  section({
    type: 'request', label: 'Facturación · Solicitud', locked: true,
    description: 'Formulario de datos fiscales (CFDI); las solicitudes llegan al correo indicado aquí. Se editan todos sus textos; los campos, las reglas y la lista de regímenes del SAT no cambian.',
    component: FacturacionRequestView,
    fields: [
      ...grouped('Recuadro', [
        f.text('title', 'Título'),
        f.text('text', 'Texto antes del correo', { hint: 'Vacío: la página no muestra el correo. Con texto (por ejemplo «Su solicitud llega a») se muestra seguido del correo.' }),
        f.text('email', 'Correo de facturación', { hint: 'Se usa en los mensajes del formulario y, si hay texto arriba, en la página.' }),
        artField('Junto al título del recuadro. Sin elegir, la carpeta con documentos.'),
      ]),
      ...grouped('Formulario', [
        f.text('requiredNote', 'Nota sobre los campos'),
        f.text('studentLabel', 'Alumno: etiqueta'), f.text('razonLabel', 'Razón social: etiqueta'), f.text('razonHint', 'Razón social: ayuda'),
        f.text('rfcLabel', 'RFC: etiqueta'), f.text('cpLabel', 'Código postal: etiqueta'),
        f.text('regimenLabel', 'Régimen: etiqueta'), f.text('regimenPlaceholder', 'Régimen: texto sin elegir'),
        f.text('emailLabel', 'Correo: etiqueta'), f.text('emailPlaceholder', 'Correo: ejemplo dentro del campo'),
        f.text('phoneLabel', 'Teléfono: etiqueta'), f.text('phonePlaceholder', 'Teléfono: ejemplo dentro del campo'),
        f.text('submitLabel', 'Texto del botón de envío'),
      ]),
      ...grouped('Mensajes', [
        f.text('errRequired', 'Campo vacío'), f.text('errRfc', 'RFC con longitud incorrecta'),
        f.text('errCp', 'Código postal incorrecto'), f.text('errPhone', 'Teléfono incorrecto'),
        f.text('errGeneral', 'Si no se pudo enviar'),
        f.text('doneTitle', 'Confirmación: título'),
        f.textarea('doneText', 'Confirmación: texto'),
      ]),
    ],
    defaults: { title: 'Solicitud de facturación', text: '', email: 'facturas@interlaken.com.mx', illustration: 'documentos', ...FACTURACION_FORM_DEFAULTS },
  }),
  section({
    type: 'download', label: 'Facturación · Descargar facturas', description: 'Recuadro con el enlace al portal de pagos para descargar facturas.',
    component: FacturacionDownloadView,
    fields: [
      f.text('title', 'Título'), f.textarea('text', 'Texto'), f.link('link', 'Botón'),
      f.text('srHint', 'Aviso para lectores de pantalla', { hint: 'Se lee después del botón; no se ve en pantalla.' }),
      artField('A un lado del recuadro. Sin elegir, el recibo con tarjeta.'),
    ],
    defaults: {
      title: 'Descargar sus facturas', illustration: 'pagos',
      text: 'Si desea descargar sus facturas, puede consultarlas desde nuestro portal de pagos.',
      link: { label: 'Ir al portal de pagos', href: 'https://interlaken.servoescolar.mx/' },
      srHint: '(interlaken.servoescolar.mx, se abre en otra pestaña)',
    },
  }),
];

export const templates = [{
  slug: 'facturacion', path: '/comunidad/facturacion', title: 'Facturación', group: 'facturacion',
  seo: {}, // title and description: lib/routeMeta.ts ROUTE_META
  sections: ['facturacion.hero', 'facturacion.notices', 'facturacion.request', 'facturacion.download'],
}];

export default defineModule(sections, templates);
