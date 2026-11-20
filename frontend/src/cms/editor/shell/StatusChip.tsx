import { AlertTriangle, CalendarClock, CheckCircle2, Hourglass, LayoutTemplate, PencilLine, CircleDot, type LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';
import type { PageState, PageStateKey } from './status';

const ICONS: Record<PageStateKey, LucideIcon> = {
  original: LayoutTemplate,
  draft: PencilLine,
  changes: CircleDot,
  published: CheckCircle2,
  scheduled: CalendarClock,
  legacy: AlertTriangle,
};

const TONES: Record<PageState['tone'], string> = {
  success: 'bg-green-50 text-green-700 ring-green-600/20',
  warning: 'bg-amber/10 text-amber ring-amber/30',
  error: 'bg-coral-50 text-coral-700 ring-coral-600/20',
  info: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  neutral: 'bg-cream text-muted ring-subtle/25',
};

/** Page state as icon + words (never colour alone). */
export function StatusChip({ state, className }: { state: Pick<PageState, 'key' | 'label' | 'tone'>; className?: string }) {
  const Icon = ICONS[state.key];
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', TONES[state.tone], className)} data-state={state.key}>
      <Icon size={13} aria-hidden="true" />
      {state.label}
    </span>
  );
}

/** «Pendiente de aprobación»: a staff member asked Dirección to publish. */
export function ReviewChip({ className }: { className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-600/20', className)}>
      <Hourglass size={13} aria-hidden="true" />
      Pendiente de aprobación
    </span>
  );
}
