import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import toast from 'react-hot-toast';
import { CalendarDays, MapPin, Users, CheckCircle, MessageCircle } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { admissionsApi } from '@/services/api';
import { SITE_URL, SITE_NAME } from '@/lib/siteMeta';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { waHref } from '@/lib/siteContact';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PrivacyNote } from '@/components/ui/PrivacyNote';
import type { OpenSchoolEvent } from '@/types';

const schema = z.object({
  event:          z.number(),
  name:           z.string().min(2, 'Nombre requerido'),
  email:          z.string().email('Correo inválido'),
  phone:          z.string().min(10, 'Teléfono inválido'),
  children_count: z.number().min(1).max(5),
});

type FormData = z.infer<typeof schema>;

const WHATSAPP_TEXT = 'Hola, me gustaría registrarme para un evento de Puertas Abiertas en el Colegio Interlaken.';

export default function OpenSchoolPage() {
  const [selectedEvent, setSelectedEvent] = useState<OpenSchoolEvent | null>(null);
  const [registered, setRegistered] = useState(false);
  const { whatsapp_number } = useSiteSettings();

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

  // Event structured data for the upcoming Puertas Abiertas dates.
  const eventsJsonLd = (events ?? []).map((e) => ({
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: e.title,
    startDate: e.date,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    location: {
      '@type': 'Place',
      name: e.location || SITE_NAME,
      address: 'Tlalnepantla de Baz, Estado de México',
    },
    organizer: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
  }));

  return (
    <div>
      {eventsJsonLd.length > 0 && (
        <Helmet>
          <script type="application/ld+json">{JSON.stringify(eventsJsonLd)}</script>
        </Helmet>
      )}
      <section className="relative overflow-hidden bg-dark py-14 text-white sm:py-20">
        <img
          src="/assets/classroom.webp"
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-30"
          loading="eager"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-dark/90 via-dark/70 to-dark/40" />
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
          <span className="section-label-pink inline-flex">Clase Abierta</span>
          <h1 className="mt-3 mb-2 font-head text-fluid-4xl font-bold">Puertas Abiertas</h1>
          <p className="max-w-2xl text-fluid-base text-white/75">
            Viva una <strong className="text-white">clase abierta</strong>: usted y su
            hijo/a participan en una clase real, conocen a nuestros docentes en acción
            y recorren las instalaciones del colegio.
          </p>
        </div>
      </section>

      {/* Qué incluye la clase abierta */}
      <section className="border-b border-line bg-cream-2">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-3 px-4 py-5 text-sm text-ink sm:grid-cols-3 sm:px-6">
          {[
            'Su hijo/a vive una clase real con nuestro modelo bilingüe',
            'Conozca a los docentes y el método en acción',
            'Recorrido guiado por aulas e instalaciones',
          ].map((t) => (
            <div key={t} className="flex items-start gap-2">
              <CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-dark" aria-hidden="true" />
              <span>{t}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-12">
        {registered ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-brand-600" />
            </div>
            <h2 className="text-2xl font-bold text-ink mb-2">¡Registro confirmado!</h2>
            <p className="text-muted">
              Recibirá un correo con los detalles del evento. ¡Esperamos verle pronto!
            </p>
          </div>
        ) : (
          <>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            {/* Events list */}
            <div>
              <h2 className="font-semibold text-ink mb-4">Próximas fechas</h2>
              {isLoading ? (
                <LoadingSpinner />
              ) : !events?.length ? (
                <p className="text-muted text-sm">No hay eventos programados actualmente.</p>
              ) : (
                <div className="space-y-3">
                  {events.map((event) => (
                    <button
                      key={event.id}
                      onClick={() => setSelectedEvent(event)}
                      className={`card w-full border-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 ${
                        selectedEvent?.id === event.id
                          ? 'border-brand-500 bg-brand-50'
                          : 'border-line hover:border-brand-300'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 bg-brand-100 rounded-xl flex items-center justify-center flex-shrink-0">
                          <CalendarDays className="w-5 h-5 text-brand-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-ink text-sm">{event.title}</p>
                          <p className="text-xs text-muted mt-0.5">
                            {format(
                              new Date(event.date),
                              "EEEE d 'de' MMMM, yyyy · HH:mm",
                              { locale: es },
                            )}
                          </p>
                          <div className="flex items-center gap-3 mt-2 text-xs text-subtle">
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
              <h2 className="font-semibold text-ink mb-4">Registrar asistencia</h2>
              {!selectedEvent ? (
                <div className="card bg-cream border-dashed border-2 border-line text-center py-10 text-subtle text-sm">
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

                  <PrivacyNote />

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
          {whatsapp_number && (
          <div className="mt-10 rounded-2xl border border-line bg-cream p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-sm text-muted text-center sm:text-left">
              <p className="font-semibold text-ink">¿Prefiere registrarse por WhatsApp?</p>
              <p>Escríbanos y con gusto le apartamos su lugar en el próximo evento.</p>
            </div>
            <a
              href={waHref(whatsapp_number, WHATSAPP_TEXT)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-green-600 text-white px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-green-700 transition-colors whitespace-nowrap"
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
