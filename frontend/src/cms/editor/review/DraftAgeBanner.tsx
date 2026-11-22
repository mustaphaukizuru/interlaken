import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { shortDateTime } from '../shell/status';
import { daysSince } from './format';

/**
 * «Este borrador tiene cambios sin publicar desde …»: edits forgotten for days
 * are how the «costos» slips of 2026-11-21 sat unnoticed.
 */
export function DraftAgeBanner({ since, canPublish, onReview, now }: { since: string; canPublish: boolean; onReview: () => void; now?: number }) {
  const days = daysSince(since, now);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-amber/40 bg-amber/[0.08] p-3 text-sm md:flex-row md:items-center md:justify-between" role="status">
      <p className="flex items-start gap-2 text-ink">
        <Clock size={17} className="mt-0.5 shrink-0 text-amber" aria-hidden="true" />
        <span>
          <strong>Este borrador tiene cambios sin publicar desde el {shortDateTime(since)}</strong> (hace {days} días).
          {' '}{canPublish ? 'Revíselos y publíquelos, o descártelos si ya no se necesitan.' : 'Revíselos y pida la aprobación de Dirección.'}
        </span>
      </p>
      <Button variant="secondary" size="md" onClick={onReview} className="shrink-0">Revisar los cambios</Button>
    </div>
  );
}
