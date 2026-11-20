/**
 * Image field (contract C5 «Image»): choose from the library or upload right
 * here (drag and drop or a button, with progress and the same limits as
 * «Medios»), write the alt text on the spot, and see the size with a warning
 * when the photo is too small for its place. Stores a library id, or keeps a
 * built-in site photo path, exactly as before.
 */
import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Image as ImageIcon, Search, UploadCloud, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { contentApi, type MediaAsset } from '@/services/api';
import { toPaged } from '@/lib/pagination';
import { describedBy, FieldNotes, RequiredMark, type FieldBaseProps } from './FieldShell';
import { mediaOneKey, rememberAsset, saveAlt, useMediaAsset, useMediaUpload, type UploadRow } from './media';

export type ImageValue = number | string | null | undefined;

const thumbOf = (v: ImageValue) => (typeof v === 'number' ? `/api/v1/content/media/${v}/thumb/` : typeof v === 'string' && v.startsWith('/') ? v : '');

/** Width a slot needs when the spec does not say (a card or half-width photo at double density). */
export const DEFAULT_MIN_WIDTH = 800;

export interface ImageFieldProps extends FieldBaseProps {
  value: ImageValue;
  onChange: (ref: number | string | null) => void;
  /** Narrowest width (px) that looks sharp in this slot. */
  minWidth?: number;
  /** Error about the alt text (shown under the alt input). */
  altError?: string;
  /** Ask for the alt text here (default true). */
  askAlt?: boolean;
  /** Extra controls under the image (e.g. a caption input in a gallery). */
  children?: ReactNode;
}

export function ImageField({ id, label, required, hint, error, warning, onBlur, value, onChange, minWidth = DEFAULT_MIN_WIDTH, altError, askAlt = true, children }: ImageFieldProps) {
  const qc = useQueryClient();
  const asset = useMediaAsset(value);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Size of a built-in site photo, read when its thumbnail loads (tagged with the value it belongs to).
  const [naturalOf, setNatural] = useState<{ ref: ImageValue; w: number; h: number } | null>(null);
  const natural = naturalOf && naturalOf.ref === value ? naturalOf : null;
  const { rows, upload, clear } = useMediaUpload();
  const altRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const isLibrary = typeof value === 'number';
  const src = thumbOf(value);
  const width = isLibrary ? asset?.width || 0 : natural?.w ?? 0;
  const height = isLibrary ? asset?.height || 0 : natural?.h ?? 0;
  const tooSmall = width > 0 && width < minWidth
    ? `Esta foto mide ${width} px de ancho; aquí se recomienda al menos ${minWidth} px para que no se vea borrosa.`
    : undefined;
  const uploading = rows.some((r) => r.status === 'uploading');

  /** After choosing an image, the alt text is asked for at once when it is missing. */
  const picked = (a: MediaAsset | number) => {
    const assetId = typeof a === 'number' ? a : a.id;
    if (typeof a !== 'number') rememberAsset(qc, a);
    onChange(assetId);
    onBlur?.();
    if (askAlt && (typeof a === 'number' || !a.alt)) setTimeout(() => altRef.current?.focus(), 50);
  };
  const uploadFiles = async (files: File[]) => {
    const done = await upload(files.slice(0, 1));
    if (done[0]) { picked(done[0]); setTimeout(clear, 2500); }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void uploadFiles(Array.from(e.dataTransfer.files ?? []));
  };

  return (
    <div
      data-image-field=""
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={onDrop}
      className={`rounded-xl border p-3 transition-colors ${dragging ? 'border-purple bg-purple/5' : error ? 'border-coral-400' : 'border-line'}`}
    >
      <p className="label">{label}<RequiredMark required={required} /></p>
      <div className="flex items-start gap-3">
        <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-cream-2 ring-1 ring-line">
          {src && asset !== null ? (
            <img src={src} alt="" className="h-full w-full object-cover" onLoad={(e) => { if (!isLibrary) setNatural({ ref: value, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }); }} />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-subtle"><ImageIcon size={22} aria-hidden="true" /></span>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-sm font-medium text-ink">
            {asset === null ? 'La imagen ya no existe en la biblioteca' : isLibrary ? asset?.filename ?? 'Imagen de la biblioteca' : value ? 'Foto original del sitio' : 'Sin imagen'}
          </p>
          {width > 0 && <p className="text-xs tabular-nums text-subtle">{width} × {height} px</p>}
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            <Button id={id} type="button" size="sm" variant="secondary" onClick={() => setOpen(true)} aria-describedby={describedBy(id, { hint, error, warning: warning ?? tooSmall })} aria-invalid={error ? true : undefined} aria-label={`${value ? 'Cambiar' : 'Elegir o subir'} ${label}`}>
              {value ? 'Cambiar' : 'Elegir o subir'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => fileRef.current?.click()} disabled={uploading} aria-label={`Subir una foto para ${label}`}>
              <UploadCloud size={15} aria-hidden="true" /> Subir
            </Button>
            {value ? <Button type="button" size="sm" variant="ghost" onClick={() => { onChange(null); onBlur?.(); }} aria-label={`Quitar ${label}`}><X size={15} aria-hidden="true" /> Quitar</Button> : null}
          </div>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { void uploadFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      <UploadRows rows={rows} />
      {!value && !rows.length && <p className="mt-2 text-xs text-subtle">También puede arrastrar una foto desde su computadora a este recuadro.</p>}
      {isLibrary && asset && askAlt && <AltInput key={asset.id} inputRef={altRef} asset={asset} error={altError} fieldId={id} onBlur={onBlur} />}
      {children}
      <FieldNotes id={id} hint={hint} error={error} warning={warning ?? tooSmall} />
      <MediaLibraryDialog open={open} onClose={() => setOpen(false)} current={value} onPick={(list) => { setOpen(false); if (list[0]) picked(list[0]); }} />
    </div>
  );
}

/** The library's alt text for this image, edited in place (saved shortly after typing). */
function AltInput({ asset, error, fieldId, inputRef, onBlur }: { asset: MediaAsset; error?: string; fieldId: string; inputRef: React.RefObject<HTMLInputElement>; onBlur?: () => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(asset.alt ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saved = useRef(asset.alt ?? '');
  const id = `${fieldId}-alt`;
  const commit = async (text: string) => {
    if (text.trim() === saved.current.trim()) return;
    setState('saving');
    try { await saveAlt(qc, asset.id, text.trim()); saved.current = text.trim(); setState('saved'); } catch { setState('error'); }
  };
  useEffect(() => {
    if (draft.trim() === saved.current.trim()) return;
    // The validation sees the new text at once; the library is updated after a pause.
    qc.setQueryData<MediaAsset | null>(mediaOneKey(asset.id), (prev) => (prev ? { ...prev, alt: draft } : prev));
    const t = setTimeout(() => { void commit(draft); }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  const missing = !draft.trim();
  const shownError = missing ? error : undefined;
  return (
    <div className="mt-3">
      <label className="label" htmlFor={id}>Descripción de la foto (texto alternativo)<RequiredMark required /></label>
      <input
        id={id}
        ref={inputRef}
        className={`input-field ${shownError ? 'border-coral-400 focus:border-coral-400 focus:ring-coral-400/20' : ''}`}
        value={draft}
        placeholder="Ej.: Alumnas de primaria leyendo en la biblioteca"
        onChange={(e) => { setDraft(e.target.value); setState('idle'); }}
        onBlur={() => { void commit(draft); onBlur?.(); }}
        aria-invalid={shownError ? true : undefined}
        aria-describedby={`${id}-hint${shownError ? ` ${id}-error` : ''}`}
      />
      {shownError && <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-coral-600">{shownError}</p>}
      <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted" aria-live="polite">
        {state === 'saving' ? 'Guardando en la biblioteca…' : state === 'saved' ? <span className="inline-flex items-center gap-1 text-green-dark"><CheckCircle2 size={12} aria-hidden="true" /> Guardada en la biblioteca.</span> : state === 'error' ? 'No se pudo guardar; intente de nuevo.' : 'Diga qué se ve en la foto, para quien no puede verla y para Google. Se guarda en la biblioteca y vale en todo el sitio.'}
      </p>
    </div>
  );
}

function UploadRows({ rows }: { rows: UploadRow[] }) {
  if (!rows.length) return null;
  return (
    <ul className="mt-2 space-y-1.5" aria-live="polite" aria-label="Subidas">
      {rows.map((r) => (
        <li key={r.key} className="text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-ink">{r.name}</span>
            <span className={r.status === 'error' ? 'text-coral-600' : r.status === 'uploading' ? 'text-subtle' : 'text-green-dark'}>
              {r.status === 'uploading' ? `${r.pct}%` : r.status === 'error' ? 'No se subió' : 'Lista'}
            </span>
          </div>
          {r.status === 'uploading' && (
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-cream-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.pct} aria-label={`Subiendo ${r.name}`}>
              <div className="h-full rounded-full bg-purple transition-[width]" style={{ width: `${r.pct}%` }} />
            </div>
          )}
          {r.message && <p className={r.status === 'error' ? 'text-coral-600' : 'text-subtle'}>{r.message}</p>}
        </li>
      ))}
    </ul>
  );
}

export interface MediaLibraryDialogProps {
  open: boolean;
  onClose: () => void;
  /** Pick several (gallery fields): the picked ids arrive together. */
  multiple?: boolean;
  current?: ImageValue;
  onPick: (ids: number[]) => void;
}

/** The library with an upload area on top: an uploaded photo is picked at once. */
export function MediaLibraryDialog({ open, onClose, multiple = false, current, onPick }: MediaLibraryDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title={multiple ? 'Agregar fotos' : 'Elegir o subir una imagen'} maxWidth={760}>
      {open && <LibraryBody multiple={multiple} current={current} onPick={onPick} onClose={onClose} />}
    </Modal>
  );
}

function LibraryBody({ multiple, current, onPick, onClose }: { multiple: boolean; current?: ImageValue; onPick: (ids: number[]) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<number[]>([]);
  const [dragging, setDragging] = useState(false);
  const { rows, upload } = useMediaUpload();
  const fileRef = useRef<HTMLInputElement>(null);
  const uid = useId();
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['admin-media', 'picker', q],
    queryFn: async ({ pageParam }) => toPaged<MediaAsset>((await contentApi.adminListMedia({ q: q || undefined, page: pageParam })).data),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (all.reduce((n, pg) => n + pg.results.length, 0) < last.count && last.results.length > 0 ? all.length + 1 : undefined),
  });
  const assets = data?.pages.flatMap((pg) => pg.results) ?? [];
  const uploadFiles = async (files: File[]) => {
    const done = await upload(multiple ? files : files.slice(0, 1));
    if (!done.length) return;
    if (multiple) setChosen((c) => [...c, ...done.map((a) => a.id).filter((id) => !c.includes(id))]);
    else onPick([done[0].id]);
  };
  const toggle = (id: number) => {
    if (!multiple) { onPick([id]); return; }
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  };
  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void uploadFiles(Array.from(e.dataTransfer.files ?? [])); }}
        className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-4 text-center ${dragging ? 'border-purple bg-purple/5' : 'border-line bg-cream-2/50'}`}
      >
        <UploadCloud size={24} className="text-purple" aria-hidden="true" />
        <p className="text-sm text-ink">Arrastre {multiple ? 'fotos' : 'una foto'} aquí o</p>
        <Button type="button" size="sm" onClick={() => fileRef.current?.click()}>Subir desde la computadora</Button>
        <p className="text-xs text-subtle">JPG, PNG, WebP o GIF de hasta 10 MB. Para portadas, al menos 1600 px de ancho.</p>
        <input ref={fileRef} id={`${uid}-file`} type="file" multiple={multiple} accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { void uploadFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
        <div className="w-full text-left"><UploadRows rows={rows} /></div>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
        <input className="input-field pl-9" placeholder="Buscar en la biblioteca…" aria-label="Buscar imágenes" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {isError ? (
        <ErrorState title="No se pudo cargar la biblioteca" onRetry={() => refetch()} />
      ) : isLoading ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label="Cargando imágenes">
          {[0, 1, 2, 3, 4].map((i) => <li key={i} className="skeleton aspect-square rounded-lg" />)}
        </ul>
      ) : assets.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{q ? 'Ninguna imagen coincide con la búsqueda.' : 'La biblioteca está vacía: suba la primera foto arriba.'}</p>
      ) : (
        <ul className="grid max-h-[45vh] grid-cols-3 gap-2 overflow-y-auto p-0.5 sm:grid-cols-5" aria-label="Imágenes de la biblioteca">
          {assets.map((a) => {
            const on = multiple ? chosen.includes(a.id) : current === a.id;
            return (
              <li key={a.id}>
                <button type="button" onClick={() => toggle(a.id)} aria-pressed={on} aria-label={`${a.alt || a.filename}${a.width ? `, ${a.width} × ${a.height} px` : ''}${a.alt ? '' : ', sin descripción'}`} className={`block aspect-square w-full overflow-hidden rounded-lg ring-2 ${on ? 'ring-purple' : 'ring-transparent hover:ring-purple/40'}`}>
                  <img src={a.urls.thumb ?? a.urls.original} alt="" className="h-full w-full object-cover" loading="lazy" />
                </button>
                <span className="mt-0.5 block truncate text-[10px] text-subtle">{a.width ? `${a.width} px` : ''}{!a.alt && <span className="text-coral-600"> · sin descripción</span>}</span>
              </li>
            );
          })}
        </ul>
      )}
      {hasNextPage && !isError && (
        <div className="flex justify-center"><Button type="button" size="sm" variant="secondary" loading={isFetchingNextPage} onClick={() => fetchNextPage()}>Cargar más</Button></div>
      )}
      {multiple && (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="button" disabled={chosen.length === 0} onClick={() => onPick(chosen)}>Agregar {chosen.length || ''} {chosen.length === 1 ? 'foto' : 'fotos'}</Button>
        </div>
      )}
    </div>
  );
}
