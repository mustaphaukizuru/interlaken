/**
 * siteContact.ts — defaults + pure helpers for admin-editable contact data
 * (CMS Phase 1). The server values come from /api/v1/content/settings/ via
 * useSiteSettings(); these defaults render instantly (no flicker) and keep
 * the site meaningful if the API is unreachable. They mirror the backend
 * model defaults — update both together.
 */
import type { SiteSettings } from '@/types/content';

export const SITE_DEFAULTS: SiteSettings = {
  phone_display: '(55) 5379-1188',
  phone_e164: '+525553791188',
  whatsapp_number: import.meta.env.VITE_WHATSAPP_NUMBER || '5215553791188',
  contact_email: 'colegio@interlaken.edu.mx',
  address: 'Av. de los Reyes 67, Residencial el Dorado, Tlalnepantla, Estado de México',
  maps_url: 'https://maps.app.goo.gl/Xd241Sht8TmrMHUe6',
  office_hours: 'Lunes–Viernes 8:00–16:00 hrs',
  // Empty = la sección «Conócenos en video» no se muestra en el sitio.
  video_url: '',
  // Empty = icon hidden. Confirmado por el cliente: solo Facebook.
  facebook_url: 'https://www.facebook.com/colegiointerlaken',
  instagram_url: '',
  youtube_url: '',
};

/** wa.me deep link; `message` is plain text (encoded here). */
export function waHref(number: string, message: string): string {
  return `https://wa.me/${number.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
}

export interface SocialEntry {
  key: 'facebook' | 'instagram' | 'youtube';
  label: string;
  href: string;
}

/** Only socials with a configured URL — placeholders never render. */
export function socialEntries(s: SiteSettings): SocialEntry[] {
  const all: SocialEntry[] = [
    { key: 'facebook', label: 'Facebook', href: s.facebook_url },
    { key: 'instagram', label: 'Instagram', href: s.instagram_url },
    { key: 'youtube', label: 'YouTube', href: s.youtube_url },
  ];
  return all.filter((e) => e.href.trim() !== '');
}
