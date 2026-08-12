import { useQuery } from '@tanstack/react-query';
import { Coffee } from 'lucide-react';
import { cafeteriaApi } from '@/services/api';
import { fmtMXN } from '@/lib/chartTheme';
import { SectionEmpty } from '@/components/ui/SectionCard';

interface CategoryRow { category: string; total: number; count: number; pct: number; }
interface CategoriesResp { days: number; total: number; categories: CategoryRow[]; }

// Coarse categories are fixed server-side (see services.categorize_item); map each
// to a brand token so the breakdown reads at a glance. Unknown → neutral.
const CATEGORY_STYLE: Record<string, { bar: string; dot: string }> = {
  Comida:  { bar: 'bg-green-500',  dot: 'bg-green-500' },
  Bebidas: { bar: 'bg-purple',     dot: 'bg-purple' },
  Snacks:  { bar: 'bg-coral',      dot: 'bg-coral' },
  Otros:   { bar: 'bg-subtle',     dot: 'bg-subtle' },
};
const styleFor = (c: string) => CATEGORY_STYLE[c] ?? CATEGORY_STYLE.Otros;

/**
 * "¿En qué gasta?" — cafetería spend grouped by coarse category (Bebidas / Comida
 * / Snacks / Otros) over the last 30 days. Rendered as accessible CSS bars rather
 * than a chart so it paints everywhere (no canvas/rAF dependency) and reads for
 * screen readers. Optionally scoped to one child via ``student``.
 */
export default function CafeteriaCategoriesCard({ student }: { student?: number | 'all' }) {
  const scoped = student && student !== 'all' ? student : undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['cafeteria-spending-categories', 30, scoped ?? 'all'],
    queryFn: async () => (await cafeteriaApi.getSpendingCategories(30, scoped)).data as CategoriesResp,
    staleTime: 1000 * 60 * 5,
  });

  const categories = data?.categories ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="card overflow-hidden !p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cream px-5 py-4">
        <div>
          <h2 className="font-head text-[15px] font-bold text-ink">¿En qué se gasta?</h2>
          <p className="text-[12px] text-subtle">Por categoría · últimos 30 días</p>
        </div>
        {total > 0 && (
          <div className="text-right">
            <div className="font-head text-[15px] font-bold text-ink">{fmtMXN(total)}</div>
            <div className="text-[11px] text-subtle">total gastado</div>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3 p-5" aria-hidden="true">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-9 rounded-lg" />)}
        </div>
      ) : total === 0 ? (
        <SectionEmpty icon={Coffee}>Sin compras registradas en este periodo.</SectionEmpty>
      ) : (
        <ul className="space-y-3.5 p-5">
          {categories.map((c) => {
            const st = styleFor(c.category);
            return (
              <li key={c.category}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 font-medium text-ink">
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${st.dot}`} aria-hidden="true" />
                    {c.category}
                  </span>
                  <span className="tabular-nums text-muted">
                    {fmtMXN(c.total)} <span className="text-subtle">· {c.pct.toFixed(0)}%</span>
                  </span>
                </div>
                <div
                  className="h-2.5 w-full overflow-hidden rounded-full bg-cream"
                  role="progressbar"
                  aria-label={`${c.category}: ${c.pct.toFixed(0)}%`}
                  aria-valuenow={Math.round(c.pct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className={`h-full rounded-full ${st.bar}`}
                    style={{ width: `${Math.max(c.pct, 2)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
