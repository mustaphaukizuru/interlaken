import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Pencil, Plus, Quote, Trash2 } from 'lucide-react';
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
import { TESTIMONIALS_ENTITY, useTestimonialsBulk, useTestimonialsExport, useTestimonialsList } from '@/hooks/queries/AdminContentQueries';
import { invalidateEntity } from '@/hooks/queries/keys';
import { contentApi, type BulkActionDef, type Testimonial, type TestimonialWrite } from '@/services/api';
import { idsParam, type ExportFormat } from '@/services/dataOps';
import { LEVELS, PUBLISHED_OPTIONS, levelLabel, publishedMeta } from '@/lib/status/AdminContentStatus';

const EMPTY: TestimonialWrite = { quote: '', author: '', role: '', level: '', is_published: true, order: 0 };

const BULK_ACTIONS: BulkActionDef[] = [
  { name: 'publish', label: 'Publicar', planVerb: 'Se publicarán', icon: Eye },
  { name: 'unpublish', label: 'Despublicar', planVerb: 'Se despublicarán', icon: EyeOff },
  { name: 'delete', label: 'Eliminar', planVerb: 'Se eliminarán', danger: true, icon: Trash2 },
];

/** Inline "Orden" editor: saves on blur or Enter, only when the number changed. */
function OrderCell({ item, onSave }: { item: Testimonial; onSave: (order: number) => void }) {
  const [value, setValue] = useState(String(item.order));
  const commit = () => {
    const next = Number.parseInt(value, 10);
    if (Number.isNaN(next) || next < 0) { setValue(String(item.order)); return; }
    if (next !== item.order) onSave(next);
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      className="input-field w-20 !py-1 text-right tabular-nums"
      aria-label={`Orden de ${item.author}`}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
    />
  );
}

/** /admin/testimonios — quotes shown on Home and Admisiones (BACKLOG P2-15) on the
 *  Data Ops list contract (Phase 8): search, filters and sort in the URL, bulk
 *  publish/unpublish/delete, export and inline order editing. */
export default function AdminTestimonials() {
  const qc = useQueryClient();
  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const sort = parseSort(get('orden'));
  const filters = {
    q: get('q') || undefined,
    published: get('publicado') || undefined,
    level: get('nivel') || undefined,
    ordering: serializeSort(sort) || undefined,
  };
  const { data, isLoading, isError, refetch } = useTestimonialsList({ page, ...filters });
  const exportTestimonials = useTestimonialsExport();
  const bulk = useTestimonialsBulk();
  const rows = data?.results;
  const count = data?.count ?? 0;
  const selection = useRowSelection(count, JSON.stringify(filters));

  const [editing, setEditing] = useState<Testimonial | null | 'new'>(null);
  const [toDelete, setToDelete] = useState<Testimonial | null>(null);
  const [bulkAction, setBulkAction] = useState<BulkActionDef | null>(null);
  const invalidate = () => { void invalidateEntity(qc, TESTIMONIALS_ENTITY); void qc.invalidateQueries({ queryKey: ['testimonials'] }); };

  const remove = useMutation({
    mutationFn: (id: number) => contentApi.adminDeleteTestimonial(id),
    onSuccess: () => { toast.success('Eliminado.'); setToDelete(null); invalidate(); },
    onError: () => toast.error('No se pudo eliminar.'),
  });
  const reorder = useMutation({
    mutationFn: ({ id, order }: { id: number; order: number }) => contentApi.adminUpdateTestimonial(id, { order }),
    onSuccess: () => { toast.success('Orden actualizado.'); invalidate(); },
    onError: () => toast.error('No se pudo cambiar el orden.'),
  });

  const fetchExport = (fmt: ExportFormat, { selectedOnly }: { selectedOnly: boolean }) =>
    exportTestimonials.mutateAsync({ ...filters, fmt, ids: selectedOnly && !selection.allMatching ? idsParam(selection.ids) : undefined });

  const columns: Column<Testimonial>[] = [
    {
      id: 'order', header: 'Orden', sortKey: 'order', minWidth: 96,
      cell: (t) => <OrderCell key={`${t.id}-${t.order}`} item={t} onSave={(order) => reorder.mutate({ id: t.id, order })} />,
    },
    { id: 'quote', header: 'Testimonio', hideable: false, minWidth: 260, className: 'text-sm text-ink', cell: (t) => <span className="line-clamp-2">“{t.quote}”</span> },
    { id: 'author', header: 'Nombre', sortKey: 'author', minWidth: 140, className: 'font-medium text-ink', cell: (t) => t.author },
    { id: 'role', header: 'Relación', minWidth: 160, className: 'text-xs text-muted', cell: (t) => t.role || '—' },
    { id: 'level', header: 'Nivel', sortKey: 'level', minWidth: 110, className: 'text-muted', cell: (t) => levelLabel(t.level, 'General') },
    {
      id: 'published', header: 'Estado', sortKey: 'published', minWidth: 110,
      cell: (t) => { const m = publishedMeta(t.is_published); return <Badge variant={m.variant}>{m.label}</Badge>; },
    },
  ];

  return (
    <>
      <PageHeader title="Testimonios" subtitle="Frases de familias y egresados que aparecen en Inicio y Admisiones. El orden menor aparece primero."
        actions={(
          <div className="flex flex-wrap gap-2">
            <ExportMenu filenamePrefix="testimonios" selectedCount={selection.count} fetch={fetchExport} />
            <Button onClick={() => setEditing('new')}><Plus size={16} aria-hidden="true" /> Nuevo testimonio</Button>
          </div>
        )} />
      <Card title={`${count.toLocaleString('es-MX')} testimonios`}>
        <DataTable<Testimonial>
          tableId="testimonials"
          columns={columns}
          rows={rows}
          rowKey={(t) => t.id}
          rowLabel={(t) => `testimonio de ${t.author}`}
          caption="Testimonios"
          sort={sort}
          onSort={(next: SortState) => set({ orden: serializeSort(next), page: null })}
          page={page}
          count={count}
          onPage={setPage}
          itemLabel="testimonios"
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          columnControls
          resizable
          selection={selection}
          rowActions={(t) => (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(t)} aria-label={`Editar testimonio de ${t.author}`}><Pencil className="h-4 w-4" aria-hidden="true" /> Editar</Button>
              <Button size="sm" variant="ghost" onClick={() => setToDelete(t)} aria-label={`Eliminar testimonio de ${t.author}`}><Trash2 className="h-4 w-4" aria-hidden="true" /> Eliminar</Button>
            </>
          )}
          toolbar={(
            <FilterBar
              search={{ placeholder: 'Texto, nombre o relación…', label: 'Buscar testimonios' }}
              tabs={{ paramKey: 'publicado', options: PUBLISHED_OPTIONS, allLabel: 'Todos', label: 'Filtrar por publicación' }}
              selects={[{ key: 'nivel', label: 'Nivel', options: [{ value: 'general', label: 'General' }, ...LEVELS], allLabel: 'Cualquier nivel' }]}
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
              onAction={setBulkAction}
              itemLabel="testimonios"
              gender="m"
              exportMenu={<ExportMenu label="Exportar seleccionados" filenamePrefix="testimonios" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
            />
          )}
          empty={{ icon: Quote, title: 'Sin testimonios', description: 'Agregue frases reales de familias; aparecerán en el sitio al publicarlas.' }}
        />
      </Card>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Nuevo testimonio' : 'Editar testimonio'} maxWidth={520}>
        {editing !== null && <TestimonialForm key={editing === 'new' ? 'new' : editing.id} item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={invalidate} />}
      </Modal>
      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        title="Eliminar testimonio" message={`¿Eliminar el testimonio de ${toDelete?.author ?? ''}?`} confirmLabel="Eliminar" loading={remove.isPending} />
      <BulkConfirmDialog
        open={!!bulkAction}
        onClose={() => setBulkAction(null)}
        action={bulkAction}
        entityLabel="testimonios"
        gender="m"
        ids={selection.ids}
        allMatching={selection.allMatching}
        filters={filters}
        execute={(body) => bulk.mutateAsync(body)}
        onDone={() => { selection.onClear(); void qc.invalidateQueries({ queryKey: ['testimonials'] }); }}
      />
    </>
  );
}

function TestimonialForm({ item, onClose, onSaved }: { item: Testimonial | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<TestimonialWrite>(item ? { quote: item.quote, author: item.author, role: item.role, level: item.level, is_published: item.is_published, order: item.order } : EMPTY);
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => item ? contentApi.adminUpdateTestimonial(item.id, form) : contentApi.adminCreateTestimonial(form),
    onSuccess: () => { toast.success('Guardado.'); onSaved(); onClose(); },
    onError: () => toast.error('No se pudo guardar.'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.quote.trim() || !form.author.trim()) { setError('Testimonio y nombre son requeridos.'); return; }
    save.mutate();
  };
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <label className="label" htmlFor="tm-quote">Testimonio</label>
        <textarea id="tm-quote" className="input-field min-h-[100px]" maxLength={400} value={form.quote} onChange={(e) => { setForm({ ...form, quote: e.target.value }); setError(''); }} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Nombre" value={form.author} onChange={(e) => { setForm({ ...form, author: e.target.value }); setError(''); }} required />
        <Input label="Relación" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Mamá de alumno de 2° de primaria" />
        <div>
          <label className="label" htmlFor="tm-level">Nivel</label>
          <select id="tm-level" className="input-field min-h-[44px]" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
            <option value="">General</option>
            {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>
        <Input label="Orden" type="number" inputMode="numeric" value={String(form.order)} onChange={(e) => setForm({ ...form, order: Number(e.target.value) || 0 })} />
      </div>
      <label className="flex min-h-[44px] items-center gap-2 text-sm text-ink"><input type="checkbox" checked={form.is_published} onChange={(e) => setForm({ ...form, is_published: e.target.checked })} /> Publicado</label>
      {error && <p className="text-xs text-coral-600">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onClose} className="min-h-[44px]">Cancelar</Button>
        <Button type="submit" loading={save.isPending} className="min-h-[44px]">Guardar</Button>
      </div>
    </form>
  );
}
