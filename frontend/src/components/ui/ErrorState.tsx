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
  description = 'Ocurrió un problema al conectar con el servidor. Intente de nuevo.',
  onRetry,
}: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-coral-50">
        <AlertTriangle className="h-6 w-6 text-coral-600" />
      </div>
      <h3 className="mb-1 font-semibold text-ink">{title}</h3>
      <p className="mb-4 max-w-xs text-sm text-muted">{description}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" /> Reintentar
        </Button>
      )}
    </div>
  );
}

export default ErrorState;
