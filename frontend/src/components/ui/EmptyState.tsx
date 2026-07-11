import { type LucideIcon } from 'lucide-react';

interface Props {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {Icon && (
        <div className="relative mb-5 grid place-items-center">
          {/* Soft brand-tinted glow so the state reads as an illustration, not a
              blank. Purely decorative; static (reduced-motion safe). */}
          <span
            aria-hidden="true"
            className="absolute h-16 w-16 rounded-full bg-gradient-to-br from-purple/15 to-pink/10 blur-lg"
          />
          <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-cream ring-1 ring-line dark:bg-white/5 dark:ring-white/10">
            <Icon className="h-6 w-6 text-purple/80 dark:text-white/70" />
          </span>
        </div>
      )}
      <h3 className="font-semibold text-ink dark:text-white mb-1">{title}</h3>
      {description && <p className="text-sm text-muted dark:text-white/60 mb-4 max-w-xs">{description}</p>}
      {action}
    </div>
  );
}
