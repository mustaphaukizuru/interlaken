import { Menu } from 'lucide-react';
import { useMobileNav } from '@/components/layout/PortalLayout';

/**
 * Staff analytics dashboard shell (IK-ADMIN P2). Mobile-first, dense spacing,
 * honors prefers-color-scheme via `dark:` variants that reuse the dark-surface
 * tokens (bg-dark*, white opacity steps) — see docs/DESIGN.md §1.4. The dark
 * treatment is scoped to this page: the shared PortalLayout stays light.
 *
 * Sections are populated incrementally: KPI row + charts land with the
 * analytics endpoint (items 6–8).
 */

/** Section wrapper: token-driven card that also carries the dark variant. */
export function StaffCard({ title, children, className = '' }: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl2 border border-line bg-white p-4 shadow-card dark:border-white/10 dark:bg-dark-card dark:shadow-none ${className}`}
    >
      {title && (
        <h2 className="mb-3 font-head text-[13px] font-semibold uppercase tracking-[0.8px] text-muted dark:text-white/60">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

export function StaffShell({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  const { toggle } = useMobileNav();

  return (
    <div className="-mx-[clamp(16px,4vw,32px)] -my-6 min-h-[100dvh] bg-cream pb-8 dark:bg-dark-2">
      {/* Header — own (not TopBar) so the dark variant stays scoped to /staff */}
      <div className="accent-bar" />
      <header className="sticky top-[3px] z-20 border-b border-line bg-cream/[0.92] px-4 py-3 backdrop-blur-[14px] sm:px-6 dark:border-white/10 dark:bg-dark-2/[0.92]">
        <div className="flex items-center gap-3">
          <button
            aria-label="Abrir menú"
            onClick={toggle}
            className="flex h-11 w-11 items-center justify-center rounded-[10px] text-ink transition-colors hover:bg-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/50 lg:hidden dark:text-white dark:hover:bg-white/10"
          >
            <Menu size={20} />
          </button>
          <div>
            <h1 className="font-head text-fluid-lg font-bold text-ink dark:text-white">
              Panel de Dirección
            </h1>
            {subtitle && (
              <p className="text-xs text-muted dark:text-white/60">{subtitle}</p>
            )}
          </div>
        </div>
      </header>

      <div className="px-4 pt-4 sm:px-6">{children}</div>
    </div>
  );
}

export default function StaffDashboard() {
  return (
    <StaffShell subtitle="Indicadores operativos del colegio">
      {/* Dense, mobile-first grid: 1 col → 2 → 4 for KPIs; charts below. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-[120px] rounded-xl2" aria-hidden="true" />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="skeleton h-[280px] rounded-xl2" aria-hidden="true" />
        <div className="skeleton h-[280px] rounded-xl2" aria-hidden="true" />
      </div>
    </StaffShell>
  );
}
