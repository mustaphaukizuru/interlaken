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
import { WhatsAppIcon } from '@/components/icons/WhatsAppIcon';
import { assetSrcSet, CARD_SIZES } from '@/lib/images';

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
  // La dirección se muestra en la tarjeta con foto de la fachada (abajo),
  // por eso no se repite aquí.
  const INFO = [
    { icon: Phone,  label: 'Teléfono',           value: settings.phone_display, href: `tel:${settings.phone_e164}` },
    { icon: Mail,   label: 'Correo',             value: settings.contact_email, href: `mailto:${settings.contact_email}` },
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
        <img src="/assets/facade-sign.webp" srcSet={assetSrcSet("/assets/facade-sign.webp", { full: true })} sizes="100vw" alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" loading="eager" />
        <div className="absolute inset-0 bg-gradient-to-r from-dark/90 via-dark/70 to-dark/45" />
        <Blob tone="pink" opacity={0.4} size={460} shape={1} className="hidden sm:block" style={{ top: -150, left: -110 }} />
        <Blob tone="purple" opacity={0.4} size={420} shape={0} className="hidden sm:block" style={{ bottom: -150, right: -110 }} />
        <div className="relative mx-auto w-full max-w-[1120px] py-14 sm:py-16">
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

            {/* Foto de la fachada + dirección y CTA "Cómo llegar".
                El mapa interactivo preciso vive en su propia sección más abajo. */}
            {settings.address && (
              <div className="group mt-6 overflow-hidden rounded-[20px] border border-line bg-white shadow-card transition-shadow hover:shadow-purple">
                <div className="relative aspect-[16/10] w-full overflow-hidden bg-cream-2">
                  <img
                    src="/assets/facade.webp"
                    alt="Fachada del Colegio Interlaken en Tlalnepantla"
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-dark/25 to-transparent" />
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
                aria-label="Escribir por WhatsApp al Colegio Interlaken"
                className="inline-flex items-center gap-2 rounded-xl bg-green-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-green-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 focus-visible:ring-offset-2"
              >
                <WhatsAppIcon className="h-4 w-4" aria-hidden="true" />
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
                  <input id="contact-email" className="input-field text-base" type="email" inputMode="email" autoComplete="email" placeholder="correo@ejemplo.com" aria-invalid={!!errors.email} {...register('email')} />
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
        <div className="mx-auto w-full max-w-[1120px]">
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
                        aria-label={`Teléfono de ${d.level}, extensión ${d.ext}`}
                        className="flex items-center gap-2 text-ink/85 hover:text-green-dark"
                      >
                        <Phone size={15} className="text-green-dark" aria-hidden="true" />
                        {settings.phone_display} · Ext {d.ext}
                      </a>
                    </li>
                    <li>
                      <a
                        href={`mailto:${d.email}`}
                        aria-label={`Correo de ${d.level}`}
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
        <div className="mx-auto w-full max-w-[1120px]">
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
