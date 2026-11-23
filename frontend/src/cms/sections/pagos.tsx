/**
 * Pagos (/pagos): designed sections (docs/CMS-COMPLETION-PLAN.md). Colegiaturas
 * y cafetería (bitácora 13/10/2026, ref. 6 y 7): the two payment accesses for
 * families. Views shared with Plataformas live in ./plataformas.parts.
 */
import { defineModule, sectionsOf } from './kit';
import { heroFields, PlatformsHeroView, platformsFields, PlatformsView } from './plataformas.parts';

const section = sectionsOf('pagos');

export const sections = [
  section({
    type: 'hero', label: 'Pagos · Portada', description: 'Foto del campus con velo oscuro, etiqueta, título y texto.',
    component: PlatformsHeroView,
    fields: heroFields,
    defaults: { label: 'Pagos', title: 'Colegiaturas y cafetería', subtitle: 'Los pagos de su familia, en línea y sin filas.', image: '/assets/campus-mural.webp' },
  }),
  section({
    type: 'platforms', label: 'Pagos · Accesos de pago', description: 'Tarjetas con los accesos de pago para familias y una nota final.',
    component: PlatformsView,
    fields: platformsFields,
    defaults: {
      bg: 'cream', labelClass: 'section-label-green', eyebrow: 'Familias', title: 'Para familias', text: '', columns: '2',
      items: [
        { name: 'Colegiaturas y boletas', text: 'Pague con tarjeta, sin filas en el banco, y consulte las boletas de calificaciones de sus hijos.', href: 'https://interlaken.servoescolar.mx/', icon: 'CreditCard', cta: 'Ir a colegiaturas y boletas', illustration: 'pagos' },
        { name: 'Cafetería', text: 'Consulte el saldo de cafetería de sus hijos y haga recargas en línea.', href: '/login', icon: 'Coffee', cta: 'Entrar a Cafetería', illustration: 'cafeteria' },
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
