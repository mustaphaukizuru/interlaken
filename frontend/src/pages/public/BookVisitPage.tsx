import { useMemo, useState } from 'react';
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
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PrivacyNote } from '@/components/ui/PrivacyNote';
import type { AvailabilitySlot } from '@/types';

const WHATSAPP_NUMBER = import.meta.env.VITE_WHATSAPP_NUMBER || '5215512345678';
const WHATSAPP_TEXT = encodeURIComponent(
  'Hola, me gustaría agendar una visita individual al Colegio Interlaken.',
);

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

  const { data: slots, isLoading } = useQuery<AvailabilitySlot[]>({
    queryKey: ['availability', 'individual'],
    queryFn: async () => {
      const { data } = await bookingsApi.getAvailability({ type: 'individual' });
      return data.results ?? data;
    },
  });

  // Group open slots by date for the month/day → time picker.
  const byDate = useMemo(() => {
    const map = new Map<string, AvailabilitySlot[]>();
    (slots ?? []).forEach((s) => {
      const list = map.get(s.date) ?? [];
      list.push(s);
      map.set(s.date, list);
    });
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [slots]);

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
      <section className="bg-gradient-to-r from-brand-700 to-brand-600 text-white py-10 sm:py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h1 className="text-fluid-4xl font-bold mb-2">Agendar Visita</h1>
          <p className="text-brand-100 text-fluid-base">
            Reserve un recorrido personalizado por nuestras instalaciones.
          </p>
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
              {/* Slot picker */}
              <div>
                <h2 className="font-semibold text-fluid-lg text-ink mb-4">Elija una fecha y horario</h2>
                {isLoading ? (
                  <LoadingSpinner />
                ) : !byDate.length ? (
                  <p className="text-muted text-sm">
                    No hay horarios disponibles por el momento. Escríbanos por WhatsApp y
                    con gusto le agendamos.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {byDate.map(([date, daySlots]) => (
                      <div key={date}>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedDate((d) => (d === date ? null : date))
                          }
                          className={`w-full text-left card border-2 min-h-[44px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-1 ${
                            selectedDate === date
                              ? 'border-brand-500 bg-brand-50'
                              : 'border-line hover:border-brand-300'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-brand-100 rounded-xl flex items-center justify-center flex-shrink-0">
                              <CalendarDays className="w-5 h-5 text-brand-600" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-ink text-sm capitalize">
                                {format(parseISO(date), "EEEE d 'de' MMMM", { locale: es })}
                              </p>
                              <p className="text-xs text-muted">
                                {daySlots.length} horario{daySlots.length !== 1 ? 's' : ''} disponible
                                {daySlots.length !== 1 ? 's' : ''}
                              </p>
                            </div>
                          </div>
                        </button>

                        {selectedDate === date && (
                          <div className="flex flex-wrap gap-2 mt-3 pl-2">
                            {daySlots.map((slot) => (
                              <button
                                key={slot.id}
                                type="button"
                                onClick={() => setSelectedSlot(slot)}
                                className={`flex items-center gap-1.5 text-sm px-3 py-2 min-h-[44px] rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-1 ${
                                  selectedSlot?.id === slot.id
                                    ? 'border-brand-500 bg-brand-500 text-white'
                                    : 'border-line text-ink hover:border-brand-400'
                                }`}
                              >
                                <Clock className="w-3.5 h-3.5" />
                                {slot.start_time.slice(0, 5)}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
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
            <div className="mt-8 sm:mt-10 rounded-2xl border border-line bg-cream p-5 sm:p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-sm text-muted text-center sm:text-left">
                <p className="font-semibold text-ink">¿Prefiere agendar por WhatsApp?</p>
                <p>Escríbanos y con gusto coordinamos su visita.</p>
              </div>
              <a
                href={`https://wa.me/${WHATSAPP_NUMBER}?text=${WHATSAPP_TEXT}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 min-h-[44px] w-full sm:w-auto bg-green-600 text-white px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-green-700 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
              >
                <MessageCircle className="w-4 h-4" />
                Reservar por WhatsApp
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
