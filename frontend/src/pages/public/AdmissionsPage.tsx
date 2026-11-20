import { useEffect } from 'react';
import { TemplatePage } from '@/cms/TemplatePage';
import admisiones from '@/cms/sections/admisiones';
import { trackEvent, FunnelEvent } from '@/services/analytics';

/** Admisiones: designed sections, editable in Contenido (cms/sections/admisiones.tsx). */
export default function AdmissionsPage() {
  // Admissions funnel entry point (page views also cover this; the explicit
  // event makes the funnel step unambiguous in the analytics tool).
  useEffect(() => {
    trackEvent(FunnelEvent.ViewAdmissions);
  }, []);

  return <TemplatePage template={admisiones.templates[0]} />;
}
