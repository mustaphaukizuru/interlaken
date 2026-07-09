import { Link } from 'react-router-dom';
import { ArrowRight, FileText, Mail, ReceiptText } from 'lucide-react';
import { Seo } from '@/components/seo/Seo';
import { useSiteSettings } from '@/hooks/useSiteSettings';

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
        <img src="/assets/court-wide.webp" alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" loading="eager" />
        <div className="absolute inset-0 bg-gradient-to-r from-dark/90 via-dark/70 to-dark/45" />
        <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
          <span className="section-label-green inline-flex">Comunidad</span>
          <h1 className="mt-3 font-head text-fluid-3xl font-black tracking-[-0.02em]">
            Facturación
          </h1>
          <p className="mt-3 max-w-2xl text-[15.5px] text-white/80">
            Emitimos factura (CFDI) por colegiaturas, inscripciones y consumos
            de cafetería dentro del mes en que se realizó el pago.
          </p>
        </div>
      </section>

      <section className="bg-white py-12 sm:py-16">
        <div className="mx-auto max-w-3xl space-y-5 px-4 sm:px-6">
          <div className="rounded-xl2 border border-ink/10 bg-cream-2 p-6">
            <p className="flex items-center gap-2 font-head text-lg font-bold text-ink">
              <FileText size={19} className="text-green-dark" aria-hidden="true" />
              Datos necesarios para su factura
            </p>
            <ul className="mt-3 list-inside list-disc space-y-1.5 text-sm leading-relaxed text-ink/85">
              {REQUIRED_DATA.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl2 border border-green/30 bg-green/5 p-6">
            <p className="flex items-center gap-2 font-head text-lg font-bold text-ink">
              <Mail size={18} className="text-green-dark" aria-hidden="true" />
              Cómo solicitarla
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
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

          <div className="rounded-xl2 border border-ink/10 p-6">
            <p className="flex items-center gap-2 font-head text-lg font-bold text-ink">
              <ReceiptText size={18} className="text-purple" aria-hidden="true" />
              Historial y comprobantes
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              En el Portal de Familias puede consultar sus colegiaturas, pagos
              realizados y descargar comprobantes.
            </p>
            <Link to="/login" className="btn-outline mt-4">
              Ir al Portal <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
