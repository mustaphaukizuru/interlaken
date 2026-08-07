import { useQuery } from '@tanstack/react-query';
import { contentApi } from '@/services/api';
import { SITE_DEFAULTS } from '@/lib/siteContact';
import type { SiteSettings } from '@/types/content';

/**
 * Admin-editable site contact/social data (CMS Phase 1). Renders the
 * hardcoded defaults immediately and swaps in the server values when they
 * arrive; the server itself caches the payload for 5 minutes.
 */
export function useSiteSettings(): SiteSettings {
  const { data } = useQuery<SiteSettings>({
    queryKey: ['site-settings'],
    queryFn: async () => (await contentApi.getSettings()).data,
    staleTime: 5 * 60_000,
    placeholderData: SITE_DEFAULTS,
  });
  return data ?? SITE_DEFAULTS;
}
