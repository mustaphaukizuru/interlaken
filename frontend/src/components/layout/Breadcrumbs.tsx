import { Link, useInRouterContext, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { navByRole, type Role } from './navConfig';

const ROOT: Record<string, { label: string; to: string }> = {
  admin: { label: 'Administración', to: '/admin' },
  staff: { label: 'Personal', to: '/staff' },
  portal: { label: 'Portal', to: '/portal' },
};

/** Route-aware breadcrumbs derived from navConfig (BACKLOG P1-E6).
 *  Dynamic segments (ids) render as the page title when the page passes one. */
export function Breadcrumbs({ role, current }: { role: Role; current?: string }) {
  // PageHeader is also rendered by tests/surfaces without a Router; stay inert there.
  const inRouter = useInRouterContext();
  if (!inRouter) return null;
  return <Trail role={role} current={current} />;
}

function Trail({ role, current }: { role: Role; current?: string }) {
  const { pathname } = useLocation();
  const [, rootSeg, ...rest] = pathname.split('/');
  const root = ROOT[rootSeg];
  if (!root || rest.filter(Boolean).length === 0) return null;

  const entries = navByRole[role] ?? [];
  const crumbs: { label: string; to: string }[] = [root];
  let acc = `/${rootSeg}`;
  rest.filter(Boolean).forEach((seg, i, arr) => {
    acc += `/${seg}`;
    const match = entries.find((e) => e.to === acc);
    const last = i === arr.length - 1;
    if (match) crumbs.push({ label: match.label, to: acc });
    else if (last && current) crumbs.push({ label: current, to: acc });
    else if (!/^\d+$/.test(seg)) crumbs.push({ label: seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' '), to: acc });
  });
  if (crumbs.length < 2) return null;

  return (
    <nav aria-label="Ruta" className="mb-3 hidden text-xs text-subtle sm:block">
      <ol className="flex flex-wrap items-center gap-1">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={c.to} className="flex items-center gap-1">
              {last ? (
                <span aria-current="page" className="font-semibold text-ink">{c.label}</span>
              ) : (
                <Link to={c.to} className="hover:text-ink hover:underline">{c.label}</Link>
              )}
              {!last && <ChevronRight size={12} aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default Breadcrumbs;
