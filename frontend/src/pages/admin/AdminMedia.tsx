import { useRef, useState, type DragEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, CheckCircle2, Copy, Image as ImageIcon, Tag, Trash2, UploadCloud, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { parseSort, serializeSort, type SortState } from '@/components/ui/SortableTh';
import { ExportMenu } from '@/components/admin/ExportMenu';
import { FilterBar } from '@/components/admin/FilterBar';
import { BulkActionBar } from '@/components/admin/BulkActionBar';
import { BulkConfirmDialog } from '@/components/admin/BulkConfirmDialog';
import { useUrlFilters, useUrlPage } from '@/hooks/useUrlFilters';
import { useRowSelection } from '@/hooks/useRowSelection';
import { MEDIA_ENTITY, useMediaBulk, useMediaExport, useMediaList } from '@/hooks/queries/AdminContentQueries';
import { invalidateEntity } from '@/hooks/queries/keys';
import { mediaAdminApi } from '@/services/AdminContentApi';
import { contentApi, type BulkActionDef, type MediaAsset } from '@/services/api';
import { idsParam, type ExportFormat } from '@/services/dataOps';
import { apiErrorMessage, apiErrorStatus } from '@/lib/apiErrors';
import { formatDateTime } from '@/lib/format';
import { checkMediaFile, formatBytes } from '@/lib/status/AdminContentStatus';

const TYPE_OPTIONS = [
  { value: 'jpeg', label: 'JPG' }, { value: 'png', label: 'PNG' }, { value: 'webp', label: 'WebP' }, { value: 'gif', label: 'GIF' },
];
const USE_OPTIONS = [
  { value: '0', label: 'En uso' },
  { value: '1', label: 'Sin usar' },
];

const BULK_ACTIONS: BulkActionDef[] = [
  { name: 'add_tag', label: 'Agregar etiqueta', planVerb: 'Se etiquetarán', icon: Tag },
  { name: 'delete', label: 'Eliminar sin usar', planVerb: 'Se eliminarán', danger: true, icon: Trash2 },
];

/** One line of the upload report: every dropped file gets a visible outcome. */
interface UploadResult {
  name: string;
  status: 'uploading' | 'ok' | 'error' | 'duplicate';
  message?: string;
  existing?: MediaAsset;
}

/** /admin/contenido/medios — CMS media library (CMS-PLAN phase 1, BACKLOG P3-1) on the
 *  Data Ops list contract (Phase 8): native drag-and-drop upload with a per-file report
 *  (duplicates detected by content hash), filters, bulk tag/delete of unused images, export. */
export default function AdminMedia() {
  const qc = useQueryClient();
  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const sort = parseSort(get('orden'));
  const filters = {
    q: get('q') || undefined,
    type: get('tipo') || undefined,
    unreferenced: get('uso') || undefined,
    missing_alt: get('alt') || undefined,
    from: get('desde') || undefined,
    to: get('hasta') || undefined,
    ordering: serializeSort(sort) || undefined,
  };
  const { data, isLoading, isError, refetch } = useMediaList({ page, ...filters });
  const exportMedia = useMediaExport();
  const bulk = useMediaBulk();
  const rows = data?.results;
  const count = data?.count ?? 0;
  const selection = useRowSelection(count, JSON.stringify(filters));

  const [selected, setSelected] = useState<MediaAsset | null>(null);
  const [toDelete, setToDelete] = useState<MediaAsset | null>(null);
  const [bulkAction, setBulkAction] = useState<BulkActionDef | null>(null);
  const [tagPrompt, setTagPrompt] = useState(false);
  const [tag, setTag] = useState('');
  const [results, setResults] = useState<UploadResult[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const invalidate = () => { void invalidateEntity(qc, MEDIA_ENTITY); void qc.invalidateQueries({ queryKey: ['admin-media'] }); };

  const remove = useMutation({
    mutationFn: (id: number) => contentApi.adminDeleteMedia(id),
    onSuccess: () => { toast.success('Imagen eliminada.'); setToDelete(null); setSelected(null); invalidate(); },
    onError: () => toast.error('No se pudo eliminar.'),
  });

  const uploadFiles = async (files: File[]) => {
    if (!files.length) return;
    const initial: UploadResult[] = files.map((f) => {
      const err = checkMediaFile(f);
      return err ? { name: f.name, status: 'error', message: err } : { name: f.name, status: 'uploading' };
    });
    setResults(initial);
    setUploading(true);
    let ok = 0;
    // One request per file, in order: every file gets its own outcome.
    for (let i = 0; i < files.length; i += 1) {
      if (initial[i].status === 'error') continue;
      let outcome: UploadResult;
      try {
        await mediaAdminApi.upload(files[i]);
        ok += 1;
        outcome = { name: files[i].name, status: 'ok' };
      } catch (e) {
        const existing = (e as { response?: { data?: { existing?: MediaAsset } } }).response?.data?.existing;
        outcome = apiErrorStatus(e) === 409 && existing
          ? { name: files[i].name, status: 'duplicate', message: apiErrorMessage(e, 'Ya existe en la biblioteca.'), existing }
          : { name: files[i].name, status: 'error', message: apiErrorMessage(e, 'No se pudo subir.') };
      }
      setResults((prev) => prev.map((r, j) => (j === i ? outcome : r)));
    }
    setUploading(false);
    if (ok) {
      toast.success(`${ok} imagen(es) subida(s). Agregue el texto alternativo.`);
      invalidate();
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    void uploadFiles(Array.from(e.dataTransfer.files ?? []));
  };

  const fetchExport = (fmt: ExportFormat, { selectedOnly }: { selectedOnly: boolean }) =>
    exportMedia.mutateAsync({ ...filters, fmt, ids: selectedOnly && !selection.allMatching ? idsParam(selection.ids) : undefined });

  const onAction = (a: BulkActionDef) => {
    if (a.name === 'add_tag') { setTag(''); setTagPrompt(true); return; }
    setBulkAction(a);
  };

  const columns: Column<MediaAsset>[] = [
    {
      id: 'preview', header: 'Vista', hideable: false, minWidth: 72,
      cell: (a) => <img src={a.urls.thumb ?? a.urls.original} alt={a.alt || ''} loading="lazy" className="h-12 w-12 rounded-lg object-cover ring-1 ring-line" />,
    },
    { id: 'filename', header: 'Archivo', sortKey: 'filename', hideable: false, minWidth: 180, className: 'font-medium text-ink break-all', cell: (a) => a.filename },
    {
      id: 'alt', header: 'Texto alternativo', sortKey: 'alt', minWidth: 180, className: 'text-xs text-muted',
      cell: (a) => (a.alt ? a.alt : <Badge variant="error">Sin alt</Badge>),
    },
    {
      id: 'referenced', header: 'Uso', minWidth: 90,
      cell: (a) => (a.referenced ? <Badge variant="info">En uso</Badge> : <Badge variant="neutral">Sin usar</Badge>),
    },
    { id: 'type', header: 'Tipo', sortKey: 'type', minWidth: 90, className: 'text-xs text-muted', cell: (a) => a.content_type.replace('image/', '').toUpperCase() },
    { id: 'size', header: 'Tamaño', sortKey: 'size', align: 'right', minWidth: 90, className: 'text-xs text-muted tabular-nums', cell: (a) => formatBytes(a.size) },
    { id: 'dimensions', header: 'Dimensiones', minWidth: 100, defaultHidden: true, className: 'text-xs text-muted tabular-nums', cell: (a) => (a.width ? `${a.width}×${a.height}` : '—') },
    { id: 'tags', header: 'Etiquetas', minWidth: 140, className: 'text-xs text-muted', cell: (a) => a.tags || '—' },
    { id: 'created', header: 'Subida', sortKey: 'created', minWidth: 150, className: 'whitespace-nowrap text-xs text-muted', cell: (a) => formatDateTime(a.created_at) },
  ];

  return (
    <>
      <PageHeader
        title="Biblioteca de medios"
        subtitle="Imágenes del sitio público. Cada imagen necesita texto alternativo antes de publicarse."
        actions={(
          <div className="flex flex-wrap gap-2">
            <ExportMenu filenamePrefix="medios" selectedCount={selection.count} fetch={fetchExport} />
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="sr-only" aria-label="Elegir imágenes para subir" onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void uploadFiles(files); }} />
            <Button loading={uploading} onClick={() => fileRef.current?.click()}><UploadCloud size={16} aria-hidden="true" /> Subir imágenes</Button>
          </div>
        )}
      />

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-testid="media-dropzone"
        className={`mb-4 rounded-xl2 border-2 border-dashed px-4 py-5 text-center text-sm transition-colors ${dragging ? 'border-purple bg-brand-50 text-ink' : 'border-line bg-cream-2 text-muted'}`}
      >
        <UploadCloud className="mx-auto mb-1 h-6 w-6 text-subtle" aria-hidden="true" />
        Arrastre aquí sus imágenes (JPG, PNG, WebP o GIF, hasta 10 MB cada una) o use «Subir imágenes».
      </div>

      {results.length > 0 && (
        <Card className="mb-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-head text-base font-bold text-ink">Resultado de la carga</h2>
            <button type="button" onClick={() => setResults([])} aria-label="Cerrar resultado de la carga" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-subtle hover:bg-cream hover:text-ink"><X size={16} aria-hidden="true" /></button>
          </div>
          <ul className="space-y-1 text-sm" aria-live="polite" aria-label="Archivos subidos">
            {results.map((r, i) => (
              <li key={`${r.name}-${i}`} className="flex flex-wrap items-center gap-2">
                {r.status === 'ok' && <CheckCircle2 size={16} className="text-green-700" aria-hidden="true" />}
                {(r.status === 'error' || r.status === 'duplicate') && <AlertTriangle size={16} className={r.status === 'error' ? 'text-coral-600' : 'text-amber'} aria-hidden="true" />}
                <span className="break-all font-medium text-ink">{r.name}</span>
                <span className="text-muted">
                  {r.status === 'uploading' ? 'Subiendo…' : r.status === 'ok' ? 'Subida' : r.message}
                </span>
                {r.status === 'duplicate' && r.existing && (
                  <Button size="sm" variant="secondary" onClick={() => setSelected(r.existing!)}>Ya existe: usar el existente</Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={`${count.toLocaleString('es-MX')} imágenes`}>
        <DataTable<MediaAsset>
          tableId="media"
          columns={columns}
          rows={rows}
          rowKey={(a) => a.id}
          rowLabel={(a) => `imagen ${a.filename}`}
          caption="Biblioteca de medios"
          sort={sort}
          onSort={(next: SortState) => set({ orden: serializeSort(next), page: null })}
          page={page}
          count={count}
          onPage={setPage}
          itemLabel="imágenes"
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          columnControls
          resizable
          selection={selection}
          onRowClick={(a) => setSelected(a)}
          rowActions={(a) => (
            <Button size="sm" variant="ghost" onClick={() => setSelected(a)} aria-label={`Editar ${a.filename}`}>Editar</Button>
          )}
          toolbar={(
            <FilterBar
              search={{ placeholder: 'Nombre, alt, pie o etiqueta…', label: 'Buscar imágenes' }}
              tabs={{ paramKey: 'uso', options: USE_OPTIONS, allLabel: 'Todas', label: 'Filtrar por uso' }}
              selects={[
                { key: 'tipo', label: 'Tipo', options: TYPE_OPTIONS, allLabel: 'Todos los tipos' },
                { key: 'alt', label: 'Texto alternativo', options: [{ value: '1', label: 'Sin texto alternativo' }, { value: '0', label: 'Con texto alternativo' }], allLabel: 'Con o sin alt' },
              ]}
              dateRange={{ idPrefix: 'medios' }}
            />
          )}
          bulkBar={(
            <BulkActionBar
              count={selection.count}
              allMatching={selection.allMatching}
              allMatchingCount={count}
              onSelectAllMatching={selection.onSelectAllMatching}
              onClear={selection.onClear}
              actions={BULK_ACTIONS}
              onAction={onAction}
              itemLabel="imágenes"
              exportMenu={<ExportMenu label="Exportar seleccionadas" filenamePrefix="medios" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
            />
          )}
          empty={{ icon: ImageIcon, title: 'Sin imágenes', description: 'Suba las fotos del campus, niveles y galería para usarlas en las páginas.' }}
        />
      </Card>

      <Modal open={tagPrompt} onClose={() => setTagPrompt(false)} title="Agregar etiqueta" maxWidth={420}>
        <form
          className="space-y-4"
          onSubmit={(e) => { e.preventDefault(); if (!tag.trim()) return; setTagPrompt(false); setBulkAction(BULK_ACTIONS[0]); }}
        >
          <Input label="Etiqueta" value={tag} onChange={(e) => setTag(e.target.value.replace(/,/g, ''))} placeholder="campus" maxLength={40} autoComplete="off" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setTagPrompt(false)}>Cancelar</Button>
            <Button type="submit" disabled={!tag.trim()}>Continuar</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!selected} onClose={() => setSelected(null)} title="Detalles de la imagen" maxWidth={640}>
        {selected && <AssetForm key={selected.id} asset={selected} onClose={() => setSelected(null)} onSaved={invalidate} onDelete={() => setToDelete(selected)} />}
      </Modal>
      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        title="Eliminar imagen" message={`Se borrará "${toDelete?.filename ?? ''}" y sus variantes.${toDelete?.referenced ? ' Está en uso: las páginas o comunicados que la usan mostrarán un hueco.' : ''}`} confirmLabel="Eliminar" loading={remove.isPending} />
      <BulkConfirmDialog
        open={!!bulkAction}
        onClose={() => setBulkAction(null)}
        action={bulkAction}
        entityLabel="imágenes"
        ids={selection.ids}
        allMatching={selection.allMatching}
        filters={filters}
        extraPayload={bulkAction?.name === 'add_tag' ? { tag: tag.trim() } : undefined}
        execute={(body) => bulk.mutateAsync(body)}
        onDone={() => { selection.onClear(); void qc.invalidateQueries({ queryKey: ['admin-media'] }); }}
      />
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
        <p className="mt-2 text-xs text-subtle">{asset.width}×{asset.height} · {formatBytes(asset.size)} · {asset.content_type}</p>
        <ul className="mt-2 space-y-1 text-xs">
          {Object.entries(asset.urls).map(([k, u]) => (
            <li key={k}>
              <button type="button" onClick={() => { void copy(k, u); }} className="inline-flex min-h-[32px] items-center gap-1 text-purple hover:underline">
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
