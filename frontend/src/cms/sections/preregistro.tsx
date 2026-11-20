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
import { eligibilityHint } from '@/lib/eligibility';
import { useDraft } from '@/hooks/useDraft';
import { iconResolver } from '../iconRuntime';
import { useCmsImage, useTokens, type CmsLink } from '../runtime';
import { asLink, CmsAnchor, defineModule, f, sectionsOf } from './kit';

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
const schema = z.object({
  child_name:       z.string().min(2, 'Nombre requerido'),
  child_dob:        z.string().min(1, 'Fecha de nacimiento requerida'),
  grade_applying:   z.string().min(1, 'Seleccione un nivel'),
  parent_name:      z.string().min(2, 'Nombre del tutor requerido'),
  email:            z.string().email('Correo electrónico inválido'),
  phone:            z.string().min(10, 'Teléfono inválido'),
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

interface FormProps {
  submitLabel?: string; error?: string;
  successTitle?: string; successText?: string; visitText?: string; visitLink?: CmsLink;
  primary?: CmsLink; secondary?: CmsLink;
}
function PreRegisterFormView(p: FormProps) {
  const t = useTokens();
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
  const ageHint = eligibilityHint(dobValue ?? '', gradeValue ?? '');

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
          <h2 className="font-semibold text-fluid-lg text-ink mb-1">Datos del alumno</h2>
          <p className="text-xs text-subtle">Información del candidato a inscripción</p>
        </div>

        <Input
          label="Nombre completo del alumno"
          placeholder="Ej. Ana María González Pérez"
          error={errors.child_name?.message}
          className="text-base min-h-[44px]"
          {...register('child_name')}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Fecha de nacimiento"
            type="date"
            max={new Date().toISOString().slice(0, 10)}
            error={errors.child_dob?.message}
            className="text-base min-h-[44px]"
            {...register('child_dob')}
          />
          <div>
            <label htmlFor="grade_applying" className="label">Grado al que aplica</label>
            <select id="grade_applying" className={selectClass} {...register('grade_applying')}>
              <option value="">Seleccionar…</option>
              {GRADES.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            {errors.grade_applying && (
              <p className="mt-1.5 text-xs text-red-600">{errors.grade_applying.message}</p>
            )}
            {!errors.grade_applying && ageHint && (
              <p className="mt-1.5 text-xs text-coral-600" role="status">{ageHint} Elija el grado que corresponde a su edad o contacte a admisiones.</p>
            )}
          </div>
        </div>

        <hr className="border-line" />

        <div>
          <h2 className="font-semibold text-fluid-lg text-ink mb-1">Datos del tutor</h2>
          <p className="text-xs text-subtle">Información de contacto del padre/madre/tutor</p>
        </div>

        <Input
          label="Nombre completo del tutor"
          placeholder="Ej. Roberto González Sánchez"
          error={errors.parent_name?.message}
          className="text-base min-h-[44px]"
          {...register('parent_name')}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Correo electrónico"
            type="email" inputMode="email" autoComplete="email"
            placeholder="correo@ejemplo.com"
            error={errors.email?.message}
            className="text-base min-h-[44px]"
            {...register('email')}
          />
          <Input
            label="Teléfono / WhatsApp"
            type="tel" inputMode="tel" autoComplete="tel"
            placeholder="55 1234 5678"
            error={errors.phone?.message}
            className="text-base min-h-[44px]"
            {...register('phone')}
          />
        </div>

        <div>
          <label htmlFor="how_did_you_hear" className="label">¿Cómo se enteró de nosotros?</label>
          <select id="how_did_you_hear" className={selectClass} {...register('how_did_you_hear')}>
            <option value="">Seleccionar…</option>
            <option value="referido">Recomendación de familia/amigo</option>
            <option value="redes">Redes sociales</option>
            <option value="google">Búsqueda en Google</option>
            <option value="espectacular">Espectacular / Anuncio</option>
            <option value="otro">Otro</option>
          </select>
        </div>

        <div>
          <label htmlFor="message" className="label">Mensaje adicional (opcional)</label>
          <textarea
            id="message"
            className="input-field text-base min-h-[96px] resize-none focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-1"
            placeholder="Dudas, necesidades especiales, o información que desee compartir…"
            {...register('message')}
          />
        </div>

        <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border border-line p-3 text-sm text-ink">
          <input type="checkbox" className="mt-0.5 h-5 w-5" {...register('wants_visit')} />
          <span>
            <span className="block font-semibold">Deseo agendar una visita para conocer el colegio</span>
            <span className="block text-xs text-muted">Al enviar, le daremos el enlace para elegir fecha y hora.</span>
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
    description: 'Formulario de pre-registro que llega a Admisiones; aquí se editan el botón y el mensaje de confirmación.',
    component: PreRegisterFormView,
    fields: [
      f.text('submitLabel', 'Texto del botón de envío'),
      f.textarea('error', 'Mensaje si falla el envío'),
      f.text('successTitle', 'Confirmación: título'),
      f.textarea('successText', 'Confirmación: texto'),
      f.text('visitText', 'Confirmación: aviso de visita', { hint: 'Se muestra si la familia pidió agendar una visita.' }),
      f.link('visitLink', 'Confirmación: enlace para agendar la visita'),
      f.link('primary', 'Confirmación: botón principal'),
      f.link('secondary', 'Confirmación: botón secundario'),
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
    },
  }),
];

export const templates = [{
  slug: 'pre-registro', path: '/pre-registro', title: 'Pre-registro', group: 'preregistro',
  seo: {},
  sections: ['preregistro.hero', 'preregistro.trust', 'preregistro.form'],
}];

export default defineModule(sections, templates);
