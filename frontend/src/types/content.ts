/** Shape of GET /api/v1/content/settings/ (apps/content — CMS Phase 1). */
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
  facebook_url: string;
  instagram_url: string;
  youtube_url: string;
  updated_at?: string;
}
