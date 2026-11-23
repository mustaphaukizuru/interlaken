import { clsx } from 'clsx';
import { AlertCircle, AlertTriangle, CheckCircle2, CircleDot, Info, type LucideIcon } from 'lucide-react';

type Variant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

/**
 * Status badge (D4, 2026-11-21): a status or a count the person needs, never
 * decoration. Always text plus an icon, so meaning never rests on colour
 * alone; at most one per row or card. The pill shape (rounded-full) is
 * reserved for badges. Colours are the status pairs in index.css (AA on
 * their own tint). Badge icons are 14 px: the one optical exception to the
 * 16/20/24 scale, matched to the 12 px label.
 */
const variants: Record<Variant, { cls: string; icon: LucideIcon }> = {
  success: { cls: 'bg-success-bg text-success', icon: CheckCircle2 },
  warning: { cls: 'bg-warning-bg text-warning', icon: AlertTriangle },
  error:   { cls: 'bg-danger-bg text-danger', icon: AlertCircle },
  info:    { cls: 'bg-info-bg text-info', icon: Info },
  neutral: { cls: 'bg-cream text-muted', icon: CircleDot },
};

interface BadgeProps {
  variant?: Variant;
  /** Replaces the variant's default icon (still decorative: the text carries the meaning). */
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = 'neutral', icon, children, className }: BadgeProps) {
  const { cls, icon: DefaultIcon } = variants[variant];
  const Icon = icon ?? DefaultIcon;
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
      cls,
      className,
    )}>
      <Icon size={14} strokeWidth={2.25} aria-hidden="true" className="flex-shrink-0" />
      {children}
    </span>
  );
}
