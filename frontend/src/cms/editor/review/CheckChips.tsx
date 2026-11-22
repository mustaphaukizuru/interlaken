import { AlertCircle, AlertTriangle, Clock } from 'lucide-react';
import { clsx } from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { shortDateTime } from '../shell/status';
import { daysSince, STALE_DRAFT_DAYS } from './format';
import type { PageCheckSummary } from './types';

const TONES = {
  error: 'bg-coral-50 text-coral-700 ring-coral-600/20',
  warning: 'bg-amber/10 text-ink ring-amber/40',
} as const;

function Chip({ tone, icon: Icon, children, title }: { tone: keyof typeof TONES; icon: LucideIcon; children: string; title?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', TONES[tone])} title={title}>
      <Icon size={13} aria-hidden="true" className={tone === 'warning' ? 'text-amber' : undefined} />
      {children}
    </span>
  );
}

/**
 * «Revisión antes de publicar» in the «Contenido» list: «En el sitio: enlace
 * privado» (what families see has an error), «Bloqueado: enlace privado» (the
 * draft cannot be published), «Revisar: 2 advertencias», and edits forgotten
 * for days. «Cambios sin publicar» itself is the page's state chip.
 */
export function CheckChips({ summary, now }: { summary?: PageCheckSummary; now: number }) {
  if (!summary) return null;
  const { live, draft } = summary;
  const draftPending = summary.has_unpublished_changes || !live;
  const chips = [];
  if (live && live.errors > 0 && live.first_error) {
    chips.push(<Chip key="live" tone="error" icon={AlertCircle} title="Lo que el sitio muestra hoy tiene un problema: ábrala y use «Revisar».">{`En el sitio: ${live.first_error.label}`}</Chip>);
  }
  if (draftPending && draft) {
    if (draft.errors > 0 && draft.first_error) {
      chips.push(<Chip key="draft" tone="error" icon={AlertCircle} title="El borrador no se puede publicar hasta corregirlo.">{`Bloqueado: ${draft.first_error.label}`}</Chip>);
    } else if (draft.warnings > 0) {
      chips.push(<Chip key="warn" tone="warning" icon={AlertTriangle}>{`Revisar: ${draft.warnings} ${draft.warnings === 1 ? 'advertencia' : 'advertencias'}`}</Chip>);
    }
  }
  if (summary.has_unpublished_changes && live && summary.unpublished_since && daysSince(summary.unpublished_since, now) >= STALE_DRAFT_DAYS) {
    chips.push(<Chip key="age" tone="warning" icon={Clock}>{`Sin publicar desde el ${shortDateTime(summary.unpublished_since)}`}</Chip>);
  }
  return chips.length ? <>{chips}</> : null;
}
