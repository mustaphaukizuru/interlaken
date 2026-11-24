import { Link } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { ArrowDownRight, ArrowUpRight, ExternalLink, type LucideIcon,
         CreditCard, FileSearch, Gavel, UserPlus } from 'lucide-react';
import { fmtInt, fmtMXN, fmtPct, getChartTheme } from '@/lib/chartTheme';
import { useAuthStore } from '@/store/authStore';
import type { AnalyticsPayload } from '@/types/analytics';

/**
 * KPI row (IK-ADMIN item 7): value, delta vs previous period, trend sparkline,
 * each card deep-linking to the console/admin view that acts on it.
 */

// Django admin is mounted at /django-admin/ on the API origin (same origin in
// production; the React console owns /admin/*). The Vite dev server proxies
// that prefix to the backend too.
const djangoAdmin = (path: string) =>
  `${import.meta.env.VITE_API_BASE_URL || ''}/django-admin${path}`;

function Delta({ pct, label }: { pct: number | null; label: string }) {
  if (pct === null) {
    return <span className="text-[11px] text-subtle">{label}</span>;
  }
  const up = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${
      up ? 'text-green-dark' : 'text-coral-dark'
    }`}>
      {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {fmtPct(pct)}
      <span className="ml-1 font-normal text-subtle">{label}</span>
    </span>
  );
}

function Sparkline({ points, color }: {
  points: { x: string; y: number }[];
  color: string;
}) {
  return (
    <div className="h-9" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <Area
            type="monotone"
            dataKey="y"
            stroke={color}
            strokeWidth={1.5}
            fill={color}
            fillOpacity={0.12}
            // Static render: rAF-dependent entry animation can leave charts
            // blank in throttled/background tabs (see ChartsSection).
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

interface KpiCardDef {
  key: string;
  icon: LucideIcon;
  title: string;
  value: string;
  deltaPct: number | null;
  deltaLabel: string;
  spark?: { points: { x: string; y: number }[]; color: string };
  /** Internal SPA route… */
  to?: string;
  /** …or external (Django admin) href. */
  href?: string;
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export default function KpiRow({ data }: { data: AnalyticsPayload }) {
  // Light theme only (the app has no dark mode): never follow the OS setting.
  const theme = getChartTheme(false);
  // Staff see this row on /staff but cannot open /admin/* (ProtectedRoute
  // bounces them back) nor the Django admin, so their cards are plain tiles.
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');

  const admissionsSeries = data.admissions.series;
  // Momentum: second half of the selected window vs the first half.
  const half = Math.floor(admissionsSeries.length / 2);
  const lastHalf = admissionsSeries.slice(half).reduce((s, p) => s + p.count, 0);
  const prevHalf = admissionsSeries.slice(0, half).reduce((s, p) => s + p.count, 0);

  const cards: KpiCardDef[] = [
    {
      key: 'payments',
      icon: CreditCard,
      title: 'Cobrado este mes',
      value: fmtMXN(data.payments.this_month.total),
      // Compare month-to-date against the SAME span of last month, not the full
      // prior month — otherwise early in the month it's always a false decline.
      deltaPct: pctChange(data.payments.this_month.total, data.payments.last_month_to_date.total),
      deltaLabel: 'vs mes anterior',
      spark: {
        points: data.payments.series.map((p) => ({ x: p.date, y: p.total })),
        color: theme.semantic.inflow,
      },
      to: '/admin/cafeteria',
    },
    {
      key: 'preregs',
      icon: UserPlus,
      title: 'Pre-registros pendientes',
      value: fmtInt(data.admissions.pre_funnel.pending),
      deltaPct: pctChange(lastHalf, prevHalf),
      deltaLabel: `nuevos vs ${half} días previos`,
      spark: {
        points: admissionsSeries.map((p) => ({ x: p.date, y: p.count })),
        color: theme.semantic.contacted,
      },
      to: '/admin/admisiones',
    },
    {
      key: 'documents',
      icon: FileSearch,
      title: 'Documentos por revisar',
      value: fmtInt(data.documents.in_review),
      deltaPct: null,
      deltaLabel: 'cola de revisión de expedientes',
      href: djangoAdmin('/admissions/registrationdocument/?is_verified__exact=0'),
    },
    {
      key: 'arco',
      icon: Gavel,
      title: 'Solicitudes ARCO abiertas',
      value: fmtInt(data.arco.open),
      deltaPct: null,
      deltaLabel: data.arco.overdue > 0
        ? `${fmtInt(data.arco.overdue)} fuera de plazo legal`
        : 'todas dentro de plazo',
      href: djangoAdmin('/legal/arcorequest/?status__in=received,in_review'),
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(({ key, icon: Icon, title, value, deltaPct, deltaLabel, spark, to, href }) => {
        const body = (
          <>
            <div className="flex items-center gap-2">
              <Icon size={16} className="text-muted" aria-hidden="true" />
              <span className="flex-1 text-xs font-medium text-muted">
                {title}
              </span>
              {isAdmin && <ExternalLink size={16} className="text-subtle opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />}
            </div>
            <div className="mt-2 font-head text-2xl font-bold tabular-nums text-ink">
              {value}
            </div>
            <div className="mt-1">
              <Delta pct={deltaPct} label={deltaLabel} />
            </div>
            {spark && <div className="mt-2"><Sparkline points={spark.points} color={spark.color} /></div>}
          </>
        );
        // Borderless surface; only a real link reacts to hover.
        const tile = 'block min-w-0 rounded-md bg-white p-4 shadow-card';
        const cls = `group ${tile} transition-shadow hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/50`;
        if (!isAdmin) {
          return <div key={key} className={tile}>{body}</div>;
        }
        return to ? (
          <Link key={key} to={to} className={cls} aria-label={`${title}: abrir vista`}>{body}</Link>
        ) : (
          <a key={key} href={href} className={cls} aria-label={`${title}: abrir en administración`}>{body}</a>
        );
      })}
    </div>
  );
}
