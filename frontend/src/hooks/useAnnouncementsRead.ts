import { useEffect } from 'react';
import { portalApi } from '@/services/api';
import type { Announcement } from '@/types';

/**
 * Fire-and-forget read receipts for the announcements a user has on screen.
 * Idempotent server-side (unique per announcement+user), so re-renders and
 * revisits never double-count. Failures are swallowed — read tracking must
 * never disturb the dashboard.
 */
export function useAnnouncementsRead(announcements: Announcement[] | undefined) {
  const key = (announcements ?? []).map((a) => a.id).join(',');

  useEffect(() => {
    if (!key) return;
    void portalApi.markAnnouncementsRead(key.split(',').map(Number)).catch(() => {});
  }, [key]);
}
