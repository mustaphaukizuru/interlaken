import { Link } from 'react-router-dom';
import { Coffee, CreditCard, Info } from 'lucide-react';
import { Seo } from '@/components/seo/Seo';
import { Section } from '@/components/ui/Section';
import { Reveal } from '@/components/ui/Reveal';
import { PlatformCard, type Platform } from '@/components/public/PlatformCard';
import { assetSrcSet } from '@/lib/images';

/**
 * Pagos → Colegiaturas y cafetería (bitácora 13/10/2026, ref. 6 y 7): los dos
 * accesos de pago para familias. Reemplaza a la antigua /comunidad/plataformas,
 * que redirige aquí; las plataformas del aula viven ahora en /plataformas.
 */
const PAYMENT_PLATFORMS: Platform[] = [
  {
    name: 'Colegiaturas y boletas',
    desc: 'Pague con tarjeta, sin filas en el banco, y consulte las boletas de calificaciones de sus hijos.',
    href: 'https://interlaken.servoescolar.mx/',
    icon: CreditCard,
    cta: 'Ir a colegiaturas y boletas',
  },
  {
    name: 'Cafetería',
    desc: 'Consulte el saldo de cafetería de sus hijos y haga recargas en línea.',
    href: '/login',
    icon: Coffee,
    cta: 'Entrar a Cafetería',
  },
];

export default function PagosPage() {
  return (
    <div>
      <Seo
        title="Colegiaturas y cafetería"
        description="Pagos del Colegio Interlaken: colegiaturas y boletas en línea, y saldo y recargas de cafetería."
      />

      <section className="relative overflow-hidden bg-dark text-white">
        <img
          src="/assets/campus-mural.webp"
          srcSet={assetSrcSet('/assets/campus-mural.webp', { full: true })}
          sizes="100vw"
          alt=""
          width={1600}
          height={900}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover opacity-30"
          loading="eager"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-dark/92 via-dark/75 to-dark/45" />
        <div className="relative mx-auto max-w-[1120px] px-4 py-14 sm:px-6 sm:py-16 lg:py-[72px]">
          <span className="section-label-purple inline-flex">Pagos</span>
          <h1 className="mt-3 font-head text-fluid-4xl font-black tracking-[-0.03em]">
            Colegiaturas y cafetería
          </h1>
          <p className="mt-3 max-w-2xl text-[15.5px] leading-relaxed text-white/75 sm:text-base">
            Los pagos de su familia, en línea y sin filas.
          </p>
        </div>
      </section>

      <Section bg="cream">
        <Reveal className="mb-8">
          <span className="section-label-green inline-flex">Familias</span>
          <h2 className="mt-2 font-head text-fluid-3xl font-extrabold tracking-[-0.02em] text-ink">
            Para familias
          </h2>
        </Reveal>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {PAYMENT_PLATFORMS.map((p, i) => (
            <Reveal key={p.name} delay={i * 80}>
              <PlatformCard p={p} />
            </Reveal>
          ))}
        </div>

        <Reveal delay={120} className="mt-8">
          <div className="flex items-start gap-3 rounded-xl2 border border-ink/10 bg-white p-5 text-sm text-muted">
            <Info size={18} className="mt-0.5 flex-shrink-0 text-purple" aria-hidden="true" />
            <p>
              ¿Necesita factura de un pago? Solicítela en{' '}
              <Link to="/comunidad/facturacion" className="font-medium text-green-dark underline">Facturación</Link>.
            </p>
          </div>
        </Reveal>
      </Section>
    </div>
  );
}
