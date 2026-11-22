import { Info, AlertTriangle, Receipt, Coffee, type LucideIcon } from 'lucide-react';
import { notifPreview } from './notificationText';
import { portalApi } from '@/services/api';

export interface Notif {
  id: number;
  notif_type: 'info' | 'warning' | 'payment' | 'cafeteria';
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  announcement?: number | null;
}

/** The bell's list (first page, newest first), shared by the header menu and
 *  Inicio's «Hoy» under one cache key, so neither asks twice. */
export const NOTIFICATIONS_KEY = ['notifications'] as const;
export async function fetchNotifications(): Promise<Notif[]> {
  const r = await portalApi.getNotifications();
  return (r.data.results ?? r.data) as Notif[];
}

/** Category per type. The page and menu are «Avisos»; `warning` is the
 *  school's urgent alert (sent even when a category is muted). */
export const NOTIF_META: Record<Notif['notif_type'], { icon: LucideIcon; cls: string; label: string }> = {
  info:      { icon: Info,          cls: 'bg-purple/10 text-purple',    label: 'Comunicados' },
  warning:   { icon: AlertTriangle, cls: 'bg-warning-bg text-warning',  label: 'Urgentes' },
  payment:   { icon: Receipt,       cls: 'bg-coral/10 text-coral',      label: 'Pagos' },
  cafeteria: { icon: Coffee,        cls: 'bg-green/10 text-green-dark', label: 'Cafetería' },
};

/**
 * Where a notification takes you when tapped.
 *
 * Prefer the page that holds its subject; everything else opens the
 * notification's own detail page. Nothing is a dead tap any more: an
 * info/warning aviso used to return null, so the row clamped its message to two
 * lines and then did nothing when you pressed it.
 */
export function notifDestination(n: Notif): string {
  // Bitácora 10: the portal no longer shows comunicados; the notification itself carries the text.
  // A message longer than its preview (a staff report listing every pending
  // top-up) opens in full first; its page links on to the cafetería.
  if (isLongMessage(n.message)) return `/portal/notificaciones/${n.id}`;
  if (n.notif_type === 'payment') return '/portal/cafeteria';
  if (n.notif_type === 'cafeteria') return '/portal/cafeteria';
  return `/portal/notificaciones/${n.id}`;
}

/** True when the list preview cannot show the whole message. */
export function isLongMessage(message: string | null | undefined): boolean {
  const text = String(message ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 0 && notifPreview(message) !== text;
}

export type NotifGroup = 'Urgentes' | 'Hoy' | 'Esta semana' | 'Anteriores';

/** An unread urgent alert: pinned above everything else until it is read. */
export const isPinned = (n: Notif) => n.notif_type === 'warning' && !n.is_read;

/**
 * The same list with unread urgent alerts first (Phase 4.7: urgent pinned
 * first), each part keeping the server's order (newest first). Client-side
 * only: the API has no priority field, `warning` is the urgent type.
 */
export function pinUrgent(list: Notif[]): Notif[] {
  return [...list.filter(isPinned), ...list.filter((n) => !isPinned(n))];
}

/** Group for the sheet/page (BACKLOG P1-B2): unread urgent alerts pinned in
 *  «Urgentes», then by recency. */
export function groupNotifs(list: Notif[], now = new Date()): { label: NotifGroup; items: Notif[] }[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekAgo = startOfToday - 6 * 86_400_000;
  const buckets: Record<NotifGroup, Notif[]> = { Urgentes: [], Hoy: [], 'Esta semana': [], Anteriores: [] };
  for (const n of list) {
    if (isPinned(n)) { buckets.Urgentes.push(n); continue; }
    const t = new Date(n.created_at).getTime();
    if (t >= startOfToday) buckets.Hoy.push(n);
    else if (t >= weekAgo) buckets['Esta semana'].push(n);
    else buckets.Anteriores.push(n);
  }
  return (Object.keys(buckets) as NotifGroup[])
    .map((label) => ({ label, items: buckets[label] }))
    .filter((g) => g.items.length > 0);
}
