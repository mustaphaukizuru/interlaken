import { type LucideIcon, TrendingUp, TrendingDown } from 'lucide-react';
import { useCountUp } from '@/hooks/useCountUp';

type Color = 'purple' | 'pink' | 'coral' | 'green' | 'amber';

/**
 * Split a stat value into an (optional) currency/symbol prefix, an animatable
 * number, and a trailing suffix — so `"$1,234.50"`, `"98%"` and a bare `3`
 * all count up while preserving their decimals, thousands grouping and unit.
 * Non-numeric values (e.g. "—") fall through and render verbatim.
 */
function parseStatValue(value: string | number) {
  if (typeof value === 'number') {
    return { animate: true, target: value, prefix: '', suffix: '', decimals: 0, grouped: false };
  }
  const m = value.match(/^(\D*?)([\d,]+(?:\.\d+)?)(\D*)$/);
  if (!m) return { animate: false as const };
  const [, prefix, num, suffix] = m;
  const decimals = num.includes('.') ? num.split('.')[1].length : 0;
  return {
    animate: true as const,
    target: parseFloat(num.replace(/,/g, '')),
    prefix,
    suffix,
    decimals,
    grouped: num.includes(','),
  };
}

/** Renders a stat value, counting up the numeric portion on mount / change. */
function StatValue({ value }: { value: string | number }) {
  const parsed = parseStatValue(value);
  const n = useCountUp(parsed.animate ? parsed.target : 0);
  if (!parsed.animate) return <>{value}</>;
  const body = parsed.grouped
    ? n.toLocaleString('es-MX', {
        minimumFractionDigits: parsed.decimals,
        maximumFractionDigits: parsed.decimals,
      })
    : n.toFixed(parsed.decimals);
  return <>{parsed.prefix}{body}{parsed.suffix}</>;
}

// Colored icon chip only — the resting shadow is the shared light token so
// every tile matches the restrained surface language (no per-color glow).
const theme: Record<Color, { bg: string; color: string }> = {
  purple: { bg: 'rgba(64,26,142,0.1)',  color: 'var(--purple)' },
  pink:   { bg: 'rgba(239,37,88,0.1)',   color: 'var(--pink)' },
  coral:  { bg: 'rgba(221,38,34,0.1)',   color: 'var(--coral-dark)' },
  green:  { bg: 'rgba(71,160,24,0.1)',   color: 'var(--green-dark)' },
  amber:  { bg: 'rgba(217,119,6,0.1)',   color: 'var(--amber)' },
};

interface StatCardProps {
  title: string;
  value: string | number;
  suffix?: string;
  icon: LucideIcon;
  color: Color;
  trend?: { value: string; up: boolean };
  subtitle?: string;
}

export function StatCard({ title, value, suffix, icon: Icon, color, trend, subtitle }: StatCardProps) {
  const t = theme[color];
  return (
    // Sizing is responsive, not fixed: at 390px these tiles sit two-per-row, so
    // padding, the icon chip and the figure all step down instead of forcing a
    // one-per-screen scroll through the KPIs.
    <div className="hover-lift relative overflow-hidden rounded-[18px] border border-line bg-white p-4 shadow-card sm:p-[22px]">
      <div className="mb-3 flex items-center justify-between sm:mb-[18px]">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-[12px] sm:h-11 sm:w-11"
          style={{ background: t.bg }}
        >
          <Icon size={20} color={t.color} className="sm:h-[22px] sm:w-[22px]" />
        </div>
        {trend && (
          <span
            className="flex items-center gap-1 rounded-full px-2.5 py-[3px] text-[11.5px] font-bold"
            style={{
              background: trend.up ? 'rgba(71,160,24,0.1)' : 'rgba(239,37,88,0.1)',
              color: trend.up ? 'var(--green-dark)' : 'var(--pink)',
            }}
          >
            {trend.up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}{trend.value}
          </span>
        )}
      </div>
      <div className="text-[13px] font-medium text-muted">{title}</div>
      {subtitle && <div className="mt-px text-[12px] text-light">{subtitle}</div>}
      <div className="mt-1 flex items-baseline gap-1">
        <span className="font-head text-[clamp(21px,5.5vw,36px)] font-extrabold leading-[1.1] tracking-[-1px] text-ink">
          <StatValue value={value} />
        </span>
        {suffix && <span className="text-[17px] font-semibold text-light">{suffix}</span>}
      </div>
    </div>
  );
}

export default StatCard;
