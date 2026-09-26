import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, CornerDownRight, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { parseSort, serializeSort, type SortState } from '@/components/ui/SortableTh';
import { ExportMenu } from '@/components/admin/ExportMenu';
import { FilterBar } from '@/components/admin/FilterBar';
import { BulkActionBar } from '@/components/admin/BulkActionBar';
import { BulkConfirmDialog } from '@/components/admin/BulkConfirmDialog';
import { ImportDialog } from '@/components/admin/ImportDialog';
import { useUrlFilters, useUrlPage } from '@/hooks/useUrlFilters';
import { useRowSelection } from '@/hooks/useRowSelection';
import { REDIRECTS_ENTITY, useRedirectsBulk, useRedirectsExport, useRedirectsList } from '@/hooks/queries/AdminContentQueries';
import { invalidateEntity } from '@/hooks/queries/keys';
import { redirectsAdminApi } from '@/services/AdminContentApi';
import { contentApi, type BulkActionDef, type SiteRedirect } from '@/services/api';
import { idsParam, type ExportFormat } from '@/services/dataOps';
import { formatDateTime } from '@/lib/format';
import type { MenuGroup } from '@/types/content';
import { apiErrors } from '@/cms/editor/helpers';

const ICON_OPTIONS = ['Users', 'BookOpen', 'Camera', 'Blocks', 'Pencil', 'GraduationCap', 'ClipboardList', 'FileText', 'CircleDollarSign', 'UserPlus', 'CalendarDays', 'MonitorSmartphone', 'Receipt', 'Phone', 'Mail', 'MapPin'];

/** The built-in menu, offered as the starting point when the CMS menu is empty. */
export const DEFAULT_MENU: MenuGroup[] = [
  { label: 'El Colegio', items: [{ label: 'Quiénes Somos', to: '/nosotros', icon: 'Users' }, { label: 'Modelo Educativo', to: '/modelo-educativo', icon: 'BookOpen' }, { label: 'Galería', to: '/galeria', icon: 'Camera' }] },
  { label: 'Niveles Educativos', items: [{ label: 'Preescolar', to: '/niveles/preescolar', icon: 'Blocks' }, { label: 'Primaria', to: '/niveles/primaria', icon: 'Pencil' }, { label: 'Secundaria', to: '/niveles/secundaria', icon: 'GraduationCap' }] },
  { label: 'Admisiones', items: [{ label: 'Proceso de Inscripción', to: '/admisiones', icon: 'ClipboardList' }, { label: 'Documentación', to: '/admisiones/documentacion', icon: 'FileText' }, { label: 'Costos', to: '/admisiones/costos', icon: 'CircleDollarSign' }, { label: 'Pre-Registro', to: '/pre-registro', icon: 'UserPlus' }] },
  { label: 'Comunidad', items: [{ label: 'Plataformas', to: '/comunidad/plataformas', icon: 'MonitorSmartphone' }, { label: 'Calendario escolar', to: '/calendario', icon: 'CalendarDays' }, { label: 'Facturación', to: '/comunidad/facturacion', icon: 'Receipt' }] },
];

function moveAt<T>(list: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const n = list.slice();
  [n[i], n[j]] = [n[j], n[i]];
  return n;
}

/** /admin/navegacion — header/footer/mobile menu editor + redirects (BACKLOG P3-7). */
export default function AdminNavigation() {
  return (
    <>
      <PageHeader title="Navegación" subtitle="El menú del encabezado, el pie de página y el menú móvil se editan aquí una sola vez. Las redirecciones evitan enlaces rotos al renombrar páginas." />
      <div className="space-y-6">
        <MenuEditor />
        <RedirectsPanel />
      </div>
    </>
  );
}

function MenuEditor() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['admin-site-settings'], queryFn: async () => (await contentApi.adminGetSettings()).data as { menu?: MenuGroup[] } });
  const [draft, setDraft] = useState<MenuGroup[] | null>(null);
  const [customOverride, setCustomOverride] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const stored = data?.menu ?? [];
  const custom = customOverride ?? stored.length > 0;
  const menu = draft ?? (stored.length > 0 ? stored : DEFAULT_MENU);
  const setMenu = (next: MenuGroup[] | ((m: MenuGroup[]) => MenuGroup[])) => setDraft(typeof next === 'function' ? next(menu) : next);
  const setCustom = setCustomOverride;
  const save = useMutation({
    mutationFn: (value: MenuGroup[]) => contentApi.adminUpdateSettings({ menu: value }),
    onSuccess: () => { toast.success('Menú guardado. El sitio lo muestra en unos minutos.'); setError(''); setDraft(null); setCustomOverride(null); qc.invalidateQueries({ queryKey: ['admin-site-settings'] }); qc.invalidateQueries({ queryKey: ['site-settings'] }); },
    onError: (e) => { const f = apiErrors(e); setError(f.menu || f.detail || 'No se pudo guardar.'); },
  });
  const setGroup = (gi: number, patch: Partial<MenuGroup>) => setMenu((m) => m.map((g, i) => (i === gi ? { ...g, ...patch } : g)));
  const setItem = (gi: number, ii: number, patch: Partial<MenuGroup['items'][number]>) => setGroup(gi, { items: menu[gi].items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) });
  if (isLoading) return <Card><ListSkeleton /></Card>;
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-head text-lg font-bold text-ink">Menú del sitio</h2>
        <div className="flex gap-2">
          {custom && <Button size="sm" variant="ghost" onClick={() => { setCustom(false); setMenu(DEFAULT_MENU); save.mutate([]); }}><RotateCcw size={14} aria-hidden="true" /> Volver al menú integrado</Button>}
          <Button size="sm" onClick={() => { setCustom(true); save.mutate(menu); }} loading={save.isPending}>Guardar menú</Button>
        </div>
      </div>
      {!custom && <p className="mb-3 rounded-lg bg-cream-2 px-3 py-2 text-xs text-muted">Actualmente el sitio usa el menú integrado. Edite y guarde para reemplazarlo.</p>}
      {error && <p className="mb-3 text-sm text-coral-600" role="alert">{error}</p>}
      <div className="space-y-4">
        {menu.map((g, gi) => (
          <fieldset key={gi} className="rounded-xl border border-line p-3">
            <div className="mb-2 flex items-end gap-2">
              <div className="flex-1"><Input label="Grupo" value={g.label} onChange={(e) => setGroup(gi, { label: e.target.value })} /></div>
              <button type="button" aria-label="Subir grupo" disabled={gi === 0} className="rounded p-2 text-subtle hover:text-ink disabled:opacity-30" onClick={() => setMenu((m) => moveAt(m, gi, -1))}><ArrowUp size={16} /></button>
              <button type="button" aria-label="Bajar grupo" disabled={gi === menu.length - 1} className="rounded p-2 text-subtle hover:text-ink disabled:opacity-30" onClick={() => setMenu((m) => moveAt(m, gi, 1))}><ArrowDown size={16} /></button>
              <button type="button" aria-label="Eliminar grupo" className="rounded p-2 text-subtle hover:text-coral-600" onClick={() => setMenu((m) => m.filter((_, i) => i !== gi))}><Trash2 size={16} /></button>
            </div>
            <ul className="space-y-2">
              {g.items.map((it, ii) => (
                <li key={ii} className="grid items-end gap-2 rounded-lg bg-cream-2 p-2 sm:grid-cols-[1fr_1fr_150px_auto]">
                  <Input label="Texto" value={it.label} onChange={(e) => setItem(gi, ii, { label: e.target.value })} />
                  <Input label="Ruta o URL" value={it.to} onChange={(e) => setItem(gi, ii, { to: e.target.value })} placeholder="/admisiones" />
                  <div>
                    <label className="label" htmlFor={`ic-${gi}-${ii}`}>Ícono</label>
                    <select id={`ic-${gi}-${ii}`} className="input-field" value={it.icon ?? ''} onChange={(e) => setItem(gi, ii, { icon: e.target.value })}>
                      <option value="">(ninguno)</option>
                      {ICON_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-1 pb-1">
                    <button type="button" aria-label="Subir enlace" disabled={ii === 0} className="rounded p-1 text-subtle hover:text-ink disabled:opacity-30" onClick={() => setGroup(gi, { items: moveAt(g.items, ii, -1) })}><ArrowUp size={14} /></button>
                    <button type="button" aria-label="Bajar enlace" disabled={ii === g.items.length - 1} className="rounded p-1 text-subtle hover:text-ink disabled:opacity-30" onClick={() => setGroup(gi, { items: moveAt(g.items, ii, 1) })}><ArrowDown size={14} /></button>
                    <button type="button" aria-label="Quitar enlace" className="rounded p-1 text-subtle hover:text-coral-600" onClick={() => setGroup(gi, { items: g.items.filter((_, j) => j !== ii) })}><Trash2 size={14} /></button>
                  </div>
                </li>
              ))}
            </ul>
            <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => setGroup(gi, { items: [...g.items, { label: '', to: '/', icon: '' }] })}><Plus size={14} aria-hidden="true" /> Agregar enlace</Button>
          </fieldset>
        ))}
        <Button type="button" size="sm" variant="secondary" onClick={() => setMenu((m) => [...m, { label: 'Nuevo grupo', items: [{ label: '', to: '/', icon: '' }] }])} disabled={menu.length >= 8}><Plus size={14} aria-hidden="true" /> Agregar grupo</Button>
      </div>
    </Card>
  );
}

const REDIRECT_BULK: BulkActionDef[] = [
  { name: 'delete', label: 'Eliminar', planVerb: 'Se eliminarán', danger: true, icon: Trash2 },
];
const PERMANENT_OPTIONS = [
  { value: '1', label: '301 permanentes' },
  { value: '0', label: '302 temporales' },
];
const REDIRECT_IMPORT_HEADERS = [{ key: 'de', required: true }, { key: 'a', required: true }, { key: 'permanente' }];

/** Redirects on the Data Ops list contract (Phase 8): search, filter, sort, paging,
 *  bulk delete, export and CSV/Excel import (`de, a, permanente`; dedupe by `de`). */
function RedirectsPanel() {
  const qc = useQueryClient();
  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const sort = parseSort(get('orden'));
  const filters = {
    q: get('q') || undefined,
    permanent: get('tipo') || undefined,
    ordering: serializeSort(sort) || undefined,
  };
  const { data, isLoading, isError, refetch } = useRedirectsList({ page, ...filters });
  const exportRedirects = useRedirectsExport();
  const bulk = useRedirectsBulk();
  const rows = data?.results;
  const count = data?.count ?? 0;
  const selection = useRowSelection(count, JSON.stringify(filters));

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [permanent, setPermanent] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toDelete, setToDelete] = useState<SiteRedirect | null>(null);
  const [bulkAction, setBulkAction] = useState<BulkActionDef | null>(null);
  const [importing, setImporting] = useState(false);
  const invalidate = () => { void invalidateEntity(qc, REDIRECTS_ENTITY); void qc.invalidateQueries({ queryKey: ['cms-redirects'] }); };
  const create = useMutation({
    mutationFn: () => contentApi.adminCreateRedirect({ from_path: from, to_path: to, permanent }),
    onSuccess: () => { toast.success('Redirección creada.'); setFrom(''); setTo(''); setErrors({}); invalidate(); },
    onError: (e) => setErrors(apiErrors(e)),
  });
  const remove = useMutation({
    mutationFn: (id: number) => contentApi.adminDeleteRedirect(id),
    onSuccess: () => { setToDelete(null); invalidate(); },
    onError: () => toast.error('No se pudo eliminar.'),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(); };
  const fetchExport = (fmt: ExportFormat, { selectedOnly }: { selectedOnly: boolean }) =>
    exportRedirects.mutateAsync({ ...filters, fmt, ids: selectedOnly && !selection.allMatching ? idsParam(selection.ids) : undefined });

  const columns: Column<SiteRedirect>[] = [
    { id: 'from', header: 'Ruta antigua', sortKey: 'from', hideable: false, minWidth: 160, className: 'font-mono text-xs text-ink break-all', cell: (r) => r.from_path },
    { id: 'to', header: 'Enviar a', sortKey: 'to', minWidth: 180, className: 'font-mono text-xs text-muted break-all', cell: (r) => r.to_path },
    { id: 'permanent', header: 'Tipo', sortKey: 'permanent', minWidth: 80, cell: (r) => <Badge variant={r.permanent ? 'info' : 'neutral'}>{r.permanent ? '301' : '302'}</Badge> },
    { id: 'hits', header: 'Visitas', sortKey: 'hits', align: 'right', minWidth: 80, className: 'tabular-nums text-muted', cell: (r) => r.hits.toLocaleString('es-MX') },
    { id: 'created', header: 'Creada', sortKey: 'created', minWidth: 140, defaultHidden: true, className: 'whitespace-nowrap text-xs text-muted', cell: (r) => formatDateTime(r.created_at) },
  ];

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-head text-lg font-bold text-ink">Redirecciones</h2>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setImporting(true)}><Upload size={14} aria-hidden="true" /> Importar</Button>
          <ExportMenu filenamePrefix="redirecciones" selectedCount={selection.count} fetch={fetchExport} />
        </div>
      </div>
      <form onSubmit={submit} className="mb-4 grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
        <Input label="Ruta antigua" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="/inscripciones" error={errors.from_path} required />
        <Input label="Enviar a" value={to} onChange={(e) => setTo(e.target.value)} placeholder="/admisiones" error={errors.to_path} required />
        <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" checked={permanent} onChange={(e) => setPermanent(e.target.checked)} /> Permanente (301)</label>
        <Button type="submit" size="sm" loading={create.isPending} className="min-h-[44px]"><Plus size={14} aria-hidden="true" /> Agregar</Button>
      </form>
      <DataTable<SiteRedirect>
        tableId="redirects"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        rowLabel={(r) => `redirección ${r.from_path}`}
        caption="Redirecciones"
        sort={sort}
        onSort={(next: SortState) => set({ orden: serializeSort(next), page: null })}
        page={page}
        count={count}
        onPage={setPage}
        itemLabel="redirecciones"
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        columnControls
        selection={selection}
        rowActions={(r) => (
          <Button size="sm" variant="ghost" onClick={() => setToDelete(r)} aria-label={`Eliminar ${r.from_path}`}><Trash2 size={14} aria-hidden="true" /></Button>
        )}
        toolbar={(
          <FilterBar
            search={{ placeholder: 'Ruta antigua o destino…', label: 'Buscar redirecciones' }}
            tabs={{ paramKey: 'tipo', options: PERMANENT_OPTIONS, allLabel: 'Todas', label: 'Filtrar por tipo' }}
          />
        )}
        bulkBar={(
          <BulkActionBar
            count={selection.count}
            allMatching={selection.allMatching}
            allMatchingCount={count}
            onSelectAllMatching={selection.onSelectAllMatching}
            onClear={selection.onClear}
            actions={REDIRECT_BULK}
            onAction={setBulkAction}
            itemLabel="redirecciones"
            exportMenu={<ExportMenu label="Exportar seleccionadas" filenamePrefix="redirecciones" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
          />
        )}
        empty={{ icon: CornerDownRight, title: 'Sin redirecciones', description: 'Agregue una al renombrar o retirar una página, o impórtelas desde un archivo.' }}
      />
      <ConfirmDialog open={!!toDelete} title="¿Eliminar redirección?" message={`${toDelete?.from_path} volverá a mostrar 404 si la página ya no existe.`} confirmLabel="Eliminar redirección" loading={remove.isPending} onConfirm={() => toDelete && remove.mutate(toDelete.id)} onClose={() => setToDelete(null)} />
      <BulkConfirmDialog
        open={!!bulkAction}
        onClose={() => setBulkAction(null)}
        action={bulkAction}
        entityLabel="redirecciones"
        ids={selection.ids}
        allMatching={selection.allMatching}
        filters={filters}
        execute={(body) => bulk.mutateAsync(body)}
        onDone={() => { selection.onClear(); void qc.invalidateQueries({ queryKey: ['cms-redirects'] }); }}
      />
      <ImportDialog
        open={importing}
        onClose={() => setImporting(false)}
        title="Importar redirecciones"
        entity={REDIRECTS_ENTITY}
        api={redirectsAdminApi.import}
        headers={REDIRECT_IMPORT_HEADERS}
        templatePrefix="plantilla_redirecciones"
        description={<>Una fila por ruta antigua. Si la ruta ya existe se actualiza su destino. «permanente»: sí (301) o no (302); vacío = sí.</>}
        onImported={() => { void qc.invalidateQueries({ queryKey: ['cms-redirects'] }); }}
      />
    </Card>
  );
}
