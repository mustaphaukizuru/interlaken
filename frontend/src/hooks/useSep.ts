import { useSiteSettings } from './useSiteSettings';
import { resolveSep, type SepIncorporation } from '@/lib/sepIncorporations';

/** SEP registrations edited once in Ajustes (BACKLOG P3-8). */
export function useSep(): SepIncorporation[] {
  const s = useSiteSettings();
  return resolveSep(s.sep_incorporations);
}
