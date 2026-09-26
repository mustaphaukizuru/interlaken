import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, ClipboardList, Inbox, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
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
import {
  FORMS_ENTITY, SUBMISSIONS_ENTITY, useFormsBulk, useFormsExport, useFormsList, useSubmissionsBulk, useSubmissionsExport, useSubmissionsList,
} from '@/hooks/queries/AdminContentQueries';
import { invalidateEntity } from '@/hooks/queries/keys';
import { contentApi, type BulkActionDef, type FormDefinitionAdmin, type FormField, type FormFieldType, type FormSubmission } from '@/services/api';
import { idsParam, type ExportFormat } from '@/services/dataOps';
import { apiErrors, slugify } from '@/cms/editor/helpers';
import { formatDateTime } from '@/lib/format';

const FIELD_TYPES: { value: FormFieldType; label: string }[] = [
  { value: 'text', label: 'Texto corto' }, { value: 'textarea', label: 'Texto largo' }, { value: 'email', label: 'Correo' },
  { value: 'phone', label: 'Teléfono' }, { value: 'select', label: 'Lista desplegable' }, { value: 'radio', label: 'Opción única' },
  { value: 'checkbox', label: 'Casilla' }, { value: 'date', label: 'Fecha' }, { value: 'number', label: 'Número' },
];

const EMPTY: Partial<FormDefinitionAdmin> = {
  title: '', slug: '', description: '', fields: [{ key: 'nombre', label: 'Nombre', type: 'text', required: true }, { key: 'correo', label: 'Correo', type: 'email', required: true }],
  consent_text: 'He leído el Aviso de Privacidad y acepto el tratamiento de mis datos.', notify_to: '', success_message: 'Gracias. Le responderemos en menos de 2 días hábiles.', submit_label: 'Enviar', is_published: true,
};

const FORM_BULK: BulkActionDef[] = [
  { name: 'delete', label: 'Eliminar sin envíos', planVerb: 'Se eliminarán', danger: true, icon: Trash2 },
];
const SUBMISSION_BULK: BulkActionDef[] = [
  { name: 'mark_handled', label: 'Marcar atendidos', planVerb: 'Se marcarán como atendidos', icon: Check },
  { name: 'reopen', label: 'Reabrir', planVerb: 'Se reabrirán', icon: RotateCcw },
  { name: 'delete', label: 'Eliminar', planVerb: 'Se eliminarán', danger: true, icon: Trash2 },
];
const PUBLISHED_OPTIONS = [{ value: '1', label: 'Publicados' }, { value: '0', label: 'Borradores' }];
// No param = pendientes (the inbox opens on what still needs an answer).
const HANDLED_OPTIONS = [{ value: '1', label: 'Atendidos' }, { value: 'todos', label: 'Todos' }];

/** /admin/formularios — forms builder + submissions inbox (BACKLOG P3-6) on the Data Ops
 *  list contract (Phase 8). The inbox is a paginated, searchable DataTable in a modal whose
 *  state (`envios=<form id>` plus `e*` filters) also lives in the URL. */
export default function AdminForms() {
  const qc = useQueryClient();
  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const sort = parseSort(get('orden'));
  const filters = {
    q: get('q') || undefined,
    published: get('publicado') || undefined,
    ordering: serializeSort(sort) || undefined,
  };
  const { data, isLoading, isError, refetch } = useFormsList({ page, ...filters });
  const exportForms = useFormsExport();
  const bulk = useFormsBulk();
  const rows = data?.results;
  const count = data?.count ?? 0;
  const selection = useRowSelection(count, JSON.stringify(filters));

  const [editing, setEditing] = useState<Partial<FormDefinitionAdmin> | null>(null);
  const [toDelete, setToDelete] = useState<FormDefinitionAdmin | null>(null);
  const [bulkAction, setBulkAction] = useState<BulkActionDef | null>(null);
  const inboxId = Number.parseInt(get('envios'), 10);
  const inbox = Number.isFinite(inboxId) ? (rows ?? []).find((f) => f.id === inboxId) ?? null : null;
  const openInbox = (f: FormDefinitionAdmin) => set({ envios: String(f.id) });
  const closeInbox = () => set({ envios: null, eq: null, eatendido: null, edesde: null, ehasta: null, eorden: null, epage: null });

  const invalidate = () => { void invalidateEntity(qc, FORMS_ENTITY); void qc.invalidateQueries({ queryKey: ['badges'] }); };
  const remove = useMutation({
    mutationFn: (id: number) => contentApi.adminDeleteForm(id),
    onSuccess: () => { toast.success('Formulario eliminado.'); setToDelete(null); invalidate(); },
    onError: () => toast.error('No se pudo eliminar.'),
  });
  const fetchExport = (fmt: ExportFormat, { selectedOnly }: { selectedOnly: boolean }) =>
    exportForms.mutateAsync({ ...filters, fmt, ids: selectedOnly && !selection.allMatching ? idsParam(selection.ids) : undefined });

  const columns: Column<FormDefinitionAdmin>[] = [
    {
      id: 'title', header: 'Formulario', sortKey: 'title', hideable: false, minWidth: 200,
      cell: (f) => (
        <div className="min-w-0">
          <p className="font-semibold text-ink">{f.title}</p>
          <p className="truncate text-xs text-subtle">bloque: <code>{f.slug}</code> · {f.fields.length} campos</p>
        </div>
      ),
    },
    { id: 'notify', header: 'Buzón', minWidth: 160, className: 'text-xs text-muted break-all', cell: (f) => f.notify_to || 'info@ (contacto general)' },
    { id: 'submissions', header: 'Envíos', sortKey: 'submissions', align: 'right', minWidth: 80, className: 'tabular-nums', cell: (f) => f.submissions_count },
    {
      id: 'pending', header: 'Pendientes', sortKey: 'pending', align: 'right', minWidth: 100,
      cell: (f) => (f.pending_count ? <Badge variant="warning">{f.pending_count}</Badge> : <span className="text-subtle">0</span>),
    },
    { id: 'published', header: 'Estado', sortKey: 'published', minWidth: 100, cell: (f) => (f.is_published ? <Badge variant="success">Publicado</Badge> : <Badge variant="neutral">Borrador</Badge>) },
    { id: 'updated', header: 'Actualizado', sortKey: 'updated', minWidth: 150, defaultHidden: true, className: 'whitespace-nowrap text-xs text-muted', cell: (f) => formatDateTime(f.updated_at) },
  ];

  return (
    <>
      <PageHeader title="Formularios" subtitle="Cree formularios para el sitio, elija el buzón que recibe cada envío y atienda las respuestas."
        actions={(
          <div className="flex flex-wrap gap-2">
            <ExportMenu filenamePrefix="formularios" selectedCount={selection.count} fetch={fetchExport} />
            <Button onClick={() => setEditing(EMPTY)}><Plus size={16} aria-hidden="true" /> Nuevo formulario</Button>
          </div>
        )} />
      <Card title={`${count.toLocaleString('es-MX')} formularios`}>
        <DataTable<FormDefinitionAdmin>
          tableId="forms"
          columns={columns}
          rows={rows}
          rowKey={(f) => f.id}
          rowLabel={(f) => `formulario ${f.title}`}
          caption="Formularios"
          sort={sort}
          onSort={(next: SortState) => set({ orden: serializeSort(next), page: null })}
          page={page}
          count={count}
          onPage={setPage}
          itemLabel="formularios"
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          columnControls
          resizable
          selection={selection}
          rowActions={(f) => (
            <>
              <Button size="sm" variant={f.pending_count ? 'primary' : 'secondary'} onClick={() => openInbox(f)}><Inbox size={14} aria-hidden="true" /> Envíos{f.pending_count ? ` (${f.pending_count})` : ''}</Button>
              <Button size="sm" variant="secondary" onClick={() => setEditing(f)} aria-label={`Editar ${f.title}`}><Pencil size={14} aria-hidden="true" /></Button>
              <Button size="sm" variant="ghost" onClick={() => setToDelete(f)} aria-label={`Eliminar ${f.title}`}><Trash2 size={14} aria-hidden="true" /></Button>
            </>
          )}
          toolbar={(
            <FilterBar
              search={{ placeholder: 'Título o clave…', label: 'Buscar formularios' }}
              tabs={{ paramKey: 'publicado', options: PUBLISHED_OPTIONS, allLabel: 'Todos', label: 'Filtrar por publicación' }}
            />
          )}
          bulkBar={(
            <BulkActionBar
              count={selection.count}
              allMatching={selection.allMatching}
              allMatchingCount={count}
              onSelectAllMatching={selection.onSelectAllMatching}
              onClear={selection.onClear}
              actions={FORM_BULK}
              onAction={setBulkAction}
              itemLabel="formularios"
              gender="m"
              exportMenu={<ExportMenu label="Exportar seleccionados" filenamePrefix="formularios" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
            />
          )}
          empty={{ icon: ClipboardList, title: 'Sin formularios', description: 'Cree el primero y colóquelo en una página con el bloque Formulario.' }}
        />
      </Card>
      {editing && <FormBuilderModal initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); invalidate(); }} />}
      {inbox && <SubmissionsModal form={inbox} onClose={closeInbox} />}
      <ConfirmDialog open={!!toDelete} title="¿Eliminar formulario?" message={`Se borrarán también sus ${toDelete?.submissions_count ?? 0} envíos. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar formulario" requireText={toDelete?.submissions_count ? 'ELIMINAR' : undefined} loading={remove.isPending} onConfirm={() => toDelete && remove.mutate(toDelete.id)} onClose={() => setToDelete(null)} />
      <BulkConfirmDialog
        open={!!bulkAction}
        onClose={() => setBulkAction(null)}
        action={bulkAction}
        entityLabel="formularios"
        gender="m"
        ids={selection.ids}
        allMatching={selection.allMatching}
        filters={filters}
        execute={(body) => bulk.mutateAsync(body)}
        onDone={() => selection.onClear()}
      />
    </>
  );
}

function FormBuilderModal({ initial, onClose, onSaved }: { initial: Partial<FormDefinitionAdmin>; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Partial<FormDefinitionAdmin>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fields = form.fields ?? [];
  const setF = (patch: Partial<FormDefinitionAdmin>) => setForm((p) => ({ ...p, ...patch }));
  const setField = (i: number, patch: Partial<FormField>) => setF({ fields: fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const move = (i: number, d: -1 | 1) => { const n = fields.slice(); const [x] = n.splice(i, 1); n.splice(i + d, 0, x); setF({ fields: n }); };
  const save = useMutation({
    mutationFn: () => (form.id ? contentApi.adminUpdateForm(form.id, form) : contentApi.adminCreateForm({ ...form, slug: form.slug || slugify(form.title ?? '') })),
    onSuccess: () => { toast.success('Formulario guardado.'); onSaved(); },
    onError: (e) => { const f = apiErrors(e); setErrors(f); toast.error(f.fields || f.slug || f.detail || 'Revise los campos.'); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setErrors({}); save.mutate(); };
  return (
    <Modal open onClose={onClose} title={form.id ? 'Editar formulario' : 'Nuevo formulario'} maxWidth={760}>
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Título" value={form.title ?? ''} onChange={(e) => setF({ title: e.target.value })} required error={errors.title} />
          <Input label="Clave (para el bloque Formulario)" value={form.slug || slugify(form.title ?? '')} onChange={(e) => setF({ slug: slugify(e.target.value) })} error={errors.slug} />
          <Input label="Buzón que recibe los envíos" type="email" value={form.notify_to ?? ''} onChange={(e) => setF({ notify_to: e.target.value })} placeholder="info@interlaken.com.mx" hint="Vacío = info@ (contacto general)." error={errors.notify_to} />
          <Input label="Texto del botón" value={form.submit_label ?? ''} onChange={(e) => setF({ submit_label: e.target.value })} />
          <Input label="Descripción (opcional)" value={form.description ?? ''} onChange={(e) => setF({ description: e.target.value })} />
          <Input label="Mensaje de éxito" value={form.success_message ?? ''} onChange={(e) => setF({ success_message: e.target.value })} />
          <Input label="Texto de consentimiento" value={form.consent_text ?? ''} onChange={(e) => setF({ consent_text: e.target.value })} hint="Vacío = sin casilla de aviso de privacidad." />
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={form.is_published ?? true} onChange={(e) => setF({ is_published: e.target.checked })} /> Publicado (acepta envíos)</label>
        </div>

        <fieldset className="space-y-2">
          <legend className="label">Campos</legend>
          {errors.fields && <p className="text-sm text-coral-600" role="alert">{errors.fields}</p>}
          {fields.map((f, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-line bg-cream-2 p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_140px_auto]">
                <Input label="Etiqueta" value={f.label} onChange={(e) => setField(i, { label: e.target.value, key: f.key || slugify(e.target.value).replace(/-/g, '_') })} />
                <Input label="Clave" value={f.key} onChange={(e) => setField(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} hint="minúsculas, sin espacios" />
                <div>
                  <label className="label" htmlFor={`ft-${i}`}>Tipo</label>
                  <select id={`ft-${i}`} className="input-field" value={f.type} onChange={(e) => setField(i, { type: e.target.value as FormFieldType })}>
                    {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="flex items-end gap-1 pb-1">
                  <button type="button" aria-label="Subir" disabled={i === 0} className="rounded p-1 text-subtle hover:text-ink disabled:opacity-30" onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
                  <button type="button" aria-label="Bajar" disabled={i === fields.length - 1} className="rounded p-1 text-subtle hover:text-ink disabled:opacity-30" onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
                  <button type="button" aria-label="Quitar campo" className="rounded p-1 text-subtle hover:text-coral-600" onClick={() => setF({ fields: fields.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {(f.type === 'select' || f.type === 'radio') && <Input label="Opciones (separadas por coma)" value={(f.options ?? []).join(', ')} onChange={(e) => setField(i, { options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) })} />}
                <Input label="Ayuda (opcional)" value={f.help ?? ''} onChange={(e) => setField(i, { help: e.target.value })} />
                <div className="flex flex-wrap items-end gap-3 pb-2">
                  <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={!!f.required} onChange={(e) => setField(i, { required: e.target.checked })} /> Obligatorio</label>
                  <label className="flex items-center gap-1.5 text-sm">
                    Mostrar si
                    <select className="input-field !py-1 text-xs" value={f.show_if?.field ?? ''} onChange={(e) => setField(i, { show_if: e.target.value ? { field: e.target.value, equals: f.show_if?.equals ?? '' } : null })} aria-label="Campo condición">
                      <option value="">siempre</option>
                      {fields.slice(0, i).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                    </select>
                    {f.show_if && <input className="input-field !py-1 w-28 text-xs" placeholder="= valor" aria-label="Valor condición" value={String(f.show_if.equals)} onChange={(e) => setField(i, { show_if: { field: f.show_if!.field, equals: e.target.value } })} />}
                  </label>
                </div>
              </div>
            </div>
          ))}
          <Button type="button" size="sm" variant="secondary" onClick={() => setF({ fields: [...fields, { key: '', label: '', type: 'text' }] })}><Plus size={14} aria-hidden="true" /> Agregar campo</Button>
        </fieldset>

        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={save.isPending}>Guardar</Button></div>
      </form>
    </Modal>
  );
}

function answer(s: FormSubmission, key: string): string {
  const v = s.data[key];
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  return v ? String(v) : '—';
}

function SubmissionsModal({ form, onClose }: { form: FormDefinitionAdmin; onClose: () => void }) {
  const qc = useQueryClient();
  const { get, set } = useUrlFilters();
  const sort = parseSort(get('eorden'));
  const rawPage = Number.parseInt(get('epage'), 10);
  const page = Number.isFinite(rawPage) && rawPage > 1 ? rawPage : 1;
  // Pending first: the inbox opens on what still needs an answer.
  const handled = get('eatendido', '0');
  const filters = {
    q: get('eq') || undefined,
    handled: handled === 'todos' ? undefined : handled,
    from: get('edesde') || undefined,
    to: get('ehasta') || undefined,
    ordering: serializeSort(sort) || undefined,
  };
  const { data, isLoading, isError, refetch } = useSubmissionsList(form.id, { page, ...filters });
  const exportSubs = useSubmissionsExport(form.id);
  const bulk = useSubmissionsBulk();
  const rows = data?.results;
  const count = data?.count ?? 0;
  const selection = useRowSelection(count, JSON.stringify(filters));
  const [bulkAction, setBulkAction] = useState<BulkActionDef | null>(null);

  const refresh = () => { void invalidateEntity(qc, SUBMISSIONS_ENTITY, [FORMS_ENTITY]); void qc.invalidateQueries({ queryKey: ['badges'] }); };
  const handle = useMutation({
    mutationFn: ({ id, v }: { id: number; v: boolean }) => contentApi.adminHandleSubmission(id, v),
    onSuccess: refresh,
    onError: () => toast.error('No se pudo actualizar el envío.'),
  });
  const fetchExport = (fmt: ExportFormat, { selectedOnly }: { selectedOnly: boolean }) =>
    exportSubs.mutateAsync({ ...filters, fmt, ids: selectedOnly && !selection.allMatching ? idsParam(selection.ids) : undefined });

  const columns = useMemo<Column<FormSubmission>[]>(() => [
    { id: 'date', header: 'Fecha', sortKey: 'date', hideable: false, minWidth: 150, className: 'whitespace-nowrap text-xs text-muted', cell: (s) => formatDateTime(s.created_at) },
    ...form.fields.map((f, i): Column<FormSubmission> => ({
      id: `f:${f.key}`, header: f.label, minWidth: 140, defaultHidden: i >= 4, className: 'text-sm text-ink break-words', cell: (s) => answer(s, f.key),
    })),
    { id: 'page', header: 'Página', sortKey: 'page', minWidth: 110, defaultHidden: true, className: 'text-xs text-subtle', cell: (s) => s.page || '—' },
    { id: 'handled', header: 'Estado', sortKey: 'handled', minWidth: 110, cell: (s) => (s.is_handled ? <Badge variant="success">Atendido</Badge> : <Badge variant="warning">Pendiente</Badge>) },
  ], [form.fields]);

  return (
    <Modal open onClose={onClose} title={`Envíos: ${form.title}`} maxWidth={960}>
      <div className="mb-3 flex justify-end">
        <ExportMenu formats={['csv', 'xlsx']} filenamePrefix={`envios-${form.slug || form.id}`} selectedCount={selection.count} fetch={fetchExport} />
      </div>
      <DataTable<FormSubmission>
        tableId={`form-submissions-${form.id}`}
        columns={columns}
        rows={rows}
        rowKey={(s) => s.id}
        rowLabel={(s) => `envío del ${formatDateTime(s.created_at)}`}
        caption={`Envíos del formulario ${form.title}`}
        sort={sort}
        onSort={(next: SortState) => set({ eorden: serializeSort(next), epage: null })}
        page={page}
        count={count}
        onPage={(p) => set({ epage: p > 1 ? String(p) : null })}
        itemLabel="envíos"
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        columnControls
        selection={selection}
        rowActions={(s) => (
          <>
            {s.reply_to && <a href={`mailto:${s.reply_to}`} className="inline-flex min-h-[36px] items-center px-2 text-xs font-semibold text-purple">Responder</a>}
            <Button size="sm" variant={s.is_handled ? 'ghost' : 'secondary'} onClick={() => handle.mutate({ id: s.id, v: !s.is_handled })}>
              <Check size={14} aria-hidden="true" /> {s.is_handled ? 'Reabrir' : 'Marcar atendido'}
            </Button>
          </>
        )}
        toolbar={(
          <FilterBar
            search={{ paramKey: 'eq', placeholder: 'Buscar en las respuestas…', label: 'Buscar envíos' }}
            tabs={{ paramKey: 'eatendido', options: HANDLED_OPTIONS, allLabel: 'Pendientes', label: 'Filtrar por estado' }}
            dateRange={{ idPrefix: 'envios', fromKey: 'edesde', toKey: 'ehasta' }}
          />
        )}
        bulkBar={(
          <BulkActionBar
            count={selection.count}
            allMatching={selection.allMatching}
            allMatchingCount={count}
            onSelectAllMatching={selection.onSelectAllMatching}
            onClear={selection.onClear}
            actions={SUBMISSION_BULK}
            onAction={setBulkAction}
            itemLabel="envíos"
            gender="m"
          />
        )}
        empty={{ icon: Inbox, title: 'Sin envíos', description: 'Ningún envío coincide con los filtros.' }}
      />
      <BulkConfirmDialog
        open={!!bulkAction}
        onClose={() => setBulkAction(null)}
        action={bulkAction}
        entityLabel="envíos"
        gender="m"
        ids={selection.ids}
        allMatching={selection.allMatching}
        filters={{ ...filters, form: form.id }}
        execute={(body) => bulk.mutateAsync(body)}
        onDone={() => { selection.onClear(); void qc.invalidateQueries({ queryKey: ['badges'] }); }}
      />
    </Modal>
  );
}
