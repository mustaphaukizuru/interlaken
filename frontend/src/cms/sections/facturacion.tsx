/**
 * Comunidad → Facturación (/comunidad/facturacion): designed sections
 * (docs/CMS-COMPLETION-PLAN.md). Bitácora 13/10/2026, ref. 8: mismos avisos y
 * campos que el formulario oficial del colegio (interlaken.com.mx/index-7.html).
 * The CFDI request form is a locked section (components/public/FacturacionForm).
 */
import type { ReactNode } from 'react';
import { ArrowUpRight, Info, Mail, ReceiptText } from 'lucide-react';
import { FacturacionForm } from '@/components/public/FacturacionForm';
import { Section } from '@/components/ui/Section';
import { Reveal } from '@/components/ui/Reveal';
import { useCmsImage, useTokens, type CmsLink } from '../runtime';
import { asLink, asList, CmsAnchor, defineModule, f, Lines, sectionsOf } from './kit';

const section = sectionsOf('facturacion');

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
  const img = useCmsImage(p.image);
  return (
    <section className="relative overflow-hidden bg-dark text-white">
      {img.src && (
        <img
          src={img.src}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-30"
          loading="eager"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-dark/92 via-dark/75 to-dark/45" />
      <div className="relative mx-auto max-w-[1120px] px-4 py-14 sm:px-6 sm:py-16 lg:py-[72px]">
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
function FacturacionNoticesView(p: { title?: string; items?: { text?: string }[] }) {
  const t = useTokens();
  return (
    <CardBand>
      <Reveal>
        <div className="rounded-xl2 border border-ink/10 bg-cream-2 p-6 sm:p-7">
          <p className="flex items-center gap-2.5 font-head text-lg font-bold text-ink sm:text-xl">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-coral/10 text-coral-700">
              <Info size={19} aria-hidden="true" />
            </span>
            {t(p.title)}
          </p>
          <ul className="mt-4 list-inside list-disc space-y-2 text-sm leading-relaxed text-ink/85">
            {asList<{ text?: string }>(p.items).map((n, i) => (
              <li key={i}>{t(n.text)}</li>
            ))}
          </ul>
        </div>
      </Reveal>
    </CardBand>
  );
}

/* ── Solicitud (bloqueado) ──────────────────────────────────────────────── */
function FacturacionRequestView(p: { title?: string; text?: string; email?: string }) {
  const t = useTokens();
  const email = t(p.email).trim() || 'facturas@interlaken.com.mx';
  return (
    <CardBand>
      <Reveal delay={70}>
        <div className="rounded-xl2 border border-green/30 bg-green/5 p-6 sm:p-7">
          <h2 className="flex items-center gap-2.5 font-head text-lg font-bold text-ink sm:text-xl">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-green/15 text-green-dark">
              <Mail size={18} aria-hidden="true" />
            </span>
            {t(p.title)}
          </h2>
          {/* The «Su solicitud llega a …» line left the page (owner, 2026-11-08); it
              only shows again when the school writes a text before the address. */}
          {p.text?.trim() && (
            <p className="mt-3 text-sm leading-relaxed text-muted sm:text-[15px]">
              {t(p.text)}{' '}
              <a href={`mailto:${email}`} className="font-medium text-green-dark underline">{email}</a>.
            </p>
          )}
          <div className="mt-5">
            <FacturacionForm billingEmail={email} />
          </div>
        </div>
      </Reveal>
    </CardBand>
  );
}

/* ── Descargar facturas ─────────────────────────────────────────────────── */
function FacturacionDownloadView(p: { title?: string; text?: string; link?: CmsLink; srHint?: string }) {
  const t = useTokens();
  const link = asLink(p.link);
  return (
    <CardBand>
      <Reveal delay={140}>
        <div className="rounded-xl2 border border-ink/10 bg-white p-6 sm:p-7">
          <p className="flex items-center gap-2.5 font-head text-lg font-bold text-ink sm:text-xl">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple/10 text-purple">
              <ReceiptText size={18} aria-hidden="true" />
            </span>
            {t(p.title)}
          </p>
          {p.text && (
            <p className="mt-3 text-sm leading-relaxed text-muted sm:text-[15px]">
              {t(p.text)}
            </p>
          )}
          <CmsAnchor link={link} className="btn-outline mt-5">
            {t(link.label)} <ArrowUpRight size={15} aria-hidden="true" />
            {p.srHint && <span className="sr-only"> {t(p.srHint)}</span>}
          </CmsAnchor>
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
    fields: [f.text('title', 'Título'), f.items('items', 'Avisos', [f.textarea('text', 'Aviso', { required: true })])],
    defaults: {
      title: 'Antes de solicitar',
      items: [
        { text: 'Solo se emiten facturas del mes en curso. No es posible cancelar ni cambiar facturas fuera del mes en que se realizó el pago.' },
        { text: 'Una vez que recibamos su solicitud, recibirá sus facturas todos los meses, 24 horas hábiles después de realizar sus pagos.' },
        { text: 'Capture sus datos tal como vienen en su constancia de situación fiscal: un dato erróneo hace que el SAT rechace la factura y no nos permite emitirla.' },
      ],
    },
  }),
  section({
    type: 'request', label: 'Facturación · Solicitud', locked: true,
    description: 'Formulario de datos fiscales (CFDI); las solicitudes llegan al correo indicado aquí.',
    component: FacturacionRequestView,
    fields: [
      f.text('title', 'Título'),
      f.text('text', 'Texto antes del correo', { hint: 'Vacío: la página no muestra el correo. Con texto (por ejemplo «Su solicitud llega a») se muestra seguido del correo.' }),
      f.text('email', 'Correo de facturación', { hint: 'Se usa en los mensajes del formulario y, si hay texto arriba, en la página.' }),
    ],
    defaults: { title: 'Solicitud de facturación', text: '', email: 'facturas@interlaken.com.mx' },
  }),
  section({
    type: 'download', label: 'Facturación · Descargar facturas', description: 'Recuadro con el enlace al portal de pagos para descargar facturas.',
    component: FacturacionDownloadView,
    fields: [f.text('title', 'Título'), f.textarea('text', 'Texto'), f.link('link', 'Botón'), f.text('srHint', 'Aviso para lectores de pantalla', { hint: 'Se lee después del botón; no se ve en pantalla.' })],
    defaults: {
      title: 'Descargar sus facturas',
      text: 'Si desea descargar sus facturas, puede consultarlas desde nuestro portal de pagos.',
      link: { label: 'Ir al portal de pagos', href: 'https://interlaken.servoescolar.mx/' },
      srHint: '(interlaken.servoescolar.mx, se abre en otra pestaña)',
    },
  }),
];

export const templates = [{
  slug: 'facturacion', path: '/comunidad/facturacion', title: 'Facturación', group: 'facturacion',
  seo: {}, // title and description: lib/siteMeta.ts ROUTE_META
  sections: ['facturacion.hero', 'facturacion.notices', 'facturacion.request', 'facturacion.download'],
}];

export default defineModule(sections, templates);
