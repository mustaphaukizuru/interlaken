import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Coffee } from 'lucide-react';
import { cafeteriaApi } from '@/services/api';
import { fmtDay, fmtMXN, fmtMXNCompact, getChartTheme } from '@/lib/chartTheme';
import { usePrefersDark, useReducedMotion } from '@/hooks/useMediaQuery';
import { useChartEntrance } from '@/hooks/useChartEntrance';
import { SectionEmpty } from '@/components/ui/SectionCard';
import { ErrorState } from '@/components/ui/ErrorState';

interface TrendPoint { date: string; amount: number; }
interface TrendResp { days: number; total: number; average: number; series: TrendPoint[]; }

const AXIS_FONT = 11;

/**
 * Parent-dashboard cafetería spending trend — daily purchases over 30 days as an
 * area chart, mirroring the staff RevenueTrend pattern (central chart theme,
 * entrance gated through useChartEntrance so a backgrounded tab can't blank it).
 * Lazy-loaded so Recharts never touches the dashboard's main chunk.
 */
export default function CafeteriaTrendCard() {
  const dark = usePrefersDark();
  const reduced = useReducedMotion();
  const theme = getChartTheme(dark);
  const entrance = useChartEntrance();

  const [student, setStudent] = useState<number | 'all'>('all');

  // Children (from balances) power the per-child switcher; shares the balances
  // cache with the cafetería page.
  const { data: children } = useQuery({
    queryKey: ['cafeteria-balances'],
    queryFn: async () => {
      const { data } = await cafeteriaApi.getMyBalance();
      const arr = Array.isArray(data) ? data : [data];
      return arr.map((b: { student: { id: number; user: { full_name: string } } }) => ({
        id: b.student.id, name: b.student.user.full_name,
      }));
    },
    staleTime: 1000 * 60 * 5,
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['cafeteria-spending-trend', 30, student],
    queryFn: async () =>
      (await cafeteriaApi.getSpendingTrend(30, student === 'all' ? undefined : student)).data as TrendResp,
    staleTime: 1000 * 60 * 5,
  });

  const series = data?.series ?? [];
  const total = data?.total ?? 0;
  const stroke = theme.semantic?.outflow ?? theme.categorical[0];
  const interval = series.length ? Math.max(0, Math.floor(series.length / 6)) : 0;

  return (
    <div className="card min-w-0 overflow-hidden !p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cream px-5 py-4">
        <div>
          <h2 className="font-head text-[15px] font-bold text-ink">Consumo de cafetería</h2>
          <p className="text-[12px] text-subtle">Últimos 30 días</p>
        </div>
        <div className="flex items-center gap-3">
          {(children?.length ?? 0) > 1 && (
            <select
              value={student}
              onChange={(e) => setStudent(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              aria-label="Filtrar consumo por alumno"
              className="min-h-[44px] sm:min-h-0 rounded-lg border border-line bg-white px-2.5 py-1.5 text-base sm:text-[12.5px] font-medium text-ink focus:outline-none focus:ring-2 focus:ring-purple/30"
            >
              <option value="all">Todos</option>
              {children!.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {total > 0 && (
            <div className="text-right">
              <div className="font-head text-[15px] font-bold text-ink">{fmtMXN(total)}</div>
              <div className="text-[11px] text-subtle">total gastado</div>
            </div>
          )}
        </div>
      </div>

      {isError ? (
        <div className="p-5">
          <ErrorState onRetry={() => refetch()} />
        </div>
      ) : isLoading ? (
        <div className="skeleton m-5 h-44 rounded-xl2" aria-hidden="true" />
      ) : total === 0 ? (
        <SectionEmpty icon={Coffee}>Sin compras registradas en este periodo.</SectionEmpty>
      ) : (
        <div className="h-52 px-2 py-3">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 6, right: 12, bottom: 0, left: 6 }}>
              <defs>
                <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={theme.grid} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={fmtDay}
                interval={interval}
                axisLine={false}
                tickLine={false}
                tick={{ fill: theme.axis, fontSize: AXIS_FONT, fontFamily: theme.fontFamily }}
              />
              <YAxis
                tickFormatter={(v: number) => fmtMXNCompact(v)}
                width={52}
                domain={[0, 'auto']}
                axisLine={false}
                tickLine={false}
                tick={{ fill: theme.axis, fontSize: AXIS_FONT, fontFamily: theme.fontFamily }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: theme.tooltipBg,
                  border: `1px solid ${theme.tooltipBorder}`,
                  borderRadius: 10,
                  color: theme.tooltipText,
                  fontSize: 12,
                  fontFamily: theme.fontFamily,
                }}
                isAnimationActive={!reduced}
                labelFormatter={(l) => fmtDay(String(l))}
                formatter={(v) => [fmtMXN(Number(v)), 'Consumo']}
              />
              <Area
                type="monotone"
                dataKey="amount"
                name="amount"
                stroke={stroke}
                strokeWidth={2}
                fill="url(#spendFill)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
                {...entrance}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
