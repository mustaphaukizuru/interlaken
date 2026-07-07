import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarDays, MapPin, Users, CheckCircle } from 'lucide-react';
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
      <section className="bg-gradient-to-r from-brand-700 to-brand-600 text-white py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h1 className="text-4xl font-bold mb-2">Puertas Abiertas</h1>
          <p className="text-brand-100">Conozca nuestras instalaciones y equipo docente</p>
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
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
          <div className="grid md:grid-cols-2 gap-8">
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
                      className={`w-full text-left card border-2 transition-colors ${
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
                      className="input-field"
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
        )}
      </div>
    </div>
  );
}
