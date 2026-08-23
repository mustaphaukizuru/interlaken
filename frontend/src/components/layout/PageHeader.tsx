import type { ReactNode } from 'react';
import { useAuthStore } from '@/store/authStore';
import { Breadcrumbs } from './Breadcrumbs';
import type { Role } from './navConfig';

/**
 * Standard page title block for content areas. The mobile nav (hamburger) lives
 * in the shell AppHeader, so this is purely the page's own title / subtitle /
 * actions — used consistently across every portal page.
 */
export function PageHeader({ title, subtitle, actions, breadcrumbs = true }: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Route-aware trail above the title (BACKLOG P1-E6); off for top-level pages. */
  breadcrumbs?: boolean;
}) {
  const role = (useAuthStore((s) => s.user?.role) ?? 'parent') as Role;
  return (
    <>
    {breadcrumbs && <Breadcrumbs role={role} current={title} />}
    <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="font-head text-fluid-xl font-bold leading-tight tracking-[-0.3px] text-ink">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
    </>
  );
}

export default PageHeader;
