/** Shape of GET /api/v1/content/settings/ (apps/content — CMS Phase 1). */
export interface MenuItem { label: string; to: string; icon?: string }
export interface MenuGroup { label: string; items: MenuItem[] }

export interface SiteSettings {
  phone_display: string;
  phone_e164: string;
  whatsapp_number: string;
  contact_email: string;
  address: string;
  maps_url: string;
  office_hours: string;
  /** YouTube/Vimeo URL del video institucional; '' = sección oculta. */
  video_url: string;
  hero_video_url?: string;
  facebook_url: string;
  instagram_url: string;
  youtube_url: string;
  /** CMS menu (P3-7). Empty = built-in menu. */
  menu?: MenuGroup[];
  /** Official SEP registrations (P3-8). Empty = built-in flyer values. */
  sep_incorporations?: { level: 'Preescolar' | 'Primaria' | 'Secundaria'; label: string }[];
  updated_at?: string;
}
