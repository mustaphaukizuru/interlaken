import { type LucideIcon } from 'lucide-react';

interface Props {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

/** Empty state: why there is nothing here, and at most one action. Light theme only. */
export function EmptyState({ icon: Icon, title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {Icon && (
        <div className="mb-5 grid place-items-center">
          {/* A flat tinted tile (no glow): the one place 32 px icons are used. */}
          <span className="flex h-14 w-14 items-center justify-center rounded-md bg-purple-light">
            <Icon size={32} className="text-purple" aria-hidden="true" />
          </span>
        </div>
      )}
      <h3 className="mb-1 font-semibold text-ink">{title}</h3>
      {description && <p className="mb-4 max-w-xs text-sm text-muted">{description}</p>}
      {action}
    </div>
  );
}
