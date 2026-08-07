import { lazy, Suspense, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { ErrorState } from '@/components/ui/ErrorState';
import { StaffCard, StaffShell } from '@/components/staff/StaffShell';
import { downloadAnalyticsCsv } from '@/lib/analyticsCsv';
import { portalApi } from '@/services/api';
import type { AnalyticsPayload, AnalyticsRange } from '@/types/analytics';

// Recharts loads only when this page renders (IK-ADMIN item 8): both sections
// live in lazy chunks so the chart library never touches the main bundle.
const KpiRow = lazy(() => import('@/components/staff/KpiRow'));
const ChartsSection = lazy(() => import('@/components/staff/ChartsSection'));

const RANGES: AnalyticsRange[] = [7, 30, 90];

/** Per-card skeletons (item 8): each pending card shimmers on its own. */
function KpiSkeletons() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="skeleton h-[130px] rounded-xl2" aria-hidden="true" />
      ))}
    </div>
  );
}

function ChartSkeletons() {
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="skeleton h-[280px] rounded-xl2" aria-hidden="true" />
      <div className="skeleton h-[280px] rounded-xl2" aria-hidden="true" />
      <div className="skeleton h-[280px] rounded-xl2" aria-hidden="true" />
      <div className="skeleton h-[320px] rounded-xl2 lg:col-span-2" aria-hidden="true" />
    </div>
  );
}

/** Range picker + freshness stamp + CSV export — the dashboard toolbar. */
function Toolbar({ range, onRange, data }: {
  range: AnalyticsRange;
  onRange: (r: AnalyticsRange) => void;
  data?: AnalyticsPayload;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div role="group" aria-label="Rango de fechas"
           className="flex overflow-hidden rounded-[10px] border border-line dark:border-white/10">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={range === r}
            onClick={() => onRange(r)}
            className={`min-h-[36px] px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/50 ${
              range === r
                ? 'bg-purple text-white'
                : 'bg-white text-muted hover:text-ink dark:bg-dark-card dark:text-white/60 dark:hover:text-white'
            }`}
          >
            {r} días
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-3">
        {data && (
          <span className="text-[11px] text-subtle dark:text-white/45">
            Actualizado {format(parseISO(data.generated_at), "d MMM HH:mm 'h'", { locale: es })}
          </span>
        )}
        <button
          type="button"
          onClick={() => data && downloadAnalyticsCsv(data)}
          disabled={!data}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-[10px] border border-line bg-white px-3 text-xs font-semibold text-muted transition-colors hover:text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/50 dark:border-white/10 dark:bg-dark-card dark:text-white/60 dark:hover:text-white"
        >
          <Download size={14} aria-hidden="true" /> CSV
        </button>
      </div>
    </div>
  );
}

export default function StaffDashboard() {
  const [range, setRange] = useState<AnalyticsRange>(30);

  const { data, isLoading, isError, refetch } = useQuery<AnalyticsPayload>({
    queryKey: ['staff-analytics', range],
    queryFn: async () => (await portalApi.getStaffAnalytics(range)).data,
    // The server caches each range 60s; align to avoid useless refetches.
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  return (
    <StaffShell subtitle="Indicadores operativos del colegio">
      <Toolbar range={range} onRange={setRange} data={data} />

      {isError ? (
        <StaffCard>
          <ErrorState
            title="No se pudo cargar la analítica"
            description="Verifique su conexión e intente de nuevo."
            onRetry={() => { void refetch(); }}
          />
        </StaffCard>
      ) : isLoading || !data ? (
        <>
          <KpiSkeletons />
          <ChartSkeletons />
        </>
      ) : (
        <>
          <Suspense fallback={<KpiSkeletons />}>
            <KpiRow data={data} />
          </Suspense>
          <Suspense fallback={<ChartSkeletons />}>
            <ChartsSection data={data} />
          </Suspense>
        </>
      )}
    </StaffShell>
  );
}
