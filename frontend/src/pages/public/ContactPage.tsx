import { Phone, Mail, MapPin, Clock, Navigation, ArrowRight } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { contactApi } from '@/services/api';
import { Section } from '@/components/ui/Section';
import { Reveal } from '@/components/ui/Reveal';
import { Blob } from '@/components/ui/Blob';
import { PrivacyNote } from '@/components/ui/PrivacyNote';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { waHref } from '@/lib/siteContact';

const schema = z.object({
  name:    z.string().min(2, 'Nombre requerido'),
  email:   z.string().email('Correo electrónico inválido'),
  subject: z.string().min(2, 'Asunto requerido'),
  message: z.string().min(10, 'El mensaje es demasiado corto'),
});

type FormData = z.infer<typeof schema>;

/** Directorio oficial por nivel (conmutador 5379-1188). */
const DIRECTORY = [
  { level: 'Preescolar', ext: '1', email: 'preescolar@interlaken.com.mx' },
  { level: 'Primaria',   ext: '2', email: 'primaria@interlaken.com.mx' },
  { level: 'Secundaria', ext: '3', email: 'secundaria@interlaken.com.mx' },
];

export default function ContactPage() {
  const settings = useSiteSettings();
  // Contact facts are admin-editable (Contenido del sitio → Ajustes del sitio);
  // entries without a value simply don't render.
  const INFO = [
    { icon: Phone,  label: 'Teléfono',           value: settings.phone_display, href: `tel:${settings.phone_e164}` },
    { icon: Mail,   label: 'Correo',             value: settings.contact_email, href: `mailto:${settings.contact_email}` },
    { icon: MapPin, label: 'Dirección',          value: settings.address,       href: settings.maps_url || undefined },
    { icon: Clock,  label: 'Horario de oficina', value: settings.office_hours },
  ].filter((item) => item.value);

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
        <img src="/assets/facade-sign.webp" alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" loading="eager" />
        <div className="absolute inset-0 bg-gradient-to-r from-dark/90 via-dark/70 to-dark/45" />
        <Blob tone="pink" opacity={0.4} size={460} shape={1} className="hidden sm:block" style={{ top: -150, left: -110 }} />
        <Blob tone="purple" opacity={0.4} size={420} shape={0} className="hidden sm:block" style={{ bottom: -150, right: -110 }} />
        <div className="relative mx-auto w-full max-w-[1120px] px-6 py-14 sm:py-16">
          <span className="section-label-pink inline-flex">Estamos para ayudarle</span>
          <h1 className="mt-3 font-head text-fluid-4xl font-black leading-[1.08] tracking-tight">
            Contacto
          </h1>
          <p className="mt-4 max-w-[520px] text-base leading-relaxed text-white/60 sm:text-[17px]">
            Resolvemos sus dudas sobre admisiones, costos y nuestro modelo educativo. Escríbanos y le contactaremos pronto.
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

            {/* Ubicación — mapa interactivo real + CTA "Cómo llegar" */}
            {settings.address && (
              <div className="group mt-6 overflow-hidden rounded-[20px] border border-line bg-white shadow-card transition-shadow hover:shadow-purple">
                <div className="relative aspect-[16/10] w-full bg-cream-2">
                  <iframe
                    title="Ubicación de Colegio Interlaken en Google Maps"
                    src={`https://maps.google.com/maps?q=${encodeURIComponent(settings.address)}&z=15&output=embed`}
                    className="absolute inset-0 h-full w-full border-0 grayscale-[0.25] transition-[filter] duration-500 group-hover:grayscale-0 motion-reduce:transition-none"
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    allowFullScreen
                  />
                </div>
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-purple/10 text-purple">
                      <MapPin className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <p className="text-sm font-medium leading-snug text-ink">{settings.address}</p>
                  </div>
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(settings.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Cómo llegar a ${settings.address} en Google Maps`}
                    className="group/btn inline-flex min-h-[44px] flex-shrink-0 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-purple to-purple-mid px-5 text-sm font-semibold text-white shadow-purple transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                  >
                    <Navigation className="h-4 w-4" aria-hidden="true" />
                    Cómo llegar
                    <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/btn:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
                  </a>
                </div>
              </div>
            )}

            {settings.whatsapp_number && (
            <div className="mt-[22px]">
              <a
                href={waHref(settings.whatsapp_number, 'Hola, me gustaría obtener más información')}
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
            )}
          </Reveal>

          {/* Contact form */}
          <Reveal direction="left">
            <div className="card">
              <h2 className="mb-[18px] font-head text-fluid-xl font-extrabold tracking-tight text-ink">Envíenos un mensaje</h2>
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
                <PrivacyNote />
                <button type="submit" disabled={isSubmitting} className="btn-primary w-full justify-center disabled:opacity-60">
                  {isSubmitting ? 'Enviando…' : 'Enviar mensaje'}
                </button>
              </form>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ── DIRECTORIO POR NIVEL ── */}
      <Section bg="cream">
        <div className="mx-auto w-full max-w-[1120px] px-6">
          <span className="section-label-green inline-flex">Directorio</span>
          <h2 className="mt-2 font-head text-fluid-xl font-bold text-ink">
            Atención por nivel educativo
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {DIRECTORY.map((d) => (
              <Reveal key={d.level}>
                <div className="h-full rounded-xl2 border border-ink/10 bg-white p-5">
                  <p className="font-head text-lg font-bold text-ink">{d.level}</p>
                  <ul className="mt-3 space-y-2 text-sm">
                    <li>
                      <a
                        href={`tel:${settings.phone_e164}`}
                        className="flex items-center gap-2 text-ink/85 hover:text-green-dark"
                      >
                        <Phone size={15} className="text-green-dark" aria-hidden="true" />
                        {settings.phone_display} · Ext {d.ext}
                      </a>
                    </li>
                    <li>
                      <a
                        href={`mailto:${d.email}`}
                        className="flex items-center gap-2 break-all text-ink/85 hover:text-green-dark"
                      >
                        <Mail size={15} className="text-green-dark" aria-hidden="true" />
                        {d.email}
                      </a>
                    </li>
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </Section>

      {/* ── MAPA ── */}
      <section className="bg-white pb-14 pt-4">
        <div className="mx-auto w-full max-w-[1120px] px-6">
          <h2 className="font-head text-fluid-xl font-bold text-ink">Cómo llegar</h2>
          <p className="mt-1 text-sm text-muted">
            {settings.address}
            {settings.maps_url && (
              <>
                {' · '}
                <a
                  href={settings.maps_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-green-dark underline"
                >
                  Abrir en Google Maps
                </a>
              </>
            )}
          </p>
          <div className="mt-4 overflow-hidden rounded-xl2 border border-ink/10">
            <iframe
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3759.6587772437156!2d-99.20946797478247!3d19.556257781749714!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x85d21d6c27c972e1%3A0x3c76d65bc761079b!2sCollege%20Interlaken%20%2F%20ADCE%20Education!5e0!3m2!1sen!2smx!4v1783605176683!5m2!1sen!2smx"
              title="Mapa — Colegio Interlaken, Av. de los Reyes 67, Tlalnepantla"
              className="h-[340px] w-full sm:h-[420px]"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
