import { Navigate, useParams } from 'react-router-dom';
import { TemplatePage } from '@/cms/TemplatePage';
import nivel from '@/cms/sections/nivel';

/**
 * Niveles: one template per level (cms/sections/nivel.tsx), editable in
 * Contenido. An unknown level still redirects to Preescolar.
 */
export default function NivelPage() {
  const { nivel: slug } = useParams();
  const template = nivel.templates.find((t) => t.slug === slug);
  if (!template) return <Navigate to="/niveles/preescolar" replace />;
  return <TemplatePage key={template.slug} template={template} />;
}
