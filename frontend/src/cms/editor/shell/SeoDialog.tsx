import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { MediaPicker } from '@/components/admin/MediaPicker';
import type { CmsPageAdmin } from '@/services/api';

export interface SeoMeta {
  title: string;
  slug: string;
  seo: CmsPageAdmin['seo'];
}

interface Props {
  open: boolean;
  onClose: () => void;
  meta: SeoMeta;
  onChange: (patch: Partial<SeoMeta>) => void;
  isAdmin: boolean;
  errors: Record<string, string>;
  /** The design template's own title and description, shown as placeholders. */
  placeholders: { title?: string; description?: string };
}

/** «Título, dirección y SEO» (scheduling moved to «Programar»). Edits autosave like the blocks. */
export function SeoDialog({ open, onClose, meta, onChange, isAdmin, errors, placeholders }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Título, dirección y SEO" maxWidth={520}>
      <div className="space-y-3">
        <Input label="Título de la página" value={meta.title} onChange={(e) => onChange({ title: e.target.value })} error={errors.title} />
        <Input label="Dirección (slug)" value={meta.slug} onChange={(e) => onChange({ slug: e.target.value })} error={errors.slug} disabled={!isAdmin}
          hint={isAdmin ? 'Cambiarla rompe enlaces ya compartidos.' : 'Solo Dirección puede cambiar la dirección.'} />
        <Input label="Título SEO" value={meta.seo.title ?? ''} onChange={(e) => onChange({ seo: { ...meta.seo, title: e.target.value } })}
          placeholder={placeholders.title ?? ''} hint="Máx. 60 caracteres recomendados. Vacío = el título actual del sitio." />
        <div>
          <label className="label" htmlFor="seo-desc">Descripción SEO</label>
          <textarea id="seo-desc" className="input-field" rows={3} value={meta.seo.description ?? ''} placeholder={placeholders.description ?? ''}
            onChange={(e) => onChange({ seo: { ...meta.seo, description: e.target.value } })} />
        </div>
        <MediaPicker label="Imagen al compartir (WhatsApp, Facebook)" value={meta.seo.og_image ?? null} onChange={(id) => onChange({ seo: { ...meta.seo, og_image: id ?? undefined } })} />
        <label className="flex min-h-[44px] items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={!!meta.seo.noindex} onChange={(e) => onChange({ seo: { ...meta.seo, noindex: e.target.checked } })} /> No indexar en buscadores
        </label>
        <p className="text-xs text-muted">Los cambios se guardan solos en el borrador y llegan al sitio al publicar.</p>
        <div className="flex justify-end"><Button onClick={onClose}>Listo</Button></div>
      </div>
    </Modal>
  );
}
