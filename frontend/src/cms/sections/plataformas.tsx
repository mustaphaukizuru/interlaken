/**
 * Plataformas (/plataformas): designed sections (docs/CMS-COMPLETION-PLAN.md).
 * El Colegio → Plataformas (bitácora 13/10/2026, ref. 6): the classroom and
 * parent platforms; payments moved to /pagos. Views shared with Pagos live in
 * ./plataformas.parts.
 */
import { defineModule, sectionsOf } from './kit';
import { heroFields, PlatformsHeroView, platformsFields, PlatformsView } from './plataformas.parts';

const section = sectionsOf('plataformas');

export const sections = [
  section({
    type: 'hero', label: 'Plataformas · Portada', description: 'Foto del campus con velo oscuro, etiqueta, título y texto.',
    component: PlatformsHeroView,
    fields: heroFields,
    defaults: { label: 'El Colegio', title: 'Plataformas', subtitle: 'Las herramientas digitales del aula y de acompañamiento a padres, en un solo lugar.', image: '/assets/campus-mural.webp' },
  }),
  section({
    type: 'platforms', label: 'Plataformas · Tarjetas', description: 'Grupo de tarjetas con acceso a cada plataforma y una nota final opcional.',
    component: PlatformsView,
    fields: platformsFields,
    defaults: {
      bg: 'white', labelClass: 'section-label-pink', eyebrow: 'Aula digital', title: 'Para alumnos y docentes',
      text: 'Classroom, correo institucional y registro de dispositivos.', columns: '3',
      items: [
        { name: 'Google Classroom', text: 'Aulas virtuales del colegio: tareas, materiales y seguimiento de cada clase.', href: 'https://classroom.google.com/', icon: 'GraduationCap', cta: 'Abrir Classroom', illustration: 'tareas' },
        { name: 'Gmail institucional', text: 'Correo electrónico oficial de alumnos y docentes (@interlaken).', href: 'https://www.gmail.com/', icon: 'Mail', cta: 'Abrir Gmail', illustration: 'mensaje' },
        { name: 'Mosyle — registro de iPad', text: 'Inscripción del iPad al sistema del colegio para usarlo en el salón de clases.', href: 'https://enroll.mosyle.com/?account=interlaken', icon: 'Tablet', cta: 'Registrar iPad', illustration: 'tecnologia' },
      ],
      note: '',
    },
  }),
];

export const templates = [{
  slug: 'plataformas', path: '/plataformas', title: 'Plataformas', group: 'plataformas',
  seo: {}, // title and description: lib/routeMeta.ts ROUTE_META
  sections: [
    'plataformas.hero',
    'plataformas.platforms',
    {
      type: 'plataformas.platforms',
      props: {
        bg: 'cream', labelClass: 'section-label-green', eyebrow: 'Familias', title: 'Para padres',
        text: 'Acompañamiento para la crianza y la vida familiar.', columns: '3',
        items: [
          { name: 'Educar es Padre', text: 'Cursos y contenidos diseñados para fortalecer la dinámica familiar y acompañar la crianza.', href: 'https://educarespadre.com/', icon: 'HeartHandshake', cta: 'Ir a Educar es Padre', illustration: 'comunidad' },
        ],
        note: '¿Necesita recuperar un acceso o una contraseña? Escríbanos por WhatsApp o al correo de su nivel; vea [Contacto](/contacto). Los pagos de colegiaturas y cafetería están en [Colegiaturas y cafetería](/pagos).',
      },
    },
  ],
}];

export default defineModule(sections, templates);
