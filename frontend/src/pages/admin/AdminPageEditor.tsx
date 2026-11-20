import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronLeft, ClipboardPaste, Copy, ExternalLink, Eye, EyeOff, History, Lock, Monitor, Plus, Redo2, RotateCcw, Search, Smartphone, Tablet, Trash2, Undo2, Upload, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { cmsPagePath } from '@/cms/slugPaths';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { BLOCKS, blockSpec, type Block } from '@/cms/blocks/registry';
import { BlockForm } from '@/cms/editor/BlockForm';
import { EditableBlocks } from '@/cms/editor/EditableBlocks';
import { PageErrorSummary } from '@/cms/editor/PageErrorSummary';
import { requestFieldFocus } from '@/cms/editor/fieldFocus';
import { fieldErrorsFrom, fieldErrorsFromIssues, type CmsFieldError } from '@/cms/editor/validation';
import { allSections as allSectionSpecs, templateFor } from '@/cms/sections';
import { GROUP_LABELS, loadAllGroups } from '@/cms/sections/loaders';
import { MediaPicker } from '@/components/admin/MediaPicker';
import { contentApi, type CmsPageAdmin } from '@/services/api';
import { apiFieldErrors } from '@/lib/apiErrors';
import { cmsBase, diffBlocks, isLegacyDraft, moveBlock, newBlock, newBlockId, originalBlocks, originalProps, pageStatusLabel, toLocalInput } from '@/cms/editor/helpers';
import { useAuthStore } from '@/store/authStore';
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardCheck, GripVertical, Send } from 'lucide-react';
import type { PageIssue } from '@/services/api';

type Device = 'mobile' | 'tablet' | 'desktop';

/** Copy/paste of sections between pages (and tabs) goes through localStorage. */
const CLIPBOARD_KEY = 'cms-clipboard';
function readClipboard(): Block | null {
  try {
    const v = JSON.parse(localStorage.getItem(CLIPBOARD_KEY) ?? 'null') as Block | null;
    return v && typeof v.type === 'string' && v.props && typeof v.props === 'object' ? v : null;
  } catch {
    return null;
  }
}
const DEVICE_WIDTH: Record<Device, number | undefined> = { mobile: 390, tablet: 820, desktop: undefined };

/** /admin/contenido/:id — split-view block editor (BACKLOG P3-4). */
export default function AdminPageEditor() {
  const { id } = useParams();
  const pageId = Number(id);
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';
  const base = cmsBase(role);
  const [rejecting, setRejecting] = useState(false);
  const [issues, setIssues] = useState<PageIssue[] | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const { data: page, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-page', pageId], queryFn: async () => (await contentApi.adminGetPage(pageId)).data, enabled: Number.isFinite(pageId) });

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [meta, setMeta] = useState<{ title: string; slug: string; seo: CmsPageAdmin['seo']; publish_at: string | null; unpublish_at: string | null }>({ title: '', slug: '', seo: {}, publish_at: null, unpublish_at: null });
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [device, setDevice] = useState<Device>('desktop');
  const [adding, setAdding] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showSeo, setShowSeo] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Structured server errors (save, publish, checks): next to each field and in the summary.
  const [fieldErrors, setFieldErrors] = useState<CmsFieldError[]>([]);
  const loadedFor = useRef<number | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef<HTMLDivElement>(null);
  // Where the last selection came from: the list scrolls the preview, a click in the preview scrolls the form.
  const selectSource = useRef<'list' | 'preview'>('list');
  // Undo/redo over the draft blocks. Consecutive edits of the same field are one
  // step (typing a title is not one step per keystroke); any other action starts a new one.
  const [history, setHistory] = useState<{ past: Block[][]; future: Block[][] }>({ past: [], future: [] });
  const lastEdit = useRef('');
  const [clip, setClip] = useState<Block | null>(() => readClipboard());
  const [confirmReset, setConfirmReset] = useState(false);
  // Every page's designed sections, so any section renders and can be added here.
  const [sectionsReady, setSectionsReady] = useState(false);
  useEffect(() => { let alive = true; void loadAllGroups().then(() => { if (alive) setSectionsReady(true); }); return () => { alive = false; }; }, []);

  useEffect(() => {
    if (page && loadedFor.current !== page.id) {
      loadedFor.current = page.id;
      setBlocks(page.draft_blocks ?? []);
      setHistory({ past: [], future: [] });
      lastEdit.current = '';
      setMeta({ title: page.title, slug: page.slug, seo: page.seo ?? {}, publish_at: page.publish_at ?? null, unpublish_at: page.unpublish_at ?? null });
      setDirty(false);
    }
  }, [page]);

  const save = useMutation({
    // Address and scheduling are admin-only server-side (the cron publishes on
    // those dates with no further approval): staff never send them.
    mutationFn: () => contentApi.adminUpdatePage(pageId, isAdmin
      ? { draft_blocks: blocks, title: meta.title, slug: meta.slug, seo: meta.seo, publish_at: meta.publish_at, unpublish_at: meta.unpublish_at }
      : { draft_blocks: blocks, title: meta.title, seo: meta.seo }),
    onSuccess: (res) => { setErrors({}); setDirty(false); qc.setQueryData(['admin-page', pageId], res.data); qc.invalidateQueries({ queryKey: ['admin', 'pages'] }); },
    onError: (e) => { const f = apiFieldErrors(e); setErrors(f); setFieldErrors(fieldErrorsFrom(e)); toast.error(f.detail || f.blocks || f.draft_blocks || 'No se pudo guardar el borrador.'); },
  });

  // Autosave 1.5 s after the last change.
  useEffect(() => {
    if (!dirty || !page) return;
    const t = setTimeout(() => save.mutate(), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, meta, dirty]);

  const publish = useMutation({
    mutationFn: async (action: 'publish' | 'unpublish') => { if (dirty) await save.mutateAsync(); return contentApi.adminPublishPage(pageId, action); },
    onSuccess: (res, action) => {
      toast.success(action === 'publish' ? `Publicada (versión ${res.data.version ?? res.data.published_version_number ?? ''}).` : 'Página retirada del sitio.');
      setFieldErrors([]);
      setConfirmUnpublish(false);
      qc.setQueryData(['admin-page', pageId], res.data); qc.invalidateQueries({ queryKey: ['admin', 'pages'] }); qc.invalidateQueries({ queryKey: ['cms-page'] });
    },
    onError: (e) => { const f = apiFieldErrors(e); const data = (e as { response?: { data?: { issues?: PageIssue[] } } })?.response?.data; if (data?.issues) setIssues(data.issues); setFieldErrors(fieldErrorsFrom(e)); toast.error(f.detail || f.blocks || f.draft_blocks || 'No se pudo publicar. Revise los bloques.'); setErrors(f); },
  });

  const review = useMutation({
    mutationFn: async (args: { action: 'request' | 'reject'; note?: string }) => { if (dirty) await save.mutateAsync(); return contentApi.adminReviewPage(pageId, args.action, args.note); },
    onSuccess: (res, args) => {
      toast.success(args.action === 'request' ? 'Solicitud enviada a Dirección.' : 'Cambios solicitados al editor.');
      setRejecting(false); setRejectNote('');
      qc.setQueryData(['admin-page', pageId], res.data); qc.invalidateQueries({ queryKey: ['admin', 'pages'] });
    },
    onError: (e) => toast.error(apiFieldErrors(e).detail || 'No se pudo enviar.'),
  });

  const checks = useMutation({
    mutationFn: async () => { if (dirty) await save.mutateAsync(); return contentApi.adminPageChecks(pageId); },
    onSuccess: ({ data }) => { setIssues(data.issues); setFieldErrors(fieldErrorsFromIssues(data.issues)); if (data.ok && data.issues.length === 0) toast.success('Sin problemas: lista para publicar.'); },
    onError: () => toast.error('No se pudo revisar la página.'),
  });

  const previewLink = useMutation({
    mutationFn: () => contentApi.adminPreviewToken(pageId),
    onSuccess: async ({ data }) => {
      const url = `${window.location.origin}${data.url}`;
      try { await navigator.clipboard.writeText(url); toast.success('Enlace de vista previa copiado (válido 7 días).'); } catch { window.prompt('Copie el enlace de vista previa:', url); }
    },
    onError: () => toast.error('No se pudo generar el enlace.'),
  });

  const update = (next: Block[], key = '') => {
    const sameField = key !== '' && key === lastEdit.current;
    lastEdit.current = key;
    setHistory((h) => (sameField ? { past: h.past, future: [] } : { past: [...h.past.slice(-49), blocks], future: [] }));
    setBlocks(next); setDirty(true);
  };
  const undo = () => {
    const prev = history.past[history.past.length - 1];
    if (!prev) return;
    setHistory({ past: history.past.slice(0, -1), future: [...history.future, blocks] });
    lastEdit.current = '';
    setBlocks(prev); setDirty(true);
  };
  const redo = () => {
    const next = history.future[history.future.length - 1];
    if (!next) return;
    setHistory({ past: [...history.past, blocks], future: history.future.slice(0, -1) });
    lastEdit.current = '';
    setBlocks(next); setDirty(true);
  };
  const historyActions = useRef({ undo, redo });
  useEffect(() => { historyActions.current = { undo, redo }; });
  const copyBlock = (b: Block) => {
    try { localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(b)); } catch { /* private mode: the copy lives only in this tab */ }
    setClip(b);
    toast.success('Sección copiada. Puede pegarla en esta u otra página con «Pegar».');
  };
  const pasteBlock = () => {
    if (!clip || !blockSpec(clip.type)) { toast.error('No hay una sección copiada.'); return; }
    const b: Block = { id: newBlockId(), type: clip.type, props: JSON.parse(JSON.stringify(clip.props)) };
    const at = selectedIdx >= 0 ? selectedIdx + 1 : blocks.length;
    update([...blocks.slice(0, at), b, ...blocks.slice(at)]);
    selectSource.current = 'list';
    setSelected(b.id);
  };
  const selectFromPreview = (id: string) => { selectSource.current = 'preview'; setSelected(id); };
  /** Error summary / checks list: open the section's form and focus the field. */
  const jumpToField = (id: string, field?: string) => { selectSource.current = 'preview'; setSelected(id); requestFieldFocus(id, field ?? ''); };
  const updateMeta = (patch: Partial<typeof meta>) => { setMeta((m) => ({ ...m, ...patch })); setDirty(true); };
  const selectedBlock = useMemo(() => blocks.find((b) => b.id === selected) ?? null, [blocks, selected]);
  const selectedIdx = blocks.findIndex((b) => b.id === selected);
  const isLocked = (b: Block) => !!blockSpec(b.type)?.locked;
  const toggleHidden = (b: Block) => update(blocks.map((x) => (x.id === b.id ? { ...x, hidden: !x.hidden } : x)));
  const resetBlock = (b: Block) => { const props = originalProps(meta.slug || page?.slug || '', b); if (props) update(blocks.map((x) => (x.id === b.id ? { ...x, props } : x))); };

  // Selecting in the list brings the block into view in the preview; clicking in the preview brings up its form.
  useEffect(() => {
    if (!selected) return;
    if (selectSource.current === 'preview') propsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    else previewRef.current?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(selected)}"]`)?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, [selected]);

  // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl+Y) outside text fields, which keep their own undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); historyActions.current.undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); historyActions.current.redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A section copied in another tab or page shows up here.
  useEffect(() => {
    const refresh = () => setClip(readClipboard());
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('storage', refresh); };
  }, []);

  // Leaving with an unsaved draft (autosave pending or failed) asks first.
  useEffect(() => {
    if (!dirty && !save.isPending) return;
    const onLeave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty, save.isPending]);

  if (!Number.isFinite(pageId)) return <ErrorState />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;
  if (isLoading || !page || !sectionsReady) return <div className="flex min-h-[40vh] items-center justify-center"><LoadingSpinner /></div>;
  const original = originalBlocks(page.slug);
  const legacy = isLegacyDraft(page.slug, blocks, !!page.published_version_number);
  const st = pageStatusLabel({ status: page.status, has_unpublished_changes: page.has_unpublished_changes || dirty, review_requested_at: page.review_requested_at });

  return (
    <div className="flex min-h-[calc(100svh-7rem)] flex-col">
      <PageHeader
        title={meta.title || page.title}
        subtitle={cmsPagePath(meta.slug)}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Link to={base} className="btn-outline inline-flex items-center gap-1"><ChevronLeft size={16} aria-hidden="true" /> Páginas</Link>
            <Button variant="secondary" size="sm" onClick={() => setShowSeo(true)}>SEO</Button>
            {original && <Button variant="secondary" size="sm" onClick={() => setConfirmReset(true)}><RotateCcw size={16} aria-hidden="true" /> Diseño original</Button>}
            <Button variant="secondary" size="sm" onClick={() => checks.mutate()} loading={checks.isPending}><ClipboardCheck size={16} aria-hidden="true" /> Revisar</Button>
            {/* Version history and restore are admin-only endpoints (staff would get a 403). */}
            {isAdmin && <Button variant="secondary" size="sm" onClick={() => setShowVersions(true)}><History size={16} aria-hidden="true" /> Versiones</Button>}
            <Button variant="secondary" size="sm" onClick={() => previewLink.mutate()} loading={previewLink.isPending}><Copy size={16} aria-hidden="true" /> Enlace de vista previa</Button>
            {!isAdmin && (
              <Button variant="cta" size="sm" onClick={() => review.mutate({ action: 'request' })} loading={review.isPending} disabled={!!page.review_requested_at}>
                <Send size={16} aria-hidden="true" /> {page.review_requested_at ? 'Esperando aprobación' : 'Solicitar aprobación'}
              </Button>
            )}
            {isAdmin && page.review_requested_at && (
              <Button variant="secondary" size="sm" onClick={() => setRejecting(true)}>Pedir cambios</Button>
            )}
            {isAdmin && page.status === 'published' && (
              <>
                <a href={cmsPagePath(page.slug)} target="_blank" rel="noopener noreferrer" className="btn-outline inline-flex items-center gap-1 text-sm"><ExternalLink size={16} aria-hidden="true" /> Ver en el sitio</a>
                <Button variant="danger" size="sm" onClick={() => setConfirmUnpublish(true)}><XCircle size={16} aria-hidden="true" /> Retirar</Button>
              </>
            )}
            {isAdmin && (
              <Button variant="cta" size="sm" onClick={() => publish.mutate('publish')} loading={publish.isPending} disabled={page.status === 'published' && !page.has_unpublished_changes && !dirty}>
                <Upload size={16} aria-hidden="true" /> Publicar
              </Button>
            )}
          </div>
        )}
      />

      <p className="mb-3 inline-flex flex-wrap items-center gap-2 text-xs text-subtle" aria-live="polite">
        <Badge variant={st.tone}>{st.label}</Badge> {save.isPending ? 'Guardando…' : dirty ? 'Cambios sin guardar' : 'Borrador guardado'}
        {page.review_requested_by_name && page.review_requested_at && <span>· solicitó {page.review_requested_by_name}</span>}
        {page.review_note && !page.review_requested_at && <span className="text-coral-600">· Dirección pidió cambios: {page.review_note}</span>}
        {meta.publish_at && <span className="inline-flex items-center gap-1"><CalendarClock size={12} aria-hidden="true" /> se publica {new Date(meta.publish_at).toLocaleString('es-MX')}</span>}
        {meta.unpublish_at && <span className="inline-flex items-center gap-1"><CalendarClock size={12} aria-hidden="true" /> se retira {new Date(meta.unpublish_at).toLocaleString('es-MX')}</span>}
      </p>
      {legacy && original && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber/40 bg-amber/10 p-3 text-sm" role="status">
          <p className="text-ink">Este borrador se creó con bloques genéricos y no se parece a la página actual del sitio. Cargue el diseño actual para editar la página tal como se ve hoy.</p>
          <Button size="sm" onClick={() => { update(original); setSelected(null); }}>Cargar el diseño actual</Button>
        </div>
      )}
      <PageErrorSummary blocks={blocks} serverErrors={fieldErrors} onJump={jumpToField} />
      {issues && issues.length > 0 && (
        <div className="mb-4 rounded-xl border border-line bg-white p-3" role="region" aria-label="Revisión previa a publicar">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-bold text-ink">Revisión: {issues.filter((i) => i.level === 'error').length} por corregir · {issues.filter((i) => i.level === 'warning').length} sugerencias</h2>
            <button type="button" className="text-xs text-subtle hover:text-ink" onClick={() => setIssues(null)}>Ocultar</button>
          </div>
          <ul className="space-y-1 text-sm">
            {issues.map((i, k) => (
              <li key={k} className="flex items-start gap-2">
                {i.level === 'error' ? <AlertTriangle size={16} className="mt-0.5 shrink-0 text-coral-600" aria-hidden="true" /> : <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-amber" aria-hidden="true" />}
                {i.block_id ? <button type="button" className="text-left text-ink underline-offset-2 hover:underline" onClick={() => jumpToField(i.block_id as string, i.field)}>{i.message}</button> : <span className="text-ink">{i.message}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid flex-1 gap-4 lg:grid-cols-[320px_1fr]">
        {/* Left: block list + properties */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:max-h-[calc(100svh-6rem)] lg:overflow-y-auto" aria-label="Bloques">
          <div className="card">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-head text-sm font-bold uppercase tracking-wide text-subtle">Bloques</h2>
              <div className="flex items-center gap-1">
                <button type="button" aria-label="Deshacer (Ctrl+Z)" title="Deshacer (Ctrl+Z)" disabled={history.past.length === 0} onClick={undo} className="rounded p-1.5 text-subtle hover:text-ink disabled:opacity-30"><Undo2 size={15} /></button>
                <button type="button" aria-label="Rehacer (Ctrl+Shift+Z)" title="Rehacer (Ctrl+Shift+Z)" disabled={history.future.length === 0} onClick={redo} className="rounded p-1.5 text-subtle hover:text-ink disabled:opacity-30"><Redo2 size={15} /></button>
                {clip && blockSpec(clip.type) && <Button size="sm" variant="ghost" onClick={pasteBlock} title={`Pegar: ${blockSpec(clip.type)?.label ?? clip.type}`}><ClipboardPaste size={14} aria-hidden="true" /> Pegar</Button>}
                <Button size="sm" variant="secondary" onClick={() => setAdding(true)}><Plus size={14} aria-hidden="true" /> Agregar</Button>
              </div>
            </div>
            {blocks.length === 0 ? <p className="text-sm text-muted">La página está vacía. Agregue el primer bloque.</p> : (
              <ol className="space-y-1">
                {blocks.map((b, i) => (
                  <li
                    key={b.id}
                    draggable
                    onDragStart={(e) => { setDragging(i); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragOver={(e) => { e.preventDefault(); if (dragOver !== i) setDragOver(i); }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={(e) => { e.preventDefault(); if (dragging !== null && dragging !== i) update(moveBlock(blocks, dragging, i)); setDragging(null); setDragOver(null); }}
                    onDragEnd={() => { setDragging(null); setDragOver(null); }}
                    className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm ${selected === b.id ? 'bg-purple/10 text-purple' : 'hover:bg-cream-2'} ${dragOver === i && dragging !== i ? 'ring-2 ring-purple/50' : ''} ${dragging === i ? 'opacity-50' : ''}`}
                  >
                    <span className="cursor-grab text-subtle" aria-hidden="true" title="Arrastre para reordenar"><GripVertical size={14} /></span>
                    <button type="button" className="flex-1 truncate text-left font-medium" onClick={() => setSelected(b.id)} aria-current={selected === b.id ? 'true' : undefined}>
                      <span className={b.hidden ? 'text-subtle line-through' : undefined}>{i + 1}. {blockSpec(b.type)?.label ?? b.type}</span>
                    </button>
                    <button type="button" aria-label="Subir" disabled={i === 0} className="rounded p-1 text-subtle hover:text-ink disabled:opacity-30" onClick={() => update(moveBlock(blocks, i, i - 1))}><ArrowUp size={14} /></button>
                    <button type="button" aria-label="Bajar" disabled={i === blocks.length - 1} className="rounded p-1 text-subtle hover:text-ink disabled:opacity-30" onClick={() => update(moveBlock(blocks, i, i + 1))}><ArrowDown size={14} /></button>
                    {isLocked(b) ? (
                      <span className="rounded p-1 text-subtle" title="Sección con formulario o datos del sistema: se puede mover, no ocultar ni eliminar." aria-label="Sección fija"><Lock size={14} /></span>
                    ) : (
                      <>
                        <button type="button" aria-label={b.hidden ? 'Mostrar en el sitio' : 'Ocultar del sitio'} aria-pressed={!!b.hidden} title={b.hidden ? 'Oculto: no aparece en el sitio' : 'Ocultar sin eliminar'} className={`rounded p-1 hover:text-ink ${b.hidden ? 'text-amber' : 'text-subtle'}`} onClick={() => toggleHidden(b)}>{b.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                        <button type="button" aria-label="Eliminar bloque" className="rounded p-1 text-subtle hover:text-coral-600" onClick={() => { update(blocks.filter((x) => x.id !== b.id)); if (selected === b.id) setSelected(null); }}><Trash2 size={14} /></button>
                      </>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="card scroll-mt-24" ref={propsRef}>
            {selectedBlock ? (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-head text-sm font-bold uppercase tracking-wide text-subtle">{blockSpec(selectedBlock.type)?.label ?? selectedBlock.type}</h2>
                  <div className="flex items-center gap-3">
                    {originalProps(page.slug, selectedBlock) && <button type="button" className="text-xs text-subtle hover:text-ink" onClick={() => resetBlock(selectedBlock)} title="Vuelve a los textos e imágenes originales de esta sección">Restablecer</button>}
                    {!isLocked(selectedBlock) && <button type="button" className="text-xs text-subtle hover:text-ink" onClick={() => copyBlock(selectedBlock)} title="Copiar para pegar en otra página">Copiar</button>}
                    {!isLocked(selectedBlock) && <button type="button" className="text-xs text-subtle hover:text-ink" onClick={() => update([...blocks.slice(0, selectedIdx + 1), { ...selectedBlock, id: newBlockId(), props: JSON.parse(JSON.stringify(selectedBlock.props)) }, ...blocks.slice(selectedIdx + 1)])}>Duplicar</button>}
                  </div>
                </div>
                <p className="mb-3 text-xs text-muted">{blockSpec(selectedBlock.type)?.description}</p>
                {selectedBlock.hidden && <p className="mb-3 rounded-lg bg-amber/10 px-3 py-2 text-xs text-ink">Este bloque está oculto: se conserva aquí pero no aparece en el sitio.</p>}
                {(errors.blocks || errors.draft_blocks) && <p className="mb-2 text-sm text-coral-600">{errors.blocks || errors.draft_blocks}</p>}
                <BlockForm block={selectedBlock} serverErrors={fieldErrors.filter((x) => x.block_id === selectedBlock.id)} onChange={(props, field) => update(blocks.map((b) => (b.id === selectedBlock.id ? { ...b, props } : b)), `${selectedBlock.id}:${field}`)} />
              </>
            ) : <p className="text-sm text-muted">Seleccione un bloque en la lista o haga clic en la vista previa para editarlo.</p>}
          </div>
        </aside>

        {/* Right: live preview */}
        <section className="min-w-0" aria-label="Vista previa">
          <div className="mb-2 flex items-center justify-between">
            <span className="inline-flex items-center gap-1 text-xs text-subtle"><Eye size={14} aria-hidden="true" /> Vista previa en vivo (haga clic en un bloque para editarlo)</span>
            <div role="group" aria-label="Tamaño de pantalla" className="inline-flex rounded-lg bg-cream-2 p-0.5">
              {([['mobile', Smartphone, 'Móvil'], ['tablet', Tablet, 'Tableta'], ['desktop', Monitor, 'Escritorio']] as const).map(([d, Icon, label]) => (
                <button key={d} type="button" aria-pressed={device === d} aria-label={label} onClick={() => setDevice(d)} className={`rounded-md p-1.5 ${device === d ? 'bg-white text-purple shadow-sm' : 'text-subtle'}`}><Icon size={16} /></button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-line bg-cream-2 p-3">
            <div ref={previewRef} className="mx-auto overflow-hidden rounded-xl bg-white shadow-card" style={{ width: DEVICE_WIDTH[device] ?? '100%', maxWidth: '100%' }}>
              {blocks.length === 0 ? <p className="p-10 text-center text-sm text-muted">Sin contenido todavía.</p> : <EditableBlocks blocks={blocks} selectedId={selected} onSelect={selectFromPreview} />}
            </div>
          </div>
        </section>
      </div>

      <AddBlockModal open={adding} onClose={() => setAdding(false)} onPick={(type) => { const b = newBlock(type); update([...blocks, b]); setSelected(b.id); setAdding(false); }} />
      {isAdmin && (
        <VersionsModal
          open={showVersions}
          pageId={pageId}
          current={blocks}
          onClose={() => setShowVersions(false)}
          onRestored={(restored) => {
            // Reload the editor from the restored draft (drops local edits and any pending autosave).
            loadedFor.current = null;
            setDirty(false);
            qc.setQueryData(['admin-page', pageId], restored);
            qc.invalidateQueries({ queryKey: ['admin', 'pages'] });
            setShowVersions(false);
          }}
        />
      )}
      <Modal open={showSeo} onClose={() => setShowSeo(false)} title="Título, dirección y SEO" maxWidth={520}>
        <div className="space-y-3">
          <Input label="Título de la página" value={meta.title} onChange={(e) => updateMeta({ title: e.target.value })} error={errors.title} />
          <Input label="Dirección (slug)" value={meta.slug} onChange={(e) => updateMeta({ slug: e.target.value })} error={errors.slug} disabled={!isAdmin} hint={isAdmin ? 'Cambiarla rompe enlaces ya compartidos.' : 'Solo Dirección puede cambiar la dirección.'} />
          <Input label="Título SEO" value={meta.seo.title ?? ''} onChange={(e) => updateMeta({ seo: { ...meta.seo, title: e.target.value } })} placeholder={templateFor(page.slug)?.seo.title ?? ''} hint="Máx. 60 caracteres recomendados. Vacío = el título actual del sitio." />
          <div><label className="label" htmlFor="seo-desc">Descripción SEO</label><textarea id="seo-desc" className="input-field" rows={3} value={meta.seo.description ?? ''} placeholder={templateFor(page.slug)?.seo.description ?? ''} onChange={(e) => updateMeta({ seo: { ...meta.seo, description: e.target.value } })} /></div>
          <MediaPicker label="Imagen al compartir (WhatsApp, Facebook)" value={meta.seo.og_image ?? null} onChange={(id) => updateMeta({ seo: { ...meta.seo, og_image: id ?? undefined } })} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!meta.seo.noindex} onChange={(e) => updateMeta({ seo: { ...meta.seo, noindex: e.target.checked } })} /> No indexar en buscadores</label>
          {!isAdmin && <p className="text-xs text-muted">La publicación y el retiro programados los define Dirección al aprobar la página.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Publicar automáticamente el" disabled={!isAdmin} type="datetime-local" value={toLocalInput(meta.publish_at)} onChange={(e) => updateMeta({ publish_at: e.target.value ? new Date(e.target.value).toISOString() : null })} hint="Vacío = manual." />
            <Input label="Retirar del sitio el" disabled={!isAdmin} type="datetime-local" value={toLocalInput(meta.unpublish_at)} onChange={(e) => updateMeta({ unpublish_at: e.target.value ? new Date(e.target.value).toISOString() : null })} hint="Para contenido con fecha de caducidad." />
          </div>
          <div className="flex justify-end"><Button onClick={() => setShowSeo(false)}>Listo</Button></div>
        </div>
      </Modal>
      <Modal open={rejecting} onClose={() => setRejecting(false)} title="Pedir cambios al editor" maxWidth={480}>
        <div className="space-y-3">
          <div><label className="label" htmlFor="reject-note">¿Qué debe corregirse?</label><textarea id="reject-note" className="input-field" rows={3} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} /></div>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setRejecting(false)}>Cancelar</Button><Button onClick={() => review.mutate({ action: 'reject', note: rejectNote })} loading={review.isPending} disabled={!rejectNote.trim()}>Enviar</Button></div>
        </div>
      </Modal>
      <ConfirmDialog open={confirmReset} title="¿Volver al diseño original?" message="El borrador se reemplaza por el contenido original de la página (textos, fotos y secciones). Lo publicado no cambia hasta que publique, y las versiones anteriores se conservan."
        confirmLabel="Restablecer borrador" onConfirm={() => { if (original) update(original); setSelected(null); setConfirmReset(false); }} onClose={() => setConfirmReset(false)} />
      <ConfirmDialog open={confirmUnpublish} title="¿Retirar la página del sitio?" message="Las visitas verán un 404 hasta volver a publicarla. El borrador se conserva."
        confirmLabel="Retirar página" loading={publish.isPending} onConfirm={() => publish.mutate('unpublish')} onClose={() => setConfirmUnpublish(false)} />
    </div>
  );
}

function AddBlockModal({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (type: string) => void }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const match = (b: { label: string; description: string }) => !needle || `${b.label} ${b.description}`.toLowerCase().includes(needle);
  // Locked sections carry a form or the booking widget: one per page, never added twice.
  const sections = allSectionSpecs().filter((b) => !b.locked && match(b));
  const groups = Object.entries(GROUP_LABELS)
    .map(([key, label]) => ({ key, label, items: sections.filter((b) => b.group === key) }))
    .filter((g) => g.items.length > 0);
  const generic = BLOCKS.filter(match);
  const card = (b: { type: string; label: string; description: string }) => (
    <li key={b.type}>
      <button type="button" onClick={() => onPick(b.type)} className="w-full rounded-xl border border-line p-3 text-left hover:border-purple hover:bg-purple/5">
        <span className="block font-semibold text-ink">{b.label}</span>
        <span className="block text-xs text-muted">{b.description}</span>
      </button>
    </li>
  );
  return (
    <Modal open={open} onClose={onClose} title="Agregar bloque" maxWidth={720}>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
        <input className="input-field pl-9" placeholder="Buscar bloque…" aria-label="Buscar bloque" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="max-h-[65vh] space-y-5 overflow-y-auto">
        {generic.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-subtle">Bloques generales</h3>
            <ul className="grid gap-2 sm:grid-cols-2" aria-label="Bloques generales">{generic.map(card)}</ul>
          </section>
        )}
        {groups.map((g) => (
          <section key={g.key}>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-subtle">Secciones de {g.label}</h3>
            <ul className="grid gap-2 sm:grid-cols-2" aria-label={`Secciones de ${g.label}`}>{g.items.map(card)}</ul>
          </section>
        ))}
        {generic.length === 0 && groups.length === 0 && <p className="py-6 text-center text-sm text-muted">Ningún bloque coincide con la búsqueda.</p>}
      </div>
    </Modal>
  );
}

function VersionsModal({ open, pageId, current, onClose, onRestored }: { open: boolean; pageId: number; current: Block[]; onClose: () => void; onRestored: (page: CmsPageAdmin) => void }) {
  const [diffOf, setDiffOf] = useState<number | null>(null);
  const [toRestore, setToRestore] = useState<number | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-page-versions', pageId], queryFn: async () => (await contentApi.adminPageVersions(pageId)).data, enabled: open });
  const rollback = useMutation({
    mutationFn: (version: number) => contentApi.adminRollbackPage(pageId, version),
    onSuccess: (res) => {
      toast.success(`Versión ${res.data.restored_from} restaurada en el borrador. El sitio no cambia hasta que la publique.`);
      setToRestore(null);
      onRestored(res.data.page);
    },
    onError: (e) => { setToRestore(null); toast.error(apiFieldErrors(e).detail || 'No se pudo restaurar.'); },
  });
  return (
    <Modal open={open} onClose={onClose} title="Versiones publicadas" maxWidth={480}>
      {isError ? (
        <ErrorState title="No se pudieron cargar las versiones" onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="flex justify-center py-6"><LoadingSpinner /></div>
      ) : (data ?? []).length === 0 ? <p className="text-sm text-muted">Esta página aún no se ha publicado.</p> : (
        <ul className="divide-y divide-line" aria-label="Versiones">
          {(data ?? []).map((v) => (
            <li key={v.id} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div><span className="font-semibold text-ink">Versión {v.number}</span><p className="text-xs text-subtle">{v.author_name} · {new Date(v.created_at).toLocaleString('es-MX')}</p></div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setDiffOf(diffOf === v.number ? null : v.number)}>{diffOf === v.number ? 'Ocultar cambios' : 'Ver cambios'}</Button>
                  <Button size="sm" variant="secondary" onClick={() => setToRestore(v.number)}>Restaurar</Button>
                </div>
              </div>
              {diffOf === v.number && <VersionDiff lines={diffBlocks(v.blocks ?? [], current)} number={v.number} />}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={toRestore !== null}
        title={`¿Restaurar la versión ${toRestore ?? ''} en el borrador?`}
        message="El borrador actual (incluidos los cambios sin publicar) se reemplaza por esta versión. El sitio público no cambia hasta que publique."
        confirmLabel="Restaurar en el borrador"
        loading={rollback.isPending}
        onConfirm={() => toRestore !== null && rollback.mutate(toRestore)}
        onClose={() => setToRestore(null)}
      />
    </Modal>
  );
}

const DIFF_LABEL: Record<string, string> = { added: '+ Nuevo', removed: '− Eliminado', changed: '± Modificado', moved: '↕ Movido', same: '' };
function VersionDiff({ lines, number }: { lines: ReturnType<typeof diffBlocks>; number: number }) {
  const changes = lines.filter((l) => l.kind !== 'same');
  return (
    <ul className="mt-2 space-y-0.5 rounded-lg bg-cream-2 p-2 text-xs" aria-label={`Cambios del borrador respecto a la versión ${number}`}>
      {changes.length === 0 && <li className="text-muted">El borrador es idéntico a esta versión.</li>}
      {changes.map((l) => (
        <li key={`${l.kind}-${l.id}`} className={l.kind === 'added' ? 'text-green-700' : l.kind === 'removed' ? 'text-coral-600' : 'text-ink'}>
          {DIFF_LABEL[l.kind]} {l.type}{l.summary ? `: ${l.summary}` : ''}
        </li>
      ))}
    </ul>
  );
}
