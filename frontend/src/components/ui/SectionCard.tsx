import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, type LucideIcon } from 'lucide-react';

interface SectionCardProps {
  title: string;
  /** Optional "see all" link shown at the right of the header. */
  action?: { to: string; label: string };
  children: ReactNode;
  className?: string;
}

/**
 * Dashboard list-card: a titled panel (optional header link) wrapping a body of
 * list rows or a <SectionEmpty>. Consolidates the repeated
 * `card !p-0` + header + divider pattern used across the dashboards so they stay
 * consistent. Pass `className="h-full"` inside an equal-height grid.
 */
export function SectionCard({ title, action, children, className = '' }: SectionCardProps) {
  return (
    <div className={`card flex flex-col overflow-hidden !p-0 ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-cream px-5 py-4">
        <h2 className="font-head text-[15px] font-bold text-ink">{title}</h2>
        {action && (
          <Link
            to={action.to}
            className="flex items-center gap-1 whitespace-nowrap rounded text-[12.5px] font-semibold text-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
          >
            {action.label} <ArrowRight size={13} />
          </Link>
        )}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

/** Compact icon empty state for a SectionCard body. */
export function SectionEmpty({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-5 py-10 text-center">
      <Icon className="h-6 w-6 text-subtle" aria-hidden="true" />
      <p className="text-[13px] text-subtle">{children}</p>
    </div>
  );
}

export default SectionCard;
