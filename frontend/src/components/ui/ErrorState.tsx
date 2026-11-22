import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './Button';

interface Props {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

/**
 * Designed error state for data views. Says what happened in es-MX and offers
 * a retry affordance. Mirrors EmptyState so list screens read consistently.
 */
export function ErrorState({
  title = 'No se pudo cargar la información',
  description = 'No pudimos conectar con el servidor. Intente de nuevo.',
  onRetry,
}: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-danger-bg">
        <AlertTriangle size={24} className="text-danger" aria-hidden="true" />
      </div>
      <p className="mb-1 font-semibold text-ink">{title}</p>
      <p className="mb-4 max-w-xs text-sm text-muted">{description}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw size={16} aria-hidden="true" /> Reintentar
        </Button>
      )}
    </div>
  );
}

export default ErrorState;
