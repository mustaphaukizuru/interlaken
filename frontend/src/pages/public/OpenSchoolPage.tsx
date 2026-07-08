import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarDays, MapPin, Users, CheckCircle, MessageCircle } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { admissionsApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { OpenSchoolEvent } from '@/types';

const schema = z.object({
  event:          z.number(),
  name:           z.string().min(2, 'Nombre requerido'),
  email:          z.string().email('Correo inválido'),
  phone:          z.string().min(10, 'Teléfono inválido'),
  children_count: z.number().min(1).max(5),
});

type FormData = z.infer<typeof schema>;

const WHATSAPP_NUMBER = import.meta.env.VITE_WHATSAPP_NUMBER || '5215512345678';
const WHATSAPP_TEXT = encodeURIComponent(
  'Hola, me gustaría registrarme para un evento de Puertas Abiertas en el Colegio Interlaken.',
);

export default function OpenSchoolPage() {
  const [selectedEvent, setSelectedEvent] = useState<OpenSchoolEvent | null>(null);
  const [registered, setRegistered] = useState(false);

  const { data: events, isLoading } = useQuery<OpenSchoolEvent[]>({
    queryKey: ['open-school-events'],
    queryFn: async () => {
      const { data } = await admissionsApi.getOpenSchoolEvents();
      return data;
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { children_count: 1 },
  });

  const onSubmit = async (data: FormData) => {
    try {
      await admissionsApi.signUpOpenSchool({ ...data, event: selectedEvent?.id });
      setRegistered(true);
    } catch {
      toast.error('No fue posible completar el registro. Intente de nuevo.');
    }
  };

  return (
    <div>
      <section className="bg-gradient-to-r from-brand-700 to-brand-600 py-12 text-white sm:py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h1 className="mb-2 font-head text-fluid-4xl font-bold">Puertas Abiertas</h1>
          <p className="text-brand-100">Conozca nuestras instalaciones y equipo docente</p>
        </div>
      </section>

      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-12">
        {registered ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-brand-600" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">¡Registro confirmado!</h2>
            <p className="text-slate-500">
              Recibirá un correo con los detalles del evento. ¡Esperamos verle pronto!
            </p>
          </div>
        ) : (
          <>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            {/* Events list */}
            <div>
              <h2 className="font-semibold text-slate-900 mb-4">Próximas fechas</h2>
              {isLoading ? (
                <LoadingSpinner />
              ) : !events?.length ? (
                <p className="text-slate-500 text-sm">No hay eventos programados actualmente.</p>
              ) : (
                <div className="space-y-3">
                  {events.map((event) => (
                    <button
                      key={event.id}
                      onClick={() => setSelectedEvent(event)}
                      className={`card w-full border-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 ${
                        selectedEvent?.id === event.id
                          ? 'border-brand-500 bg-brand-50'
                          : 'border-slate-100 hover:border-brand-300'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 bg-brand-100 rounded-xl flex items-center justify-center flex-shrink-0">
                          <CalendarDays className="w-5 h-5 text-brand-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 text-sm">{event.title}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {format(
                              new Date(event.date),
                              "EEEE d 'de' MMMM, yyyy · HH:mm",
                              { locale: es },
                            )}
                          </p>
                          <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              {event.location}
                            </span>
                            <span className="flex items-center gap-1">
                              <Users className="w-3 h-3" />
                              {event.spots_remaining} lugares
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Registration form */}
            <div>
              <h2 className="font-semibold text-slate-900 mb-4">Registrar asistencia</h2>
              {!selectedEvent ? (
                <div className="card bg-slate-50 border-dashed border-2 border-slate-200 text-center py-10 text-slate-400 text-sm">
                  Seleccione una fecha a la izquierda
                </div>
              ) : (
                <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4">
                  <div className="bg-brand-50 rounded-xl p-3 text-sm text-brand-700">
                    <strong>{selectedEvent.title}</strong>
                    <br />
                    {format(new Date(selectedEvent.date), "d 'de' MMMM, yyyy", { locale: es })}
                  </div>

                  <Input
                    label="Nombre completo"
                    error={errors.name?.message}
                    {...register('name')}
                  />
                  <Input
                    label="Correo electrónico"
                    type="email"
                    error={errors.email?.message}
                    {...register('email')}
                  />
                  <Input
                    label="Teléfono"
                    type="tel"
                    error={errors.phone?.message}
                    {...register('phone')}
                  />

                  <div>
                    <label className="label">Número de asistentes</label>
                    <select
                      className="input-field text-base"
                      {...register('children_count', { valueAsNumber: true })}
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>

                  <Button
                    type="submit"
                    loading={isSubmitting}
                    className="w-full justify-center"
                  >
                    Confirmar asistencia
                  </Button>
                </form>
              )}
            </div>
          </div>

          {/* WhatsApp fallback */}
          <div className="mt-10 rounded-2xl border border-slate-100 bg-slate-50 p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-sm text-slate-600 text-center sm:text-left">
              <p className="font-semibold text-slate-900">¿Prefiere registrarse por WhatsApp?</p>
              <p>Escríbanos y con gusto le apartamos su lugar en el próximo evento.</p>
            </div>
            <a
              href={`https://wa.me/${WHATSAPP_NUMBER}?text=${WHATSAPP_TEXT}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-green-600 text-white px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-green-700 transition-colors whitespace-nowrap"
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
