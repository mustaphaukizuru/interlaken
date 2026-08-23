import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronLeft, Copy, ExternalLink, Eye, History, Monitor, Plus, Smartphone, Tablet, Trash2, Upload, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
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
import { BlockRenderer } from '@/cms/CmsPage';
import { contentApi, type CmsPageAdmin } from '@/services/api';
import { apiErrors, cmsBase, diffBlocks, moveBlock, newBlock, newBlockId, pageStatusLabel, toLocalInput } from '@/cms/editor/helpers';
import { useAuthStore } from '@/store/authStore';
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardCheck, GripVertical, Send } from 'lucide-react';
import type { PageIssue } from '@/services/api';

type Device = 'mobile' | 'tablet' | 'desktop';
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
  const loadedFor = useRef<number | null>(null);

  useEffect(() => {
    if (page && loadedFor.current !== page.id) {
      loadedFor.current = page.id;
      setBlocks(page.draft_blocks ?? []);
      setMeta({ title: page.title, slug: page.slug, seo: page.seo ?? {}, publish_at: page.publish_at ?? null, unpublish_at: page.unpublish_at ?? null });
      setDirty(false);
    }
  }, [page]);

  const save = useMutation({
    mutationFn: () => contentApi.adminUpdatePage(pageId, { draft_blocks: blocks, title: meta.title, slug: meta.slug, seo: meta.seo, publish_at: meta.publish_at, unpublish_at: meta.unpublish_at }),
    onSuccess: (res) => { setErrors({}); setDirty(false); qc.setQueryData(['admin-page', pageId], res.data); qc.invalidateQueries({ queryKey: ['admin-pages'] }); },
    onError: (e) => { const f = apiErrors(e); setErrors(f); toast.error(f.detail || f.blocks || f.draft_blocks || 'No se pudo guardar el borrador.'); },
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
      setConfirmUnpublish(false);
      qc.setQueryData(['admin-page', pageId], res.data); qc.invalidateQueries({ queryKey: ['admin-pages'] }); qc.invalidateQueries({ queryKey: ['cms-page'] });
    },
    onError: (e) => { const f = apiErrors(e); const data = (e as { response?: { data?: { issues?: PageIssue[] } } })?.response?.data; if (data?.issues) setIssues(data.issues); toast.error(f.detail || f.blocks || f.draft_blocks || 'No se pudo publicar. Revise los bloques.'); setErrors(f); },
  });

  const review = useMutation({
    mutationFn: async (args: { action: 'request' | 'reject'; note?: string }) => { if (dirty) await save.mutateAsync(); return contentApi.adminReviewPage(pageId, args.action, args.note); },
    onSuccess: (res, args) => {
      toast.success(args.action === 'request' ? 'Solicitud enviada a Dirección.' : 'Cambios solicitados al editor.');
      setRejecting(false); setRejectNote('');
      qc.setQueryData(['admin-page', pageId], res.data); qc.invalidateQueries({ queryKey: ['admin-pages'] });
    },
    onError: (e) => toast.error(apiErrors(e).detail || 'No se pudo enviar.'),
  });

  const checks = useMutation({
    mutationFn: async () => { if (dirty) await save.mutateAsync(); return contentApi.adminPageChecks(pageId); },
    onSuccess: ({ data }) => { setIssues(data.issues); if (data.ok && data.issues.length === 0) toast.success('Sin problemas: lista para publicar.'); },
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

  const update = (next: Block[]) => { setBlocks(next); setDirty(true); };
  const updateMeta = (patch: Partial<typeof meta>) => { setMeta((m) => ({ ...m, ...patch })); setDirty(true); };
  const selectedBlock = useMemo(() => blocks.find((b) => b.id === selected) ?? null, [blocks, selected]);
  const selectedIdx = blocks.findIndex((b) => b.id === selected);

  if (!Number.isFinite(pageId)) return <ErrorState />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;
  if (isLoading || !page) return <div className="flex min-h-[40vh] items-center justify-center"><LoadingSpinner /></div>;
  const st = pageStatusLabel({ status: page.status, has_unpublished_changes: page.has_unpublished_changes || dirty, review_requested_at: page.review_requested_at });

  return (
    <div className="flex min-h-[calc(100svh-7rem)] flex-col">
      <PageHeader
        title={meta.title || page.title}
        subtitle={`/${meta.slug}`}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Link to={base} className="btn-outline inline-flex items-center gap-1"><ChevronLeft size={16} aria-hidden="true" /> Páginas</Link>
            <Button variant="secondary" size="sm" onClick={() => setShowSeo(true)}>SEO</Button>
            <Button variant="secondary" size="sm" onClick={() => checks.mutate()} loading={checks.isPending}><ClipboardCheck size={16} aria-hidden="true" /> Revisar</Button>
            <Button variant="secondary" size="sm" onClick={() => setShowVersions(true)}><History size={16} aria-hidden="true" /> Versiones</Button>
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
                <a href={`/${page.slug}`} target="_blank" rel="noopener noreferrer" className="btn-outline inline-flex items-center gap-1 text-sm"><ExternalLink size={16} aria-hidden="true" /> Ver en el sitio</a>
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
                {i.block_id ? <button type="button" className="text-left text-ink underline-offset-2 hover:underline" onClick={() => setSelected(i.block_id)}>{i.message}</button> : <span className="text-ink">{i.message}</span>}
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
              <Button size="sm" variant="secondary" onClick={() => setAdding(true)}><Plus size={14} aria-hidden="true" /> Agregar</Button>
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
                      {i + 1}. {blockSpec(b.type)?.label ?? b.type}
                    </button>
                    <button type="button" aria-label="Subir" disabled={i === 0} className="rounded p-1 text-subtle hover:text-ink disabled:opacity-30" onClick={() => update(moveBlock(blocks, i, i - 1))}><ArrowUp size={14} /></button>
                    <button type="button" aria-label="Bajar" disabled={i === blocks.length - 1} className="rounded p-1 text-subtle hover:text-ink disabled:opacity-30" onClick={() => update(moveBlock(blocks, i, i + 1))}><ArrowDown size={14} /></button>
                    <button type="button" aria-label="Eliminar bloque" className="rounded p-1 text-subtle hover:text-coral-600" onClick={() => { update(blocks.filter((x) => x.id !== b.id)); if (selected === b.id) setSelected(null); }}><Trash2 size={14} /></button>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="card">
            {selectedBlock ? (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-head text-sm font-bold uppercase tracking-wide text-subtle">{blockSpec(selectedBlock.type)?.label ?? selectedBlock.type}</h2>
                  <button type="button" className="text-xs text-subtle hover:text-ink" onClick={() => update([...blocks.slice(0, selectedIdx + 1), { ...selectedBlock, id: newBlockId() }, ...blocks.slice(selectedIdx + 1)])}>Duplicar</button>
                </div>
                <p className="mb-3 text-xs text-muted">{blockSpec(selectedBlock.type)?.description}</p>
                {(errors.blocks || errors.draft_blocks) && <p className="mb-2 text-sm text-coral-600">{errors.blocks || errors.draft_blocks}</p>}
                <BlockForm block={selectedBlock} onChange={(props) => update(blocks.map((b) => (b.id === selectedBlock.id ? { ...b, props } : b)))} />
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
            <div className="mx-auto overflow-hidden rounded-xl bg-white shadow-card" style={{ width: DEVICE_WIDTH[device] ?? '100%', maxWidth: '100%' }}>
              {blocks.length === 0 ? <p className="p-10 text-center text-sm text-muted">Sin contenido todavía.</p> : <BlockRenderer blocks={blocks} editing onSelect={setSelected} />}
            </div>
          </div>
        </section>
      </div>

      <AddBlockModal open={adding} onClose={() => setAdding(false)} onPick={(type) => { const b = newBlock(type); update([...blocks, b]); setSelected(b.id); setAdding(false); }} />
      <VersionsModal open={showVersions} pageId={pageId} current={blocks} onClose={() => setShowVersions(false)} onRolledBack={() => { loadedFor.current = null; qc.invalidateQueries({ queryKey: ['admin-page', pageId] }); setShowVersions(false); }} />
      <Modal open={showSeo} onClose={() => setShowSeo(false)} title="Título, dirección y SEO" maxWidth={520}>
        <div className="space-y-3">
          <Input label="Título de la página" value={meta.title} onChange={(e) => updateMeta({ title: e.target.value })} error={errors.title} />
          <Input label="Dirección (slug)" value={meta.slug} onChange={(e) => updateMeta({ slug: e.target.value })} error={errors.slug} hint="Cambiarla rompe enlaces ya compartidos." />
          <Input label="Título SEO" value={meta.seo.title ?? ''} onChange={(e) => updateMeta({ seo: { ...meta.seo, title: e.target.value } })} hint="Máx. 60 caracteres recomendados." />
          <div><label className="label" htmlFor="seo-desc">Descripción SEO</label><textarea id="seo-desc" className="input-field" rows={3} value={meta.seo.description ?? ''} onChange={(e) => updateMeta({ seo: { ...meta.seo, description: e.target.value } })} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!meta.seo.noindex} onChange={(e) => updateMeta({ seo: { ...meta.seo, noindex: e.target.checked } })} /> No indexar en buscadores</label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Publicar automáticamente el" type="datetime-local" value={toLocalInput(meta.publish_at)} onChange={(e) => updateMeta({ publish_at: e.target.value ? new Date(e.target.value).toISOString() : null })} hint="Vacío = manual." />
            <Input label="Retirar del sitio el" type="datetime-local" value={toLocalInput(meta.unpublish_at)} onChange={(e) => updateMeta({ unpublish_at: e.target.value ? new Date(e.target.value).toISOString() : null })} hint="Para contenido con fecha de caducidad." />
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
      <ConfirmDialog open={confirmUnpublish} title="¿Retirar la página del sitio?" message="Las visitas verán un 404 hasta volver a publicarla. El borrador se conserva."
        confirmLabel="Retirar página" loading={publish.isPending} onConfirm={() => publish.mutate('unpublish')} onClose={() => setConfirmUnpublish(false)} />
    </div>
  );
}

function AddBlockModal({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (type: string) => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Agregar bloque" maxWidth={640}>
      <ul className="grid gap-2 sm:grid-cols-2" aria-label="Tipos de bloque">
        {BLOCKS.map((b) => (
          <li key={b.type}>
            <button type="button" onClick={() => onPick(b.type)} className="w-full rounded-xl border border-line p-3 text-left hover:border-purple hover:bg-purple/5">
              <span className="block font-semibold text-ink">{b.label}</span>
              <span className="block text-xs text-muted">{b.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function VersionsModal({ open, pageId, current, onClose, onRolledBack }: { open: boolean; pageId: number; current: Block[]; onClose: () => void; onRolledBack: () => void }) {
  const [diffOf, setDiffOf] = useState<number | null>(null);
  const { data } = useQuery({ queryKey: ['admin-page-versions', pageId], queryFn: async () => (await contentApi.adminPageVersions(pageId)).data, enabled: open });
  const rollback = useMutation({
    mutationFn: (version: number) => contentApi.adminRollbackPage(pageId, version),
    onSuccess: () => { toast.success('Versión restaurada al borrador. Publique para hacerla visible.'); onRolledBack(); },
    onError: () => toast.error('No se pudo restaurar.'),
  });
  return (
    <Modal open={open} onClose={onClose} title="Versiones publicadas" maxWidth={480}>
      {(data ?? []).length === 0 ? <p className="text-sm text-muted">Esta página aún no se ha publicado.</p> : (
        <ul className="divide-y divide-line" aria-label="Versiones">
          {(data ?? []).map((v) => (
            <li key={v.id} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div><span className="font-semibold text-ink">Versión {v.number}</span><p className="text-xs text-subtle">{v.author_name} · {new Date(v.created_at).toLocaleString('es-MX')}</p></div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setDiffOf(diffOf === v.number ? null : v.number)}>{diffOf === v.number ? 'Ocultar cambios' : 'Ver cambios'}</Button>
                  <Button size="sm" variant="secondary" loading={rollback.isPending} onClick={() => rollback.mutate(v.number)}>Restaurar</Button>
                </div>
              </div>
              {diffOf === v.number && <VersionDiff lines={diffBlocks(v.blocks ?? [], current)} number={v.number} />}
            </li>
          ))}
        </ul>
      )}
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
