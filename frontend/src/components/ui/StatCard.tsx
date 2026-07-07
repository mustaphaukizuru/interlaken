import { type LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';

interface Props {
  title: string;
  value: string | number;
  icon?: LucideIcon;
  trend?: string;
  color?: 'brand' | 'amber' | 'red' | 'blue';
}

const colors = {
  brand: 'bg-brand-50 text-brand-600',
  amber: 'bg-amber-50 text-amber-600',
  red:   'bg-red-50 text-red-600',
  blue:  'bg-blue-50 text-blue-600',
};

export function StatCard({ title, value, icon: Icon, trend, color = 'brand' }: Props) {
  return (
    <div className="card flex items-start gap-4">
      {Icon && (
        <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', colors[color])}>
          <Icon className="w-5 h-5" />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-sm text-slate-500">{title}</p>
        <p className="text-2xl font-bold text-slate-900 mt-0.5">{value}</p>
        {trend && <p className="text-xs text-slate-400 mt-1">{trend}</p>}
      </div>
    </div>
  );
}
