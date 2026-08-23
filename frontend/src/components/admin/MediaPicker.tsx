import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Image as ImageIcon, Search, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { contentApi, type MediaAsset } from '@/services/api';
import { toPaged } from '@/lib/pagination';

const mediaUrl = (id: number, variant = 'thumb') => `/api/v1/content/media/${id}/${variant}/`;

/** Field that picks a MediaAsset id from the library (CMS editor, BACKLOG P3-4). */
export function MediaPicker({ value, onChange, label }: { value?: number | null; onChange: (id: number | null) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const { data } = useQuery({
    queryKey: ['admin-media', 'picker', q],
    queryFn: async () => toPaged<MediaAsset>((await contentApi.adminListMedia({ q: q || undefined })).data),
    enabled: open,
  });
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex items-center gap-3">
        {value ? (
          <img src={mediaUrl(value)} alt="" className="h-16 w-16 rounded-lg object-cover ring-1 ring-line" />
        ) : (
          <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-cream-2 text-subtle"><ImageIcon size={20} aria-hidden="true" /></span>
        )}
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>{value ? 'Cambiar' : 'Elegir imagen'}</Button>
          {value && <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}><X className="h-4 w-4" aria-hidden="true" /> Quitar</Button>}
        </div>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Elegir imagen" maxWidth={720}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
          <input className="input-field pl-9" placeholder="Buscar…" aria-label="Buscar imágenes" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ul className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4" aria-label="Imágenes">
          {(data?.results ?? []).map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => { onChange(a.id); setOpen(false); }} className={`block aspect-square w-full overflow-hidden rounded-lg ring-2 ${value === a.id ? 'ring-purple' : 'ring-transparent hover:ring-purple/40'}`} aria-label={a.alt || a.filename}>
                <img src={a.urls.thumb ?? a.urls.original} alt={a.alt || ''} className="h-full w-full object-cover" loading="lazy" />
              </button>
              {!a.alt && <span className="block text-[10px] text-coral-600">Sin alt</span>}
            </li>
          ))}
        </ul>
        <p className="text-xs text-subtle">¿Falta una imagen? Súbala en Biblioteca de medios.</p>
      </Modal>
    </div>
  );
}

export default MediaPicker;
