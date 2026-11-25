/**
 * Contacto (/contacto): designed sections (docs/CMS-COMPLETION-PLAN.md).
 * Phone, office hours, address, WhatsApp and the Maps link come from Ajustes
 * (useSiteSettings); the copy around them is editable here. The message form
 * is a locked section: it owns its own form state and validation.
 *
 * Media round (owner 2026-11-22): the form opens on an illustrated header,
 * each level of the directory has its colour and its illustration, and the
 * map sits beside its address with a drawn frame while it loads.
 */
import { useEffect, useRef, useState } from 'react';
import { Phone, Mail, MapPin, Clock, Navigation, ArrowRight, ArrowUpRight, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { contactApi } from '@/services/api';
import { Section } from '@/components/ui/Section';
import { Reveal } from '@/components/ui/Reveal';
import { Blob } from '@/components/ui/Blob';
import { PrivacyNote } from '@/components/ui/PrivacyNote';
import { FieldError } from '@/components/public/FormMessages';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { waHref } from '@/lib/siteContact';
import { WhatsAppIcon } from '@/components/icons/WhatsAppIcon';
import { Illustration, wash } from '@/components/ui/Illustration';
import { isIllustration, type IllustrationName } from '@/lib/illustrations';
import { useCmsImage, useTokens } from '../runtime';
import { asList, defineModule, f, grouped, headingFields, Lines, sectionsOf } from './kit';

const section = sectionsOf('contacto');

/** The illustration chosen in the editor; «none» hides it; nothing chosen (saved before the field existed) uses the fallback. */
const artOr = (chosen: unknown, fallback?: IllustrationName): IllustrationName | undefined =>
  chosen === 'none' ? undefined : isIllustration(chosen) ? chosen : fallback;

/* ── Portada ────────────────────────────────────────────────────────────── */
interface HeroProps { label?: string; title?: string; text?: string; image?: number | string }
function ContactHeroView(p: HeroProps) {
  const t = useTokens();
  const img = useCmsImage(p.image, '', { full: true });
  return (
    <section className="relative overflow-hidden bg-dark text-white">
      {img.src && <img src={img.src} srcSet={img.srcSet} sizes="100vw" alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" loading="eager" />}
      <div className="absolute inset-0 bg-gradient-to-r from-dark/90 via-dark/70 to-dark/45" />
      <Blob tone="pink" opacity={0.4} size={460} shape={1} className="hidden sm:block" style={{ top: -150, left: -110 }} />
      <Blob tone="purple" opacity={0.4} size={420} shape={0} className="hidden sm:block" style={{ bottom: -150, right: -110 }} />
      <div className="relative mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
        {p.label && <span className="section-label-pink inline-flex">{t(p.label)}</span>}
        <h1 className="mt-3 font-head text-fluid-4xl font-black leading-[1.08] tracking-tight">
          <Lines text={t(p.title)} />
        </h1>
        {p.text && (
          <p className="mt-4 max-w-[520px] text-base leading-relaxed text-white/60 sm:text-[17px]">
            {t(p.text)}
          </p>
        )}
      </div>
    </section>
  );
}

/* ── Información y formulario (bloqueado) ───────────────────────────────── */
// Rules stay in code; each message is the prop that words it (errName...).
// An empty e-mail asks for it (errEmailEmpty); only a typed one can be wrong (errEmail).
const schema = z.object({
  name:    z.string().min(2, 'errName'),
  email:   z.string().trim().min(1, 'errEmailEmpty').pipe(z.email('errEmail')),
  subject: z.string().min(2, 'errSubject'),
  message: z.string().min(10, 'errMessage'),
});

type FormData = z.infer<typeof schema>;

interface MainProps {
  infoTitle?: string; phoneLabel?: string; hoursLabel?: string;
  image?: number | string; imageAlt?: string; directionsLabel?: string;
  whatsappLabel?: string; whatsappMessage?: string;
  formTitle?: string; submitLabel?: string; success?: string; error?: string;
  formIllustration?: string;
  [copy: string]: unknown;
}
function ContactMainView(p: MainProps) {
  const t = useTokens();
  const c = (key: string) => t(p[key]);
  const err = (e?: { message?: string }) => (e?.message ? c(e.message) || e.message : '');
  const settings = useSiteSettings();
  const facade = useCmsImage(p.image, t(p.imageAlt));
  const formArt = artOr(p.formIllustration, 'mensaje');
  // Contact facts are admin-editable (Contenido del sitio → Ajustes del sitio);
  // entries without a value simply don't render.
  // La dirección se muestra en la tarjeta con foto de la fachada (abajo),
  // por eso no se repite aquí.
  const INFO = [
    { icon: Phone,  label: t(p.phoneLabel), value: settings.phone_display, href: `tel:${settings.phone_e164}` },
    { icon: Clock,  label: t(p.hoursLabel), value: settings.office_hours },
  ].filter((item) => item.value);

  // react-hook-form focuses the first invalid field on submit (shouldFocusError).
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });
  // The outcome shows on the page, where the form was (not only in a passing toast).
  const [result, setResult] = useState<'idle' | 'sent' | 'failed'>('idle');
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (result !== 'idle') resultRef.current?.focus(); }, [result]);

  const onSubmit = async (data: FormData) => {
    setResult('idle');
    try {
      await contactApi.send(data);
      setResult('sent');
      reset();
    } catch {
      setResult('failed');
    }
  };
  /** Error and its id for aria-describedby (only while there is one). */
  const fieldError = (key: keyof FormData) => {
    const text = err(errors[key]);
    return text ? { id: `contact-${key}-error`, text } : null;
  };
  const described = (key: keyof FormData) => fieldError(key)?.id;

  return (
    <Section bg="white">
      <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-2">
        {/* Contact info + map */}
        <Reveal direction="right">
          {p.infoTitle && <h2 className="font-head text-fluid-2xl font-extrabold tracking-tight text-ink">{t(p.infoTitle)}</h2>}
          {/* Teléfono y horario: dos mosaicos lado a lado. */}
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {INFO.map(({ icon: Icon, label, value, href }, i) => {
              const inner = (
                <>
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-sm bg-white text-purple shadow-card">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="block min-w-0 sm:mt-3">
                    <span className="mb-0.5 block text-[13px] text-subtle">{label}</span>
                    <span className="block text-base font-semibold leading-snug text-ink">{value}</span>
                  </span>
                </>
              );
              const tile = 'flex h-full items-center gap-3.5 rounded-md bg-purple/[0.05] p-4 sm:block sm:p-5';
              return href ? (
                <a
                  key={i}
                  href={href}
                  {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  className={`${tile} transition-colors hover:bg-purple/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-2`}
                >
                  {inner}
                </a>
              ) : (
                <div key={i} className={tile}>{inner}</div>
              );
            })}
          </div>

          {/* Foto de la fachada + dirección y CTA "Cómo llegar".
              El mapa interactivo preciso vive en su propia sección más abajo. */}
          {settings.address && (
            <div className="group mt-6 overflow-hidden rounded-md bg-white shadow-card transition-shadow hover:shadow-purple">
              <div className="relative aspect-[16/10] w-full overflow-hidden bg-cream-2">
                {facade.src && (
                  <img
                    src={facade.src}
                    srcSet={facade.srcSet}
                    sizes="(min-width: 1024px) 536px, 100vw"
                    alt={facade.alt}
                    width={960}
                    height={600}
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  />
                )}
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-dark/25 to-transparent" />
              </div>
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-sm bg-purple/10 text-purple">
                    <MapPin className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <p className="text-base font-medium leading-snug text-ink">{settings.address}</p>
                </div>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(settings.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${t(p.directionsLabel)} a ${settings.address} en Google Maps`}
                  className="group/btn inline-flex min-h-[44px] flex-shrink-0 items-center justify-center gap-2 rounded-sm bg-gradient-to-r from-purple to-purple-mid px-5 text-sm font-semibold text-white shadow-purple transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                >
                  <Navigation className="h-4 w-4" aria-hidden="true" />
                  {t(p.directionsLabel)}
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/btn:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
                </a>
              </div>
            </div>
          )}

          {settings.whatsapp_number && p.whatsappLabel && (
          <div className="mt-[22px]">
            <a
              href={waHref(settings.whatsapp_number, t(p.whatsappMessage))}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Escribir por WhatsApp al Colegio Interlaken"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-sm bg-green-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-green-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 focus-visible:ring-offset-2"
            >
              <WhatsAppIcon className="h-4 w-4" aria-hidden="true" />
              {t(p.whatsappLabel)}
            </a>
          </div>
          )}
        </Reveal>

        {/* Contact form */}
        <Reveal direction="left">
          <div className="overflow-hidden rounded-md bg-white shadow-card">
            {(p.formTitle || formArt) && (
              <div
                className="relative flex min-h-[112px] items-center justify-between gap-4 overflow-hidden px-6 py-5 sm:px-7"
                style={{ background: `radial-gradient(120% 140% at 85% 30%, ${wash('var(--purple)', 16)} 0%, ${wash('var(--purple)', 5)} 70%)` }}
              >
                <span aria-hidden="true" className="absolute -right-8 -top-14 h-44 w-44 rounded-full bg-white/45" />
                {p.formTitle && <h2 className="relative font-head text-fluid-xl font-extrabold tracking-tight text-ink">{t(p.formTitle)}</h2>}
                {formArt && <Illustration name={formArt} size={112} className="relative -my-2 shrink-0" />}
              </div>
            )}
            <div className="p-6 sm:p-7">
            {result === 'sent' ? (
              <div ref={resultRef} tabIndex={-1} role="status" className="rounded-md bg-success-bg p-6 text-center focus:outline-none">
                <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-success" aria-hidden="true" />
                <p className="font-semibold text-ink">{t(p.success) || 'Mensaje enviado. Le responderemos pronto.'}</p>
                <button type="button" onClick={() => setResult('idle')} className="mt-3 inline-flex min-h-[44px] items-center rounded-sm px-3 text-sm font-semibold text-purple underline underline-offset-4 hover:text-purple-mid focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40">
                  Escribir otro mensaje
                </button>
              </div>
            ) : (
            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
              <div>
                <label className="label" htmlFor="contact-name">{c('nameLabel')}</label>
                <input id="contact-name" className="input-field text-base" autoComplete="name" placeholder={c('namePlaceholder')} aria-required="true" aria-invalid={!!errors.name} aria-describedby={described('name')} {...register('name')} />
                <FieldError error={fieldError('name')} />
              </div>
              <div>
                <label className="label" htmlFor="contact-email">{c('emailLabel')}</label>
                <input id="contact-email" className="input-field text-base" type="email" inputMode="email" autoComplete="email" placeholder={c('emailPlaceholder')} aria-required="true" aria-invalid={!!errors.email} aria-describedby={described('email')} {...register('email')} />
                <FieldError error={fieldError('email')} />
              </div>
              <div>
                <label className="label" htmlFor="contact-subject">{c('subjectLabel')}</label>
                <input id="contact-subject" className="input-field text-base" autoComplete="off" placeholder={c('subjectPlaceholder')} aria-required="true" aria-invalid={!!errors.subject} aria-describedby={described('subject')} {...register('subject')} />
                <FieldError error={fieldError('subject')} />
              </div>
              <div>
                <label className="label" htmlFor="contact-message">{c('messageLabel')}</label>
                <textarea
                  id="contact-message"
                  className="input-field min-h-[120px] resize-none text-base"
                  placeholder={c('messagePlaceholder')}
                  aria-required="true"
                  aria-invalid={!!errors.message}
                  aria-describedby={described('message')}
                  {...register('message')}
                />
                <FieldError error={fieldError('message')} />
              </div>
              <PrivacyNote />
              {result === 'failed' ? (
                <div ref={resultRef} tabIndex={-1} role="alert" className="flex items-start gap-2 rounded-sm bg-danger-bg px-3 py-2.5 text-sm font-semibold text-danger focus:outline-none">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{t(p.error) || 'No se pudo enviar el mensaje. Intente nuevamente.'}</span>
                </div>
              ) : null}
              <button type="submit" disabled={isSubmitting} className="btn-primary w-full justify-center disabled:opacity-60">
                {isSubmitting ? c('sending') || 'Enviando…' : t(p.submitLabel) || 'Enviar mensaje'}
              </button>
            </form>
            )}
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

/* ── Directorio por nivel ───────────────────────────────────────────────── */
interface DirectoryItem { level?: string; ext?: string; email?: string; illustration?: string }

const foldName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
/** Each level's colour (index.css --nivel-*) and its illustration, by the level's name. */
const LEVEL_TINT: Record<string, string> = { preescolar: 'var(--nivel-preescolar)', primaria: 'var(--nivel-primaria)', secundaria: 'var(--nivel-secundaria)' };
const LEVEL_ART: Record<string, IllustrationName> = { maternal: 'crear', preescolar: 'crear', primaria: 'mochila', secundaria: 'ciencia' };

function ContactDirectoryView(p: { eyebrow?: string; title?: string; items?: DirectoryItem[]; extLabel?: string }) {
  const t = useTokens();
  const settings = useSiteSettings();
  const row = 'flex min-h-[44px] items-center gap-3 rounded-sm text-ink/85 transition-colors hover:text-green-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green/40';
  const chip = 'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-sm bg-cream-2 text-green-dark';
  return (
    <Section bg="cream">
      <div>
        {p.eyebrow && <span className="section-label-green inline-flex">{t(p.eyebrow)}</span>}
        {p.title && (
          <h2 className="mt-2 font-head text-fluid-xl font-bold text-ink">
            {t(p.title)}
          </h2>
        )}
        <div className="mt-6 grid gap-5 sm:grid-cols-3">
          {asList<DirectoryItem>(p.items).map((d, i) => {
            const level = t(d.level);
            const email = t(d.email);
            const key = foldName(level);
            const tint = LEVEL_TINT[key] ?? 'var(--purple)';
            const art = artOr(d.illustration, LEVEL_ART[key] ?? 'academico');
            return (
              <Reveal key={i} delay={i * 70} className="h-full">
                <div className="flex h-full flex-col overflow-hidden rounded-md bg-white shadow-card">
                  {/* Cabecera con el color del nivel y su ilustración */}
                  <div
                    className="relative flex min-h-[124px] items-end justify-between gap-3 overflow-hidden px-5 pb-4 pt-5"
                    style={{ background: `radial-gradient(130% 120% at 85% 20%, ${wash(tint, 34)} 0%, ${wash(tint, 14)} 75%)` }}
                  >
                    <span aria-hidden="true" className="absolute -right-10 -top-12 h-36 w-36 rounded-full" style={{ background: wash(tint, 45), opacity: 0.4 }} />
                    <div className="relative">
                      <span aria-hidden="true" className="mb-2.5 block h-1 w-8 rounded-full" style={{ background: tint }} />
                      <h3 className="font-head text-xl font-bold text-ink">{level}</h3>
                    </div>
                    {art && <Illustration name={art} size={96} className="relative -mb-2 shrink-0" />}
                  </div>
                  <ul className="flex-1 space-y-1.5 px-5 py-4 text-base">
                    <li>
                      <a
                        href={`tel:${settings.phone_e164}`}
                        aria-label={d.ext ? `Teléfono de ${level}, extensión ${d.ext}` : `Teléfono de ${level}`}
                        className={row}
                      >
                        <span className={chip}><Phone size={16} aria-hidden="true" /></span>
                        <span>{settings.phone_display}{d.ext ? ` · ${t(p.extLabel)} ${d.ext}` : ''}</span>
                      </a>
                    </li>
                    {email && (
                      <li>
                        <a
                          href={`mailto:${email}`}
                          aria-label={`Correo de ${level}`}
                          className={row}
                        >
                          <span className={chip}><Mail size={16} aria-hidden="true" /></span>
                          <span className="min-w-0 break-all">{email}</span>
                        </a>
                      </li>
                    )}
                  </ul>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

/* ── Mapa ───────────────────────────────────────────────────────────────── */
interface MapProps { title?: string; mapsLabel?: string; embed?: string; mapTitle?: string; illustration?: string }

/** A drawn street grid under the map: what shows while Google's map loads (or if it is blocked). */
const MAP_GRID = [
  `linear-gradient(115deg, transparent 47%, ${wash('var(--green)', 30)} 47%, ${wash('var(--green)', 30)} 53%, transparent 53%)`,
  `repeating-linear-gradient(0deg, ${wash('var(--green)', 20)} 0 2px, transparent 2px 56px)`,
  `repeating-linear-gradient(90deg, ${wash('var(--green)', 20)} 0 2px, transparent 2px 56px)`,
].join(', ');

function ContactMapView(p: MapProps) {
  const t = useTokens();
  const settings = useSiteSettings();
  const embed = (p.embed || '').trim();
  const art = artOr(p.illustration, 'ubicacion');
  const info = (
    <div className={embed ? 'lg:col-span-4' : ''}>
      <div className="flex items-start justify-between gap-4 lg:flex-col lg:justify-start lg:gap-0">
        <div className="lg:order-2">
          {p.title && <h2 className="font-head text-fluid-xl font-bold text-ink">{t(p.title)}</h2>}
          {settings.address && (
            <p className="mt-2 flex items-start gap-2 text-base leading-relaxed text-muted">
              <MapPin size={18} className="mt-1 shrink-0 text-green-dark" aria-hidden="true" />
              <span>{settings.address}</span>
            </p>
          )}
        </div>
        {art && <Illustration name={art} size={150} fluid className="w-[88px] shrink-0 lg:order-1 lg:mb-5 lg:w-[150px]" />}
      </div>
      {settings.maps_url && p.mapsLabel && (
        <a
          href={settings.maps_url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-outline mt-5 min-h-[44px]"
        >
          {t(p.mapsLabel)} <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      )}
    </div>
  );
  return (
    <section className="bg-white py-14 sm:py-16">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className={embed ? 'grid items-center gap-8 lg:grid-cols-12 lg:gap-12' : ''}>
          {info}
          {embed && (
            <div className="relative overflow-hidden rounded-md shadow-card lg:col-span-8" style={{ background: wash('var(--green)', 8) }}>
              <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center" style={{ backgroundImage: MAP_GRID }}>
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-coral shadow-raised">
                  <MapPin size={26} />
                </span>
              </div>
              <iframe
                src={embed}
                title={t(p.mapTitle)}
                className="relative block h-[320px] w-full sm:h-[420px]"
                style={{ border: 0 }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const MAP_EMBED = 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3759.6587772437156!2d-99.20946797478247!3d19.556257781749714!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x85d21d6c27c972e1%3A0x3c76d65bc761079b!2sCollege%20Interlaken%20%2F%20ADCE%20Education!5e0!3m2!1sen!2smx!4v1783605176683!5m2!1sen!2smx';

export const sections = [
  section({
    type: 'hero', label: 'Contacto · Portada', description: 'Portada oscura con foto de la fachada, etiqueta, título y texto.',
    component: ContactHeroView,
    fields: [f.text('label', 'Etiqueta superior'), f.textarea('title', 'Título', { required: true, hint: 'Un salto de línea aquí es un salto de línea en el título.' }), f.textarea('text', 'Texto'), f.image('image', 'Foto de fondo')],
    defaults: {
      label: 'Estamos para ayudarle', title: 'Contacto',
      text: 'Resolvemos sus dudas sobre admisiones, costos y nuestro modelo educativo. Escríbanos y le contactaremos pronto.',
      image: '/assets/facade-sign.webp',
    },
  }),
  section({
    type: 'main', label: 'Contacto · Información y formulario', locked: true,
    description: 'Datos de contacto, foto de la fachada y formulario de mensajes; el teléfono, el horario, la dirección y el WhatsApp se editan en Ajustes.',
    component: ContactMainView,
    fields: [
      ...grouped('Datos de contacto', [
        f.text('infoTitle', 'Título de la información'),
        f.text('phoneLabel', 'Etiqueta del teléfono'),
        f.text('hoursLabel', 'Etiqueta del horario'),
      ]),
      ...grouped('Foto y botones', [
        f.image('image', 'Foto de la fachada'),
        f.text('imageAlt', 'Descripción de la foto (accesibilidad)'),
        f.text('directionsLabel', 'Botón «Cómo llegar»'),
        f.text('whatsappLabel', 'Botón de WhatsApp'),
        f.text('whatsappMessage', 'Mensaje inicial de WhatsApp'),
      ]),
      ...grouped('Formulario', [
        f.text('formTitle', 'Título del formulario'),
        f.illustration('formIllustration', 'Ilustración del formulario', { hint: 'Junto al título del formulario. Sin elegir, el sobre con avión de papel.' }),
        f.text('nameLabel', 'Nombre: etiqueta'), f.text('namePlaceholder', 'Nombre: ejemplo dentro del campo'),
        f.text('emailLabel', 'Correo: etiqueta'), f.text('emailPlaceholder', 'Correo: ejemplo dentro del campo'),
        f.text('subjectLabel', 'Asunto: etiqueta'), f.text('subjectPlaceholder', 'Asunto: ejemplo dentro del campo'),
        f.text('messageLabel', 'Mensaje: etiqueta'), f.text('messagePlaceholder', 'Mensaje: ejemplo dentro del campo'),
        f.text('submitLabel', 'Texto del botón de envío'),
        f.text('sending', 'Botón mientras envía'),
      ]),
      ...grouped('Mensajes', [
        f.text('success', 'Mensaje al enviar'),
        f.text('error', 'Mensaje si falla el envío'),
        f.text('errName', 'Falta el nombre'), f.text('errEmailEmpty', 'Falta el correo'), f.text('errEmail', 'Correo no válido'),
        f.text('errSubject', 'Falta el asunto'), f.text('errMessage', 'Mensaje demasiado corto'),
      ]),
    ],
    defaults: {
      infoTitle: 'Información de contacto', phoneLabel: 'Teléfono o WhatsApp', hoursLabel: 'Horario de oficina',
      image: '/assets/facade.webp', imageAlt: 'Fachada del Colegio Interlaken en Tlalnepantla', directionsLabel: 'Cómo llegar',
      whatsappLabel: 'Escribir por WhatsApp', whatsappMessage: 'Hola, me gustaría obtener más información',
      formTitle: 'Envíenos un mensaje', formIllustration: 'mensaje', submitLabel: 'Enviar mensaje',
      success: 'Mensaje enviado. Le responderemos pronto.', error: 'No se pudo enviar el mensaje. Intente nuevamente.',
      nameLabel: 'Nombre', namePlaceholder: 'Su nombre completo',
      emailLabel: 'Correo electrónico', emailPlaceholder: 'correo@ejemplo.com',
      subjectLabel: 'Asunto', subjectPlaceholder: '¿En qué le podemos ayudar?',
      messageLabel: 'Mensaje', messagePlaceholder: 'Describa su consulta…', sending: 'Enviando…',
      errName: 'Nombre requerido', errEmailEmpty: 'Escriba su correo.', errEmail: 'Revise el correo: debe ser como nombre@ejemplo.com.',
      errSubject: 'Asunto requerido', errMessage: 'El mensaje es demasiado corto',
    },
  }),
  section({
    type: 'directory', label: 'Contacto · Directorio por nivel', description: 'Tarjetas por nivel con extensión y correo; el conmutador se edita en Ajustes.',
    component: ContactDirectoryView,
    fields: [
      ...headingFields(),
      f.items('items', 'Niveles', [
        f.text('level', 'Nivel', { required: true }), f.text('ext', 'Extensión'), f.text('email', 'Correo'),
        f.illustration('illustration', 'Ilustración', { hint: 'Arriba de la tarjeta, sobre el color del nivel. Sin elegir, la del nivel.' }),
      ]),
      f.text('extLabel', 'Palabra antes de la extensión'),
    ],
    defaults: {
      extLabel: 'Ext',
      // Directorio oficial por nivel (conmutador 5379-1188).
      eyebrow: 'Directorio', title: 'Atención por nivel educativo',
      items: [
        { level: 'Preescolar', ext: '1', email: 'preescolar@interlaken.com.mx', illustration: 'crear' },
        { level: 'Primaria',   ext: '2', email: 'primaria@interlaken.com.mx', illustration: 'mochila' },
        { level: 'Secundaria', ext: '3', email: 'secundaria@interlaken.com.mx', illustration: 'ciencia' },
      ],
    },
  }),
  section({
    type: 'map', label: 'Contacto · Mapa', description: 'Mapa de Google con la dirección; la dirección y el enlace a Google Maps se editan en Ajustes.',
    component: ContactMapView,
    fields: [
      f.text('title', 'Título'),
      f.text('mapsLabel', 'Texto del enlace a Google Maps'),
      f.url('embed', 'Dirección del mapa incrustado'),
      f.text('mapTitle', 'Descripción del mapa (accesibilidad)'),
      f.illustration('illustration', 'Ilustración', { hint: 'Junto a la dirección. Sin elegir, el pin en el mapa.' }),
    ],
    defaults: {
      title: 'Cómo llegar', mapsLabel: 'Abrir en Google Maps', embed: MAP_EMBED,
      mapTitle: 'Mapa — Colegio Interlaken, Av. de los Reyes 67, Tlalnepantla',
      illustration: 'ubicacion',
    },
  }),
];

export const templates = [{
  slug: 'contacto', path: '/contacto', title: 'Contacto', group: 'contacto',
  seo: {},
  sections: ['contacto.hero', 'contacto.main', 'contacto.directory', 'contacto.map'],
}];

export default defineModule(sections, templates);
