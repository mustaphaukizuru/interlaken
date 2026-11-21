import { CheckCircle2, Circle, CircleSlash, Clock, Package, XCircle, type LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';
import type { DocStatus } from '@/hooks/queries/requiredDocs';
import { STATUS_LABEL, STATUS_TONE, type StatusTone } from '@/lib/requiredDocs';

const ICON: Record<DocStatus, LucideIcon> = {
  aprobado: CheckCircle2,
  entregado_fisico: Package,
  no_aplica: CircleSlash,
  en_revision: Clock,
  rechazado: XCircle,
  falta: Circle,
};

// Brand tokens (Badge's palette); the icon and the words carry the meaning, never the colour alone.
const TONE: Record<StatusTone, string> = {
  success: 'bg-green-50 text-green-700 ring-green-600/20',
  info: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  warning: 'bg-amber/10 text-amber ring-amber/30',
  error: 'bg-coral-50 text-coral-700 ring-coral-600/20',
  neutral: 'bg-cream text-muted ring-subtle/25',
};

/**
 * Status of one required document: icon + words in a tinted pill. The staff
 * checklist uses the default words; the family page passes its CMS copy.
 */
export function DocStatusChip({ status, label, className }: { status: DocStatus; label?: string; className?: string }) {
  const Icon = ICON[status];
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset',
        TONE[STATUS_TONE[status]],
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label || STATUS_LABEL[status]}
    </span>
  );
}

export default DocStatusChip;
