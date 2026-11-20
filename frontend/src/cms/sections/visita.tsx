/**
 * Agendar visita (/agendar-visita): designed sections (docs/CMS-COMPLETION-PLAN.md).
 * The booking widget (calendar, time slots, form, confirmation) is a locked
 * section that owns its own state; its titles and messages are editable.
 * The open slots are edited in Visitas (availability).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { CalendarDays, Clock, MapPin, CheckCircle, MessageCircle } from 'lucide-react';
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
import { FunnelHero } from '@/components/admissions/FunnelHero';
import type { AvailabilitySlot } from '@/types';
import { useCmsImage, useTokens, type CmsLink } from '../runtime';
import { asLink, asList, CmsAnchor, defineModule, f, inGroup, sectionsOf } from './kit';

const section = sectionsOf('visita');

/* ── Portada ────────────────────────────────────────────────────────────── */
interface HeroProps { label?: string; title?: string; subtitle?: string; image?: number | string }
function VisitHeroView(p: HeroProps) {
  const t = useTokens();
  const img = useCmsImage(p.image);
  return (
    <FunnelHero
      step="agendar-visita"
      label={t(p.label)}
      title={t(p.title)}
      subtitle={p.subtitle ? t(p.subtitle) : undefined}
      imageSrc={img.src || undefined}
    />
  );
}

/* ── Cómo funciona ──────────────────────────────────────────────────────── */
// Cómo funciona: pre-registro → fecha → confirmación
function VisitStepsView(p: { items?: { text?: string }[]; link?: CmsLink }) {
  const t = useTokens();
  const link = asLink(p.link);
  return (
    <section className="border-b border-line bg-cream-2">
      <div className="max-w-6xl mx-auto grid grid-cols-1 gap-3 px-4 py-5 text-sm sm:grid-cols-3 sm:px-6">
        {asList<{ text?: string }>(p.items).map((s, i) => (
          <div key={i} className="flex items-start gap-2.5 text-ink">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-green-strong text-xs font-bold text-white">{i + 1}</span>
            <span>{t(s.text)}</span>
          </div>
        ))}
      </div>
      {link.href && (
        <div className="max-w-6xl mx-auto px-4 pb-5 sm:px-6">
          <CmsAnchor link={{ ...link, label: t(link.label) }} className="text-sm font-semibold text-green-dark hover:underline" />
        </div>
      )}
    </section>
  );
}

/* ── Reserva (bloqueado) ────────────────────────────────────────────────── */
// Rules stay in code; each message is the prop that words it (errName...).
const schema = z.object({
  parent_name:  z.string().min(3, 'errName'),
  parent_email: z.string().email('errEmail'),
  parent_phone: z.string().min(10, 'errPhone'),
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
  const { whatsapp_number } = useSiteSettings();
  const whatsappText = t(p.whatsappMessage);
  const whatsappLabel = t(p.whatsappLabel) || 'Reservar por WhatsApp';

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

  const onSubmit = async (values: FormData) => {
    if (!selectedSlot) return;
    try {
      await bookingsApi.createBooking({
        slot: selectedSlot.id,
        parent_name: values.parent_name,
        parent_email: values.parent_email,
        parent_phone: values.parent_phone,
        child_name: values.child_name,
        child_grade: values.child_grade,
        num_attendees: 1,
      });
      trackEvent(FunnelEvent.BookingConversion, { grade: values.child_grade });
      setConfirmed(selectedSlot);
      setSelectedSlot(null);
      setSelectedDate(null);
      reset();
    } catch (err: any) {
      toast.error(
        err?.response?.data?.detail ??
          (c('bookingError') || 'No fue posible completar la reserva. Intente de nuevo.'),
      );
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {confirmed ? (
        <div className="text-center py-12 sm:py-16" role="status">
          <div className="w-16 h-16 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-brand-600" />
          </div>
          <h2 className="text-fluid-2xl font-bold text-ink mb-2">{t(p.confirmedTitle) || '¡Visita confirmada!'}</h2>
          <p className="text-muted mb-1">
            {format(parseISO(confirmed.date), "EEEE d 'de' MMMM, yyyy", { locale: es })} ·{' '}
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
                  <div className="skeleton h-10 w-48 rounded-lg" />
                  <div className="skeleton h-[280px] rounded-xl2" />
                  <div className="flex gap-2">
                    <div className="skeleton h-11 w-20 rounded-xl" />
                    <div className="skeleton h-11 w-20 rounded-xl" />
                    <div className="skeleton h-11 w-20 rounded-xl" />
                  </div>
                </div>
              ) : isError ? (
                <ErrorState
                  title={t(p.errorTitle) || 'No fue posible cargar los horarios'}
                  description={t(p.errorText) || undefined}
                  onRetry={() => refetch()}
                />
              ) : !calendarDays.length ? (
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
                        <MessageCircle className="h-4 w-4" /> {whatsappLabel}
                      </a>
                    ) : (
                      <Link to="/contacto" className="btn-outline inline-flex min-h-[44px] items-center">
                        {t(p.contactLabel) || 'Contactar al colegio'}
                      </Link>
                    )
                  }
                />
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
                    <div className="rounded-xl2 border border-line bg-white p-4 shadow-card">
                      <p className="mb-3 flex items-center gap-2 text-sm font-semibold capitalize text-ink">
                        <CalendarDays className="h-4 w-4 text-purple" aria-hidden="true" />
                        {format(parseISO(selectedDate), "EEEE d 'de' MMMM", { locale: es })}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {daySlots.map((slot) => (
                          <button
                            key={slot.id}
                            type="button"
                            onClick={() => setSelectedSlot(slot)}
                            className={`flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-1 ${
                              selectedSlot?.id === slot.id
                                ? 'border-purple bg-purple text-white shadow-purple'
                                : 'border-line text-ink hover:border-brand-400 hover:bg-brand-50'
                            }`}
                          >
                            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
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
                <div className="card bg-cream border-dashed border-2 border-line text-center py-10 text-subtle text-sm">
                  {t(p.pickHint)}
                </div>
              ) : (
                <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4">
                  <div className="bg-brand-50 rounded-xl p-3 text-sm text-brand-700">
                    <div className="flex items-center gap-2">
                      <CalendarDays className="w-4 h-4 flex-shrink-0" />
                      <strong className="capitalize">
                        {format(parseISO(selectedSlot.date), "d 'de' MMMM, yyyy", { locale: es })}
                      </strong>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Clock className="w-4 h-4 flex-shrink-0" />
                      {selectedSlot.start_time.slice(0, 5)} - {selectedSlot.end_time.slice(0, 5)} h
                    </div>
                    {selectedSlot.location && (
                      <div className="flex items-center gap-2 mt-1">
                        <MapPin className="w-4 h-4 flex-shrink-0" />
                        {selectedSlot.location}
                      </div>
                    )}
                  </div>

                  <Input label={c('nameLabel')} error={err(errors.parent_name)} className={inputClass} {...register('parent_name')} />
                  <Input label={c('emailLabel')} type="email" inputMode="email" autoComplete="email" error={err(errors.parent_email)} className={inputClass} {...register('parent_email')} />
                  <Input label={c('phoneLabel')} type="tel" inputMode="tel" autoComplete="tel" error={err(errors.parent_phone)} className={inputClass} {...register('parent_phone')} />
                  <Input label={c('childLabel')} className={inputClass} {...register('child_name')} />
                  <Input label={c('gradeLabel')} className={inputClass} {...register('child_grade')} />

                  <PrivacyNote />

                  <Button type="submit" loading={isSubmitting} className="w-full justify-center min-h-[44px]">
                    {t(p.submitLabel) || 'Confirmar visita'}
                  </Button>
                </form>
              )}
            </div>
          </div>

          {/* WhatsApp fallback */}
          {whatsapp_number && (
          <div className="mt-8 sm:mt-10 rounded-2xl border border-line bg-cream p-5 sm:p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-sm text-muted text-center sm:text-left">
              {p.whatsappTitle && <p className="font-semibold text-ink">{t(p.whatsappTitle)}</p>}
              {p.whatsappText && <p>{t(p.whatsappText)}</p>}
            </div>
            <a
              href={waHref(whatsapp_number, whatsappText)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 min-h-[44px] w-full sm:w-auto bg-green-600 text-white px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-green-700 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
            >
              <MessageCircle className="w-4 h-4" />
              {whatsappLabel}
            </a>
          </div>
          )}
        </>
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
      subtitle: 'Un recorrido personalizado para su familia: complete su pre-registro, elija la fecha que le convenga y confirme su cita.',
      image: '/assets/facade.webp',
    },
  }),
  section({
    type: 'steps', label: 'Agendar visita · Cómo funciona', description: 'Franja con los pasos numerados y un enlace al pre-registro.',
    component: VisitStepsView,
    fields: [f.items('items', 'Pasos', [f.text('text', 'Paso', { required: true })]), f.link('link', 'Enlace bajo los pasos')],
    defaults: {
      items: [
        { text: 'Complete su pre-registro con los datos de su hijo/a' },
        { text: 'Elija fecha y horario disponibles aquí mismo' },
        { text: 'Reciba la confirmación de su visita por correo' },
      ],
      link: { label: '¿Aún no se pre-registra? Inicie su pre-registro aquí →', href: '/pre-registro' },
    },
  }),
  section({
    type: 'booking', label: 'Agendar visita · Calendario y reserva', locked: true,
    description: 'Calendario con los horarios abiertos, formulario y confirmación; los horarios se editan en Visitas y el WhatsApp en Ajustes.',
    component: VisitBookingView,
    fields: [
      ...inGroup('Calendario', [
        f.text('pickTitle', 'Título del calendario'),
        f.text('weekdays', 'Días de la semana', { hint: 'Siete abreviaturas separadas por coma, empezando en lunes.' }),
        f.text('emptyTitle', 'Sin horarios: título'),
        f.textarea('emptyText', 'Sin horarios: texto'),
        f.text('errorTitle', 'Error al cargar: título'),
        f.textarea('errorText', 'Error al cargar: texto'),
      ]),
      ...inGroup('Formulario', [
        f.text('formTitle', 'Título del formulario'),
        f.text('pickHint', 'Aviso antes de elegir horario'),
        f.text('nameLabel', 'Nombre: etiqueta'), f.text('emailLabel', 'Correo: etiqueta'), f.text('phoneLabel', 'Teléfono: etiqueta'),
        f.text('childLabel', 'Alumno: etiqueta'), f.text('gradeLabel', 'Grado: etiqueta'),
        f.text('submitLabel', 'Texto del botón de envío'),
      ]),
      ...inGroup('Mensajes', [
        f.text('errName', 'Falta el nombre'), f.text('errEmail', 'Correo no válido'), f.text('errPhone', 'Teléfono no válido'),
        f.text('bookingError', 'Si la reserva no se pudo completar', { hint: 'Si el horario ya se ocupó, el sitio muestra el motivo exacto.' }),
      ]),
      ...inGroup('Confirmación', [
        f.text('confirmedTitle', 'Título al confirmar'),
        f.textarea('confirmedText', 'Texto al confirmar'),
        f.text('againLabel', 'Botón «Agendar otra visita»'),
      ]),
      ...inGroup('WhatsApp', [
        f.text('whatsappTitle', 'Recuadro de WhatsApp: título'),
        f.text('whatsappText', 'Recuadro de WhatsApp: texto'),
        f.text('whatsappLabel', 'Botón de WhatsApp'),
        f.text('whatsappMessage', 'Mensaje inicial de WhatsApp'),
        f.text('contactLabel', 'Botón de contacto (si no hay WhatsApp)'),
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
      errName: 'Nombre requerido', errEmail: 'Correo inválido', errPhone: 'Teléfono inválido',
      bookingError: 'No fue posible completar la reserva. Intente de nuevo.',
    },
  }),
];

export const templates = [{
  slug: 'agendar-visita', path: '/agendar-visita', title: 'Agendar visita', group: 'visita',
  seo: {},
  sections: ['visita.hero', 'visita.steps', 'visita.booking'],
}];

export default defineModule(sections, templates);
