import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList,
         ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ClipboardList, Megaphone } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { StaffCard } from '@/components/staff/StaffShell';
import { fmtDay, fmtInt, fmtMXN, fmtMXNCompact, getChartTheme } from '@/lib/chartTheme';
import { usePrefersDark, useReducedMotion } from '@/hooks/useMediaQuery';
import type { AnalyticsPayload } from '@/types/analytics';

/**
 * Charts (IK-ADMIN item 7). Rules enforced here: token-driven central theme,
 * max 6 categorical colors, bars start at zero, no pies, direct labels instead
 * of legends, es-MX numbers/dates, every chart titled with its takeaway.
 *
 * Entry animations are OFF by design: they depend on requestAnimationFrame,
 * which throttled/background/battery-saver tabs may never fire — leaving
 * charts blank exactly when a director glances at a backgrounded phone tab.
 * Interaction motion (tooltip) stays on unless prefers-reduced-motion.
 */

const AXIS_FONT = 11;

function useTheme() {
  const dark = usePrefersDark();
  return { theme: getChartTheme(dark), reduced: useReducedMotion() };
}

function tooltipStyle(theme: ReturnType<typeof getChartTheme>) {
  return {
    backgroundColor: theme.tooltipBg,
    border: `1px solid ${theme.tooltipBorder}`,
    borderRadius: 10,
    color: theme.tooltipText,
    fontSize: 12,
    fontFamily: theme.fontFamily,
  };
}

// ── 1. Admissions funnel ──────────────────────────────────
function FunnelChart({ data }: { data: AnalyticsPayload }) {
  const { theme } = useTheme();
  const f = data.admissions.pre_funnel;
  const total = f.pending + f.contacted + f.enrolled + f.rejected;

  const rows = [
    { stage: 'Pendiente', value: f.pending, color: theme.semantic.pending },
    { stage: 'Contactado', value: f.contacted, color: theme.semantic.contacted },
    { stage: 'Inscrito', value: f.enrolled, color: theme.semantic.enrolled },
    { stage: 'No procedió', value: f.rejected, color: theme.semantic.rejected },
  ];

  const takeaway = total === 0
    ? 'Aún no hay pre-registros en este ciclo'
    : f.pending > 0
      ? `${fmtInt(f.pending)} de ${fmtInt(total)} pre-registros esperan primer contacto`
      : 'Todos los pre-registros han sido atendidos';

  return (
    <StaffCard title={takeaway} subtitle="Embudo de admisiones — pre-registros por etapa">
      {total === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Sin pre-registros"
          description="Cuando lleguen solicitudes del sitio público, el embudo se llena solo."
        />
      ) : (
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical"
                      margin={{ top: 4, right: 40, bottom: 0, left: 8 }}>
              <XAxis type="number" hide domain={[0, 'auto']} />
              <YAxis type="category" dataKey="stage" width={86} axisLine={false}
                     tickLine={false}
                     tick={{ fill: theme.axis, fontSize: AXIS_FONT, fontFamily: theme.fontFamily }} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]} isAnimationActive={false} barSize={22}>
                {rows.map((r) => <Cell key={r.stage} fill={r.color} />)}
                <LabelList dataKey="value" position="right"
                           formatter={(v: unknown) => fmtInt(Number(v))}
                           style={{ fill: theme.axis, fontSize: AXIS_FONT, fontFamily: theme.fontFamily }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </StaffCard>
  );
}

// ── 2. Referral sources ───────────────────────────────────
function ReferralsChart({ data }: { data: AnalyticsPayload }) {
  const { theme } = useTheme();
  const rows = data.admissions.referrals;

  const takeaway = rows.length === 0
    ? 'Sin datos de fuentes de prospectos'
    : `«${rows[0].source}» es la principal fuente de prospectos`;

  return (
    <StaffCard title={takeaway} subtitle="¿Cómo nos conocieron? — pre-registros por fuente">
      {rows.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="Sin fuentes registradas"
          description="El campo «¿Cómo nos conoció?» del pre-registro alimenta esta gráfica."
        />
      ) : (
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical"
                      margin={{ top: 4, right: 40, bottom: 0, left: 8 }}>
              <XAxis type="number" hide domain={[0, 'auto']} />
              <YAxis type="category" dataKey="source" width={110} axisLine={false}
                     tickLine={false}
                     tick={{ fill: theme.axis, fontSize: AXIS_FONT, fontFamily: theme.fontFamily }} />
              <Bar dataKey="count" fill={theme.categorical[1]} radius={[0, 6, 6, 0]}
                   isAnimationActive={false} barSize={18}>
                <LabelList dataKey="count" position="right"
                           formatter={(v: unknown) => fmtInt(Number(v))}
                           style={{ fill: theme.axis, fontSize: AXIS_FONT, fontFamily: theme.fontFamily }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </StaffCard>
  );
}

// ── 3. Cafeteria: top-ups vs consumption ──────────────────
function CafeteriaChart({ data }: { data: AnalyticsPayload }) {
  const { theme, reduced } = useTheme();
  const series = data.cafeteria.series;
  const topups = series.reduce((s, p) => s + p.topups, 0);
  const purchases = series.reduce((s, p) => s + p.purchases, 0);
  const empty = topups === 0 && purchases === 0;

  const takeaway = empty
    ? 'Sin movimientos de cafetería en 30 días'
    : topups >= purchases
      ? `Las recargas (${fmtMXN(topups)}) superan el consumo (${fmtMXN(purchases)}) en 30 días`
      : `El consumo (${fmtMXN(purchases)}) supera las recargas (${fmtMXN(topups)}) en 30 días`;

  return (
    <StaffCard
      title={takeaway}
      subtitle="Cafetería — flujo diario de los últimos 30 días"
      className="lg:col-span-2"
    >
      {empty ? (
        <EmptyState
          title="Sin transacciones"
          description="Las recargas y compras sincronizadas desde Loyverse aparecerán aquí."
        />
      ) : (
        <>
          {/* Direct labels (no legend): series named inline, color-matched. */}
          <p className="mb-2 text-xs text-muted dark:text-white/60" aria-hidden="true">
            <span className="font-semibold" style={{ color: theme.semantic.inflow }}>■ Recargas</span>
            <span className="mx-2">·</span>
            <span className="font-semibold" style={{ color: theme.semantic.outflow }}>■ Consumo</span>
          </p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid stroke={theme.grid} vertical={false} />
                <XAxis dataKey="date" tickFormatter={fmtDay} interval={6}
                       axisLine={false} tickLine={false}
                       tick={{ fill: theme.axis, fontSize: AXIS_FONT, fontFamily: theme.fontFamily }} />
                <YAxis tickFormatter={(v: number) => fmtMXNCompact(v)} width={64}
                       domain={[0, 'auto']} axisLine={false} tickLine={false}
                       tick={{ fill: theme.axis, fontSize: AXIS_FONT, fontFamily: theme.fontFamily }} />
                <Tooltip
                  contentStyle={tooltipStyle(theme)}
                  isAnimationActive={!reduced}
                  labelFormatter={(label) => fmtDay(String(label))}
                  formatter={(value, name) => [
                    fmtMXN(Number(value)), name === 'topups' ? 'Recargas' : 'Consumo',
                  ]}
                />
                <Area type="monotone" dataKey="topups" name="topups"
                      stroke={theme.semantic.inflow} strokeWidth={2}
                      fill={theme.semantic.inflow} fillOpacity={0.14}
                      isAnimationActive={false} dot={false} />
                <Area type="monotone" dataKey="purchases" name="purchases"
                      stroke={theme.semantic.outflow} strokeWidth={2}
                      fill={theme.semantic.outflow} fillOpacity={0.1}
                      isAnimationActive={false} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </StaffCard>
  );
}

export default function ChartsSection({ data }: { data: AnalyticsPayload }) {
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <FunnelChart data={data} />
      <ReferralsChart data={data} />
      <CafeteriaChart data={data} />
    </div>
  );
}
