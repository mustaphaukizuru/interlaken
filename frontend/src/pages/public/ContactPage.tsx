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
      <section style={{ position: 'relative', background: '#080516', color: '#fff', overflow: 'hidden' }}>
        <Blob tone="pink" opacity={0.4} size={460} shape={1} style={{ top: -150, left: -110 }} />
        <Blob tone="purple" opacity={0.4} size={420} shape={0} style={{ bottom: -150, right: -110 }} />
        <div style={{ position: 'relative', maxWidth: 1120, margin: '0 auto', padding: '64px 24px' }}>
          <span className="section-label-pink" style={{ display: 'inline-flex' }}>Estamos para ayudarte</span>
          <h1 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 900, fontSize: 'clamp(34px, 5.5vw, 52px)', letterSpacing: -1.4, lineHeight: 1.08, marginTop: 12 }}>
            Contacto
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.64)', fontSize: 17, marginTop: 16, maxWidth: 520, lineHeight: 1.7 }}>
            Resolvemos tus dudas sobre admisiones, costos y nuestro modelo educativo. Escríbenos y te contactaremos pronto.
          </p>
        </div>
      </section>

      {/* ── SPLIT: info + form ── */}
      <Section bg="white">
        <div style={{ display: 'grid', gap: 40, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'start' }}>
          {/* Contact info + map */}
          <Reveal direction="right">
            <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 24, color: '#1A1130', letterSpacing: -0.5 }}>Información de contacto</h2>
            <div style={{ marginTop: 24, display: 'grid', gap: 18 }}>
              {INFO.map(({ icon: Icon, label, value, href }) => {
                const inner = (
                  <>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(64,26,142,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon className="w-5 h-5" style={{ color: '#401a8e' }} />
                    </div>
                    <div>
                      <p style={{ fontSize: 12, color: '#9A93AE', marginBottom: 2 }}>{label}</p>
                      <p style={{ fontSize: 14.5, fontWeight: 600, color: '#1A1130' }}>{value}</p>
                    </div>
                  </>
                );
                return href ? (
                  <a
                    key={label}
                    href={href}
                    {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    className="group"
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}
                  >
                    {inner}
                  </a>
                ) : (
                  <div key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>{inner}</div>
                );
              })}
            </div>

            {/* Map placeholder */}
            <a
              href="https://maps.google.com/?q=Tlalnepantla+de+Baz"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Abrir ubicación en Google Maps"
              style={{ position: 'relative', display: 'block', marginTop: 26, borderRadius: 18, overflow: 'hidden', height: 220, border: '1px solid #ECEAF3', background: 'linear-gradient(135deg, #ede8f7 0%, #e3f6f7 100%)' }}
            >
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#401a8e' }}>
                <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 24px -10px rgba(64,26,142,0.4)' }}>
                  <MapPin className="w-6 h-6" />
                </div>
                <span style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 14 }}>Tlalnepantla de Baz, Edo. de México</span>
                <span style={{ fontSize: 12.5, color: '#6E6885' }}>Ver ubicación en Google Maps</span>
              </div>
            </a>

            <div style={{ marginTop: 22 }}>
              <a
                href="https://wa.me/5215512345678?text=Hola%2C%20me%20gustar%C3%ADa%20obtener%20m%C3%A1s%20informaci%C3%B3n"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-green-500 text-white px-5 py-2.5 rounded-xl font-medium text-sm hover:bg-green-600 transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" xmlns="http://www.w3.org/2000/svg">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
                Escribir por WhatsApp
              </a>
            </div>
          </Reveal>

          {/* Contact form */}
          <Reveal direction="left">
            <div className="card">
              <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 22, color: '#1A1130', letterSpacing: -0.5, marginBottom: 18 }}>Envíanos un mensaje</h2>
              <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
                <div>
                  <label className="label" htmlFor="contact-name">Nombre</label>
                  <input id="contact-name" className="input-field" placeholder="Su nombre completo" aria-invalid={!!errors.name} {...register('name')} />
                  {errors.name && <p className="mt-1.5 text-xs text-red-600">{errors.name.message}</p>}
                </div>
                <div>
                  <label className="label" htmlFor="contact-email">Correo electrónico</label>
                  <input id="contact-email" className="input-field" type="email" placeholder="correo@ejemplo.com" aria-invalid={!!errors.email} {...register('email')} />
                  {errors.email && <p className="mt-1.5 text-xs text-red-600">{errors.email.message}</p>}
                </div>
                <div>
                  <label className="label" htmlFor="contact-subject">Asunto</label>
                  <input id="contact-subject" className="input-field" placeholder="¿En qué le podemos ayudar?" aria-invalid={!!errors.subject} {...register('subject')} />
                  {errors.subject && <p className="mt-1.5 text-xs text-red-600">{errors.subject.message}</p>}
                </div>
                <div>
                  <label className="label" htmlFor="contact-message">Mensaje</label>
                  <textarea
                    id="contact-message"
                    className="input-field min-h-[120px] resize-none"
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
