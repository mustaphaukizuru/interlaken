import { CheckCircle2, Circle, CircleSlash, Clock, Package, XCircle, type LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { Badge } from '@/components/ui/Badge';
import type { DocStatus } from '@/hooks/queries/requiredDocs';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/requiredDocs';

const ICON: Record<DocStatus, LucideIcon> = {
  aprobado: CheckCircle2,
  entregado_fisico: Package,
  no_aplica: CircleSlash,
  en_revision: Clock,
  rechazado: XCircle,
  falta: Circle,
};

/**
 * Status of one required document: the status Badge (icon + words on the
 * status pair; the colour never carries the meaning alone). The staff
 * checklist uses the default words; the family page passes its CMS copy.
 */
export function DocStatusChip({ status, label, className }: { status: DocStatus; label?: string; className?: string }) {
  return (
    <Badge variant={STATUS_TONE[status]} icon={ICON[status]} className={clsx('shrink-0 whitespace-nowrap', className)}>
      {label || STATUS_LABEL[status]}
    </Badge>
  );
}

export default DocStatusChip;
