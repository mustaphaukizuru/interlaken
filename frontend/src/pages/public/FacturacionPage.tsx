import { Link } from 'react-router-dom';
import { ArrowRight, FileText, Mail, ReceiptText } from 'lucide-react';
import { Seo } from '@/components/seo/Seo';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { Section } from '@/components/ui/Section';
import { Reveal } from '@/components/ui/Reveal';

const REQUIRED_DATA = [
  'Razón social y RFC',
  'Código postal fiscal',
  'Régimen fiscal y uso de CFDI',
  'Nombre del alumno, nivel y concepto pagado',
  'Comprobante o referencia del pago',
];

/** Comunidad → Facturación: cómo solicitar factura (CFDI) de pagos al colegio. */
export default function FacturacionPage() {
  const settings = useSiteSettings();

  return (
    <div>
      <Seo
        title="Facturación"
        description="Solicite la factura (CFDI) de colegiaturas, inscripciones y cafetería del Colegio Interlaken: datos requeridos y proceso de solicitud."
      />

      <section className="relative overflow-hidden bg-dark text-white">
        <img
          src="/assets/court-wide.webp"
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-30"
          loading="eager"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-dark/92 via-dark/75 to-dark/45" />
        <div className="relative mx-auto max-w-[1120px] px-4 py-14 sm:px-6 sm:py-16 lg:py-[72px]">
          <span className="section-label-green inline-flex">Comunidad</span>
          <h1 className="mt-3 font-head text-fluid-4xl font-black tracking-[-0.03em]">
            Facturación
          </h1>
          <p className="mt-3 max-w-2xl text-[15.5px] leading-relaxed text-white/75 sm:text-base">
            Emitimos factura (CFDI) por colegiaturas, inscripciones y consumos
            de cafetería dentro del mes en que se realizó el pago.
          </p>
        </div>
      </section>

      <Section bg="white" containerSize="md">
        <div className="space-y-5">
          <Reveal>
            <div className="rounded-xl2 border border-ink/10 bg-cream-2 p-6 sm:p-7">
              <p className="flex items-center gap-2.5 font-head text-lg font-bold text-ink sm:text-xl">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-green/10 text-green-dark">
                  <FileText size={19} aria-hidden="true" />
                </span>
                Datos necesarios para su factura
              </p>
              <ul className="mt-4 list-inside list-disc space-y-2 text-sm leading-relaxed text-ink/85">
                {REQUIRED_DATA.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
          </Reveal>

          <Reveal delay={70}>
            <div className="rounded-xl2 border border-green/30 bg-green/5 p-6 sm:p-7">
              <p className="flex items-center gap-2.5 font-head text-lg font-bold text-ink sm:text-xl">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-green/15 text-green-dark">
                  <Mail size={18} aria-hidden="true" />
                </span>
                Cómo solicitarla
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted sm:text-[15px]">
                Envíe sus datos fiscales y el comprobante de pago al correo de
                administración{' '}
                <a
                  href={`mailto:${settings.contact_email}`}
                  className="font-medium text-green-dark underline"
                >
                  {settings.contact_email}
                </a>{' '}
                dentro del mismo mes del pago. Recibirá su CFDI por correo
                electrónico. Importante: las facturas solo pueden emitirse dentro
                del mes en que se efectuó el pago.
              </p>
            </div>
          </Reveal>

          <Reveal delay={140}>
            <div className="rounded-xl2 border border-ink/10 bg-white p-6 sm:p-7">
              <p className="flex items-center gap-2.5 font-head text-lg font-bold text-ink sm:text-xl">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple/10 text-purple">
                  <ReceiptText size={18} aria-hidden="true" />
                </span>
                Historial y comprobantes
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted sm:text-[15px]">
                En el Portal de Familias puede consultar sus colegiaturas, pagos
                realizados y descargar comprobantes.
              </p>
              <Link to="/login" className="btn-outline mt-5">
                Ir al Portal <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
          </Reveal>
        </div>
      </Section>
    </div>
  );
}
