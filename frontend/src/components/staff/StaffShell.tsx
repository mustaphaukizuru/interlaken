import { PageHeader } from '@/components/layout/PageHeader';

/**
 * Staff dashboard shell + card (IK-ADMIN P2). Mobile-first, dense spacing,
 * light theme only like the rest of the app (the `dark:` variants were
 * removed in UX Phase 7). The shared PortalLayout + AppHeader stay the same
 * chrome as admin/parent (hamburger + brand «Interlaken»).
 */

export function StaffCard({ title, subtitle, children, className = '' }: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`min-w-0 rounded-md bg-white p-4 shadow-card ${className}`}
    >
      {title && (
        <h2 className="font-head text-sm font-semibold text-ink">
          {title}
        </h2>
      )}
      {subtitle && (
        <p className="mt-0.5 text-xs text-muted">{subtitle}</p>
      )}
      <div className={title || subtitle ? 'mt-3' : ''}>{children}</div>
    </section>
  );
}

export function StaffShell({ children, subtitle }: {
  children: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <div className="-mx-[clamp(16px,4vw,32px)] -my-6 min-h-[100dvh] bg-cream px-[clamp(16px,4vw,32px)] pb-8 pt-6">
      {/* Title lives in content (like admin); AppHeader owns hamburger/brand. */}
      <PageHeader title="Panel de Dirección" subtitle={subtitle} />
      {children}
    </div>
  );
}
