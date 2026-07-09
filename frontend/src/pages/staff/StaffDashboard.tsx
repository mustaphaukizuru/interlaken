import { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorState } from '@/components/ui/ErrorState';
import { StaffCard, StaffShell } from '@/components/staff/StaffShell';
import { portalApi } from '@/services/api';
import type { AnalyticsPayload } from '@/types/analytics';

// Recharts loads only when this page renders (IK-ADMIN item 8): both sections
// live in lazy chunks so the chart library never touches the main bundle.
const KpiRow = lazy(() => import('@/components/staff/KpiRow'));
const ChartsSection = lazy(() => import('@/components/staff/ChartsSection'));

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
      <div className="skeleton h-[320px] rounded-xl2 lg:col-span-2" aria-hidden="true" />
    </div>
  );
}

export default function StaffDashboard() {
  const { data, isLoading, isError, refetch } = useQuery<AnalyticsPayload>({
    queryKey: ['staff-analytics'],
    queryFn: async () => (await portalApi.getStaffAnalytics()).data,
    // The server caches the payload 60s; align to avoid useless refetches.
    staleTime: 60_000,
  });

  return (
    <StaffShell subtitle="Indicadores operativos del colegio">
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
