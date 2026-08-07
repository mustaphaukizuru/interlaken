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
    <div className="hover-lift" style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 18, padding: '22px', boxShadow: 'var(--shadow-card)', position: 'relative', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={22} color={t.color} />
        </div>
        {trend && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: trend.up ? 'rgba(71,160,24,0.1)' : 'rgba(239,37,88,0.1)', color: trend.up ? 'var(--green-dark)' : 'var(--pink)' }}>
            {trend.up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}{trend.value}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text-muted)' }}>{title}</div>
      {subtitle && <div style={{ fontSize: 11.5, color: 'var(--text-light)', marginTop: 1 }}>{subtitle}</div>}
      <div style={{ marginTop: 4, display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 36, letterSpacing: -1, color: 'var(--text-main)', lineHeight: 1.1 }}><StatValue value={value} /></span>
        {suffix && <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-light)' }}>{suffix}</span>}
      </div>
    </div>
  );
}

export default StatCard;
