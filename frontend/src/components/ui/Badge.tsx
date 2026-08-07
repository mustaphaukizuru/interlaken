import { clsx } from 'clsx';

type Variant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

// Semantic states mapped to Interlaken brand tokens (no raw Tailwind palette):
// success→green · warning→amber · error→coral · info→brand(purple) · neutral→cream/muted.
const variants: Record<Variant, string> = {
  success: 'bg-green-50 text-green-700 ring-green-600/20',
  warning: 'bg-amber/10 text-amber ring-amber/30',
  error:   'bg-coral-50 text-coral-700 ring-coral-600/20',
  info:    'bg-brand-50 text-brand-700 ring-brand-600/20',
  neutral: 'bg-cream text-muted ring-subtle/25',
};

interface BadgeProps {
  variant?: Variant;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = 'neutral', children, className }: BadgeProps) {
  return (
    <span className={clsx(
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
      variants[variant],
      className,
    )}>
      {children}
    </span>
  );
}
