/**
 * Página no encontrada (404): designed section (docs/CMS-COMPLETION-PLAN.md).
 * Rendered inside PublicLayout by the catch-all route (CmsOrNotFound).
 */
import { ArrowLeft, Home } from 'lucide-react';
import { useTokens, type CmsLink } from '../runtime';
import { asLink, CmsAnchor, defineModule, f, Lines, sectionsOf } from './kit';

const section = sectionsOf('notfound');

interface MessageProps { code?: string; title?: string; text?: string; primary?: CmsLink; secondary?: CmsLink }
function NotFoundMessageView(p: MessageProps) {
  const t = useTokens();
  const primary = asLink(p.primary);
  const secondary = asLink(p.secondary);
  return (
    <section className="bg-cream-2 px-4 py-16 sm:py-24">
      <div className="mx-auto flex max-w-xl flex-col items-center text-center">
        {p.code && (
          <p className="font-head text-fluid-3xl font-extrabold leading-none text-green" aria-hidden="true">
            {t(p.code)}
          </p>
        )}
        <h1 className="mt-4 font-head text-fluid-xl font-bold text-ink">
          <Lines text={t(p.title)} />
        </h1>
        {p.text && (
          <p className="mt-3 text-muted">
            {t(p.text)}
          </p>
        )}
        {(primary.href || secondary.href) && (
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <CmsAnchor link={primary} className="btn-pink">
              <Home size={16} aria-hidden="true" /> {t(primary.label)}
            </CmsAnchor>
            <CmsAnchor link={secondary} className="btn-outline">
              <ArrowLeft size={16} aria-hidden="true" /> {t(secondary.label)}
            </CmsAnchor>
          </div>
        )}
      </div>
    </section>
  );
}

export const sections = [
  section({
    type: 'message', label: 'Página no encontrada · Mensaje', description: 'Mensaje que ve quien abre una dirección que no existe, con dos botones.',
    component: NotFoundMessageView,
    fields: [
      f.text('code', 'Número grande'),
      f.textarea('title', 'Título', { required: true }),
      f.textarea('text', 'Texto'),
      f.link('primary', 'Botón principal'),
      f.link('secondary', 'Botón secundario'),
    ],
    defaults: {
      code: '404',
      title: 'Página no encontrada',
      text: 'La dirección que escribió no existe o fue movida. Verifique el enlace o regrese al inicio.',
      primary: { label: 'Ir al inicio', href: '/' },
      secondary: { label: 'Contactar al colegio', href: '/contacto' },
    },
  }),
];

export const templates = [{
  slug: 'no-encontrada', path: '/no-encontrada', title: 'Página no encontrada', group: 'notfound',
  seo: { title: 'Página no encontrada', description: 'La página que busca no existe o fue movida.' },
  sections: ['notfound.message'],
}];

export default defineModule(sections, templates);
