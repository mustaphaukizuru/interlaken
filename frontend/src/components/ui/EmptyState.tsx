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
        <div className="w-12 h-12 rounded-2xl bg-cream flex items-center justify-center mb-4">
          <Icon className="w-6 h-6 text-subtle" />
        </div>
      )}
      <h3 className="font-semibold text-ink mb-1">{title}</h3>
      {description && <p className="text-sm text-muted mb-4 max-w-xs">{description}</p>}
      {action}
    </div>
  );
}
