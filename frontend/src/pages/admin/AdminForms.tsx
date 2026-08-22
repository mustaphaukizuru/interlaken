import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, ClipboardList, Download, Inbox, Pencil, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { contentApi, type FormDefinitionAdmin, type FormField, type FormFieldType, type FormSubmission } from '@/services/api';
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

/** /admin/formularios — forms builder + submissions inbox (BACKLOG P3-6). */
export default function AdminForms() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<FormDefinitionAdmin> | null>(null);
  const [inbox, setInbox] = useState<FormDefinitionAdmin | null>(null);
  const [toDelete, setToDelete] = useState<FormDefinitionAdmin | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-forms'], queryFn: async () => (await contentApi.adminListForms()).data });
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['admin-forms'] }); qc.invalidateQueries({ queryKey: ['badges'] }); };
  const remove = useMutation({
    mutationFn: (id: number) => contentApi.adminDeleteForm(id),
    onSuccess: () => { toast.success('Formulario eliminado.'); setToDelete(null); invalidate(); },
    onError: () => toast.error('No se pudo eliminar.'),
  });
  const rows = data ?? [];
  return (
    <>
      <PageHeader title="Formularios" subtitle="Cree formularios para el sitio, elija el buzón que recibe cada envío y atienda las respuestas."
        actions={<Button onClick={() => setEditing(EMPTY)}><Plus size={16} aria-hidden="true" /> Nuevo formulario</Button>} />
      <Card>
        {isError ? <ErrorState onRetry={() => refetch()} /> : isLoading ? <ListSkeleton /> : rows.length === 0 ? (
          <EmptyState icon={ClipboardList} title="Sin formularios" description="Cree el primero y colóquelo en una página con el bloque Formulario." />
        ) : (
          <ul className="divide-y divide-cream" aria-label="Formularios">
            {rows.map((f) => (
              <li key={f.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{f.title} {!f.is_published && <Badge variant="neutral">Borrador</Badge>}</p>
                  <p className="truncate text-xs text-subtle">bloque: <code>{f.slug}</code> · {f.fields.length} campos · avisa a {f.notify_to || 'info@'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant={f.pending_count ? 'primary' : 'secondary'} onClick={() => setInbox(f)}><Inbox size={14} aria-hidden="true" /> Envíos{f.pending_count ? ` (${f.pending_count})` : ''}</Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(f)} aria-label={`Editar ${f.title}`}><Pencil size={14} aria-hidden="true" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => setToDelete(f)} aria-label={`Eliminar ${f.title}`}><Trash2 size={14} aria-hidden="true" /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <FormBuilderModal initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); invalidate(); }} />}
      {inbox && <SubmissionsModal form={inbox} onClose={() => setInbox(null)} />}
      <ConfirmDialog open={!!toDelete} title="¿Eliminar formulario?" message={`Se borrarán también sus ${toDelete?.submissions_count ?? 0} envíos. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar formulario" requireText={toDelete?.submissions_count ? 'ELIMINAR' : undefined} loading={remove.isPending} onConfirm={() => toDelete && remove.mutate(toDelete.id)} onClose={() => setToDelete(null)} />
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

function SubmissionsModal({ form, onClose }: { form: FormDefinitionAdmin; onClose: () => void }) {
  const qc = useQueryClient();
  const [onlyPending, setOnlyPending] = useState(true);
  const { data, isLoading } = useQuery({ queryKey: ['admin-form-submissions', form.id, onlyPending], queryFn: async () => (await contentApi.adminFormSubmissions(form.id, onlyPending ? { handled: '0' } : undefined)).data });
  const handle = useMutation({
    mutationFn: ({ id, v }: { id: number; v: boolean }) => contentApi.adminHandleSubmission(id, v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-form-submissions', form.id] }); qc.invalidateQueries({ queryKey: ['admin-forms'] }); qc.invalidateQueries({ queryKey: ['badges'] }); },
  });
  const rows: FormSubmission[] = data ?? [];
  return (
    <Modal open onClose={onClose} title={`Envíos: ${form.title}`} maxWidth={720}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} /> Solo pendientes</label>
        <a href={contentApi.adminFormSubmissionsCsvUrl(form.id)} className="btn-outline inline-flex items-center gap-1 text-sm"><Download size={14} aria-hidden="true" /> CSV</a>
      </div>
      {isLoading ? <ListSkeleton /> : rows.length === 0 ? <p className="py-6 text-center text-sm text-muted">Sin envíos{onlyPending ? ' pendientes' : ''}.</p> : (
        <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto" aria-label="Envíos">
          {rows.map((s) => (
            <li key={s.id} className="space-y-1 py-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-subtle">{formatDateTime(s.created_at)}{s.page ? ` · ${s.page}` : ''}</span>
                <div className="flex items-center gap-2">
                  {s.reply_to && <a href={`mailto:${s.reply_to}`} className="text-xs font-semibold text-purple">Responder</a>}
                  <Button size="sm" variant={s.is_handled ? 'ghost' : 'secondary'} onClick={() => handle.mutate({ id: s.id, v: !s.is_handled })}><Check size={14} aria-hidden="true" /> {s.is_handled ? 'Atendido' : 'Marcar atendido'}</Button>
                </div>
              </div>
              <dl className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                {form.fields.filter((f) => f.key in s.data).map((f) => (
                  <div key={f.key} className="flex gap-2"><dt className="shrink-0 text-subtle">{f.label}:</dt><dd className="break-words text-ink">{typeof s.data[f.key] === 'boolean' ? (s.data[f.key] ? 'Sí' : 'No') : String(s.data[f.key] || '-')}</dd></div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
