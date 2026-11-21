import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TemplatePage } from '@/cms/TemplatePage';
import admisiones from '@/cms/sections/admisiones';
import { publicRequiredDocsQuery } from '@/hooks/queries/requiredDocsPublic';
import { trackEvent, FunnelEvent } from '@/services/analytics';

/** Admisiones: designed sections, editable in Contenido (cms/sections/admisiones.tsx). */
export default function AdmissionsPage() {
  // Admissions funnel entry point (page views also cover this; the explicit
  // event makes the funnel step unambiguous in the analytics tool).
  useEffect(() => {
    trackEvent(FunnelEvent.ViewAdmissions);
  }, []);

  // The documents card's list loads while the CMS lookup runs.
  useQuery(publicRequiredDocsQuery);
  return <TemplatePage template={admisiones.templates[0]} />;
}
