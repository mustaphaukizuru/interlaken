/**
 * Pre-registro (/pre-registro): designed sections (docs/CMS-COMPLETION-PLAN.md).
 * The form (eligibility hint, autosaved draft, submit) is a locked section
 * that owns its own state. After a successful submit the page shows only the
 * confirmation, as before: the form publishes a page-local "sent" flag and
 * the hero and the trust strip step aside while it is set.
 */
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { createElement, useEffect, useState, useSyncExternalStore } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, CalendarDays, CheckCircle, Clock } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { PrivacyNote } from '@/components/ui/PrivacyNote';
import { FunnelHero } from '@/components/admissions/FunnelHero';
import { admissionsApi } from '@/services/api';
import { trackEvent, FunnelEvent } from '@/services/analytics';
import type { PreRegistrationData } from '@/types';
import { eligibilityGap } from '@/lib/eligibility';
import { useDraft } from '@/hooks/useDraft';
import { iconResolver } from '../iconRuntime';
import { useCmsImage, useTokens, type CmsLink } from '../runtime';
import { asLink, CmsAnchor, defineModule, f, fill, grouped, sectionsOf } from './kit';

/** The icons this module's defaults use; any other curated icon loads on demand. */
const cmsIcon = iconResolver({ CalendarDays, Clock });

const section = sectionsOf('preregistro');

/* ── "Sent" flag shared by the sections of this page ────────────────────── */
let sent = false;
const listeners = new Set<() => void>();
function setSent(v: boolean) {
  if (sent === v) return;
  sent = v;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const useSent = () => useSyncExternalStore(subscribe, () => sent, () => false);

/* ── Portada ────────────────────────────────────────────────────────────── */
interface HeroProps { label?: string; title?: string; subtitle?: string; image?: number | string }
function PreRegisterHeroView(p: HeroProps) {
  const t = useTokens();
  const img = useCmsImage(p.image);
  const hidden = useSent();
  if (hidden) return null;
  return (
    <FunnelHero
      step="pre-registro"
      label={t(p.label)}
      title={t(p.title)}
      subtitle={p.subtitle ? t(p.subtitle) : undefined}
      imageSrc={img.src || undefined}
    />
  );
}

/* ── Franja de confianza ────────────────────────────────────────────────── */
// Trust strip — reinforces cycle + time commitment under FunnelHero
interface TrustProps { first?: string; firstIcon?: string; second?: string; secondIcon?: string }
function PreRegisterTrustView(p: TrustProps) {
  const t = useTokens();
  const hidden = useSent();
  if (hidden) return null;
  return (
    <section className="border-b border-line bg-cream-2">
      <div className="mx-auto flex max-w-2xl flex-col gap-2.5 px-4 py-4 text-sm text-ink sm:flex-row sm:items-center sm:justify-between sm:px-6">
        {p.first && (
          <span className="inline-flex items-center gap-2 font-medium">
            {createElement(cmsIcon(p.firstIcon), { className: 'h-4 w-4 text-green-dark', 'aria-hidden': true })}
            {t(p.first)}
          </span>
        )}
        {p.second && (
          <span className="inline-flex items-center gap-2 text-muted">
            {createElement(cmsIcon(p.secondIcon), { className: 'h-4 w-4 text-pink', 'aria-hidden': true })}
            {t(p.second)}
          </span>
        )}
      </div>
    </section>
  );
}

/* ── Formulario (bloqueado) ─────────────────────────────────────────────── */
// Rules stay in code; each message is the prop that names it (errChildName...),
// so the school words them in Contenido without touching the validation.
const schema = z.object({
  child_name:       z.string().min(2, 'errChildName'),
  child_dob:        z.string().min(1, 'errDob'),
  grade_applying:   z.string().min(1, 'errGrade'),
  parent_name:      z.string().min(2, 'errParentName'),
  email:            z.string().email('errEmail'),
  phone:            z.string().min(10, 'errPhone'),
  how_did_you_hear: z.string().optional(),
  message:          z.string().optional(),
  wants_visit:      z.boolean().optional(),
});

type FormData = z.infer<typeof schema>;

const GRADES = [
  'Maternal',
  'Preescolar 1°', 'Preescolar 2°', 'Preescolar 3°',
  'Primaria 1°', 'Primaria 2°', 'Primaria 3°', 'Primaria 4°', 'Primaria 5°', 'Primaria 6°',
  'Secundaria 1°', 'Secundaria 2°', 'Secundaria 3°',
];

// Full-width, ≥16px inputs prevent iOS zoom on focus; brand focus-visible ring.
const selectClass =
  'input-field text-base min-h-[44px] focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-1';

/** «¿Cómo se enteró?» answers: the value is stored with the pre-registro, the label is copy. */
const HEAR_OPTIONS = [
  { value: 'referido', prop: 'hearReferido' },
  { value: 'redes', prop: 'hearRedes' },
  { value: 'google', prop: 'hearGoogle' },
  { value: 'espectacular', prop: 'hearEspectacular' },
  { value: 'otro', prop: 'hearOtro' },
] as const;

interface FormProps {
  submitLabel?: string; error?: string;
  successTitle?: string; successText?: string; visitText?: string; visitLink?: CmsLink;
  primary?: CmsLink; secondary?: CmsLink;
  [copy: string]: unknown;
}
function PreRegisterFormView(p: FormProps) {
  const t = useTokens();
  const c = (key: string) => t(p[key]);
  /** The edited message of a validation error (its key is the prop name). */
  const err = (e?: { message?: string }) => (e?.message ? c(e.message) || e.message : undefined);
  const draft = useDraft<FormData>('pre-registro');
  const success = useSent();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: draft.load() ?? undefined,
  });

  // The flag lives as long as this form: leaving the page resets it.
  useEffect(() => { setSent(false); return () => setSent(false); }, []);

  // Autosave (BACKLOG P1-I2): restore on return, clear on success.
  useEffect(() => {
    const sub = watch((values) => draft.save(values as Partial<FormData>));
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watch]);

  const onSubmit = async (data: FormData) => {
    setSubmitError(null);
    try {
      await admissionsApi.preRegister(data as PreRegistrationData);
      trackEvent(FunnelEvent.SubmitPreRegister, { grade: data.grade_applying });
      draft.clear();
      setSent(true);
    } catch {
      const msg = t(p.error) || 'No pudimos enviar el pre-registro. Verifique los datos e intente nuevamente.';
      setSubmitError(msg);
      toast.error(msg);
    }
  };

  const dobValue = watch('child_dob');
  const gradeValue = watch('grade_applying');
  const wantsVisit = watch('wants_visit');
  const gap = eligibilityGap(dobValue ?? '', gradeValue ?? '');
  const ageHint = gap ? fill(c('ageHint'), gap) : null;

  if (success) {
    const visitLink = asLink(p.visitLink);
    const primary = asLink(p.primary);
    const secondary = asLink(p.secondary);
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4 py-12">
        <div className="text-center max-w-md" role="status">
          <div className="w-16 h-16 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-8 h-8 text-brand-600" aria-hidden="true" />
          </div>
          <h2 className="text-fluid-2xl font-bold text-ink mb-3">{t(p.successTitle) || '¡Pre-registro enviado!'}</h2>
          {p.successText && (
            <p className="text-muted mb-6">
              {t(p.successText)}
            </p>
          )}
          {wantsVisit && (p.visitText || visitLink.href) && (
            <div className="mb-6 rounded-xl border border-green/30 bg-green/5 p-4 text-sm text-ink">
              {t(p.visitText)}{' '}
              <CmsAnchor link={visitLink} className="font-semibold text-green-dark underline">{t(visitLink.label)}</CmsAnchor>{visitLink.href ? '.' : ''}
            </div>
          )}
          {(primary.href || secondary.href) && (
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <CmsAnchor
                link={primary}
                className="btn-primary focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-2"
              >
                {t(primary.label)}
              </CmsAnchor>
              <CmsAnchor
                link={secondary}
                className="btn-outline focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-2"
              >
                {t(secondary.label)}
              </CmsAnchor>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <form onSubmit={handleSubmit(onSubmit)} className="card space-y-6" noValidate>
        {submitError && (
          <div
            className="flex items-start gap-3 rounded-xl2 border border-coral/30 bg-coral-50 px-4 py-3 text-sm text-coral-dark"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>{submitError}</p>
          </div>
        )}
        <div>
          <h2 className="font-semibold text-fluid-lg text-ink mb-1">{c('studentTitle')}</h2>
          <p className="text-xs text-subtle">{c('studentSubtitle')}</p>
        </div>

        <Input
          label={c('childNameLabel')}
          placeholder={c('childNamePlaceholder')}
          error={err(errors.child_name)}
          className="text-base min-h-[44px]"
          {...register('child_name')}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label={c('dobLabel')}
            type="date"
            max={new Date().toISOString().slice(0, 10)}
            error={err(errors.child_dob)}
            className="text-base min-h-[44px]"
            {...register('child_dob')}
          />
          <div>
            <label htmlFor="grade_applying" className="label">{c('gradeLabel')}</label>
            <select id="grade_applying" className={selectClass} {...register('grade_applying')}>
              <option value="">{c('selectPlaceholder')}</option>
              {GRADES.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            {errors.grade_applying && (
              <p className="mt-1.5 text-xs text-red-600">{err(errors.grade_applying)}</p>
            )}
            {!errors.grade_applying && ageHint && (
              <p className="mt-1.5 text-xs text-coral-600" role="status">{ageHint}</p>
            )}
          </div>
        </div>

        <hr className="border-line" />

        <div>
          <h2 className="font-semibold text-fluid-lg text-ink mb-1">{c('parentTitle')}</h2>
          <p className="text-xs text-subtle">{c('parentSubtitle')}</p>
        </div>

        <Input
          label={c('parentNameLabel')}
          placeholder={c('parentNamePlaceholder')}
          error={err(errors.parent_name)}
          className="text-base min-h-[44px]"
          {...register('parent_name')}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label={c('emailLabel')}
            type="email" inputMode="email" autoComplete="email"
            placeholder={c('emailPlaceholder')}
            error={err(errors.email)}
            className="text-base min-h-[44px]"
            {...register('email')}
          />
          <Input
            label={c('phoneLabel')}
            type="tel" inputMode="tel" autoComplete="tel"
            placeholder={c('phonePlaceholder')}
            error={err(errors.phone)}
            className="text-base min-h-[44px]"
            {...register('phone')}
          />
        </div>

        <div>
          <label htmlFor="how_did_you_hear" className="label">{c('hearLabel')}</label>
          <select id="how_did_you_hear" className={selectClass} {...register('how_did_you_hear')}>
            <option value="">{c('selectPlaceholder')}</option>
            {HEAR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{c(o.prop)}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="message" className="label">{c('messageLabel')}</label>
          <textarea
            id="message"
            className="input-field text-base min-h-[96px] resize-none focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-1"
            placeholder={c('messagePlaceholder')}
            {...register('message')}
          />
        </div>

        <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border border-line p-3 text-sm text-ink">
          <input type="checkbox" className="mt-0.5 h-5 w-5" {...register('wants_visit')} />
          <span>
            <span className="block font-semibold">{c('visitCheck')}</span>
            <span className="block text-xs text-muted">{c('visitCheckHint')}</span>
          </span>
        </label>

        <PrivacyNote />

        <Button type="submit" variant="cta" loading={isSubmitting} size="lg" className="w-full justify-center">
          {t(p.submitLabel) || 'Enviar pre-registro'}
        </Button>
      </form>
    </div>
  );
}

export const sections = [
  section({
    type: 'hero', label: 'Pre-registro · Portada', description: 'Portada oscura con foto, título, subtítulo y los pasos del proceso de admisión.',
    component: PreRegisterHeroView,
    fields: [f.text('label', 'Etiqueta superior', { hint: 'Puede usar {{ciclo}}.' }), f.text('title', 'Título', { required: true }), f.textarea('subtitle', 'Subtítulo'), f.image('image', 'Foto de fondo')],
    defaults: {
      label: 'Ciclo Escolar {{ciclo}} · Admisiones', title: 'Pre-Registro',
      subtitle: 'Menos de 5 minutos. Recibirá confirmación inmediata y un asesor le contactará en 2 días hábiles.',
      image: '/assets/hopscotch.webp',
    },
  }),
  section({
    type: 'trust', label: 'Pre-registro · Franja de confianza', description: 'Franja clara bajo la portada con dos datos breves (tiempo y ciclo escolar).',
    component: PreRegisterTrustView,
    fields: [f.text('first', 'Dato 1'), f.icon('firstIcon', 'Ícono del dato 1'), f.text('second', 'Dato 2', { hint: 'Puede usar {{ciclo}}.' }), f.icon('secondIcon', 'Ícono del dato 2')],
    defaults: { first: 'Menos de 5 minutos', firstIcon: 'Clock', second: 'Ciclo Escolar {{ciclo}}', secondIcon: 'CalendarDays' },
  }),
  section({
    type: 'form', label: 'Pre-registro · Formulario', locked: true,
    description: 'Formulario de pre-registro que llega a Admisiones. Aquí se editan todos sus textos (etiquetas, ejemplos, avisos, botón y confirmación); los campos, los grados y las reglas no cambian.',
    component: PreRegisterFormView,
    fields: [
      ...grouped('Datos del alumno', [
        f.text('studentTitle', 'Título'), f.text('studentSubtitle', 'Subtítulo'),
        f.text('childNameLabel', 'Nombre: etiqueta'), f.text('childNamePlaceholder', 'Nombre: ejemplo dentro del campo'),
        f.text('dobLabel', 'Fecha de nacimiento: etiqueta'), f.text('gradeLabel', 'Grado: etiqueta'),
        f.text('selectPlaceholder', 'Texto de las listas sin elegir'),
        f.textarea('ageHint', 'Aviso de edad'),
      ]),
      ...grouped('Datos del tutor', [
        f.text('parentTitle', 'Título'), f.text('parentSubtitle', 'Subtítulo'),
        f.text('parentNameLabel', 'Nombre: etiqueta'), f.text('parentNamePlaceholder', 'Nombre: ejemplo dentro del campo'),
        f.text('emailLabel', 'Correo: etiqueta'), f.text('emailPlaceholder', 'Correo: ejemplo dentro del campo'),
        f.text('phoneLabel', 'Teléfono: etiqueta'), f.text('phonePlaceholder', 'Teléfono: ejemplo dentro del campo'),
      ]),
      ...grouped('Más información', [
        f.text('hearLabel', '«¿Cómo se enteró?»: etiqueta'),
        f.text('hearReferido', 'Respuesta: recomendación'), f.text('hearRedes', 'Respuesta: redes sociales'),
        f.text('hearGoogle', 'Respuesta: Google'), f.text('hearEspectacular', 'Respuesta: anuncio'), f.text('hearOtro', 'Respuesta: otro'),
        f.text('messageLabel', 'Mensaje: etiqueta'), f.text('messagePlaceholder', 'Mensaje: ejemplo dentro del campo'),
        f.text('visitCheck', 'Casilla de visita'), f.text('visitCheckHint', 'Casilla de visita: aclaración'),
      ]),
      ...grouped('Mensajes de validación', [
        f.text('errChildName', 'Falta el nombre del alumno'), f.text('errDob', 'Falta la fecha de nacimiento'),
        f.text('errGrade', 'Falta el grado'), f.text('errParentName', 'Falta el nombre del tutor'),
        f.text('errEmail', 'Correo no válido'), f.text('errPhone', 'Teléfono no válido'),
      ]),
      ...grouped('Envío', [
        f.text('submitLabel', 'Texto del botón de envío'),
        f.textarea('error', 'Mensaje si falla el envío'),
      ]),
      ...grouped('Confirmación', [
        f.text('successTitle', 'Título'),
        f.textarea('successText', 'Texto'),
        f.text('visitText', 'Aviso de visita'),
        f.link('visitLink', 'Enlace para agendar la visita'),
        f.link('primary', 'Botón principal'),
        f.link('secondary', 'Botón secundario'),
      ]),
    ],
    defaults: {
      submitLabel: 'Enviar pre-registro',
      error: 'No pudimos enviar el pre-registro. Verifique los datos e intente nuevamente.',
      successTitle: '¡Pre-registro enviado!',
      successText: 'Hemos recibido su solicitud. En los próximos 2 días hábiles, un asesor se pondrá en contacto con usted para coordinar los siguientes pasos.',
      visitText: 'Nos indicó que desea conocer el colegio.',
      visitLink: { label: 'Elija fecha y hora de su visita', href: '/agendar-visita' },
      primary: { label: 'Ver proceso de admisión', href: '/admisiones' },
      secondary: { label: 'Contactar al colegio', href: '/contacto' },
      studentTitle: 'Datos del alumno', studentSubtitle: 'Información del candidato a inscripción',
      childNameLabel: 'Nombre completo del alumno', childNamePlaceholder: 'Ej. Ana María González Pérez',
      dobLabel: 'Fecha de nacimiento', gradeLabel: 'Grado al que aplica', selectPlaceholder: 'Seleccionar…',
      ageHint: 'Para {grado} el alumno debe tener {edad} años al 31 de diciembre de {anio} (tendrá {tiene}). Elija el grado que corresponde a su edad o contacte a admisiones.',
      parentTitle: 'Datos del tutor', parentSubtitle: 'Información de contacto del padre/madre/tutor',
      parentNameLabel: 'Nombre completo del tutor', parentNamePlaceholder: 'Ej. Roberto González Sánchez',
      emailLabel: 'Correo electrónico', emailPlaceholder: 'correo@ejemplo.com',
      phoneLabel: 'Teléfono / WhatsApp', phonePlaceholder: '55 1234 5678',
      hearLabel: '¿Cómo se enteró de nosotros?',
      hearReferido: 'Recomendación de familia/amigo', hearRedes: 'Redes sociales', hearGoogle: 'Búsqueda en Google',
      hearEspectacular: 'Espectacular / Anuncio', hearOtro: 'Otro',
      messageLabel: 'Mensaje adicional (opcional)', messagePlaceholder: 'Dudas, necesidades especiales, o información que desee compartir…',
      visitCheck: 'Deseo agendar una visita para conocer el colegio', visitCheckHint: 'Al enviar, le daremos el enlace para elegir fecha y hora.',
      errChildName: 'Nombre requerido', errDob: 'Fecha de nacimiento requerida', errGrade: 'Seleccione un nivel',
      errParentName: 'Nombre del tutor requerido', errEmail: 'Correo electrónico inválido', errPhone: 'Teléfono inválido',
    },
  }),
];

export const templates = [{
  slug: 'pre-registro', path: '/pre-registro', title: 'Pre-registro', group: 'preregistro',
  seo: {},
  sections: ['preregistro.hero', 'preregistro.trust', 'preregistro.form'],
}];

export default defineModule(sections, templates);
