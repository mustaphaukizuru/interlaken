import { useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image as ImageIcon, UploadCloud, Search, Trash2, Copy, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { ADMIN_PAGE_SIZE, toPaged } from '@/lib/pagination';
import { useUrlPage, useUrlSyncedSearch } from '@/hooks/useUrlFilters';
import { contentApi, type MediaAsset } from '@/services/api';

const MAX_BYTES = 10 * 1024 * 1024;

/** /admin/contenido/medios — CMS media library (CMS-PLAN phase 1, BACKLOG P3-1). */
export default function AdminMedia() {
  const qc = useQueryClient();
  const { input: q, setInput: setQ, search: debouncedQ } = useUrlSyncedSearch('q');
  const [page, setPage] = useUrlPage();
  const [selected, setSelected] = useState<MediaAsset | null>(null);
  const [toDelete, setToDelete] = useState<MediaAsset | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-media', page, debouncedQ],
    queryFn: async () => toPaged<MediaAsset>((await contentApi.adminListMedia({ page, q: debouncedQ || undefined })).data),
    placeholderData: keepPreviousData,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-media'] });
  const upload = useMutation({
    mutationFn: (files: File[]) => Promise.all(files.map((f) => contentApi.adminUploadMedia(f))),
    onSuccess: (res) => { toast.success(`${res.length} imagen(es) subida(s). Agregue el texto alternativo.`); invalidate(); },
    onError: () => toast.error('Alguna imagen no se pudo subir (máx. 10 MB, JPG/PNG/WebP/GIF).'),
  });
  const remove = useMutation({
    mutationFn: (id: number) => contentApi.adminDeleteMedia(id),
    onSuccess: () => { toast.success('Imagen eliminada.'); setToDelete(null); setSelected(null); invalidate(); },
    onError: () => toast.error('No se pudo eliminar.'),
  });

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) => f.size <= MAX_BYTES);
    e.target.value = '';
    if (files.length) upload.mutate(files);
  };
  const rows = data?.results ?? [];
  const missingAlt = rows.filter((a) => !a.alt).length;

  return (
    <>
      <PageHeader
        title="Biblioteca de medios"
        subtitle="Imágenes del sitio público. Cada imagen necesita texto alternativo antes de publicarse."
        actions={(
          <>
            <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" onChange={onPick} />
            <Button loading={upload.isPending} onClick={() => fileRef.current?.click()}><UploadCloud size={16} aria-hidden="true" /> Subir imágenes</Button>
          </>
        )}
      />
      <Card title={`${data?.count ?? 0} imágenes${missingAlt ? ` · ${missingAlt} sin texto alternativo` : ''}`}>
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
          <input className="input-field pl-9" placeholder="Buscar por nombre, alt o etiqueta…" aria-label="Buscar imágenes" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {isError ? <ErrorState onRetry={() => refetch()} /> : isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{[...Array(10)].map((_, i) => <div key={i} className="skeleton aspect-square rounded-xl" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={ImageIcon} title="Sin imágenes" description="Suba las fotos del campus, niveles y galería para usarlas en las páginas." />
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Imágenes">
              {rows.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => setSelected(a)} className="group relative block aspect-square w-full overflow-hidden rounded-xl bg-cream-2 ring-1 ring-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40" aria-label={`Editar ${a.filename}`}>
                    <img src={a.urls.thumb ?? a.urls.original} alt={a.alt || ''} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
                    {!a.alt && <span className="absolute left-2 top-2 rounded-full bg-coral px-2 py-0.5 text-[10px] font-bold text-white">Sin alt</span>}
                    <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-ink/70 to-transparent px-2 pb-1.5 pt-6 text-left text-[11px] text-white">{a.filename}</span>
                  </button>
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} count={data?.count ?? 0} onChange={setPage} itemLabel="imágenes" />
          </>
        )}
      </Card>

      <Modal open={!!selected} onClose={() => setSelected(null)} title="Detalles de la imagen" maxWidth={640}>
        {selected && <AssetForm key={selected.id} asset={selected} onClose={() => setSelected(null)} onSaved={invalidate} onDelete={() => setToDelete(selected)} />}
      </Modal>
      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        title="Eliminar imagen" message={`Se borrará "${toDelete?.filename ?? ''}" y sus variantes. Las páginas que la usen mostrarán un hueco.`} confirmLabel="Eliminar" loading={remove.isPending} />
    </>
  );
}

function AssetForm({ asset, onClose, onSaved, onDelete }: { asset: MediaAsset; onClose: () => void; onSaved: () => void; onDelete: () => void }) {
  const [alt, setAlt] = useState(asset.alt);
  const [caption, setCaption] = useState(asset.caption);
  const [tags, setTags] = useState(asset.tags);
  const [copied, setCopied] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => contentApi.adminUpdateMedia(asset.id, { alt: alt.trim(), caption: caption.trim(), tags: tags.trim() }),
    onSuccess: () => { toast.success('Guardado.'); onSaved(); onClose(); },
    onError: () => toast.error('No se pudo guardar.'),
  });
  const copy = async (key: string, url: string) => {
    try { await navigator.clipboard.writeText(`${window.location.origin}${url}`); setCopied(key); setTimeout(() => setCopied(null), 1500); } catch { toast.error('No se pudo copiar.'); }
  };
  return (
    <div className="grid gap-5 sm:grid-cols-[200px_1fr]">
      <div>
        <img src={asset.urls.md ?? asset.urls.original} alt={asset.alt || ''} className="w-full rounded-xl ring-1 ring-line" />
        <p className="mt-2 text-xs text-subtle">{asset.width}×{asset.height} · {(asset.size / 1024).toFixed(0)} KB · {asset.content_type}</p>
        <ul className="mt-2 space-y-1 text-xs">
          {Object.entries(asset.urls).map(([k, u]) => (
            <li key={k}>
              <button type="button" onClick={() => copy(k, u)} className="inline-flex items-center gap-1 text-purple hover:underline">
                {copied === k ? <Check className="h-3 w-3" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />} URL {k}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-4">
        <Input label="Texto alternativo (requerido para publicar)" value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={200} hint="Describa la imagen para lectores de pantalla y SEO." />
        <Input label="Pie de foto" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={300} />
        <Input label="Etiquetas" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="campus, primaria, deportes" />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button variant="ghost" onClick={onDelete} className="min-h-[44px] text-coral"><Trash2 className="h-4 w-4" aria-hidden="true" /> Eliminar</Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} className="min-h-[44px]">Cancelar</Button>
            <Button loading={save.isPending} onClick={() => save.mutate()} className="min-h-[44px]">Guardar</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
