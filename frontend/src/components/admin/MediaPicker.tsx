import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Image as ImageIcon, Search, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { contentApi, type MediaAsset } from '@/services/api';
import { toPaged } from '@/lib/pagination';

const mediaUrl = (id: number, variant = 'thumb') => `/api/v1/content/media/${id}/${variant}/`;

/** Field that picks a MediaAsset id from the library (CMS editor, BACKLOG P3-4). */
export function MediaPicker({ value, onChange, label }: { value?: number | null; onChange: (id: number | null) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  // Paged (20 per page) with «Cargar más»: the first page alone hid every
  // older image from the editor.
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['admin-media', 'picker', q],
    queryFn: async ({ pageParam }) => toPaged<MediaAsset>((await contentApi.adminListMedia({ q: q || undefined, page: pageParam })).data),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (all.reduce((n, pg) => n + pg.results.length, 0) < last.count && last.results.length > 0 ? all.length + 1 : undefined),
    enabled: open,
  });
  const assets = data?.pages.flatMap((pg) => pg.results) ?? [];
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
        {isError ? (
          <ErrorState title="No se pudo cargar la biblioteca" onRetry={() => refetch()} />
        ) : isLoading ? (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="Cargando imágenes">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <li key={i} className="skeleton aspect-square rounded-lg" />)}
          </ul>
        ) : assets.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">{q ? 'Ninguna imagen coincide con la búsqueda.' : 'La biblioteca está vacía.'}</p>
        ) : (
        <ul className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4" aria-label="Imágenes">
          {assets.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => { onChange(a.id); setOpen(false); }} className={`block aspect-square w-full overflow-hidden rounded-lg ring-2 ${value === a.id ? 'ring-purple' : 'ring-transparent hover:ring-purple/40'}`} aria-label={a.alt || a.filename}>
                <img src={a.urls.thumb ?? a.urls.original} alt={a.alt || ''} className="h-full w-full object-cover" loading="lazy" />
              </button>
              {!a.alt && <span className="block text-[10px] text-coral-600">Sin alt</span>}
            </li>
          ))}
        </ul>
        )}
        {hasNextPage && !isError && (
          <div className="flex justify-center">
            <Button type="button" size="sm" variant="secondary" loading={isFetchingNextPage} onClick={() => fetchNextPage()}>Cargar más</Button>
          </div>
        )}
        <p className="text-xs text-subtle">¿Falta una imagen? Súbala en Biblioteca de medios.</p>
      </Modal>
    </div>
  );
}

export default MediaPicker;
