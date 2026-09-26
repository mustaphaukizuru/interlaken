import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Eye, EyeOff, Link2, Pencil, Plus, Trash2, Upload } from 'lucide-react';
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
import { ImportDialog } from '@/components/admin/ImportDialog';
import { useUrlFilters, useUrlPage } from '@/hooks/useUrlFilters';
import { useRowSelection } from '@/hooks/useRowSelection';
import { CALENDAR_ENTITY, useCalendarBulk, useCalendarExport, useCalendarList } from '@/hooks/queries/AdminContentQueries';
import { invalidateEntity } from '@/hooks/queries/keys';
import { calendarAdminApi, calendarIcsUrl } from '@/services/AdminContentApi';
import { contentApi, type BulkActionDef, type SchoolEvent, type SchoolEventWrite } from '@/services/api';
import { idsParam, type ExportFormat } from '@/services/dataOps';
import { fieldErrorsFrom } from '@/components/admin/StudentFormModal';
import { EVENT_KINDS, LEVELS, PUBLISHED_OPTIONS, formatDateOnly, levelLabel, publishedMeta } from '@/lib/status/AdminContentStatus';

const EMPTY: SchoolEventWrite = { title: '', kind: 'event', start_date: '', end_date: '', level: '', description: '', is_published: true };

const BULK_ACTIONS: BulkActionDef[] = [
  { name: 'publish', label: 'Publicar', planVerb: 'Se publicarán', icon: Eye },
  { name: 'unpublish', label: 'Despublicar', planVerb: 'Se despublicarán', icon: EyeOff },
  { name: 'delete', label: 'Eliminar', planVerb: 'Se eliminarán', danger: true, icon: Trash2 },
];

const IMPORT_HEADERS = [
  { key: 'titulo', required: true }, { key: 'tipo' }, { key: 'inicio', required: true }, { key: 'fin' },
  { key: 'nivel' }, { key: 'descripcion' }, { key: 'publicado' },
];

const COLUMNS: Column<SchoolEvent>[] = [
  { id: 'title', header: 'Evento', sortKey: 'title', hideable: false, minWidth: 200, className: 'font-medium text-ink', cell: (e) => e.title },
  { id: 'start', header: 'Inicio', sortKey: 'start', minWidth: 110, className: 'whitespace-nowrap text-muted tabular-nums', cell: (e) => formatDateOnly(e.start_date) },
  { id: 'end', header: 'Fin', sortKey: 'end', minWidth: 110, className: 'whitespace-nowrap text-muted tabular-nums', cell: (e) => formatDateOnly(e.end_date) || '—' },
  { id: 'kind', header: 'Tipo', sortKey: 'kind', minWidth: 150, cell: (e) => <Badge variant="info">{e.kind_label}</Badge> },
  { id: 'level', header: 'Nivel', sortKey: 'level', minWidth: 110, className: 'text-muted', cell: (e) => levelLabel(e.level) },
  { id: 'description', header: 'Descripción', minWidth: 200, defaultHidden: true, className: 'text-xs text-muted', cell: (e) => e.description || '—' },
  {
    id: 'published', header: 'Estado', sortKey: 'published', minWidth: 110,
    cell: (e) => { const m = publishedMeta(e.is_published); return <Badge variant={m.variant}>{m.label}</Badge>; },
  },
];

/** /admin/calendario — school calendar on the Data Ops list contract (BACKLOG P2-16, Phase 8):
 *  search, filters and sort in the URL, selection with bulk publish/unpublish/delete,
 *  export, CSV/Excel import and the public .ics feed link. */
export default function AdminCalendar() {
  const qc = useQueryClient();
  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const sort = parseSort(get('orden'));
  const filters = {
    q: get('q') || undefined,
    kind: get('tipo') || undefined,
    level: get('nivel') || undefined,
    published: get('publicado') || undefined,
    from: get('desde') || undefined,
    to: get('hasta') || undefined,
    ordering: serializeSort(sort) || undefined,
  };
  const { data, isLoading, isError, refetch } = useCalendarList({ page, ...filters });
  const exportCalendar = useCalendarExport();
  const bulk = useCalendarBulk();
  const rows = data?.results;
  const count = data?.count ?? 0;
  const selection = useRowSelection(count, JSON.stringify(filters));

  const [editing, setEditing] = useState<SchoolEvent | null | 'new'>(null);
  const [toDelete, setToDelete] = useState<SchoolEvent | null>(null);
  const [bulkAction, setBulkAction] = useState<BulkActionDef | null>(null);
  const [importing, setImporting] = useState(false);

  const invalidate = () => { void invalidateEntity(qc, CALENDAR_ENTITY); void qc.invalidateQueries({ queryKey: ['school-calendar'] }); };
  const remove = useMutation({
    mutationFn: (id: number) => contentApi.adminDeleteCalendar(id),
    onSuccess: () => { toast.success('Evento eliminado.'); setToDelete(null); invalidate(); },
    onError: () => toast.error('No se pudo eliminar.'),
  });

  const fetchExport = (fmt: ExportFormat, { selectedOnly }: { selectedOnly: boolean }) =>
    exportCalendar.mutateAsync({ ...filters, fmt, ids: selectedOnly && !selection.allMatching ? idsParam(selection.ids) : undefined });

  const copyIcs = async () => {
    try {
      await navigator.clipboard.writeText(calendarIcsUrl());
      toast.success('Liga .ics copiada. Péguela en Google Calendar, Outlook o Apple Calendar para suscribirse.');
    } catch {
      toast.error('No se pudo copiar la liga.');
    }
  };

  return (
    <>
      <PageHeader
        title="Calendario escolar"
        subtitle="Fechas que las familias ven en /calendario y en su calendario suscrito (.ics). Sin publicar = solo visible aquí."
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => { void copyIcs(); }}><Link2 size={16} aria-hidden="true" /> Copiar liga .ics</Button>
            <Button variant="secondary" onClick={() => setImporting(true)}><Upload size={16} aria-hidden="true" /> Importar</Button>
            <ExportMenu filenamePrefix="calendario" selectedCount={selection.count} fetch={fetchExport} />
            <Button onClick={() => setEditing('new')}><Plus size={16} aria-hidden="true" /> Nuevo evento</Button>
          </div>
        )}
      />
      <Card title={`${count.toLocaleString('es-MX')} eventos`}>
        <DataTable<SchoolEvent>
          tableId="calendar"
          columns={COLUMNS}
          rows={rows}
          rowKey={(e) => e.id}
          rowLabel={(e) => `evento ${e.title}`}
          caption="Eventos del calendario escolar"
          sort={sort}
          onSort={(next: SortState) => set({ orden: serializeSort(next), page: null })}
          page={page}
          count={count}
          onPage={setPage}
          itemLabel="eventos"
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          columnControls
          resizable
          pinFirstColumn
          selection={selection}
          onRowClick={(e) => setEditing(e)}
          rowActions={(e) => (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(e)} aria-label={`Editar ${e.title}`}><Pencil className="h-4 w-4" aria-hidden="true" /> Editar</Button>
              <Button size="sm" variant="ghost" onClick={() => setToDelete(e)} aria-label={`Eliminar ${e.title}`}><Trash2 className="h-4 w-4" aria-hidden="true" /> Eliminar</Button>
            </>
          )}
          toolbar={(
            <FilterBar
              search={{ placeholder: 'Título o descripción…', label: 'Buscar eventos' }}
              tabs={{ paramKey: 'publicado', options: PUBLISHED_OPTIONS, allLabel: 'Todos', label: 'Filtrar por publicación' }}
              selects={[
                { key: 'tipo', label: 'Tipo', options: EVENT_KINDS, allLabel: 'Todos los tipos' },
                { key: 'nivel', label: 'Nivel', options: [{ value: 'todos', label: 'Todos los niveles (general)' }, ...LEVELS], allLabel: 'Cualquier nivel' },
              ]}
              dateRange={{ idPrefix: 'calendario' }}
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
              itemLabel="eventos"
              gender="m"
              exportMenu={<ExportMenu label="Exportar seleccionados" filenamePrefix="calendario" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
            />
          )}
          empty={{ icon: CalendarDays, title: 'Sin eventos', description: 'Agregue vacaciones, evaluaciones, eventos y juntas, o impórtelos desde un archivo.' }}
        />
      </Card>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Nuevo evento' : 'Editar evento'} maxWidth={520}>
        {editing !== null && <EventForm key={editing === 'new' ? 'new' : editing.id} event={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={invalidate} />}
      </Modal>
      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        title="Eliminar evento" message={`¿Eliminar "${toDelete?.title ?? ''}" del calendario?`} confirmLabel="Eliminar" loading={remove.isPending} />
      <BulkConfirmDialog
        open={!!bulkAction}
        onClose={() => setBulkAction(null)}
        action={bulkAction}
        entityLabel="eventos"
        gender="m"
        ids={selection.ids}
        allMatching={selection.allMatching}
        filters={filters}
        execute={(body) => bulk.mutateAsync(body)}
        onDone={() => { selection.onClear(); void qc.invalidateQueries({ queryKey: ['school-calendar'] }); }}
      />
      <ImportDialog
        open={importing}
        onClose={() => setImporting(false)}
        title="Importar eventos del calendario"
        entity={CALENDAR_ENTITY}
        api={calendarAdminApi.import}
        headers={IMPORT_HEADERS}
        templatePrefix="plantilla_calendario"
        description={<>Fechas en formato DD/MM/AAAA. Un evento con el mismo título e inicio se actualiza en lugar de duplicarse. Tipo: suspension, vacaciones, examen, evento, junta o fecha_limite.</>}
      />
    </>
  );
}

function EventForm({ event, onClose, onSaved }: { event: SchoolEvent | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<SchoolEventWrite>(event ? {
    title: event.title, kind: event.kind, start_date: event.start_date, end_date: event.end_date ?? '', level: event.level,
    description: event.description, is_published: event.is_published,
  } : EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof SchoolEventWrite, string>>>({});
  const set = <K extends keyof SchoolEventWrite>(k: K, v: SchoolEventWrite[K]) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); };
  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form, end_date: form.end_date || null };
      return event ? contentApi.adminUpdateCalendar(event.id, payload) : contentApi.adminCreateCalendar(payload);
    },
    onSuccess: () => { toast.success('Guardado.'); onSaved(); onClose(); },
    onError: (e: unknown) => { const f = fieldErrorsFrom(e); if (f) setErrors(f as typeof errors); else toast.error('No se pudo guardar.'); },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { setErrors({ title: 'Requerido.' }); return; }
    if (!form.start_date) { setErrors({ start_date: 'Requerido.' }); return; }
    save.mutate();
  };
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Input label="Título" value={form.title} onChange={(e) => set('title', e.target.value)} error={errors.title} required />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="ev-kind">Tipo</label>
          <select id="ev-kind" className="input-field min-h-[44px]" value={form.kind} onChange={(e) => set('kind', e.target.value as SchoolEvent['kind'])}>
            {EVENT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ev-level">Nivel</label>
          <select id="ev-level" className="input-field min-h-[44px]" value={form.level} onChange={(e) => set('level', e.target.value)}>
            <option value="">Todos</option>
            {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>
        <Input label="Inicio" type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} error={errors.start_date} required />
        <Input label="Fin (opcional)" type="date" value={form.end_date ?? ''} onChange={(e) => set('end_date', e.target.value)} error={errors.end_date} />
      </div>
      <Input label="Descripción (opcional)" value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={300} />
      <label className="flex min-h-[44px] items-center gap-2 text-sm text-ink"><input type="checkbox" checked={form.is_published} onChange={(e) => set('is_published', e.target.checked)} /> Publicado en el sitio</label>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onClose} className="min-h-[44px]">Cancelar</Button>
        <Button type="submit" loading={save.isPending} className="min-h-[44px]">Guardar</Button>
      </div>
    </form>
  );
}
