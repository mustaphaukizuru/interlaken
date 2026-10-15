import { ArrowUpRight, Info, Mail, ReceiptText } from 'lucide-react';
import { Seo } from '@/components/seo/Seo';
import { FacturacionForm } from '@/components/public/FacturacionForm';
import { Section } from '@/components/ui/Section';
import { Reveal } from '@/components/ui/Reveal';

/**
 * Comunidad → Facturación (bitácora 13/10/2026, ref. 8): mismos avisos y campos
 * que el formulario oficial del colegio (interlaken.com.mx/index-7.html).
 */
const NOTICES = [
  'Solo se emiten facturas del mes en curso. No es posible cancelar ni cambiar facturas fuera del mes en que se realizó el pago.',
  'Una vez que recibamos su solicitud, recibirá sus facturas todos los meses, 24 horas hábiles después de realizar sus pagos.',
  'Capture sus datos tal como vienen en su constancia de situación fiscal: un dato erróneo hace que el SAT rechace la factura y no nos permite emitirla.',
];

const BILLING_EMAIL = 'facturas@interlaken.com.mx';
const PAYMENTS_PORTAL = 'https://interlaken.servoescolar.mx/';
export default function FacturacionPage() {
  return (
    <div>
      <Seo
        title="Facturación"
        description="Solicite sus facturas (CFDI) del Colegio Interlaken: datos fiscales requeridos y avisos importantes."
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
          <span className="section-label-green inline-flex">Pagos</span>
          <h1 className="mt-3 font-head text-fluid-4xl font-black tracking-[-0.03em]">
            Facturación
          </h1>
          <p className="mt-3 max-w-2xl text-[15.5px] leading-relaxed text-white/75 sm:text-base">
            Solicite sus facturas (CFDI) una sola vez: a partir de entonces las
            recibirá cada mes, después de realizar sus pagos.
          </p>
        </div>
      </section>

      <Section bg="white" containerSize="md">
        <div className="space-y-5">
          <Reveal>
            <div className="rounded-xl2 border border-ink/10 bg-cream-2 p-6 sm:p-7">
              <p className="flex items-center gap-2.5 font-head text-lg font-bold text-ink sm:text-xl">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-coral/10 text-coral-700">
                  <Info size={19} aria-hidden="true" />
                </span>
                Antes de solicitar
              </p>
              <ul className="mt-4 list-inside list-disc space-y-2 text-sm leading-relaxed text-ink/85">
                {NOTICES.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          </Reveal>

          <Reveal delay={70}>
            <div className="rounded-xl2 border border-green/30 bg-green/5 p-6 sm:p-7">
              <h2 className="flex items-center gap-2.5 font-head text-lg font-bold text-ink sm:text-xl">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-green/15 text-green-dark">
                  <Mail size={18} aria-hidden="true" />
                </span>
                Solicitud de facturación
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted sm:text-[15px]">
                Su solicitud llega a{' '}
                <a href={`mailto:${BILLING_EMAIL}`} className="font-medium text-green-dark underline">{BILLING_EMAIL}</a>.
              </p>
              <div className="mt-5">
                <FacturacionForm billingEmail={BILLING_EMAIL} />
              </div>
            </div>
          </Reveal>

          <Reveal delay={140}>
            <div className="rounded-xl2 border border-ink/10 bg-white p-6 sm:p-7">
              <p className="flex items-center gap-2.5 font-head text-lg font-bold text-ink sm:text-xl">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple/10 text-purple">
                  <ReceiptText size={18} aria-hidden="true" />
                </span>
                Descargar sus facturas
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted sm:text-[15px]">
                Si desea descargar sus facturas, puede consultarlas desde nuestro portal de pagos.
              </p>
              <a href={PAYMENTS_PORTAL} target="_blank" rel="noopener noreferrer" className="btn-outline mt-5">
                Ir al portal de pagos <ArrowUpRight size={15} aria-hidden="true" />
                <span className="sr-only"> (interlaken.servoescolar.mx, se abre en otra pestaña)</span>
              </a>
            </div>
          </Reveal>
        </div>
      </Section>
    </div>
  );
}
