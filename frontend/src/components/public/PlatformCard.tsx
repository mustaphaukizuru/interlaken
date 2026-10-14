import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface Platform {
  name: string;
  desc: string;
  /** External URL (opens in a new tab) or an internal route starting with "/". */
  href: string;
  icon: LucideIcon;
  cta: string;
}

/** Card for one digital platform (Pagos and Plataformas pages). */
export function PlatformCard({ p }: { p: Platform }) {
  const internal = p.href.startsWith('/');
  const cls =
    'mt-4 inline-flex min-h-[44px] items-center gap-1.5 self-start rounded-full border-2 border-green px-5 text-sm font-semibold text-green-dark transition-colors hover:bg-green-strong hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green/40';
  return (
    <div className="flex h-full flex-col rounded-xl2 border border-ink/10 bg-white p-6 shadow-card transition-shadow hover:shadow-lg">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-green/10 text-green-dark">
          <p.icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <h3 className="font-head text-lg font-bold text-ink">{p.name}</h3>
      </div>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-muted">{p.desc}</p>
      {internal ? (
        <Link to={p.href} className={cls}>
          {p.cta} <ArrowRight size={15} aria-hidden="true" />
        </Link>
      ) : (
        <a href={p.href} target="_blank" rel="noopener noreferrer" className={cls}>
          {p.cta} <ArrowUpRight size={15} aria-hidden="true" />
          <span className="sr-only"> (se abre en otra pestaña)</span>
        </a>
      )}
    </div>
  );
}
