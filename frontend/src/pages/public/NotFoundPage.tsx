import { TemplatePage } from '@/cms/TemplatePage';
import notfound from '@/cms/sections/notfound';

/**
 * 404 — replaces the old silent redirect-to-home so users (and crawlers)
 * get honest feedback on a bad URL. Rendered inside PublicLayout; the
 * message is editable in Contenido (cms/sections/notfound.tsx).
 */
export default function NotFoundPage() {
  return <TemplatePage template={notfound.templates[0]} />;
}
