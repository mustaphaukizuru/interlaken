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
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PrivacyNote } from '@/components/ui/PrivacyNote';
import { MonthCalendar } from '@/components/ui/MonthCalendar';
import type { AvailabilitySlot } from '@/types';

const WHATSAPP_TEXT = 'Hola, me gustaría agendar una visita individual al Colegio Interlaken.';

const schema = z.object({
  parent_name:  z.string().min(3, 'Nombre requerido'),
  parent_email: z.string().email('Correo inválido'),
  parent_phone: z.string().min(10, 'Teléfono inválido'),
  child_name:   z.string().optional(),
  child_grade:  z.string().optional(),
});

type FormData = z.infer<typeof schema>;

// ≥16px inputs prevent iOS zoom on focus; brand focus-visible ring.
const inputClass = 'text-base min-h-[44px]';

export default function BookVisitPage() {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);
  const [confirmed, setConfirmed] = useState<AvailabilitySlot | null>(null);
  const { whatsapp_number } = useSiteSettings();

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
          'No fue posible completar la reserva. Intente de nuevo.',
      );
    }
  };

  return (
    <div>
      <section className="relative overflow-hidden bg-dark text-white py-12 sm:py-20">
        <img
          src="/assets/facade.webp"
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-30"
          loading="eager"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-dark/90 via-dark/70 to-dark/40" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
          <span className="section-label-pink inline-flex">Visita Individual</span>
          <h1 className="mt-3 text-fluid-4xl font-bold mb-2">Agendar Visita</h1>
          <p className="max-w-2xl text-brand-100 text-fluid-base">
            Un recorrido personalizado para su familia: complete su pre-registro,
            elija la fecha que le convenga y confirme su cita.
          </p>
        </div>
      </section>

      {/* Cómo funciona: pre-registro → fecha → confirmación */}
      <section className="border-b border-line bg-cream-2">
        <div className="max-w-6xl mx-auto grid grid-cols-1 gap-3 px-4 py-5 text-sm sm:grid-cols-3 sm:px-6">
          {[
            ['1', 'Complete su pre-registro con los datos de su hijo/a'],
            ['2', 'Elija fecha y horario disponibles aquí mismo'],
            ['3', 'Reciba la confirmación de su visita por correo'],
          ].map(([n, t]) => (
            <div key={n} className="flex items-start gap-2.5 text-ink">
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-green text-xs font-bold text-white">{n}</span>
              <span>{t}</span>
            </div>
          ))}
        </div>
        <div className="max-w-6xl mx-auto px-4 pb-5 sm:px-6">
          <Link to="/pre-registro" className="text-sm font-semibold text-green-dark hover:underline">
            ¿Aún no se pre-registra? Inicie su pre-registro aquí →
          </Link>
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {confirmed ? (
          <div className="text-center py-12 sm:py-16">
            <div className="w-16 h-16 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-brand-600" />
            </div>
            <h2 className="text-fluid-2xl font-bold text-ink mb-2">¡Visita confirmada!</h2>
            <p className="text-muted mb-1">
              {format(parseISO(confirmed.date), "EEEE d 'de' MMMM, yyyy", { locale: es })} ·{' '}
              {confirmed.start_time.slice(0, 5)} h
            </p>
            <p className="text-muted">
              Le enviamos los detalles por correo. ¡Le esperamos!
            </p>
            <Button
              variant="secondary"
              className="mt-6 min-h-[44px]"
              onClick={() => setConfirmed(null)}
            >
              Agendar otra visita
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Slot picker — month calendar + time chips */}
              <div>
                <h2 className="font-semibold text-fluid-lg text-ink mb-4">Elija una fecha y horario</h2>
                {isLoading ? (
                  <div className="flex justify-center py-10" aria-busy="true" aria-label="Cargando horarios">
                    <LoadingSpinner />
                  </div>
                ) : isError ? (
                  <div className="rounded-xl2 border border-coral/30 bg-coral-50 p-6 text-center text-sm text-coral-dark" role="alert">
                    <p>No fue posible cargar los horarios. Intente de nuevo.</p>
                    <button
                      type="button"
                      onClick={() => refetch()}
                      className="mt-3 font-semibold underline"
                    >
                      Reintentar
                    </button>
                  </div>
                ) : !calendarDays.length ? (
                  <div className="rounded-xl2 border border-dashed border-line bg-cream p-6 text-center text-sm text-muted">
                    No hay horarios disponibles por el momento. Escríbanos por WhatsApp y
                    con gusto le agendamos.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <MonthCalendar
                      days={calendarDays}
                      selectedDate={selectedDate}
                      countLabel="horarios"
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
                <h2 className="font-semibold text-fluid-lg text-ink mb-4">Sus datos</h2>
                {!selectedSlot ? (
                  <div className="card bg-cream border-dashed border-2 border-line text-center py-10 text-subtle text-sm">
                    Seleccione un horario para continuar
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

                    <Input label="Nombre completo" error={errors.parent_name?.message} className={inputClass} {...register('parent_name')} />
                    <Input label="Correo electrónico" type="email" error={errors.parent_email?.message} className={inputClass} {...register('parent_email')} />
                    <Input label="Teléfono / WhatsApp" type="tel" error={errors.parent_phone?.message} className={inputClass} {...register('parent_phone')} />
                    <Input label="Nombre del alumno (opcional)" className={inputClass} {...register('child_name')} />
                    <Input label="Grado de interés (opcional)" className={inputClass} {...register('child_grade')} />

                    <PrivacyNote />

                    <Button type="submit" loading={isSubmitting} className="w-full justify-center min-h-[44px]">
                      Confirmar visita
                    </Button>
                  </form>
                )}
              </div>
            </div>

            {/* WhatsApp fallback */}
            {whatsapp_number && (
            <div className="mt-8 sm:mt-10 rounded-2xl border border-line bg-cream p-5 sm:p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-sm text-muted text-center sm:text-left">
                <p className="font-semibold text-ink">¿Prefiere agendar por WhatsApp?</p>
                <p>Escríbanos y con gusto coordinamos su visita.</p>
              </div>
              <a
                href={waHref(whatsapp_number, WHATSAPP_TEXT)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 min-h-[44px] w-full sm:w-auto bg-green-600 text-white px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-green-700 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
              >
                <MessageCircle className="w-4 h-4" />
                Reservar por WhatsApp
              </a>
            </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
