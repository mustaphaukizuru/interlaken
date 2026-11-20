/**
 * Sections shared by several public pages (group "page"). Page modules use
 * them in their templates with per-page props, e.g.
 * `{ type: 'page.hero', props: { label: 'Comunidad', title: '...', image: '/assets/facade.webp' } }`.
 */
import { PhotoHero } from '@/components/public/PhotoHero';
import { useTokens, type CmsLink } from '../runtime';
import { asLink, CmsAnchor, defineModule, f, Lines, sectionsOf } from './kit';

const section = sectionsOf('page');

const LABEL_STYLES = [
  { value: 'section-label-purple', label: 'Morado' },
  { value: 'section-label-pink', label: 'Rosa' },
  { value: 'section-label-green', label: 'Verde' },
];

interface HeroProps { label?: string; labelClass?: string; title?: string; subtitle?: string; image?: number | string; focus?: string; opacity?: number; primary?: CmsLink; secondary?: CmsLink }
function PageHeroView(p: HeroProps) {
  const t = useTokens();
  const primary = asLink(p.primary);
  const secondary = asLink(p.secondary);
  return (
    <PhotoHero
      label={t(p.label)}
      labelClass={p.labelClass || 'section-label-purple'}
      title={<Lines text={t(p.title)} />}
      subtitle={p.subtitle ? t(p.subtitle) : undefined}
      image={p.image ?? ''}
      focus={p.focus || 'center'}
      opacity={typeof p.opacity === 'number' ? p.opacity : 0.35}
    >
      {(primary.href || secondary.href) && (
        <div className="mt-7 flex flex-wrap gap-3">
          <CmsAnchor link={primary} className="btn-pink min-h-[44px]" />
          <CmsAnchor link={secondary} className="btn-ghost min-h-[44px]" />
        </div>
      )}
    </PhotoHero>
  );
}

export const sections = [
  section({
    type: 'hero', label: 'Portada con foto', description: 'Foto del campus con velo oscuro, etiqueta, título y subtítulo.',
    component: PageHeroView,
    fields: [
      f.text('label', 'Etiqueta superior'),
      f.select('labelClass', 'Color de la etiqueta', LABEL_STYLES),
      f.textarea('title', 'Título', { required: true, hint: 'Un salto de línea aquí es un salto de línea en el título. Puede usar {{anios}} y {{ciclo}}.' }),
      f.textarea('subtitle', 'Subtítulo'),
      f.image('image', 'Foto'),
      f.text('focus', 'Encuadre de la foto', { hint: 'Ej.: center 40% (horizontal vertical).' }),
      f.number('opacity', 'Visibilidad de la foto (0 a 1)'),
      f.link('primary', 'Botón principal (opcional)'),
      f.link('secondary', 'Botón secundario (opcional)'),
    ],
    defaults: { label: '', labelClass: 'section-label-purple', title: '', subtitle: '', image: '/assets/facade.webp', focus: 'center', opacity: 0.35, primary: { label: '', href: '' }, secondary: { label: '', href: '' } },
  }),
];

export const templates = [];
export default defineModule(sections, templates);
