import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, ClipboardCheck, ClipboardPaste, Copy, ExternalLink, Eye, EyeOff,
  HelpCircle, History, Link2, Plus, RotateCcw, Search, Send, Upload, XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { cmsPagePath } from '@/cms/slugPaths';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { blockSpec, type Block } from '@/cms/blocks/registry';
import { BlockForm } from '@/cms/editor/BlockForm';
import { PageErrorSummary } from '@/cms/editor/PageErrorSummary';
import { requestFieldFocus } from '@/cms/editor/fieldFocus';
import { templateFor } from '@/cms/sections';
import { ROUTE_META } from '@/lib/routeMeta';
import { loadAllGroups } from '@/cms/sections/loaders';
import { contentApi, type CmsPageAdmin } from '@/services/api';
import { apiFieldErrors } from '@/lib/apiErrors';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cmsBase, isLegacyDraft, moveBlock, newBlock, newBlockId, originalBlocks, originalProps } from '@/cms/editor/helpers';
import { withoutSeedSeo } from '@/cms/seedSeo';
import { useAuthStore } from '@/store/authStore';
import { AddBlockModal } from '@/cms/editor/shell/AddBlockModal';
import { BlockList } from '@/cms/editor/shell/BlockList';
import { splitLabel } from '@/cms/editor/shell/blockLabels';
import { BlockIcon } from '@/cms/editor/shell/blockIcons';
import { ConflictBanner, LocalCopyBanner } from '@/cms/editor/shell/ConflictBanner';
import { blockErrorsFrom, isLegacySeedRefusal, type BlockFieldError } from '@/cms/editor/shell/contracts';
import { EditorActionBar, EditorBottomBar, type EditorPane } from '@/cms/editor/shell/EditorActionBar';
import { EditorOnboarding } from '@/cms/editor/shell/EditorOnboarding';
import { useOnboarding } from '@/cms/editor/shell/useOnboarding';
import { LegacyDraftBanner, LegacyDraftDialog } from '@/cms/editor/shell/LegacyDraft';
import { clearLocalCopy, readLocalCopy, writeLocalCopy, type LocalCopy } from '@/cms/editor/shell/localCopy';
import type { MenuItem } from '@/cms/editor/shell/MoreMenu';
import { PreviewPane, type Device } from '@/cms/editor/shell/PreviewPane';
import { publishPage } from '@/cms/editor/shell/publishApi';
import { ScheduleDialog, type Schedule } from '@/cms/editor/shell/ScheduleDialog';
import { SeoDialog } from '@/cms/editor/shell/SeoDialog';
import { pageState } from '@/cms/editor/shell/status';
import { useDraftSaver } from '@/cms/editor/shell/useDraftSaver';
import { useLeaveGuard, type LeaveState } from '@/cms/editor/shell/useLeaveGuard';
import { VersionsModal } from '@/cms/editor/shell/VersionsModal';
import { applyFix, isSeoField } from '@/cms/editor/review/applyFix';
import { DraftAgeBanner } from '@/cms/editor/review/DraftAgeBanner';
import { daysSince, STALE_DRAFT_DAYS } from '@/cms/editor/review/format';
import { ReviewDialog } from '@/cms/editor/review/ReviewDialog';
import { publishRefusalFrom, reviewApi } from '@/cms/editor/review/reviewApi';
import type { ReviewIssue, ReviewReport } from '@/cms/editor/review/types';

/**
 * What a page shows when the school leaves its SEO fields empty: the route's
 * entry in ROUTE_META (lib/routeMeta.ts), else the template's own (404 page).
 */
function seoDefaults(slug: string): { title: string; description: string } {
  const tpl = templateFor(slug);
  const meta = tpl ? ROUTE_META[tpl.path] : undefined;
  return { title: meta?.title ?? tpl?.seo.title ?? '', description: meta?.description ?? tpl?.seo.description ?? '' };
}

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

/** Width of the editing column on desktop, resizable and remembered in this browser. */
const COLUMN_KEY = 'cms-editor-column';
const COLUMN_MIN = 320;
const COLUMN_MAX = 640;
function readColumn(): number {
  try {
    const v = Number(localStorage.getItem(COLUMN_KEY));
    return Number.isFinite(v) && v >= COLUMN_MIN && v <= COLUMN_MAX ? v : 420;
  } catch {
    return 420;
  }
}

/** Thrown when the draft could not be saved before publishing or reviewing. */
class SaveBlocked extends Error {}

type Meta = { title: string; slug: string; seo: CmsPageAdmin['seo']; publish_at: string | null; unpublish_at: string | null };
const EMPTY_META: Meta = { title: '', slug: '', seo: {}, publish_at: null, unpublish_at: null };

/** Public preview of the draft on this site's own origin (the API answers with FRONTEND_URL, which may be another host). */
const previewUrl = (slug: string, token: string) => `${window.location.origin}/p/${encodeURIComponent(slug)}?preview=${encodeURIComponent(token)}`;

/**
 * /admin/contenido/:id: the page editor (docs/cms/editor-shell.md).
 * Sticky action bar, section list and form side by side with the live
 * preview on desktop, «Editar | Vista previa» tabs on phones and tablets.
 */
export default function AdminPageEditor() {
  const { id } = useParams();
  const pageId = Number(id);
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';
  const base = cmsBase(role);
  const desktop = useMediaQuery('(min-width: 1024px)');
  // On phones the toaster sits at the bottom (ToastHost), right over the review dialog's
  // «Entiendo las advertencias» and «Publicar»: notices raised while it is open go on top.
  const phone = !useMediaQuery('(min-width: 768px)');
  const dialogToast = phone ? { position: 'top-center' as const } : undefined;
  const { data: page, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-page', pageId], queryFn: async () => (await contentApi.adminGetPage(pageId)).data, enabled: Number.isFinite(pageId) });

  const [blocks, setBlocksState] = useState<Block[]>([]);
  const [meta, setMetaState] = useState<Meta>(EMPTY_META);
  // The draft as of the last change, read by autosave: a save requested in the
  // same handler as an edit (e.g. «Guardar programación») sends that edit.
  const draft = useRef<{ blocks: Block[]; meta: Meta }>({ blocks: [], meta: EMPTY_META });
  const setBlocks = (next: Block[]) => { draft.current.blocks = next; setBlocksState(next); };
  const setMeta = (next: Meta) => { draft.current.meta = next; setMetaState(next); };
  const [selected, setSelected] = useState<string | null>(null);
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>('desktop');
  const [pane, setPane] = useState<EditorPane>('edit');
  // «Versiones» from the page list opens the dialog right away (?versiones=1).
  const [dialog, setDialog] = useState<null | 'add' | 'versions' | 'seo' | 'schedule' | 'unpublish' | 'reset' | 'reject' | 'legacy' | 'legacy-review'>(() => (isAdmin && params.get('versiones') ? 'versions' : null));
  const [rejectNote, setRejectNote] = useState('');
  // «Revisión antes de publicar»: the dialog and the last review of the draft on screen.
  const [reviewOpen, setReviewOpen] = useState(false);
  const [report, setReport] = useState<ReviewReport | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const reviewSeq = useRef(0);
  // «Publicar de todos modos» an old seed, then its warnings: the next publish keeps the confirmation.
  const legacyConfirmed = useRef(false);
  // An edit made in this visit (leaving with it unpublished asks first).
  const [editedHere, setEditedHere] = useState(false);
  // C3: structured errors of the last save, publish or «Revisar», next to each field and in the summary.
  const [serverErrors, setServerErrors] = useState<BlockFieldError[]>([]);
  // Review warnings, amber under their fields.
  const [serverWarnings, setServerWarnings] = useState<BlockFieldError[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [legacyResolved, setLegacyResolved] = useState(false);
  const [localCopy, setLocalCopy] = useState<LocalCopy | null>(null);
  const [conflictBusy, setConflictBusy] = useState<'reload' | 'overwrite' | null>(null);
  const [column, setColumn] = useState(readColumn);
  const onboarding = useOnboarding();
  const loadedFor = useRef<number | null>(null);
  const wroteCopy = useRef(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  // A jump to a field (error summary, checks): the field takes the focus, not the form heading.
  const jumping = useRef(false);
  const formPanel = useRef<HTMLDivElement>(null);
  const editColumn = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(96);
  const [viewHeight, setViewHeight] = useState(800);
  // Where the last selection came from: the list scrolls the preview to the block, the preview opens its form.
  const selectSource = useRef<'list' | 'preview'>('list');
  // Undo/redo over the draft blocks. Consecutive edits of the same field are one
  // step (typing a title is not one step per keystroke); any other action starts a new one.
  const [history, setHistory] = useState<{ past: Block[][]; future: Block[][] }>({ past: [], future: [] });
  const lastEdit = useRef('');
  const [clip, setClip] = useState<Block | null>(() => readClipboard());
  // Every page's designed sections, so any section renders and can be added here.
  const [sectionsReady, setSectionsReady] = useState(false);
  useEffect(() => { let alive = true; void loadAllGroups().then(() => { if (alive) setSectionsReady(true); }); return () => { alive = false; }; }, []);

  const saver = useDraftSaver({
    // Address and scheduling are admin-only server-side (the cron publishes on
    // those dates with no further approval): staff never send them.
    buildBody: () => {
      const { blocks: b, meta: m } = draft.current;
      return isAdmin
        ? { draft_blocks: b, title: m.title, slug: m.slug, seo: m.seo, publish_at: m.publish_at, unpublish_at: m.unpublish_at }
        : { draft_blocks: b, title: m.title, seo: m.seo };
    },
    send: (body) => contentApi.adminUpdatePage(pageId, body),
    onSaved: (data) => {
      setFieldErrors({});
      qc.setQueryData(['admin-page', pageId], data);
      qc.invalidateQueries({ queryKey: ['admin', 'pages'] });
      if (wroteCopy.current) { clearLocalCopy(pageId); wroteCopy.current = false; }
    },
    onConflict: () => keepLocalCopy(),
    onFailure: (f) => {
      setFieldErrors(f.fields);
      keepLocalCopy();
      toast.error(f.message);
      // An autosave refused: open the section, but do not take the cursor from where the person types.
      showBlockErrors(f.blockErrors, 'open');
    },
  });
  const { reset: resetSaver } = saver;

  /** Keeps the local draft in this browser while it is not on the server. */
  const keepLocalCopy = () => {
    writeLocalCopy(pageId, { blocks: draft.current.blocks, title: draft.current.meta.title, seo: draft.current.meta.seo });
    wroteCopy.current = true;
  };

  /** C3: the errors go next to their fields and into the summary; then open the first one («focus» also puts the cursor there). */
  const showBlockErrors = (errs: BlockFieldError[], go: 'open' | 'focus') => {
    setServerErrors(errs);
    const first = errs.find((e) => e.block_id || typeof e.block_index === 'number');
    if (!first) return;
    const target = (first.block_id && blocks.find((b) => b.id === first.block_id)) || (typeof first.block_index === 'number' ? blocks[first.block_index] : undefined);
    if (!target) return;
    if (go === 'focus') jumpToField(target.id, first.field);
    else select(target.id, 'list');
  };
  /** Error summary, checks list, failed publish: open the section and focus the field (cms/editor/fieldFocus). */
  const jumpToField = (blockId: string, field?: string) => {
    jumping.current = blockId !== selected;
    select(blockId, 'list');
    requestFieldFocus(blockId, field ?? '');
  };

  const initFrom = useCallback((p: CmsPageAdmin) => {
    loadedFor.current = p.id;
    const m: Meta = { title: p.title, slug: p.slug, seo: p.seo ?? {}, publish_at: p.publish_at ?? null, unpublish_at: p.unpublish_at ?? null };
    draft.current = { blocks: p.draft_blocks ?? [], meta: m };
    setBlocksState(draft.current.blocks);
    setMetaState(m);
    setHistory({ past: [], future: [] });
    lastEdit.current = '';
    setLegacyResolved(false);
    resetSaver(p);
    const copy = readLocalCopy(p.id);
    setLocalCopy(copy && JSON.stringify(copy.blocks) !== JSON.stringify(p.draft_blocks ?? []) ? copy : null);
  }, [resetSaver]);

  useEffect(() => {
    if (page && loadedFor.current !== page.id) initFrom(page);
  }, [page, initFrom]);

  useEffect(() => {
    if (params.get('versiones')) setParams((prev) => { const next = new URLSearchParams(prev); next.delete('versiones'); return next; }, { replace: true });
  }, [params, setParams]);

  // The sticky column sits under the sticky bar and fits the console's scroll area.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === 'undefined') return;
    let scroller: HTMLElement | null = bar.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const measure = () => {
      setBarHeight(bar.offsetHeight);
      setViewHeight(scroller ? scroller.clientHeight : window.innerHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    if (scroller) ro.observe(scroller);
    return () => ro.disconnect();
  }, [page, sectionsReady]);

  const flushOrThrow = async () => { if (!(await saver.flush())) throw new SaveBlocked(); };
  const blockedMessage = () => (saver.conflict ? 'Primero resuelva el aviso: otra persona guardó cambios en esta página.' : 'El borrador no se pudo guardar. Revise el aviso y vuelva a intentarlo.');

  /** A review shown next to the fields: errors in red, warnings in amber. */
  const showReport = (r: ReviewReport) => {
    const located = (list: ReviewIssue[]): BlockFieldError[] => list.filter((i) => i.block_id && i.field).map((i) => ({
      block_index: i.block_index ?? undefined, block_id: i.block_id, block_label: i.block_label, field: i.field, field_label: i.field_label, message: i.field_message || i.message,
    }));
    setReport(r);
    setServerErrors(located(r.errors));
    setServerWarnings(located([...r.warnings, ...r.suggestions]));
  };

  /** «Revisión antes de publicar» of the draft as it is on screen (saved or not). */
  const runReview = async () => {
    const seq = ++reviewSeq.current;
    setReviewing(true);
    setReviewError(null);
    try {
      const { data } = await reviewApi.check(pageId, { draft_blocks: draft.current.blocks, seo: draft.current.meta.seo });
      if (seq === reviewSeq.current) showReport(data);
    } catch (e) {
      if (seq !== reviewSeq.current) return;
      const errs = blockErrorsFrom(e);
      if (errs.length) setServerErrors(errs);
      setReviewError(apiFieldErrors(e).detail || 'No se pudo revisar la página. Inténtelo de nuevo.');
    } finally {
      if (seq === reviewSeq.current) setReviewing(false);
    }
  };
  // Older notices (a token's «Deshacer», «Guardado») would cover the dialog's footer on phones.
  const openReview = () => { toast.dismiss(); setReviewOpen(true); void runReview(); };

  const publish = useMutation({
    mutationFn: async ({ action, confirmLegacy, acknowledged }: { action: 'publish' | 'unpublish'; confirmLegacy?: boolean; acknowledged?: string[] }) => {
      await flushOrThrow();
      return publishPage(pageId, action, !!confirmLegacy, acknowledged);
    },
    onSuccess: (res, { action }) => {
      toast.success(action === 'publish' ? `Publicada (versión ${res.data.version ?? res.data.published_version_number ?? ''}).` : 'Página retirada del sitio.');
      setDialog(null);
      setReviewOpen(false);
      setReport(null);
      legacyConfirmed.current = false;
      setEditedHere(false);
      setServerErrors([]);
      setServerWarnings([]);
      qc.setQueryData(['admin-page', pageId], res.data);
      qc.invalidateQueries({ queryKey: ['admin', 'pages'] });
      qc.invalidateQueries({ queryKey: ['cms-page'] });
    },
    onError: (e, vars) => {
      if (e instanceof SaveBlocked) { toast.error(blockedMessage()); return; }
      // Contract C1: the backend refuses an old generic seed without confirmation.
      if (isLegacySeedRefusal(e)) { setReviewOpen(false); setDialog('legacy'); return; }
      // «Revisión antes de publicar»: what stopped it opens (or refreshes) the review.
      const refusal = publishRefusalFrom(e);
      if (refusal) {
        if (vars.confirmLegacy) legacyConfirmed.current = true;
        setDialog(null);
        showReport(refusal);
        setReviewOpen(true);
        if (refusal.code === 'publish_warnings' && vars.acknowledged?.length) toast.error('Apareció una advertencia nueva: revísela antes de publicar.', dialogToast);
        return;
      }
      const f = apiFieldErrors(e);
      toast.error(f.detail || f.blocks || f.draft_blocks || 'No se pudo publicar. Revise las secciones.');
      setFieldErrors(f);
      showBlockErrors(blockErrorsFrom(e), 'focus');
    },
  });

  const discard = useMutation({
    mutationFn: async () => {
      await flushOrThrow();
      return reviewApi.discard(pageId, saver.revision.current);
    },
    onSuccess: ({ data }) => {
      qc.setQueryData(['admin-page', pageId], data);
      qc.invalidateQueries({ queryKey: ['admin', 'pages'] });
      initFrom(data);
      setSelected(null);
      setReviewOpen(false);
      setReport(null);
      setServerErrors([]);
      setServerWarnings([]);
      setEditedHere(false);
      toast.success('Cambios descartados: el borrador es igual a lo que muestra el sitio.');
    },
    onError: (e) => toast.error(e instanceof SaveBlocked ? blockedMessage() : apiFieldErrors(e).detail || 'No se pudieron descartar los cambios.'),
  });

  /** A quick fix of the review: the field takes the backend's value (undo and autosave as any edit), then a new review. */
  const fixIssue = (issue: ReviewIssue) => {
    const res = applyFix(draft.current.blocks, draft.current.meta.seo, issue);
    if (!res) { toast.error('Esta corrección ya no aplica: la sección cambió. Use «Ir al campo».', dialogToast); return; }
    if (res.blocks) update(res.blocks);
    if (res.seo) updateMeta({ seo: res.seo });
    toast.success(`Corregido: ${issue.fix?.label ?? ''}.`, dialogToast);
    void runReview();
  };
  const jumpToIssue = (issue: ReviewIssue) => {
    setReviewOpen(false);
    if (isSeoField(issue.field)) { setDialog('seo'); return; }
    if (issue.block_id) jumpToField(issue.block_id, issue.field);
  };

  const review = useMutation({
    mutationFn: async (args: { action: 'request' | 'reject'; note?: string }) => { await flushOrThrow(); return contentApi.adminReviewPage(pageId, args.action, args.note); },
    onSuccess: (res, args) => {
      toast.success(args.action === 'request' ? 'Solicitud enviada a Dirección.' : 'Cambios solicitados al editor.');
      setDialog(null); setRejectNote('');
      if (args.action === 'request') { setReviewOpen(false); setEditedHere(false); }
      qc.setQueryData(['admin-page', pageId], res.data); qc.invalidateQueries({ queryKey: ['admin', 'pages'] });
    },
    onError: (e) => {
      // Contract C1: an old generic seed draft can't go to Dirección for approval either.
      if (isLegacySeedRefusal(e)) { setReviewOpen(false); setDialog('legacy-review'); return; }
      toast.error(e instanceof SaveBlocked ? blockedMessage() : apiFieldErrors(e).detail || 'No se pudo enviar.');
    },
  });

  const previewLink = useMutation({
    mutationFn: async () => { await flushOrThrow(); return contentApi.adminPreviewToken(pageId); },
    onSuccess: async ({ data }) => {
      const url = previewUrl(meta.slug || page?.slug || '', data.token);
      try { await navigator.clipboard.writeText(url); toast.success('Enlace de vista previa copiado (válido 7 días).'); } catch { window.prompt('Copie el enlace de vista previa:', url); }
    },
    onError: (e) => toast.error(e instanceof SaveBlocked ? blockedMessage() : 'No se pudo generar el enlace.'),
  });

  /** «Vista previa»: the whole page as families will see it, in a new tab (saved draft, signed link). */
  const openPreview = async () => {
    // Opened right away, inside the click, so pop-up blockers allow it.
    const win = typeof window.open === 'function' ? window.open('', '_blank') : null;
    try {
      await flushOrThrow();
      const { data } = await contentApi.adminPreviewToken(pageId);
      const url = previewUrl(meta.slug || page?.slug || '', data.token);
      if (win) { win.opener = null; win.location.href = url; } else toast.error('El navegador bloqueó la pestaña nueva. Use «Más» y «Enlace de vista previa».');
    } catch (e) {
      win?.close();
      toast.error(e instanceof SaveBlocked ? blockedMessage() : 'No se pudo abrir la vista previa.');
    }
  };

  const update = (next: Block[], key = '') => {
    const sameField = key !== '' && key === lastEdit.current;
    lastEdit.current = key;
    // The history keeps the draft as it was, read from the ref: a quick fix runs from a dialog's handler.
    const before = draft.current.blocks;
    setHistory((h) => (sameField ? { past: h.past, future: [] } : { past: [...h.past.slice(-49), before], future: [] }));
    setBlocks(next);
    setEditedHere(true);
    saver.touch();
  };
  const undo = () => {
    const prev = history.past[history.past.length - 1];
    if (!prev) return;
    setHistory({ past: history.past.slice(0, -1), future: [...history.future, blocks] });
    lastEdit.current = '';
    setBlocks(prev); saver.touch();
  };
  const redo = () => {
    const next = history.future[history.future.length - 1];
    if (!next) return;
    setHistory({ past: [...history.past, blocks], future: history.future.slice(0, -1) });
    lastEdit.current = '';
    setBlocks(next); saver.touch();
  };
  const historyActions = useRef({ undo, redo });
  useEffect(() => { historyActions.current = { undo, redo }; });
  const updateMeta = (patch: Partial<Meta>) => { setMeta({ ...draft.current.meta, ...patch }); setEditedHere(true); saver.touch(); };

  const select = (blockId: string | null, source: 'list' | 'preview' = 'list') => {
    selectSource.current = source;
    if (blockId) setLastSelected(blockId);
    setSelected(blockId);
    if (blockId && !desktop) setPane('edit');
  };
  const backToList = () => {
    const was = selected;
    setSelected(null);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-block-item="${CSS.escape(was ?? '')}"] button`)?.focus());
  };

  const copyBlock = (b: Block) => {
    try { localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(b)); } catch { /* private mode: the copy lives only in this tab */ }
    setClip(b);
    toast.success('Sección copiada. Puede pegarla en esta u otra página con «Pegar».');
  };
  const insertAfterAnchor = (b: Block) => {
    const anchor = selected ?? lastSelected;
    const idx = blocks.findIndex((x) => x.id === anchor);
    const at = idx >= 0 ? idx + 1 : blocks.length;
    update([...blocks.slice(0, at), b, ...blocks.slice(at)]);
    select(b.id, 'list');
  };
  const pasteBlock = () => {
    if (!clip || !blockSpec(clip.type)) { toast.error('No hay una sección copiada.'); return; }
    insertAfterAnchor({ id: newBlockId(), type: clip.type, props: JSON.parse(JSON.stringify(clip.props)) });
  };
  const duplicateBlock = (b: Block) => insertAfterAnchorOf(b, { ...b, id: newBlockId(), props: JSON.parse(JSON.stringify(b.props)) });
  const insertAfterAnchorOf = (anchor: Block, b: Block) => {
    const at = blocks.findIndex((x) => x.id === anchor.id) + 1;
    update([...blocks.slice(0, at), b, ...blocks.slice(at)]);
    select(b.id, 'list');
  };
  const deleteBlock = (b: Block) => {
    update(blocks.filter((x) => x.id !== b.id));
    if (selected === b.id) setSelected(null);
    toast.success(`Sección «${splitLabel(b.type).name}» eliminada. «Deshacer» la recupera.`);
  };
  const toggleHidden = (b: Block) => update(blocks.map((x) => (x.id === b.id ? { ...x, hidden: !x.hidden } : x)));
  const resetBlock = (b: Block) => { const props = originalProps(meta.slug || page?.slug || '', b); if (props) update(blocks.map((x) => (x.id === b.id ? { ...x, props } : x))); };
  const loadDesign = () => {
    const original = originalBlocks(page?.slug ?? '');
    if (!original) return;
    update(original);
    // The design brings its own SEO: what the old seed_cms left there goes with the old blocks.
    const seo = withoutSeedSeo(draft.current.meta.seo, page?.seed_seo);
    if (seo !== draft.current.meta.seo) updateMeta({ seo });
    setSelected(null);
    setLegacyResolved(true);
  };

  const selectedBlock = useMemo(() => blocks.find((b) => b.id === selected) ?? null, [blocks, selected]);
  const selectedIdx = blocks.findIndex((b) => b.id === selected);

  // A selection from the list shows the block in the preview; any selection
  // brings its form into view and moves focus to its heading.
  useEffect(() => {
    if (!selected) return;
    if (selectSource.current === 'list' && desktop) {
      previewRef.current?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(selected)}"]`)?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    }
    // After a jump the form already focused and scrolled to the field (BlockForm, cms/editor/fieldFocus).
    if (jumping.current) { jumping.current = false; return; }
    if (desktop && editColumn.current) editColumn.current.scrollTop = 0;
    formHeading.current?.focus({ preventScroll: true });
    // Phones and tablets: the form starts right under the sticky bar (its scroll-margin).
    if (!desktop) formPanel.current?.scrollIntoView?.({ block: 'start' });
  }, [selected, desktop]);

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

  // Edits made here that the site does not show yet (asked about on the way out). A review already
  // requested from Dirección is the expected way out for staff, so it does not ask.
  const unpublishedHere = editedHere && !!page && (page.has_unpublished_changes || saver.dirty)
    && !(role !== 'admin' && page.review_requested_at);
  const leaveState: LeaveState = saver.status === 'error' || saver.status === 'conflict' ? 'unsaved'
    : saver.dirty || saver.status === 'saving' || saver.status === 'pending' ? 'pending'
      : unpublishedHere ? 'unpublished' : 'clean';
  const guard = useLeaveGuard({ state: leaveState, flush: saver.flush, unpublished: unpublishedHere, beforeLeave: () => { if (saver.dirty) keepLocalCopy(); } });

  /** C2 «Ver sus cambios (recargar)»: local edits go to a copy in this browser first. */
  const reloadTheirs = async () => {
    keepLocalCopy();
    setConflictBusy('reload');
    const res = await refetch();
    setConflictBusy(null);
    if (res.data) {
      initFrom(res.data);
      setSelected(null);
      toast.success('Se cargó la versión más reciente. Su copia quedó guardada en este navegador.');
    }
  };
  const overwriteMine = async () => {
    setConflictBusy('overwrite');
    const ok = await saver.overwrite();
    setConflictBusy(null);
    if (ok) toast.success('Se guardaron sus cambios.');
  };
  const restoreLocalCopy = () => {
    if (!localCopy) return;
    const m = draft.current.meta;
    setMeta({ ...m, title: localCopy.title ?? m.title, seo: localCopy.seo ?? m.seo });
    update(localCopy.blocks);
    setLocalCopy(null);
    wroteCopy.current = true;
    toast.success('Sus cambios volvieron al borrador.');
  };
  const discardLocalCopy = () => { clearLocalCopy(pageId); setLocalCopy(null); };

  // ── column resize (desktop) ──
  const saveColumn = (w: number) => { try { localStorage.setItem(COLUMN_KEY, String(w)); } catch { /* remembered for this visit only */ } };
  const onSplitterKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    let next: number;
    if (e.key === 'ArrowLeft') next = column - step;
    else if (e.key === 'ArrowRight') next = column + step;
    else if (e.key === 'Home') next = COLUMN_MIN;
    else if (e.key === 'End') next = COLUMN_MAX;
    else return;
    e.preventDefault();
    next = Math.min(COLUMN_MAX, Math.max(COLUMN_MIN, next));
    setColumn(next); saveColumn(next);
  };
  const onSplitterDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const start = editColumn.current?.getBoundingClientRect().width ?? column;
    let last = column;
    const onMove = (ev: PointerEvent) => { last = Math.min(COLUMN_MAX, Math.max(COLUMN_MIN, Math.round(start + ev.clientX - startX))); setColumn(last); };
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); saveColumn(last); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  if (!Number.isFinite(pageId)) return <ErrorState />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;
  if (isLoading || !page || !sectionsReady) return <div className="flex min-h-[40vh] items-center justify-center"><LoadingSpinner /></div>;

  const original = originalBlocks(page.slug);
  // Contract C1: the backend flag when it exists (optional), else the old client-side guess on the local draft.
  const legacy = !legacyResolved && (typeof page.legacy_seed === 'boolean' ? page.legacy_seed : isLegacyDraft(page.slug, blocks, !!page.published_version_number));
  const state = pageState(page, { blocks, dirty: saver.dirty, legacy });
  const published = page.status === 'published';
  const nothingToPublish = published && !page.has_unpublished_changes && !saver.dirty;
  const pageTitle = meta.title || page.title;
  const path = cmsPagePath(meta.slug || page.slug);
  const busy = publish.isPending || review.isPending;

  const onPublishClick = () => {
    // Without the backend flag (C1 not deployed yet) the client still stops an old seed.
    if (legacy) { setDialog('legacy'); return; }
    // «Revisión antes de publicar»: «Publicar» opens the review; its own «Publicar» sends the page.
    openReview();
  };
  // Fresh unpublished edits that sat for days get a reminder (not the untouched design, not drafts in review).
  const staleSince = page.unpublished_since && (state.key === 'changes' || state.key === 'draft' || state.key === 'scheduled')
    && daysSince(page.unpublished_since) >= STALE_DRAFT_DAYS ? page.unpublished_since : null;
  const reviewCounts = report ? { errors: report.errors.length, warnings: report.warnings.length } : null;

  // Same actions in the top bar (desktop) and the bottom bar (phones, tablets: «Vista previa» is a tab there).
  const btn = desktop ? 'whitespace-nowrap' : 'whitespace-nowrap !px-3';
  const primary = (
    <>
      <Button variant="secondary" size="md" onClick={openReview} loading={reviewing && !reviewOpen} className={btn}>
        <ClipboardCheck size={17} aria-hidden="true" /> Revisar
      </Button>
      {desktop && (
        <Button variant="secondary" size="md" onClick={() => void openPreview()} className={btn} title="Abre la página completa con sus cambios en otra pestaña">
          <Eye size={17} aria-hidden="true" /> Vista previa
        </Button>
      )}
      {isAdmin ? (
        <Button variant="cta" size="md" onClick={onPublishClick} loading={publish.isPending && publish.variables?.action === 'publish'} disabled={nothingToPublish || busy}
          title={nothingToPublish ? 'No hay cambios por publicar' : undefined} className={desktop ? btn : `${btn} flex-1`}>
          <Upload size={17} aria-hidden="true" /> Publicar
        </Button>
      ) : (
        <Button variant="cta" size="md" onClick={openReview} loading={review.isPending} disabled={!!page.review_requested_at || busy} className={desktop ? btn : `${btn} flex-1`}>
          <Send size={17} aria-hidden="true" /> {page.review_requested_at ? 'Esperando aprobación' : desktop ? 'Solicitar aprobación' : 'Pedir aprobación'}
        </Button>
      )}
    </>
  );

  const more: MenuItem[] = [
    ...(!desktop ? [{ key: 'preview', label: 'Ver la página completa', icon: ExternalLink, onSelect: () => void openPreview(), hint: 'Abre otra pestaña con sus cambios' }] : []),
    ...(isAdmin ? [{ key: 'versions', label: 'Versiones', icon: History, onSelect: () => setDialog('versions'), hint: 'Publicaciones anteriores y «Restaurar»' }] : []),
    { key: 'link', label: 'Enlace de vista previa', icon: Link2, onSelect: () => previewLink.mutate(), hint: 'Copia un enlace para compartir (7 días)' },
    { key: 'seo', label: 'SEO', icon: Search, onSelect: () => setDialog('seo'), hint: 'Título, dirección y buscadores' },
    { key: 'schedule', label: 'Programar', icon: CalendarClock, onSelect: () => setDialog('schedule'), hint: 'Publicar o retirar en una fecha' },
    ...(original ? [{ key: 'reset', label: 'Diseño original', icon: RotateCcw, onSelect: () => setDialog('reset'), hint: 'Vuelve el borrador al diseño de la página' }] : []),
    ...(published ? [{ key: 'live', label: 'Ver en el sitio', icon: ExternalLink, onSelect: () => window.open(path, '_blank', 'noopener') }] : []),
    { key: 'help', label: 'Cómo editar', icon: HelpCircle, onSelect: onboarding.show },
    ...(isAdmin && published ? [{ key: 'unpublish', label: 'Retirar', icon: XCircle, onSelect: () => setDialog('unpublish'), danger: true, hint: original ? 'El sitio vuelve al diseño original' : 'La página deja el sitio' }] : []),
  ];

  const alerts = saver.conflict
    ? <ConflictBanner conflict={saver.conflict} onReload={() => void reloadTheirs()} onOverwrite={() => void overwriteMine()} busy={conflictBusy} />
    : null;

  const listToolbar = (
    <div className="flex items-center gap-1">
      {clip && blockSpec(clip.type) && <Button size="sm" variant="ghost" onClick={pasteBlock} title={`Pegar: ${blockSpec(clip.type)?.label ?? clip.type}`}><ClipboardPaste size={15} aria-hidden="true" /> Pegar</Button>}
      <Button size="sm" variant="secondary" onClick={() => setDialog('add')}><Plus size={15} aria-hidden="true" /> Agregar</Button>
    </div>
  );

  const selSpec = selectedBlock ? blockSpec(selectedBlock.type) : undefined;
  const selLocked = !!selSpec?.locked;
  const selName = selectedBlock ? splitLabel(selectedBlock.type).name : '';
  const form = selectedBlock && (
      <div ref={formPanel} style={{ scrollMarginTop: barHeight + 12 }}>
        <div className="mb-3 flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={backToList} className="!px-2"><ChevronLeft size={16} aria-hidden="true" /> Secciones</Button>
          <span className="ml-auto text-xs text-subtle" aria-hidden="true">{selectedIdx + 1} de {blocks.length}</span>
          <button type="button" aria-label="Sección anterior" title="Sección anterior" disabled={selectedIdx <= 0} onClick={() => select(blocks[selectedIdx - 1].id)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-subtle hover:bg-cream hover:text-ink disabled:opacity-30"><ChevronLeft size={18} /></button>
          <button type="button" aria-label="Sección siguiente" title="Sección siguiente" disabled={selectedIdx >= blocks.length - 1} onClick={() => select(blocks[selectedIdx + 1].id)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-subtle hover:bg-cream hover:text-ink disabled:opacity-30"><ChevronRight size={18} /></button>
        </div>
        <div className="mb-2 flex items-start gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple text-white" aria-hidden="true"><BlockIcon type={selectedBlock.type} locked={selLocked} size={17} /></span>
          <div className="min-w-0">
            <h2 ref={formHeading} tabIndex={-1} className="font-head text-base font-bold leading-snug text-ink focus:outline-none" title={selSpec?.label}>{selectedIdx + 1}. {selName}</h2>
            <p className="text-xs text-muted">{selSpec?.description}</p>
          </div>
        </div>
        <div className="mb-3 flex flex-wrap gap-x-1 gap-y-0">
          {originalProps(page.slug, selectedBlock) && <Button variant="ghost" size="sm" onClick={() => resetBlock(selectedBlock)} title="Vuelve a los textos e imágenes originales de esta sección"><RotateCcw size={14} aria-hidden="true" /> Restablecer</Button>}
          {!selLocked && <Button variant="ghost" size="sm" onClick={() => copyBlock(selectedBlock)} title="Copiar para pegar en otra página"><Copy size={14} aria-hidden="true" /> Copiar</Button>}
          {!selLocked && <Button variant="ghost" size="sm" onClick={() => duplicateBlock(selectedBlock)}><Plus size={14} aria-hidden="true" /> Duplicar</Button>}
          {!selLocked && (
            <Button variant="ghost" size="sm" onClick={() => toggleHidden(selectedBlock)} aria-pressed={!!selectedBlock.hidden}>
              {selectedBlock.hidden ? <><Eye size={14} aria-hidden="true" /> Mostrar</> : <><EyeOff size={14} aria-hidden="true" /> Ocultar</>}
            </Button>
          )}
        </div>
        {selectedBlock.hidden && <p className="mb-3 flex items-center gap-2 rounded-lg bg-amber/10 px-3 py-2 text-xs text-ink"><EyeOff size={14} aria-hidden="true" /> Esta sección está oculta: se conserva aquí pero no aparece en el sitio.</p>}
        {(fieldErrors.blocks || fieldErrors.draft_blocks) && <p className="mb-2 text-sm text-coral-700" role="alert">{fieldErrors.blocks || fieldErrors.draft_blocks}</p>}
        <BlockForm block={selectedBlock} serverErrors={serverErrors.filter((x) => x.block_id === selectedBlock.id)} serverWarnings={serverWarnings.filter((x) => x.block_id === selectedBlock.id)} onChange={(props, field) => update(blocks.map((b) => (b.id === selectedBlock.id ? { ...b, props } : b)), `${selectedBlock.id}:${field}`)} />
      </div>
  );

  const editPane = (
    <div className="card !p-3 sm:!p-4">
      {form ?? (
        <BlockList
          blocks={blocks}
          selectedId={lastSelected}
          onSelect={(blockId) => select(blockId, 'list')}
          onMove={(from, to) => update(moveBlock(blocks, from, to))}
          onToggleHidden={toggleHidden}
          onDelete={deleteBlock}
          onDuplicate={duplicateBlock}
          onCopy={copyBlock}
          toolbar={listToolbar}
        />
      )}
    </div>
  );
  const preview = <PreviewPane blocks={blocks} selectedId={selected} onSelect={(blockId) => select(blockId, 'preview')} device={device} onDevice={setDevice} previewRef={previewRef} />;

  return (
    <div className="flex min-h-[calc(100svh-7rem)] flex-col">
      <EditorActionBar
        barRef={barRef}
        backTo={base}
        title={pageTitle}
        path={path}
        liveHref={published && page.slug !== 'no-encontrada' ? path : null}
        state={state}
        save={{ status: saver.status, lastSavedAt: saver.lastSavedAt, serverSavedAt: page.draft_updated_at ?? page.updated_at, onRetry: () => void saver.flush() }}
        history={{ canUndo: history.past.length > 0, canRedo: history.future.length > 0, onUndo: undo, onRedo: redo }}
        actions={primary}
        more={more}
        desktop={desktop}
        pane={desktop ? undefined : { value: pane, onChange: setPane }}
        alerts={alerts}
      />

      <div className="mb-4 space-y-3 empty:hidden">
        {onboarding.visible && <EditorOnboarding onDismiss={onboarding.dismiss} canPublish={isAdmin} />}
        {legacy && <LegacyDraftBanner canLoad={!!original} onLoadDesign={loadDesign} />}
        {localCopy && !saver.conflict && <LocalCopyBanner copy={localCopy} onRestore={restoreLocalCopy} onDiscard={discardLocalCopy} />}
        {page.review_requested_at && (
          <div className="flex flex-col gap-2 rounded-xl border border-brand-600/20 bg-brand-50 p-3 text-sm md:flex-row md:items-center md:justify-between" role="status">
            <p className="text-ink">{page.review_requested_by_name || 'Un editor'} pidió a Dirección publicar estos cambios.</p>
            {isAdmin && <Button variant="secondary" size="md" onClick={() => setDialog('reject')}>Pedir cambios</Button>}
          </div>
        )}
        {page.review_note && !page.review_requested_at && (
          <p className="rounded-xl border border-coral-600/20 bg-coral-50 px-3 py-2 text-sm text-coral-700" role="status">Dirección pidió cambios: {page.review_note}</p>
        )}
        {staleSince && <DraftAgeBanner since={staleSince} canPublish={isAdmin} onReview={openReview} />}
        <PageErrorSummary blocks={blocks} serverErrors={serverErrors} onJump={jumpToField} />
        {reviewCounts && !reviewOpen && (reviewCounts.errors > 0 || reviewCounts.warnings > 0) && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2 text-sm" role="status">
            <p className="flex items-center gap-2 text-ink">
              <AlertTriangle size={16} className={`shrink-0 ${reviewCounts.errors ? 'text-coral-600' : 'text-amber'}`} aria-hidden="true" />
              <span><strong>Revisión:</strong> {reviewCounts.errors} por corregir · {reviewCounts.warnings} {reviewCounts.warnings === 1 ? 'advertencia' : 'advertencias'}</span>
            </p>
            <Button variant="ghost" size="sm" onClick={openReview}>Ver la revisión</Button>
          </div>
        )}
      </div>

      {desktop ? (
        <div className="grid flex-1 items-start" style={{ gridTemplateColumns: `clamp(${COLUMN_MIN}px, ${column}px, 55%) 16px minmax(0, 1fr)` }}>
          <aside
            ref={editColumn}
            aria-label="Secciones y formulario"
            className="sticky overflow-y-auto overscroll-contain rounded-2xl"
            style={{ top: barHeight + 8, maxHeight: Math.max(320, viewHeight - barHeight - 16) }}
          >
            {editPane}
          </aside>
          {/* A focusable window splitter (ARIA separator widget): drag or arrow keys. */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Ancho del panel de edición"
            aria-valuemin={COLUMN_MIN}
            aria-valuemax={COLUMN_MAX}
            aria-valuenow={column}
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            onKeyDown={onSplitterKey}
            onPointerDown={onSplitterDown}
            onDoubleClick={() => { setColumn(420); saveColumn(420); }}
            title="Arrastre para cambiar el ancho (doble clic: ancho normal)"
            className="group sticky flex h-24 cursor-col-resize items-center justify-center focus-visible:outline-none"
            style={{ top: barHeight + 8 }}
          >
            <span className="h-12 w-1 rounded-full bg-line transition-colors group-hover:bg-purple/50 group-focus-visible:bg-purple" />
          </div>
          {preview}
        </div>
      ) : (
        <>
          <div id="editor-pane-edit" role="tabpanel" aria-labelledby="editor-tab-edit" hidden={pane !== 'edit'}>{pane === 'edit' && editPane}</div>
          <div id="editor-pane-preview" role="tabpanel" aria-labelledby="editor-tab-preview" hidden={pane !== 'preview'}>{pane === 'preview' && preview}</div>
          <EditorBottomBar actions={primary} more={more} />
        </>
      )}

      <AddBlockModal open={dialog === 'add'} onClose={() => setDialog(null)} onPick={(type) => { const b = newBlock(type); update([...blocks, b]); setDialog(null); select(b.id, 'list'); }} />
      {isAdmin && (
        <VersionsModal
          open={dialog === 'versions'}
          pageId={pageId}
          current={blocks}
          onClose={() => setDialog(null)}
          onRestored={(restored) => {
            // Reload the editor from the restored draft (drops local edits and any pending autosave).
            qc.setQueryData(['admin-page', pageId], restored);
            qc.invalidateQueries({ queryKey: ['admin', 'pages'] });
            initFrom(restored);
            setSelected(null);
            setDialog(null);
          }}
        />
      )}
      <SeoDialog
        open={dialog === 'seo'}
        onClose={() => setDialog(null)}
        meta={meta}
        onChange={updateMeta}
        isAdmin={isAdmin}
        errors={fieldErrors}
        placeholders={seoDefaults(page.slug)}
      />
      <ScheduleDialog
        open={dialog === 'schedule'}
        onClose={() => setDialog(null)}
        value={{ publish_at: meta.publish_at, unpublish_at: meta.unpublish_at }}
        canEdit={isAdmin}
        hasOriginalDesign={!!original}
        saving={saver.status === 'saving'}
        onSave={(next: Schedule) => {
          updateMeta(next);
          // Saved right away (not after the autosave delay): the cron acts on these dates.
          void saver.flush().then((ok) => {
            if (!ok) return;
            setDialog(null);
            toast.success(next.publish_at || next.unpublish_at ? 'Programación guardada.' : 'Programación cancelada.');
          });
        }}
      />
      <LegacyDraftDialog
        open={dialog === 'legacy' || dialog === 'legacy-review'}
        onClose={() => setDialog(null)}
        pageTitle={pageTitle}
        canLoad={!!original}
        publishing={publish.isPending}
        onLoadDesign={() => { loadDesign(); setDialog(null); toast.success('Diseño actual cargado. Revise sus cambios y publique cuando esté lista.'); }}
        onPublishAnyway={dialog === 'legacy' ? () => publish.mutate({ action: 'publish', confirmLegacy: true }) : undefined}
      />
      <Modal open={dialog === 'reject'} onClose={() => setDialog(null)} title="Pedir cambios al editor" maxWidth={480}>
        <div className="space-y-3">
          <div><label className="label" htmlFor="reject-note">¿Qué debe corregirse?</label><textarea id="reject-note" className="input-field" rows={3} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} /></div>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setDialog(null)}>Cancelar</Button><Button onClick={() => review.mutate({ action: 'reject', note: rejectNote })} loading={review.isPending} disabled={!rejectNote.trim()}>Enviar</Button></div>
        </div>
      </Modal>
      <ConfirmDialog open={dialog === 'reset'} title="¿Volver al diseño original?" message="El borrador se reemplaza por el contenido original de la página (textos, fotos y secciones). Lo publicado no cambia hasta que publique, y las versiones anteriores se conservan."
        confirmLabel="Restablecer borrador" onConfirm={() => { loadDesign(); setDialog(null); }} onClose={() => setDialog(null)} />
      <ConfirmDialog open={dialog === 'unpublish'} title="¿Retirar la página del sitio?"
        message={original ? 'El sitio vuelve a mostrar el diseño original de esta página. El borrador y las versiones se conservan.' : 'Las visitas verán «Página no encontrada» hasta volver a publicarla. El borrador se conserva.'}
        confirmLabel="Retirar página" loading={publish.isPending} onConfirm={() => publish.mutate({ action: 'unpublish' })} onClose={() => setDialog(null)} />
      <ConfirmDialog open={guard.blocked?.reason === 'unsaved'} title="¿Salir sin guardar?"
        message={saver.conflict
          ? 'Otra persona guardó cambios en esta página y los suyos no se han guardado. Si sale, quedará una copia solo en este navegador.'
          : 'El último cambio no se pudo guardar. Si sale, quedará una copia solo en este navegador y podrá recuperarla al volver.'}
        confirmLabel="Salir sin guardar" onConfirm={guard.leave} onClose={guard.stay} />
      <ConfirmDialog open={guard.blocked?.reason === 'unpublished'} title="¿Salir sin publicar?"
        message={isAdmin
          ? 'Sus cambios están guardados como borrador, pero el sitio no los muestra hasta que los publique. Puede volver y publicarlos cuando quiera.'
          : 'Sus cambios están guardados como borrador. Para que aparezcan en el sitio, pida la aprobación de Dirección con «Solicitar aprobación».'}
        confirmLabel="Salir sin publicar" onConfirm={guard.leave} onClose={guard.stay} />
      <ReviewDialog
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        pageTitle={pageTitle}
        report={report}
        loading={reviewing}
        error={reviewError}
        onRetry={() => void runReview()}
        onFix={fixIssue}
        onJump={jumpToIssue}
        canPublish={isAdmin}
        onPublish={(acknowledged) => publish.mutate({ action: 'publish', confirmLegacy: legacyConfirmed.current, acknowledged })}
        publishing={publish.isPending && publish.variables?.action === 'publish'}
        onRequest={() => review.mutate({ action: 'request' })}
        requesting={review.isPending}
        nothingToDo={isAdmin
          ? (nothingToPublish ? 'No hay cambios por publicar: el sitio ya muestra este borrador.' : null)
          : (page.review_requested_at ? 'Ya se pidió la aprobación de Dirección.' : null)}
        discard={published && page.published_version_number && (page.has_unpublished_changes || saver.dirty)
          ? { onConfirm: () => discard.mutate(), busy: discard.isPending, version: page.published_version_number } : null}
      />
    </div>
  );
}
