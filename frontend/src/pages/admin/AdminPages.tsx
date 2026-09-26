import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EyeOff, FileText, Pencil, Plus, Send, Trash2 } from 'lucide-react';
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
import { PAGES_ENTITY, usePagesBulk, usePagesExport, usePagesList } from '@/hooks/queries/AdminContentQueries';
import { invalidateEntity } from '@/hooks/queries/keys';
import { contentApi, type BulkActionDef, type CmsPageAdmin } from '@/services/api';
import { idsParam, type ExportFormat } from '@/services/dataOps';
import { apiErrors, cmsBase, pageStatusLabel, slugify } from '@/cms/editor/helpers';
import { formatDateTime } from '@/lib/format';
import { useAuthStore } from '@/store/authStore';

const TEMPLATES: { value: CmsPageAdmin['template']; label: string }[] = [
  { value: 'simple', label: 'Página sencilla' },
  { value: 'landing', label: 'Landing (campaña)' },
  { value: 'level', label: 'Nivel educativo' },
  { value: 'home', label: 'Inicio' },
];
const STATUS_OPTIONS = [
  { value: 'published', label: 'Publicadas' },
  { value: 'draft', label: 'Borradores' },
];

const BULK_ACTIONS: BulkActionDef[] = [
  { name: 'publish', label: 'Publicar', planVerb: 'Se publicarán', icon: Send },
  { name: 'unpublish', label: 'Despublicar', planVerb: 'Se despublicarán', icon: EyeOff },
  { name: 'delete', label: 'Eliminar borradores', planVerb: 'Se eliminarán', danger: true, icon: Trash2 },
];

/** /admin/contenido — CMS page list (BACKLOG P3-4) on the Data Ops list contract (Phase 8).
 *  Staff see and edit; Dirección (admin) also selects, publishes in bulk, deletes drafts
 *  that were never published and exports. */
export default function AdminPages() {
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';
  const base = cmsBase(role);
  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const sort = parseSort(get('orden'));
  const filters = {
    q: get('q') || undefined,
    status: get('estado') || undefined,
    template: get('plantilla') || undefined,
    ordering: serializeSort(sort) || undefined,
  };
  const { data, isLoading, isError, refetch } = usePagesList({ page, ...filters });
  const exportPages = usePagesExport();
  const bulk = usePagesBulk();
  const rows = data?.results;
  const count = data?.count ?? 0;
  const selection = useRowSelection(count, JSON.stringify(filters));

  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<CmsPageAdmin | null>(null);
  const [bulkAction, setBulkAction] = useState<BulkActionDef | null>(null);
  const remove = useMutation({
    mutationFn: (id: number) => contentApi.adminDeletePage(id),
    onSuccess: () => { toast.success('Página eliminada.'); setToDelete(null); void invalidateEntity(qc, PAGES_ENTITY); },
    onError: () => toast.error('No se pudo eliminar.'),
  });

  const fetchExport = (fmt: ExportFormat, { selectedOnly }: { selectedOnly: boolean }) =>
    exportPages.mutateAsync({ ...filters, fmt, ids: selectedOnly && !selection.allMatching ? idsParam(selection.ids) : undefined });

  const columns: Column<CmsPageAdmin>[] = [
    {
      id: 'title', header: 'Página', sortKey: 'title', hideable: false, minWidth: 200,
      cell: (p) => (
        <div className="min-w-0">
          <Link to={`${base}/${p.id}`} className="font-semibold text-ink hover:text-purple">{p.title}</Link>
          {(p.review_requested_by_name || (p.review_note && !p.review_requested_at)) && (
            <p className="truncate text-xs text-subtle">
              {p.review_requested_by_name ? `solicitó ${p.review_requested_by_name}` : ''}
              {p.review_note && !p.review_requested_at ? `cambios solicitados: ${p.review_note}` : ''}
            </p>
          )}
        </div>
      ),
    },
    { id: 'slug', header: 'Dirección', sortKey: 'slug', minWidth: 140, className: 'font-mono text-xs text-subtle', cell: (p) => `/${p.slug}` },
    { id: 'template', header: 'Plantilla', sortKey: 'template', minWidth: 140, className: 'text-muted', cell: (p) => TEMPLATES.find((t) => t.value === p.template)?.label ?? p.template },
    {
      id: 'status', header: 'Estado', sortKey: 'status', minWidth: 170,
      cell: (p) => { const st = pageStatusLabel(p); return <Badge variant={st.tone}>{st.label}</Badge>; },
    },
    { id: 'updated', header: 'Actualizada', sortKey: 'updated', minWidth: 150, className: 'whitespace-nowrap text-xs text-muted', cell: (p) => formatDateTime(p.updated_at) || '—' },
    { id: 'published', header: 'Publicada', sortKey: 'published', minWidth: 150, defaultHidden: true, className: 'whitespace-nowrap text-xs text-muted', cell: (p) => formatDateTime(p.published_at) || '—' },
  ];

  return (
    <>
      <PageHeader title="Páginas del sitio" subtitle="Cree y edite páginas con bloques. Los cambios se publican cuando usted lo decida."
        actions={(
          <div className="flex flex-wrap gap-2">
            {isAdmin && <ExportMenu filenamePrefix="paginas" selectedCount={selection.count} fetch={fetchExport} />}
            <Button onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" /> Nueva página</Button>
          </div>
        )} />
      <Card title={`${count.toLocaleString('es-MX')} páginas`}>
        <DataTable<CmsPageAdmin>
          tableId="cms-pages"
          columns={columns}
          rows={rows}
          rowKey={(p) => p.id}
          rowLabel={(p) => `página ${p.title}`}
          caption="Páginas del sitio"
          sort={sort}
          onSort={(next: SortState) => set({ orden: serializeSort(next), page: null })}
          page={page}
          count={count}
          onPage={setPage}
          itemLabel="páginas"
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          columnControls
          resizable
          pinFirstColumn
          selection={isAdmin ? selection : undefined}
          rowActions={(p) => (
            <>
              <Link to={`${base}/${p.id}`} className="btn-outline btn-sm inline-flex min-h-[36px] items-center gap-1" aria-label={`Editar ${p.title}`}><Pencil size={14} aria-hidden="true" /> Editar</Link>
              {isAdmin && <Button size="sm" variant="ghost" onClick={() => setToDelete(p)} aria-label={`Eliminar ${p.title}`}><Trash2 size={14} aria-hidden="true" /></Button>}
            </>
          )}
          toolbar={(
            <FilterBar
              search={{ placeholder: 'Título o dirección…', label: 'Buscar páginas' }}
              tabs={{ paramKey: 'estado', options: STATUS_OPTIONS, allLabel: 'Todas', label: 'Filtrar por estado' }}
              selects={[{ key: 'plantilla', label: 'Plantilla', options: TEMPLATES, allLabel: 'Todas las plantillas' }]}
            />
          )}
          bulkBar={isAdmin ? (
            <BulkActionBar
              count={selection.count}
              allMatching={selection.allMatching}
              allMatchingCount={count}
              onSelectAllMatching={selection.onSelectAllMatching}
              onClear={selection.onClear}
              actions={BULK_ACTIONS}
              onAction={setBulkAction}
              itemLabel="páginas"
              exportMenu={<ExportMenu label="Exportar seleccionadas" filenamePrefix="paginas" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
            />
          ) : undefined}
          empty={{ icon: FileText, title: 'Aún no hay páginas', description: 'Cree la primera página. Hasta publicarla, solo usted la verá.' }}
        />
      </Card>
      <CreatePageModal open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog open={!!toDelete} title="¿Eliminar página?" message={`"${toDelete?.title}" dejará de existir en el sitio. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar página" loading={remove.isPending} onConfirm={() => toDelete && remove.mutate(toDelete.id)} onClose={() => setToDelete(null)} />
      <BulkConfirmDialog
        open={!!bulkAction}
        onClose={() => setBulkAction(null)}
        action={bulkAction}
        entityLabel="páginas"
        ids={selection.ids}
        allMatching={selection.allMatching}
        filters={filters}
        execute={(body) => bulk.mutateAsync(body)}
        onDone={() => selection.onClear()}
      />
    </>
  );
}

function CreatePageModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [template, setTemplate] = useState<CmsPageAdmin['template']>('simple');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: () => contentApi.adminCreatePage({ title, slug: slug || slugify(title), template, draft_blocks: [], seo: {} }),
    onSuccess: () => { toast.success('Página creada.'); void invalidateEntity(qc, PAGES_ENTITY); onClose(); setTitle(''); setSlug(''); },
    onError: (e) => setErrors(apiErrors(e)),
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
