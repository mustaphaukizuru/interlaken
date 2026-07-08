import { Phone, Mail, MapPin, Clock } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { contactApi } from '@/services/api';
import { Section } from '@/components/ui/Section';
import { Reveal } from '@/components/ui/Reveal';
import { Blob } from '@/components/ui/Blob';

const schema = z.object({
  name:    z.string().min(2, 'Nombre requerido'),
  email:   z.string().email('Correo electrónico inválido'),
  subject: z.string().min(2, 'Asunto requerido'),
  message: z.string().min(10, 'El mensaje es demasiado corto'),
});

type FormData = z.infer<typeof schema>;

const INFO = [
  { icon: Phone,  label: 'Teléfono',           value: '(55) 1234-5678',                        href: 'tel:+525512345678' },
  { icon: Mail,   label: 'Correo',             value: 'colegio@interlaken.edu.mx',             href: 'mailto:colegio@interlaken.edu.mx' },
  { icon: MapPin, label: 'Dirección',          value: 'Tlalnepantla de Baz, Estado de México', href: 'https://maps.google.com/?q=Tlalnepantla+de+Baz' },
  { icon: Clock,  label: 'Horario de oficina', value: 'Lunes–Viernes 8:00–16:00 hrs' },
];

export default function ContactPage() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    try {
      await contactApi.send(data);
      toast.success('Mensaje enviado. Le responderemos pronto.');
      reset();
    } catch {
      toast.error('No se pudo enviar el mensaje. Intente nuevamente.');
    }
  };

  return (
    <div>
      {/* ── HERO ── */}
      <section className="relative overflow-hidden bg-dark text-white">
        <Blob tone="pink" opacity={0.4} size={460} shape={1} className="hidden sm:block" style={{ top: -150, left: -110 }} />
        <Blob tone="purple" opacity={0.4} size={420} shape={0} className="hidden sm:block" style={{ bottom: -150, right: -110 }} />
        <div className="relative mx-auto w-full max-w-[1120px] px-6 py-14 sm:py-16">
          <span className="section-label-pink inline-flex">Estamos para ayudarte</span>
          <h1 className="mt-3 font-head text-fluid-4xl font-black leading-[1.08] tracking-tight">
            Contacto
          </h1>
          <p className="mt-4 max-w-[520px] text-base leading-relaxed text-white/60 sm:text-[17px]">
            Resolvemos tus dudas sobre admisiones, costos y nuestro modelo educativo. Escríbenos y te contactaremos pronto.
          </p>
        </div>
      </section>

      {/* ── SPLIT: info + form ── */}
      <Section bg="white">
        <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-2">
          {/* Contact info + map */}
          <Reveal direction="right">
            <h2 className="font-head text-fluid-2xl font-extrabold tracking-tight text-ink">Información de contacto</h2>
            <div className="mt-6 grid gap-[18px]">
              {INFO.map(({ icon: Icon, label, value, href }) => {
                const inner = (
                  <>
                    <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-purple/[0.08]">
                      <Icon className="h-5 w-5 text-purple" />
                    </div>
                    <div>
                      <p className="mb-0.5 text-xs text-subtle">{label}</p>
                      <p className="text-[14.5px] font-semibold text-ink">{value}</p>
                    </div>
                  </>
                );
                return href ? (
                  <a
                    key={label}
                    href={href}
                    {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    className="group flex items-start gap-3.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-2"
                  >
                    {inner}
                  </a>
                ) : (
                  <div key={label} className="flex items-start gap-3.5">{inner}</div>
                );
              })}
            </div>

            {/* Map placeholder */}
            <a
              href="https://maps.google.com/?q=Tlalnepantla+de+Baz"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Abrir ubicación en Google Maps"
              className="relative mt-6 block h-[220px] overflow-hidden rounded-[18px] border border-[#ECEAF3] bg-gradient-to-br from-purple-light to-green-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-2"
            >
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 text-purple">
                <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-white shadow-purple">
                  <MapPin className="h-6 w-6" />
                </div>
                <span className="font-head text-sm font-bold">Tlalnepantla de Baz, Edo. de México</span>
                <span className="text-[12.5px] text-muted">Ver ubicación en Google Maps</span>
              </div>
            </a>

            <div className="mt-[22px]">
              <a
                href="https://wa.me/5215512345678?text=Hola%2C%20me%20gustar%C3%ADa%20obtener%20m%C3%A1s%20informaci%C3%B3n"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-green-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-green-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 focus-visible:ring-offset-2"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" xmlns="http://www.w3.org/2000/svg">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
                Escribir por WhatsApp
              </a>
            </div>
          </Reveal>

          {/* Contact form */}
          <Reveal direction="left">
            <div className="card">
              <h2 className="mb-[18px] font-head text-fluid-xl font-extrabold tracking-tight text-ink">Envíanos un mensaje</h2>
              <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
                <div>
                  <label className="label" htmlFor="contact-name">Nombre</label>
                  <input id="contact-name" className="input-field text-base" placeholder="Su nombre completo" aria-invalid={!!errors.name} {...register('name')} />
                  {errors.name && <p className="mt-1.5 text-xs text-red-600">{errors.name.message}</p>}
                </div>
                <div>
                  <label className="label" htmlFor="contact-email">Correo electrónico</label>
                  <input id="contact-email" className="input-field text-base" type="email" placeholder="correo@ejemplo.com" aria-invalid={!!errors.email} {...register('email')} />
                  {errors.email && <p className="mt-1.5 text-xs text-red-600">{errors.email.message}</p>}
                </div>
                <div>
                  <label className="label" htmlFor="contact-subject">Asunto</label>
                  <input id="contact-subject" className="input-field text-base" placeholder="¿En qué le podemos ayudar?" aria-invalid={!!errors.subject} {...register('subject')} />
                  {errors.subject && <p className="mt-1.5 text-xs text-red-600">{errors.subject.message}</p>}
                </div>
                <div>
                  <label className="label" htmlFor="contact-message">Mensaje</label>
                  <textarea
                    id="contact-message"
                    className="input-field min-h-[120px] resize-none text-base"
                    placeholder="Describa su consulta…"
                    aria-invalid={!!errors.message}
                    {...register('message')}
                  />
                  {errors.message && <p className="mt-1.5 text-xs text-red-600">{errors.message.message}</p>}
                </div>
                <button type="submit" disabled={isSubmitting} className="btn-primary w-full justify-center disabled:opacity-60">
                  {isSubmitting ? 'Enviando…' : 'Enviar mensaje'}
                </button>
              </form>
            </div>
          </Reveal>
        </div>
      </Section>
    </div>
  );
}
