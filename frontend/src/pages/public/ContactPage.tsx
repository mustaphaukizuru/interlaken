import { TemplatePage } from '@/cms/TemplatePage';
import contacto from '@/cms/sections/contacto';

/** Contacto: designed sections, editable in Contenido (cms/sections/contacto.tsx). */
export default function ContactPage() {
  return <TemplatePage template={contacto.templates[0]} />;
}
