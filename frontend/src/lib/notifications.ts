import { Info, AlertTriangle, Receipt, Coffee, type LucideIcon } from 'lucide-react';

export interface Notif {
  id: number;
  notif_type: 'info' | 'warning' | 'payment' | 'cafeteria';
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  announcement?: number | null;
}

export const NOTIF_META: Record<Notif['notif_type'], { icon: LucideIcon; cls: string; label: string }> = {
  info:      { icon: Info,          cls: 'bg-purple/10 text-purple',    label: 'Avisos' },
  warning:   { icon: AlertTriangle, cls: 'bg-amber/10 text-amber',      label: 'Alertas' },
  payment:   { icon: Receipt,       cls: 'bg-coral/10 text-coral',      label: 'Pagos' },
  cafeteria: { icon: Coffee,        cls: 'bg-green/10 text-green-dark', label: 'Cafetería' },
};

/** Where a notification takes you when tapped; null = just mark read in place. */
export function notifDestination(n: Notif): string | null {
  if (n.announcement) return `/portal/comunicados/${n.announcement}`;
  if (n.notif_type === 'payment') return '/portal/pagos';
  if (n.notif_type === 'cafeteria') return '/portal/cafeteria';
  return null;
}

export type NotifGroup = 'Hoy' | 'Esta semana' | 'Anteriores';

/** Group by recency for the sheet/page (BACKLOG P1-B2). */
export function groupNotifs(list: Notif[], now = new Date()): { label: NotifGroup; items: Notif[] }[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekAgo = startOfToday - 6 * 86_400_000;
  const buckets: Record<NotifGroup, Notif[]> = { Hoy: [], 'Esta semana': [], Anteriores: [] };
  for (const n of list) {
    const t = new Date(n.created_at).getTime();
    if (t >= startOfToday) buckets.Hoy.push(n);
    else if (t >= weekAgo) buckets['Esta semana'].push(n);
    else buckets.Anteriores.push(n);
  }
  return (Object.keys(buckets) as NotifGroup[])
    .map((label) => ({ label, items: buckets[label] }))
    .filter((g) => g.items.length > 0);
}
