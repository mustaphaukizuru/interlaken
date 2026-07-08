import { type LucideIcon, TrendingUp, TrendingDown } from 'lucide-react';

type Color = 'purple' | 'pink' | 'coral' | 'green' | 'amber';

const theme: Record<Color, { bg: string; color: string; shadow: string }> = {
  purple: { bg: 'rgba(64,26,142,0.1)',  color: '#401a8e', shadow: '0 12px 28px -10px rgba(64,26,142,0.28)' },
  pink:   { bg: 'rgba(239,37,88,0.1)',   color: '#ef2558', shadow: '0 12px 28px -10px rgba(239,37,88,0.25)' },
  coral:  { bg: 'rgba(221,38,34,0.1)',   color: '#c51d1a', shadow: '0 12px 28px -10px rgba(221,38,34,0.28)' },
  green:  { bg: 'rgba(71,160,24,0.1)',   color: '#316f1c', shadow: 'var(--shadow-card)' },
  amber:  { bg: 'rgba(217,119,6,0.1)',   color: '#b45309', shadow: 'var(--shadow-card)' },
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
    <div style={{ background: '#fff', border: '1px solid #ECEAF3', borderRadius: 18, padding: '22px', boxShadow: t.shadow, position: 'relative', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={22} color={t.color} />
        </div>
        {trend && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: trend.up ? 'rgba(71,160,24,0.1)' : 'rgba(239,37,88,0.1)', color: trend.up ? '#316f1c' : '#ef2558' }}>
            {trend.up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}{trend.value}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 500, color: '#6E6885' }}>{title}</div>
      {subtitle && <div style={{ fontSize: 11.5, color: '#9A93AE', marginTop: 1 }}>{subtitle}</div>}
      <div style={{ marginTop: 4, display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 36, letterSpacing: -1, color: '#1A1130', lineHeight: 1.1 }}>{value}</span>
        {suffix && <span style={{ fontSize: 17, fontWeight: 600, color: '#9A93AE' }}>{suffix}</span>}
      </div>
    </div>
  );
}

export default StatCard;
