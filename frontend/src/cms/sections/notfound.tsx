/**
 * Página no encontrada (404): designed section (docs/CMS-COMPLETION-PLAN.md).
 * Rendered inside PublicLayout by the catch-all route (CmsOrNotFound).
 *
 * Media round (owner 2026-11-22): the message sits beside the «perdido»
 * illustration (a paper plane looping around a question mark).
 */
import { ArrowLeft, Home } from 'lucide-react';
import { IllustrationPanel } from '@/components/ui/Illustration';
import { isIllustration, type IllustrationName } from '@/lib/illustrations';
import { useTokens, type CmsLink } from '../runtime';
import { asLink, CmsAnchor, defineModule, f, Lines, sectionsOf } from './kit';

const section = sectionsOf('notfound');

/** «none» hides the art; nothing chosen (content saved before the field existed) shows the lost paper plane. */
const artOf = (chosen: unknown): IllustrationName | undefined =>
  chosen === 'none' ? undefined : isIllustration(chosen) ? chosen : 'perdido';

interface MessageProps { code?: string; title?: string; text?: string; primary?: CmsLink; secondary?: CmsLink; illustration?: string }
function NotFoundMessageView(p: MessageProps) {
  const t = useTokens();
  const primary = asLink(p.primary);
  const secondary = asLink(p.secondary);
  const art = artOf(p.illustration);
  return (
    <section className="bg-cream-2 px-4 py-12 sm:px-6 sm:py-20">
      <div className={`mx-auto grid items-center gap-8 ${art ? 'max-w-5xl md:grid-cols-2 md:gap-12' : 'max-w-xl'}`}>
        {art && (
          <div className="w-full max-w-[300px] justify-self-center md:order-2 md:max-w-none">
            <IllustrationPanel name={art} tint="var(--purple)" priority />
          </div>
        )}
        <div className={`flex flex-col items-center text-center ${art ? 'md:items-start md:text-left' : ''}`}>
          {p.code && (
            <p className="font-head text-fluid-3xl font-extrabold leading-none text-green" aria-hidden="true">
              {t(p.code)}
            </p>
          )}
          <h1 className="mt-4 font-head text-fluid-2xl font-bold text-ink">
            <Lines text={t(p.title)} />
          </h1>
          {p.text && (
            <p className="mt-3 max-w-md text-base leading-relaxed text-muted">
              {t(p.text)}
            </p>
          )}
          {(primary.href || secondary.href) && (
            <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <CmsAnchor link={primary} className="btn-pink justify-center">
                <Home size={16} aria-hidden="true" /> {t(primary.label)}
              </CmsAnchor>
              <CmsAnchor link={secondary} className="btn-outline justify-center">
                <ArrowLeft size={16} aria-hidden="true" /> {t(secondary.label)}
              </CmsAnchor>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export const sections = [
  section({
    type: 'message', label: 'Página no encontrada · Mensaje', description: 'Mensaje que ve quien abre una dirección que no existe, con dos botones y una ilustración.',
    component: NotFoundMessageView,
    fields: [
      f.text('code', 'Número grande'),
      f.textarea('title', 'Título', { required: true }),
      f.textarea('text', 'Texto'),
      f.link('primary', 'Botón principal'),
      f.link('secondary', 'Botón secundario'),
      f.illustration('illustration', 'Ilustración', { hint: 'Junto al mensaje. Sin elegir, el avión de papel perdido.' }),
    ],
    defaults: {
      code: '404',
      title: 'Página no encontrada',
      text: 'La dirección que escribió no existe o fue movida. Verifique el enlace o regrese al inicio.',
      primary: { label: 'Ir al inicio', href: '/' },
      secondary: { label: 'Contactar al colegio', href: '/contacto' },
      illustration: 'perdido',
    },
  }),
];

export const templates = [{
  slug: 'no-encontrada', path: '/no-encontrada', title: 'Página no encontrada', group: 'notfound',
  seo: { title: 'Página no encontrada', description: 'La página que busca no existe o fue movida.', noindex: true },
  sections: ['notfound.message'],
}];

export default defineModule(sections, templates);
