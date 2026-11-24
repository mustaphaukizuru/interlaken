/**
 * Pagos (/pagos): designed sections (docs/CMS-COMPLETION-PLAN.md). Colegiaturas
 * y cafetería (bitácora 13/10/2026, ref. 6 y 7): the two payment accesses for
 * families. Views shared with Plataformas live in ./plataformas.parts.
 */
import type { ComponentProps } from 'react';
import { useAuthStore } from '@/store/authStore';
import { defineModule, sectionsOf } from './kit';
import { heroFields, PlatformsHeroView, platformsFields, PlatformsView } from './plataformas.parts';

const section = sectionsOf('pagos');

/** The payment cards; for a signed-in family the «Portal Cafetería» card (/login) opens its cafetería directly. */
function PagosPlatformsView(p: ComponentProps<typeof PlatformsView>) {
  const cafeHref = useAuthStore((s) => (s.isAuthenticated && (s.user?.role === 'parent' || s.user?.role === 'student') ? '/portal/cafeteria' : ''));
  const items = cafeHref && Array.isArray(p.items)
    ? (p.items as { href?: string }[]).map((it) => (it?.href === '/login' ? { ...it, href: cafeHref } : it))
    : p.items;
  return <PlatformsView {...p} items={items as typeof p.items} />;
}

export const sections = [
  section({
    type: 'hero', label: 'Pagos · Portada', description: 'Foto del campus con velo oscuro, etiqueta, título y texto.',
    component: PlatformsHeroView,
    fields: heroFields,
    defaults: { label: 'Pagos', title: 'Colegiaturas y cafetería', subtitle: 'Los pagos de su familia, en línea y sin filas.', image: '/assets/campus-mural.webp' },
  }),
  section({
    type: 'platforms', label: 'Pagos · Accesos de pago', description: 'Tarjetas con los accesos de pago para familias y una nota final.',
    component: PagosPlatformsView,
    fields: platformsFields,
    defaults: {
      bg: 'cream', labelClass: 'section-label-green', eyebrow: 'Familias', title: 'Para familias', text: '', columns: '2',
      items: [
        { name: 'Colegiaturas y boletas', text: 'Pague con tarjeta, sin filas en el banco, y consulte las boletas de calificaciones de sus hijos.', href: 'https://interlaken.servoescolar.mx/', icon: 'CreditCard', cta: 'Ir a colegiaturas y boletas', illustration: 'pagos' },
        // Header version 3 (2026-11-23): the same name as the header button.
        { name: 'Portal Cafetería', text: 'Consulte el saldo de cafetería de sus hijos y haga recargas en línea.', href: '/login', icon: 'Coffee', cta: 'Entrar al Portal Cafetería', illustration: 'cafeteria' },
      ],
      note: '¿Necesita factura de un pago? Solicítela en [Facturación](/comunidad/facturacion).',
    },
  }),
];

export const templates = [{
  slug: 'pagos', path: '/pagos', title: 'Colegiaturas y cafetería', group: 'pagos',
  seo: {}, // title and description: lib/routeMeta.ts ROUTE_META
  sections: ['pagos.hero', 'pagos.platforms'],
}];

export default defineModule(sections, templates);
