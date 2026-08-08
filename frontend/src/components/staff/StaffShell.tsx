import { PageHeader } from '@/components/layout/PageHeader';

/**
 * Staff dashboard shell + card (IK-ADMIN P2). Mobile-first, dense spacing,
 * honors prefers-color-scheme via `dark:` variants that reuse the dark-surface
 * tokens (bg-dark*, white opacity steps) — see docs/DESIGN.md §1.4. The dark
 * treatment is scoped to /staff content: the shared PortalLayout + AppHeader
 * stay the same chrome as admin/parent (hamburger + brand «Interlaken»).
 */

export function StaffCard({ title, subtitle, children, className = '' }: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl2 border border-line bg-white p-4 shadow-card dark:border-white/10 dark:bg-dark-card dark:shadow-none ${className}`}
    >
      {title && (
        <h2 className="font-head text-sm font-semibold text-ink dark:text-white">
          {title}
        </h2>
      )}
      {subtitle && (
        <p className="mt-0.5 text-xs text-muted dark:text-white/60">{subtitle}</p>
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
    <div className="-mx-[clamp(16px,4vw,32px)] -my-6 min-h-[100dvh] bg-cream px-[clamp(16px,4vw,32px)] pb-8 pt-6 dark:bg-dark-2">
      {/* Title lives in content (like admin); AppHeader owns hamburger/brand. */}
      <div className="[&_h1]:dark:text-white [&_p]:dark:text-white/60">
        <PageHeader title="Panel de Dirección" subtitle={subtitle} />
      </div>
      {children}
    </div>
  );
}
