import { Link } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * A console detail page for a record that does not exist (deleted, or a
 * wrong id in the address): say so and lead back to the list, instead of
 * «No pudimos conectar con el servidor» and a «Reintentar» that cannot help
 * (QA 2026-11-24).
 */
export function RecordNotFound({ backTo, backLabel }: { backTo?: string; backLabel?: string }) {
  return (
    <EmptyState
      icon={SearchX}
      title="No encontramos este registro"
      description="Puede que se haya eliminado o que el enlace esté incompleto."
      action={backTo && backLabel ? <Link to={backTo} className="btn-secondary min-h-[44px]">{backLabel}</Link> : undefined}
    />
  );
}

export default RecordNotFound;
