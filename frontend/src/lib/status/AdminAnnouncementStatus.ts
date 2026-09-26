import type { AnnouncementAttachment } from '@/services/api';
import type { BadgeVariant } from './importRow';

/** A comunicado as the admin list returns it (Data Ops Phase 8). */
export interface AdminAnnouncement {
  id: number;
  title: string;
  body: string;
  audience: string;
  is_active: boolean;
  push_enabled: boolean;
  created_at: string;
  show_on_site?: boolean;
  site_until?: string | null;
  site_link?: string;
  publish_at?: string | null;
  requires_ack?: boolean;
  attachments?: AnnouncementAttachment[];
  ack_count?: number;
  created_by_name: string;
  read_count: number;
}

export const AUDIENCES: { value: string; label: string; variant: BadgeVariant }[] = [
  { value: 'all', label: 'Todos', variant: 'info' },
  { value: 'parents', label: 'Padres', variant: 'success' },
  { value: 'students', label: 'Alumnos', variant: 'warning' },
  { value: 'staff', label: 'Personal', variant: 'neutral' },
];

export const audienceMeta = (a: string) => AUDIENCES.find((x) => x.value === a) ?? AUDIENCES[0];

/** Lifecycle chip: programado (publish_at in the future), activo, inactivo. */
export function announcementStatus(a: Pick<AdminAnnouncement, 'is_active' | 'publish_at'>, now = Date.now()): { label: string; variant: BadgeVariant } {
  if (!a.is_active) return { label: 'Inactivo', variant: 'neutral' };
  if (a.publish_at && new Date(a.publish_at).getTime() > now) return { label: 'Programado', variant: 'info' };
  return { label: 'Activo', variant: 'success' };
}
