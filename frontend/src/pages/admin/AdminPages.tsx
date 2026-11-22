import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EyeOff, Plus, Send, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { ExportMenu } from '@/components/admin/ExportMenu';
import { FilterBar } from '@/components/admin/FilterBar';
import { BulkActionBar } from '@/components/admin/BulkActionBar';
import { BulkConfirmDialog } from '@/components/admin/BulkConfirmDialog';
import { useUrlFilters } from '@/hooks/useUrlFilters';
import { useRowSelection } from '@/hooks/useRowSelection';
import { PAGES_ENTITY, usePagesBulk, usePagesExport } from '@/hooks/queries/AdminContentQueries';
import { adminKeys, invalidateEntity } from '@/hooks/queries/keys';
import { pagesAdminApi } from '@/services/AdminContentApi';
import { contentApi, type BulkActionDef, type CmsPageAdmin } from '@/services/api';
import { idsParam, type ExportFormat } from '@/services/dataOps';
import { apiFieldErrors } from '@/lib/apiErrors';
import { toPaged } from '@/lib/pagination';
import { allTemplates } from '@/cms/sections';
import { loadAllGroups } from '@/cms/sections/loaders';
import type { PageTemplate } from '@/cms/sections/types';
import { cmsBase, originalBlocks, pageKindFor, slugify } from '@/cms/editor/helpers';
import { PageListGroup } from '@/cms/editor/shell/PageListGroup';
import { STATUS_FILTERS, buildRows, filterRows, type PageRow } from '@/cms/editor/shell/pageList';
import { useAuthStore } from '@/store/authStore';

const TEMPLATES: { value: CmsPageAdmin['template']; label: string }[] = [
  { value: 'simple', label: 'Página sencilla' },
  { value: 'landing', label: 'Landing (campaña)' },
  { value: 'level', label: 'Nivel educativo' },
  { value: 'home', label: 'Inicio' },
];

const BULK_ACTIONS: BulkActionDef[] = [
  { name: 'publish', label: 'Publicar', planVerb: 'Se publicarán', icon: Send },
  { name: 'unpublish', label: 'Despublicar', planVerb: 'Se despublicarán', icon: EyeOff },
  { name: 'delete', label: 'Eliminar borradores', planVerb: 'Se eliminarán', danger: true, icon: Trash2 },
];

/** Every CMS page in one go (the school has a few dozen; 100 per request, the API maximum). */
async function fetchAllPages(): Promise<CmsPageAdmin[]> {
  const first = toPaged<CmsPageAdmin>((await pagesAdminApi.list({ page: 1, page_size: 100 })).data);
  const out = [...first.results];
  const pages = Math.min(10, Math.ceil(first.count / 100));
  for (let page = 2; page <= pages; page += 1) out.push(...toPaged<CmsPageAdmin>((await pagesAdminApi.list({ page, page_size: 100 })).data).results);
  return out;
}

/**
 * /admin/contenido: one list of the site (docs/cms/editor-shell.md). Each
 * public page appears once, customised or not, with its state, who edited it
 * last and its actions; the pages the school created have their own group.
 * Dirección also selects pages for bulk publish/unpublish/delete and export.
 */
export default function AdminPages() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';
  const base = cmsBase(role);
  const { get, set } = useUrlFilters();
  const q = get('q');
  const estado = get('estado');
  const [templates, setTemplates] = useState<PageTemplate[] | null>(null);
  useEffect(() => { let alive = true; void loadAllGroups().then(() => { if (alive) setTemplates(allTemplates()); }); return () => { alive = false; }; }, []);
  // Under the pages entity key: bulk actions, imports and the editor refresh it.
  const { data: pages, isLoading, isError, refetch } = useQuery({ queryKey: adminKeys.summary(PAGES_ENTITY, 'all'), queryFn: fetchAllPages });
  // «Revisión antes de publicar» of every page (chips); the list never waits for it.
  const { data: checkRows } = useQuery({
    queryKey: adminKeys.summary(PAGES_ENTITY, 'checks'),
    queryFn: async () => (await pagesAdminApi.checksSummary()).data.results,
    staleTime: 30_000,
  });
  const checks = useMemo(() => new Map((checkRows ?? []).map((c) => [c.id, c])), [checkRows]);
  const exportPages = usePagesExport();
  const bulk = usePagesBulk();
  const [now] = useState(() => Date.now());

  const rows = useMemo(() => (templates && pages ? buildRows(templates, pages, now) : null), [templates, pages, now]);
  const site = rows ? filterRows(rows.site, q, estado) : [];
  const custom = rows ? filterRows(rows.custom, q, estado) : [];
  const filtering = !!(q || estado);
  const selection = useRowSelection(0, JSON.stringify({ q, estado }));

  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<PageRow | null>(null);
  const [bulkAction, setBulkAction] = useState<BulkActionDef | null>(null);
  const remove = useMutation({
    mutationFn: (id: number) => contentApi.adminDeletePage(id),
    onSuccess: () => { toast.success('Borrador eliminado.'); setToDelete(null); void invalidateEntity(qc, PAGES_ENTITY); },
    onError: (e) => toast.error(apiFieldErrors(e).detail || 'No se pudo eliminar.'),
  });
  const customise = useMutation({
    mutationFn: (t: PageTemplate) => contentApi.adminCreatePage({
      title: t.title, slug: t.slug, template: pageKindFor(t.slug), draft_blocks: originalBlocks(t.slug) ?? [], seo: {},
    }),
    onSuccess: (res) => { void invalidateEntity(qc, PAGES_ENTITY); navigate(`${base}/${res.data.id}`); },
    onError: (e) => toast.error(apiFieldErrors(e).detail || apiFieldErrors(e).slug || 'No se pudo crear el borrador.'),
  });

  const fetchExport = (fmt: ExportFormat, { selectedOnly }: { selectedOnly: boolean }) =>
    exportPages.mutateAsync({ fmt, ids: selectedOnly ? idsParam(selection.ids) : undefined });
  const toggle = (id: number) => selection.toggle(id);
  const toggleAll = (ids: number[], on: boolean) => selection.setPage(ids, on);
  const rowName = (id: string | number) => [...(rows?.site ?? []), ...(rows?.custom ?? [])].find((r) => r.page?.id === id)?.title;

  const newPageButton = <Button size="md" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" /> Nueva página</Button>;
  const clearFilters = <Button variant="ghost" size="md" onClick={() => set({ q: null, estado: null })}>Limpiar filtros</Button>;

  return (
    <>
      <PageHeader title="Páginas del sitio" subtitle="Cada página pública aparece una vez. «Personalizar» o «Editar» abre el editor; el sitio no cambia hasta que se publica."
        actions={(
          <div className="flex flex-wrap gap-2">
            {isAdmin && <ExportMenu filenamePrefix="paginas" selectedCount={selection.count} fetch={fetchExport} />}
            {newPageButton}
          </div>
        )} />

      <div className="mb-4">
        <FilterBar
          search={{ placeholder: 'Buscar por nombre o dirección…', label: 'Buscar páginas' }}
          selects={[{ key: 'estado', label: 'Estado', options: STATUS_FILTERS, allLabel: 'Todos los estados' }]}
        />
      </div>

      {isAdmin && (
        <BulkActionBar
          count={selection.count}
          onClear={selection.onClear}
          actions={BULK_ACTIONS}
          onAction={setBulkAction}
          itemLabel="páginas"
          gender="f"
          exportMenu={<ExportMenu label="Exportar seleccionadas" filenamePrefix="paginas" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
        />
      )}

      {isError ? (
        <Card><ErrorState title="No se pudieron cargar las páginas" onRetry={() => refetch()} /></Card>
      ) : isLoading || !rows ? (
        <Card><ListSkeleton rows={8} /></Card>
      ) : (
        <div className="space-y-6">
          <PageListGroup
            title="Páginas del sitio"
            listLabel="Páginas del sitio"
            rows={site}
            total={rows.site.length}
            base={base}
            isAdmin={isAdmin}
            selected={isAdmin ? selection.selected : undefined}
            onToggle={toggle}
            onToggleAll={toggleAll}
            onCustomise={(r) => r.template && customise.mutate(r.template)}
            customising={customise.isPending ? customise.variables?.slug ?? null : null}
            onDelete={setToDelete}
            now={now}
            checks={checks}
            empty={<div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted"><p>Ninguna página del sitio coincide con la búsqueda.</p>{clearFilters}</div>}
          />
          <PageListGroup
            title="Páginas propias"
            listLabel="Páginas propias"
            rows={custom}
            total={rows.custom.length}
            base={base}
            isAdmin={isAdmin}
            selected={isAdmin ? selection.selected : undefined}
            onToggle={toggle}
            onToggleAll={toggleAll}
            onDelete={setToDelete}
            now={now}
            checks={checks}
            headerAction={rows.custom.length > 0 ? <Button variant="secondary" size="md" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" /> Nueva página</Button> : undefined}
            empty={filtering && rows.custom.length > 0
              ? <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted"><p>Ninguna página propia coincide con la búsqueda.</p>{clearFilters}</div>
              : (
                <div className="flex flex-col items-start gap-3 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
                  <p>Páginas que el colegio crea aparte (una campaña, un evento). Hasta publicarlas, solo el personal las ve.</p>
                  {newPageButton}
                </div>
              )}
          />
        </div>
      )}

      <CreatePageModal open={creating} onClose={() => setCreating(false)} onCreated={(p) => navigate(`${base}/${p.id}`)} />
      <ConfirmDialog open={!!toDelete} title="¿Eliminar el borrador?"
        message={toDelete?.kind === 'site'
          ? `Se elimina el borrador de «${toDelete?.title}». La página del sitio no cambia: sigue con su diseño original y podrá personalizarla otra vez.`
          : `«${toDelete?.title}» dejará de existir. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar borrador" loading={remove.isPending} onConfirm={() => toDelete?.page && remove.mutate(toDelete.page.id)} onClose={() => setToDelete(null)} />
      <BulkConfirmDialog
        open={!!bulkAction}
        onClose={() => setBulkAction(null)}
        action={bulkAction}
        entityLabel="páginas"
        gender="f"
        ids={selection.ids}
        rowName={rowName}
        execute={(body) => bulk.mutateAsync(body)}
        onDone={() => selection.onClear()}
      />
    </>
  );
}

function CreatePageModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (p: CmsPageAdmin) => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [template, setTemplate] = useState<CmsPageAdmin['template']>('simple');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: () => contentApi.adminCreatePage({ title, slug: slug || slugify(title), template, draft_blocks: [], seo: {} }),
    onSuccess: (res) => { toast.success('Página creada.'); void invalidateEntity(qc, PAGES_ENTITY); onClose(); setTitle(''); setSlug(''); onCreated(res.data); },
    onError: (e) => setErrors(apiFieldErrors(e)),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setErrors({}); create.mutate(); };
  return (
    <Modal open={open} onClose={onClose} title="Nueva página" maxWidth={480}>
      <form onSubmit={submit} className="space-y-4">
        <Input label="Título" value={title} onChange={(e) => setTitle(e.target.value)} required error={errors.title} />
        <Input label="Dirección (slug)" value={slug || slugify(title)} onChange={(e) => setSlug(slugify(e.target.value))} hint="La página se verá en interlaken.edu.mx/<slug>" error={errors.slug} />
        <div>
          <label className="label" htmlFor="tpl">Plantilla</label>
          <select id="tpl" className="input-field" value={template} onChange={(e) => setTemplate(e.target.value as CmsPageAdmin['template'])}>
            {TEMPLATES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        {errors.detail && <p className="text-sm text-coral-600">{errors.detail}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={create.isPending}>Crear</Button></div>
      </form>
    </Modal>
  );
}
