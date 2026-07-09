import { Menu } from 'lucide-react';
import { useMobileNav } from '@/components/layout/PortalLayout';

/**
 * Staff dashboard shell + card (IK-ADMIN P2). Mobile-first, dense spacing,
 * honors prefers-color-scheme via `dark:` variants that reuse the dark-surface
 * tokens (bg-dark*, white opacity steps) — see docs/DESIGN.md §1.4. The dark
 * treatment is scoped to /staff: the shared PortalLayout stays light.
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
  const { toggle } = useMobileNav();

  return (
    <div className="-mx-[clamp(16px,4vw,32px)] -my-6 min-h-[100dvh] bg-cream pb-8 dark:bg-dark-2">
      {/* Own header (not TopBar) so the dark variant stays scoped to /staff */}
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
