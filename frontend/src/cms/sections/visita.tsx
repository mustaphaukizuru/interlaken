/**
 * Agendar visita (/agendar-visita): designed sections (docs/CMS-COMPLETION-PLAN.md).
 * The booking widget (calendar, time slots, form, confirmation) is a locked
 * section that owns its own state; its titles and messages are editable.
 * The open slots are edited in Visitas (availability).
 *
 * Media round (owner 2026-11-22): the steps are small illustrated cards, the
 * empty form side and the WhatsApp box carry an illustration, and a row of
 * the school's photos closes the page. The booking logic is untouched.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, CalendarCheck, CalendarDays, Clock, MapPin, CheckCircle, MessageCircle, Phone } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { bookingsApi } from '@/services/api';
import { trackEvent, FunnelEvent } from '@/services/analytics';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { waHref } from '@/lib/siteContact';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { PrivacyNote } from '@/components/ui/PrivacyNote';
import { MonthCalendar } from '@/components/ui/MonthCalendar';
import { Illustration, wash } from '@/components/ui/Illustration';
import { FunnelHero } from '@/components/admissions/FunnelHero';
import { isIllustration, type IllustrationName } from '@/lib/illustrations';
import { phoneProblem } from '@/lib/validators';
import { apiErrorCode, apiFieldErrors } from '@/lib/apiErrors';
import type { AvailabilitySlot } from '@/types';
import { imageSrc, imageSrcSet, useCmsImage, useMediaAlt, useTokens, type CmsLink } from '../runtime';
import { asLink, asList, CmsAnchor, defineModule, f, grouped, sectionsOf } from './kit';

const section = sectionsOf('visita');

/** «jueves 26 de noviembre» → «Jueves 26 de noviembre» (Spanish keeps the rest lowercase). */
const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The one chosen in the editor; «none» hides it; nothing chosen (saved before the field existed) keeps the built-in one. */
const artOf = (chosen: unknown, fallback?: IllustrationName): IllustrationName | undefined =>
  chosen === 'none' ? undefined : isIllustration(chosen) ? chosen : fallback;
const ART_HINT = 'Sin elegir, se muestra la de siempre. «Sin ilustración» la oculta.';

/* ── Portada ────────────────────────────────────────────────────────────── */
interface HeroProps { label?: string; title?: string; subtitle?: string; image?: number | string }
function VisitHeroView(p: HeroProps) {
  const t = useTokens();
  const img = useCmsImage(p.image, '', { full: true });
  return (
    <FunnelHero
      step="agendar-visita"
      label={t(p.label)}
      title={t(p.title)}
      subtitle={p.subtitle ? t(p.subtitle) : undefined}
      imageSrc={img.src || undefined}
      imageSrcSet={img.srcSet}
    />
  );
}

/* ── Cómo funciona ──────────────────────────────────────────────────────── */
// Cómo funciona: fecha → confirmación → examen de valoración (the ficha comes after admission)
interface VisitStep { text?: string; illustration?: string }
/** Each step's illustration when none is chosen, by its place: calendar, confirmation e-mail, exam. */
const VISIT_STEP_ART: IllustrationName[] = ['agenda', 'mensaje', 'examen'];
const VISIT_STEP_TINT = ['var(--green)', 'var(--purple)', 'var(--pink)'];

/** Three small illustrated cards: short, so the calendar stays near the top. */
function VisitStepsView(p: { items?: VisitStep[]; link?: CmsLink }) {
  const t = useTokens();
  const link = asLink(p.link);
  return (
    <section className="border-b border-line bg-cream-2">
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
        <ol className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          {asList<VisitStep>(p.items).map((s, i) => {
            const art = artOf(s.illustration, VISIT_STEP_ART[i]);
            return (
              <li key={i} className="flex items-center gap-4 rounded-md bg-white p-3 pr-4 shadow-card">
                <span className="relative flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-sm" style={{ background: wash(VISIT_STEP_TINT[i % VISIT_STEP_TINT.length], 12) }}>
                  {art && <Illustration name={art} size={64} fluid className="w-[54px]" />}
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full bg-green-strong text-xs font-bold text-white ${art ? 'absolute -left-1.5 -top-1.5' : ''}`}>{i + 1}</span>
                </span>
                <span className="text-base leading-snug text-ink">{t(s.text)}</span>
              </li>
            );
          })}
        </ol>
        {link.href && (
          <div className="mt-3">
            <CmsAnchor link={{ ...link, label: t(link.label) }} className="inline-flex min-h-[44px] items-center text-[15px] font-semibold text-green-dark hover:underline" />
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Reserva (bloqueado) ────────────────────────────────────────────────── */
interface VisitPhoto { image?: number | string; caption?: string }
/** The school's photos under the booking (each caption is the photo's alt text). */
const VISIT_PHOTOS: VisitPhoto[] = [
  { image: '/assets/facade-sign.webp', caption: 'Fachada del Colegio Interlaken con su letrero' },
  { image: '/assets/court-primaria.webp', caption: 'Patio de Primaria con cancha techada y murales de colores' },
  { image: '/assets/classroom.webp', caption: 'Pasillo de los salones de clase' },
];

// Rules stay in code; each message is the prop that words it (errName...).
// An empty e-mail or phone asks for it (errEmailEmpty, errPhoneEmpty); only a
// typed one can be wrong. Phones follow the site's rule (lib/validators): digits
// plus +, spaces, dashes and parentheses, 10 to 15 digits; the server checks it too.
const schema = z.object({
  parent_name:  z.string().min(3, 'errName'),
  parent_email: z.string().trim().min(1, 'errEmailEmpty').pipe(z.email('errEmail')),
  parent_phone: z.string().trim().min(1, 'errPhoneEmpty').refine((v) => !phoneProblem(v), 'errPhone'),
  child_name:   z.string().optional(),
  child_grade:  z.string().optional(),
});

type FormData = z.infer<typeof schema>;

// ≥16px inputs prevent iOS zoom on focus; brand focus-visible ring.
const inputClass = 'text-base min-h-[44px]';

interface BookingProps {
  pickTitle?: string; formTitle?: string; pickHint?: string; submitLabel?: string;
  confirmedTitle?: string; confirmedText?: string; againLabel?: string;
  emptyTitle?: string; emptyText?: string; errorTitle?: string; errorText?: string;
  whatsappTitle?: string; whatsappText?: string; whatsappLabel?: string; whatsappMessage?: string;
  contactLabel?: string;
  hintIllustration?: string; whatsappIllustration?: string;
  photosTitle?: string; photos?: VisitPhoto[];
  [copy: string]: unknown;
}
function VisitBookingView(p: BookingProps) {
  const t = useTokens();
  const c = (key: string) => t(p[key]);
  const err = (e?: { message?: string }) => (e?.message ? c(e.message) || e.message : undefined);
  const weekdays = c('weekdays').split(',').map((d) => d.trim()).filter(Boolean);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);
  const [confirmed, setConfirmed] = useState<AvailabilitySlot | null>(null);
  const { whatsapp_number, phone_display, phone_e164 } = useSiteSettings();
  // `?lead=` is the signed visit link the office sends from the Expediente:
  // the booking attaches itself to that case. It stays in the address (a
  // reload keeps it) and is never shown; a bad or old one is ignored by the API.
  const [searchParams] = useSearchParams();
  const leadToken = searchParams.get('lead')?.trim() ?? '';
  const whatsappText = t(p.whatsappMessage);
  const whatsappLabel = t(p.whatsappLabel) || 'Reservar por WhatsApp';
  const hintArt = artOf(p.hintIllustration, 'visita');
  const waArt = artOf(p.whatsappIllustration, 'informes');
  const altOf = useMediaAlt();
  // Saved before the field existed: the built-in photos; an emptied list hides the row.
  const photos = (p.photos === undefined ? VISIT_PHOTOS : asList<VisitPhoto>(p.photos)).filter((ph) => ph.image);

  const queryClient = useQueryClient();
  const { data: slots, isLoading, isError, refetch } = useQuery<AvailabilitySlot[]>({
    queryKey: ['availability', 'individual'],
    queryFn: async () => {
      const { data } = await bookingsApi.getAvailability({ type: 'individual' });
      return data.results ?? data;
    },
  });

  // Group open slots by date for the calendar → time picker.
  const byDate = useMemo(() => {
    const map = new Map<string, AvailabilitySlot[]>();
    (slots ?? []).forEach((s) => {
      const list = map.get(s.date) ?? [];
      list.push(s);
      map.set(s.date, list);
    });
    return map;
  }, [slots]);

  // Available days (with slot counts) for the month calendar.
  const calendarDays = useMemo(
    () => [...byDate.entries()]
      .map(([date, list]) => ({ date, count: list.length }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    [byDate],
  );

  const daySlots = selectedDate
    ? [...(byDate.get(selectedDate) ?? [])].sort((a, b) => a.start_time.localeCompare(b.start_time))
    : [];

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  // The outcome shows on the page: the confirmation replaces the form, a
  // failure sits above the button (react-hook-form focuses the first invalid field).
  const [bookingError, setBookingError] = useState<string | null>(null);
  // The family already has a visit still to come (owner 2026-11-26: one family
  // booked three times). The server names that visit; the page offers the
  // school's WhatsApp and phone to change it instead of a red error.
  const [alreadyBooked, setAlreadyBooked] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (confirmed || bookingError || alreadyBooked) resultRef.current?.focus(); }, [confirmed, bookingError, alreadyBooked]);

  const onSubmit = async (values: FormData) => {
    if (!selectedSlot) return;
    setBookingError(null);
    setAlreadyBooked(null);
    try {
      await bookingsApi.createBooking({
        slot: selectedSlot.id,
        parent_name: values.parent_name,
        parent_email: values.parent_email,
        parent_phone: values.parent_phone,
        child_name: values.child_name,
        child_grade: values.child_grade,
        num_attendees: 1,
        ...(leadToken ? { lead_token: leadToken } : {}),
      });
      trackEvent(FunnelEvent.BookingConversion, { grade: values.child_grade });
      setConfirmed(selectedSlot);
      setSelectedSlot(null);
      setSelectedDate(null);
      reset();
      // The slot just booked may be full now: «Agendar otra visita» must not
      // offer it again from the old list (QA 2026-11-24).
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
    } catch (err: unknown) {
      // The server's reason (a full slot, or a field it refused) before the generic message.
      const fields = apiFieldErrors(err);
      if (apiErrorCode(err) === 'already_booked' && fields.detail) {
        setAlreadyBooked(fields.detail);
        return;
      }
      setBookingError(
        fields.detail ?? fields.parent_phone ?? fields.parent_email ?? fields.parent_name ??
          (c('bookingError') || 'No fue posible completar la reserva. Intente de nuevo.'),
      );
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {confirmed ? (
        <div ref={resultRef} tabIndex={-1} className="text-center py-12 sm:py-16 focus:outline-none" role="status">
          <div className="w-16 h-16 bg-success-bg rounded-sm flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-success" aria-hidden="true" />
          </div>
          <h2 className="text-fluid-2xl font-bold text-ink mb-2">{t(p.confirmedTitle) || '¡Visita confirmada!'}</h2>
          <p className="text-muted mb-1">
            {upperFirst(format(parseISO(confirmed.date), "EEEE d 'de' MMMM, yyyy", { locale: es }))} ·{' '}
            {confirmed.start_time.slice(0, 5)} h
          </p>
          {p.confirmedText && (
            <p className="text-muted">
              {t(p.confirmedText)}
            </p>
          )}
          <Button
            variant="secondary"
            className="mt-6 min-h-[44px]"
            onClick={() => setConfirmed(null)}
          >
            {t(p.againLabel) || 'Agendar otra visita'}
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Slot picker — month calendar + time chips */}
            <div>
              {p.pickTitle && <h2 className="font-semibold text-fluid-lg text-ink mb-4">{t(p.pickTitle)}</h2>}
              {isLoading ? (
                <div className="space-y-3" aria-busy="true" aria-label="Cargando horarios">
                  <div className="skeleton h-10 w-48 rounded-sm" />
                  <div className="skeleton h-[280px] rounded-md" />
                  <div className="flex gap-2">
                    <div className="skeleton h-11 w-20 rounded-md" />
                    <div className="skeleton h-11 w-20 rounded-md" />
                    <div className="skeleton h-11 w-20 rounded-md" />
                  </div>
                </div>
              ) : isError ? (
                // On a white card like the calendar and the form side, so both columns match.
                <div className="rounded-md bg-white px-4 shadow-card">
                  <ErrorState
                    title={t(p.errorTitle) || 'No fue posible cargar los horarios'}
                    description={t(p.errorText) || undefined}
                    onRetry={() => refetch()}
                  />
                </div>
              ) : !calendarDays.length ? (
                <div className="rounded-md bg-white px-4 shadow-card">
                  <EmptyState
                    icon={CalendarDays}
                    title={t(p.emptyTitle) || 'Sin horarios disponibles'}
                    description={t(p.emptyText)}
                    action={
                      whatsapp_number ? (
                        <a
                          href={waHref(whatsapp_number, whatsappText)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-green inline-flex min-h-[44px] items-center"
                        >
                          <MessageCircle className="h-4 w-4" aria-hidden="true" /> {whatsappLabel}
                        </a>
                      ) : (
                        <Link to="/contacto" className="btn-outline inline-flex min-h-[44px] items-center">
                          {t(p.contactLabel) || 'Contactar al colegio'}
                        </Link>
                      )
                    }
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  <MonthCalendar
                    days={calendarDays}
                    selectedDate={selectedDate}
                    countLabel="horarios"
                    weekdays={weekdays.length === 7 ? weekdays : undefined}
                    onSelect={(date) => { setSelectedDate(date); setSelectedSlot(null); }}
                  />

                  {selectedDate && (
                    <div className="rounded-md bg-white p-4 shadow-card">
                      {/* Only the first letter («Jueves 26 de noviembre»): CSS
                          `capitalize` also raised «De» and the month (QA 2026-11-24). */}
                      <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
                        <CalendarDays className="h-4 w-4 text-purple" aria-hidden="true" />
                        {upperFirst(format(parseISO(selectedDate), "EEEE d 'de' MMMM", { locale: es }))}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {daySlots.map((slot) => (
                          <button
                            key={slot.id}
                            type="button"
                            onClick={() => setSelectedSlot(slot)}
                            className={`flex min-h-[44px] items-center gap-1.5 rounded-sm border px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-1 ${
                              selectedSlot?.id === slot.id
                                ? 'border-purple bg-purple text-white shadow-purple'
                                : 'border-line text-ink hover:border-brand-400 hover:bg-brand-50'
                            }`}
                          >
                            <Clock className="h-4 w-4" aria-hidden="true" />
                            {slot.start_time.slice(0, 5)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Contact form */}
            <div>
              {p.formTitle && <h2 className="font-semibold text-fluid-lg text-ink mb-4">{t(p.formTitle)}</h2>}
              {!selectedSlot ? (
                <div className="flex flex-col items-center gap-4 rounded-md bg-white px-6 py-10 text-center text-base text-muted shadow-card">
                  {hintArt && <Illustration name={hintArt} size={150} fluid className="w-[120px] sm:w-[150px]" />}
                  <p>{t(p.pickHint)}</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4" noValidate>
                  <div className="bg-brand-50 rounded-md p-3 text-sm text-brand-700">
                    <div className="flex items-center gap-2">
                      <CalendarDays className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                      <strong>
                        {format(parseISO(selectedSlot.date), "d 'de' MMMM, yyyy", { locale: es })}
                      </strong>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Clock className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                      {selectedSlot.start_time.slice(0, 5)} - {selectedSlot.end_time.slice(0, 5)} h
                    </div>
                    {selectedSlot.location && (
                      <div className="flex items-center gap-2 mt-1">
                        <MapPin className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                        {selectedSlot.location}
                      </div>
                    )}
                  </div>

                  {/* Own data autofills; the child's fields don't (they are another person). */}
                  <Input id="visit-name" label={c('nameLabel')} autoComplete="name" aria-required="true" error={err(errors.parent_name)} className={inputClass} {...register('parent_name')} />
                  <Input id="visit-email" label={c('emailLabel')} type="email" inputMode="email" autoComplete="email" aria-required="true" error={err(errors.parent_email)} className={inputClass} {...register('parent_email')} />
                  <Input id="visit-phone" label={c('phoneLabel')} type="tel" inputMode="tel" autoComplete="tel" aria-required="true" error={err(errors.parent_phone)} className={inputClass} {...register('parent_phone')} />
                  <Input id="visit-child" label={c('childLabel')} autoComplete="off" className={inputClass} {...register('child_name')} />
                  <Input id="visit-grade" label={c('gradeLabel')} autoComplete="off" className={inputClass} {...register('child_grade')} />

                  <PrivacyNote />
                  {alreadyBooked ? (
                    <div ref={resultRef} tabIndex={-1} role="alert" className="space-y-3 rounded-sm bg-purple-light px-4 py-3 text-sm text-ink focus:outline-none">
                      <p className="flex items-start gap-2 font-semibold">
                        <CalendarCheck className="mt-0.5 h-4 w-4 shrink-0 text-purple" aria-hidden="true" />
                        <span>{alreadyBooked}</span>
                      </p>
                      {/* Stacked and full width: the form column is narrow, and side by
                          side the phone button ran past the panel (QA 2026-11-28). */}
                      {(whatsapp_number || phone_e164) && (
                        <div className="flex flex-col gap-2">
                          {whatsapp_number && (
                            <a
                              href={waHref(whatsapp_number, 'Hola, tengo una visita agendada al Colegio Interlaken y me gustaría cambiarla.')}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn-secondary min-h-[44px] w-full justify-center text-sm"
                            >
                              <MessageCircle className="h-4 w-4" aria-hidden="true" /> Escribir por WhatsApp
                            </a>
                          )}
                          {phone_e164 && (
                            <a href={`tel:${phone_e164}`} className="btn-outline min-h-[44px] w-full justify-center text-sm">
                              <Phone className="h-4 w-4" aria-hidden="true" /> Llamar {phone_display}
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  ) : null}
                  {bookingError ? (
                    <div ref={resultRef} tabIndex={-1} role="alert" className="flex items-start gap-2 rounded-sm bg-danger-bg px-3 py-2.5 text-sm font-semibold text-danger focus:outline-none">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{bookingError}</span>
                    </div>
                  ) : null}

                  <Button type="submit" loading={isSubmitting} className="w-full justify-center min-h-[44px]">
                    {t(p.submitLabel) || 'Confirmar visita'}
                  </Button>
                </form>
              )}
            </div>
          </div>

          {/* WhatsApp fallback */}
          {whatsapp_number && (
          <div className="mt-8 sm:mt-10 rounded-md bg-white p-5 shadow-card sm:p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
              {waArt && (
                <span className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-sm" style={{ background: wash('var(--green)', 12) }}>
                  <Illustration name={waArt} size={64} fluid className="w-[56px]" />
                </span>
              )}
              <div className="text-base text-muted">
                {p.whatsappTitle && <p className="font-head font-semibold text-ink">{t(p.whatsappTitle)}</p>}
                {p.whatsappText && <p>{t(p.whatsappText)}</p>}
              </div>
            </div>
            <a
              href={waHref(whatsapp_number, whatsappText)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 min-h-[44px] w-full sm:w-auto bg-green-600 text-white px-5 py-2.5 rounded-sm text-sm font-semibold hover:bg-green-700 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
            >
              <MessageCircle className="w-4 h-4" aria-hidden="true" />
              {whatsappLabel}
            </a>
          </div>
          )}
        </>
      )}

      {/* The school's own photos: what the family will see on the visit. */}
      {photos.length > 0 && (
        <div className="mt-10 sm:mt-12">
          {p.photosTitle && <h2 className="mb-4 font-head text-fluid-lg font-semibold text-ink">{t(p.photosTitle)}</h2>}
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
            {photos.map((ph, i) => (
              <li key={i} className={i === 0 ? 'col-span-2 sm:col-span-1' : ''}>
                <img
                  src={imageSrc(ph.image, 'md')}
                  srcSet={imageSrcSet(ph.image)}
                  sizes={i === 0 ? '(min-width: 640px) 280px, 100vw' : '(min-width: 640px) 280px, 50vw'}
                  alt={altOf(ph.image, t(ph.caption))}
                  width={480}
                  height={360}
                  loading="lazy"
                  decoding="async"
                  className={`w-full rounded-md bg-cream-2 object-cover shadow-card ${i === 0 ? 'aspect-[16/9] sm:aspect-[4/3]' : 'aspect-[4/3]'}`}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export const sections = [
  section({
    type: 'hero', label: 'Agendar visita · Portada', description: 'Portada oscura con foto, título, subtítulo y los pasos del proceso de admisión.',
    component: VisitHeroView,
    fields: [f.text('label', 'Etiqueta superior', { hint: 'Puede usar {{ciclo}}.' }), f.text('title', 'Título', { required: true }), f.textarea('subtitle', 'Subtítulo'), f.image('image', 'Foto de fondo')],
    defaults: {
      label: 'Ciclo Escolar {{ciclo}} · Admisiones', title: 'Agendar Visita',
      subtitle: 'Un recorrido personalizado para su familia: elija la fecha que le convenga y confirme su cita. Es el primer paso del proceso de admisión.',
      image: '/assets/facade.webp',
    },
  }),
  section({
    type: 'steps', label: 'Agendar visita · Cómo funciona', description: 'Franja con los pasos numerados, cada uno con su ilustración, y un enlace al proceso de admisión.',
    component: VisitStepsView,
    fields: [
      f.items('items', 'Pasos', [f.text('text', 'Paso', { required: true }), f.illustration('illustration', 'Ilustración', { hint: ART_HINT })]),
      f.link('link', 'Enlace bajo los pasos'),
    ],
    defaults: {
      items: [
        { text: 'Elija fecha y horario disponibles aquí mismo', illustration: 'agenda' },
        { text: 'Reciba la confirmación de su visita por correo', illustration: 'mensaje' },
        { text: 'Después de la visita agendamos el examen de valoración de su hijo/a', illustration: 'examen' },
      ],
      link: { label: 'Conozca el proceso de admisión →', href: '/admisiones' },
    },
  }),
  section({
    type: 'booking', label: 'Agendar visita · Calendario y reserva', locked: true,
    description: 'Calendario con los horarios abiertos, formulario, confirmación y fotos del colegio al final; los horarios se editan en Visitas y el WhatsApp en Ajustes.',
    component: VisitBookingView,
    fields: [
      ...grouped('Calendario', [
        f.text('pickTitle', 'Título del calendario'),
        f.text('weekdays', 'Días de la semana'),
        f.text('emptyTitle', 'Sin horarios: título'),
        f.textarea('emptyText', 'Sin horarios: texto'),
        f.text('errorTitle', 'Error al cargar: título'),
        f.textarea('errorText', 'Error al cargar: texto'),
      ]),
      ...grouped('Formulario', [
        f.text('formTitle', 'Título del formulario'),
        f.text('pickHint', 'Aviso antes de elegir horario'),
        f.illustration('hintIllustration', 'Ilustración del aviso', { hint: ART_HINT }),
        f.text('nameLabel', 'Nombre: etiqueta'), f.text('emailLabel', 'Correo: etiqueta'), f.text('phoneLabel', 'Teléfono: etiqueta'),
        f.text('childLabel', 'Alumno: etiqueta'), f.text('gradeLabel', 'Grado: etiqueta'),
        f.text('submitLabel', 'Texto del botón de envío'),
      ]),
      ...grouped('Mensajes', [
        f.text('errName', 'Falta el nombre'), f.text('errEmailEmpty', 'Falta el correo'), f.text('errEmail', 'Correo no válido'),
        f.text('errPhoneEmpty', 'Falta el teléfono'), f.text('errPhone', 'Teléfono no válido'),
        f.text('bookingError', 'Si la reserva no se pudo completar'),
      ]),
      ...grouped('Confirmación', [
        f.text('confirmedTitle', 'Título al confirmar'),
        f.textarea('confirmedText', 'Texto al confirmar'),
        f.text('againLabel', 'Botón «Agendar otra visita»'),
      ]),
      ...grouped('WhatsApp y contacto', [
        f.text('whatsappTitle', 'Recuadro de WhatsApp: título'),
        f.text('whatsappText', 'Recuadro de WhatsApp: texto'),
        f.text('whatsappLabel', 'Botón de WhatsApp'),
        f.text('whatsappMessage', 'Mensaje inicial de WhatsApp'),
        f.text('contactLabel', 'Botón de contacto (si no hay WhatsApp)'),
        f.illustration('whatsappIllustration', 'Recuadro de WhatsApp: ilustración', { hint: ART_HINT }),
      ]),
      ...grouped('Fotos del colegio', [
        f.text('photosTitle', 'Título sobre las fotos', { hint: 'Opcional. Vacío = las fotos sin título.' }),
        f.images('photos', 'Fotos al final de la página', { hint: 'Fotos del colegio; la descripción de cada una es su texto alternativo.' }),
      ]),
    ],
    defaults: {
      pickTitle: 'Elija una fecha y horario', formTitle: 'Sus datos', pickHint: 'Seleccione un horario para continuar',
      submitLabel: 'Confirmar visita', confirmedTitle: '¡Visita confirmada!',
      confirmedText: 'Le enviamos los detalles por correo. ¡Le esperamos!', againLabel: 'Agendar otra visita',
      emptyTitle: 'Sin horarios disponibles', emptyText: 'No hay citas abiertas por el momento. Escríbanos por WhatsApp y con gusto le agendamos.',
      errorTitle: 'No fue posible cargar los horarios', errorText: 'Verifique su conexión e intente de nuevo. También puede agendar por WhatsApp.',
      whatsappTitle: '¿Prefiere agendar por WhatsApp?', whatsappText: 'Escríbanos y con gusto coordinamos su visita.',
      whatsappLabel: 'Reservar por WhatsApp', whatsappMessage: 'Hola, me gustaría agendar una visita individual al Colegio Interlaken.',
      contactLabel: 'Contactar al colegio',
      weekdays: 'Lun, Mar, Mié, Jue, Vie, Sáb, Dom',
      nameLabel: 'Nombre completo', emailLabel: 'Correo electrónico', phoneLabel: 'Teléfono / WhatsApp',
      childLabel: 'Nombre del alumno (opcional)', gradeLabel: 'Grado de interés (opcional)',
      errName: 'Nombre requerido', errEmailEmpty: 'Escriba su correo.', errEmail: 'Revise el correo: debe ser como nombre@ejemplo.com.',
      errPhoneEmpty: 'Escriba su teléfono.', errPhone: 'Revise el teléfono: solo números, de 10 a 15 dígitos (puede usar espacios, guiones, paréntesis y +).',
      bookingError: 'No fue posible completar la reserva. Intente de nuevo.',
      hintIllustration: 'visita', whatsappIllustration: 'informes',
      photosTitle: '',
      photos: VISIT_PHOTOS,
    },
  }),
];

export const templates = [{
  slug: 'agendar-visita', path: '/agendar-visita', title: 'Agendar visita', group: 'visita',
  seo: {},
  sections: ['visita.hero', 'visita.steps', 'visita.booking'],
}];

export default defineModule(sections, templates);
