import { StaffCard } from './StaffShell';
import type { AnalyticsPayload } from '@/types/analytics';

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
const ratePct = (r: number | null) => (r == null ? 'n/d' : `${Math.round(r * 100)}%`);

/** Conversion between consecutive funnel steps (for labels and tests). */
export function stepRates(f: AnalyticsPayload['funnel']): number[] {
  return f.map((s, i) => (i === 0 ? 100 : pct(s.count, f[i - 1].count)));
}

/** Admissions funnel + cafetería adoption (BACKLOG P4-10). */
export function FunnelSection({ data }: { data: AnalyticsPayload }) {
  const f = data.funnel ?? [];
  const max = Math.max(1, ...f.map((s) => s.count));
  const rates = stepRates(f);
  const ad = data.cafeteria.adoption;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <StaffCard title={`Embudo de admisión · últimos ${data.range_days} días`} subtitle="De pre-registro a inscripción. El porcentaje es la conversión respecto al paso anterior.">
        <ol className="space-y-2" aria-label="Embudo de admisión">
          {f.map((s, i) => (
            <li key={s.step} className="text-sm">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-ink">{s.label}</span>
                <span className="tabular-nums text-muted">{s.count}{i > 0 && <span className="ml-2 text-xs text-subtle">{rates[i]}%</span>}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-cream-2"><div className="h-full rounded-full bg-purple transition-[width]" style={{ width: `${pct(s.count, max)}%` }} /></div>
            </li>
          ))}
        </ol>
      </StaffCard>
      <StaffCard title="Adopción de la cafetería" subtitle="Alumnos activos con monedero y uso en el periodo.">
        {ad ? (
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <div><dt className="text-xs uppercase tracking-wide text-subtle">Con monedero</dt><dd className="font-head text-2xl font-bold text-ink">{ratePct(ad.wallet_rate)}</dd><dd className="text-xs text-muted">{ad.with_wallet} de {ad.active_students}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-subtle">Usaron el monedero</dt><dd className="font-head text-2xl font-bold text-ink">{ratePct(ad.usage_rate)}</dd><dd className="text-xs text-muted">{ad.used_in_period} alumnos</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-subtle">Recargaron</dt><dd className="font-head text-2xl font-bold text-ink">{ad.topped_up_in_period}</dd><dd className="text-xs text-muted">alumnos en el periodo</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-subtle">Saldo bajo</dt><dd className={`font-head text-2xl font-bold ${ad.low_balance ? 'text-coral-600' : 'text-ink'}`}>{ad.low_balance}</dd><dd className="text-xs text-muted">bajo su umbral</dd></div>
          </dl>
        ) : <p className="text-sm text-muted">Sin datos.</p>}
      </StaffCard>
    </div>
  );
}

export default FunnelSection;
