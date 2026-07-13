import type { ReactNode } from 'react';

/**
 * Standard page title block for content areas. The mobile nav (hamburger) lives
 * in the shell AppHeader, so this is purely the page's own title / subtitle /
 * actions — used consistently across every portal page.
 */
export function PageHeader({ title, subtitle, actions }: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="font-head text-fluid-xl font-bold leading-tight tracking-[-0.3px] text-ink">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export default PageHeader;
