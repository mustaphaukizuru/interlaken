import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Plus, Pencil, Trash2 } from 'lucide-react';
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
import { contentApi, type SchoolEvent, type SchoolEventWrite } from '@/services/api';
import { fieldErrorsFrom } from '@/components/admin/StudentFormModal';

const KINDS: [SchoolEvent['kind'], string][] = [
  ['holiday', 'Suspensión de clases'], ['vacation', 'Vacaciones'], ['exam', 'Evaluaciones'],
  ['event', 'Evento escolar'], ['meeting', 'Junta de padres'], ['deadline', 'Fecha límite'],
];
const EMPTY: SchoolEventWrite = { title: '', kind: 'event', start_date: '', end_date: '', level: '', description: '', is_published: true };

/** /admin/calendario — school calendar editor (BACKLOG P2-16). */
export default function AdminCalendar() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<SchoolEvent | null | 'new'>(null);
  const [toDelete, setToDelete] = useState<SchoolEvent | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-calendar'],
    queryFn: async () => (await contentApi.adminListCalendar()).data,
  });
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['admin-calendar'] }); qc.invalidateQueries({ queryKey: ['school-calendar'] }); };
  const remove = useMutation({
    mutationFn: (id: number) => contentApi.adminDeleteCalendar(id),
    onSuccess: () => { toast.success('Evento eliminado.'); setToDelete(null); invalidate(); },
    onError: () => toast.error('No se pudo eliminar.'),
  });
  const rows = (data?.results ?? data ?? []) as SchoolEvent[];

  return (
    <>
      <PageHeader title="Calendario escolar" subtitle="Fechas que las familias ven en /calendario. Sin publicar = solo visible aquí."
        actions={<Button onClick={() => setEditing('new')}><Plus size={16} aria-hidden="true" /> Nuevo evento</Button>} />
      <Card>
        {isError ? <ErrorState onRetry={() => refetch()} /> : isLoading ? <ListSkeleton /> : rows.length === 0 ? (
          <EmptyState icon={CalendarDays} title="Sin eventos" description="Agregue vacaciones, evaluaciones, eventos y juntas." />
        ) : (
          <ul className="divide-y divide-cream">
            {rows.map((e) => (
              <li key={e.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                    {e.title}
                    <Badge variant="info">{e.kind_label}</Badge>
                    {e.level && <Badge variant="neutral">{e.level}</Badge>}
                    {!e.is_published && <Badge variant="warning">Borrador</Badge>}
                  </p>
                  <p className="text-xs text-subtle">{e.start_date}{e.end_date ? ` al ${e.end_date}` : ''}{e.description ? ` · ${e.description}` : ''}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(e)}><Pencil className="h-4 w-4" aria-hidden="true" /> Editar</Button>
                  <Button size="sm" variant="ghost" onClick={() => setToDelete(e)}><Trash2 className="h-4 w-4" aria-hidden="true" /> Eliminar</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Nuevo evento' : 'Editar evento'} maxWidth={520}>
        {editing !== null && <EventForm key={editing === 'new' ? 'new' : editing.id} event={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={invalidate} />}
      </Modal>
      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        title="Eliminar evento" message={`¿Eliminar "${toDelete?.title ?? ''}" del calendario?`} confirmLabel="Eliminar" loading={remove.isPending} />
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
            {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ev-level">Nivel</label>
          <select id="ev-level" className="input-field min-h-[44px]" value={form.level} onChange={(e) => set('level', e.target.value)}>
            <option value="">Todos</option><option value="preescolar">Preescolar</option><option value="primaria">Primaria</option><option value="secundaria">Secundaria</option>
          </select>
        </div>
        <Input label="Inicio" type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} error={errors.start_date} required />
        <Input label="Fin (opcional)" type="date" value={form.end_date ?? ''} onChange={(e) => set('end_date', e.target.value)} error={errors.end_date} />
      </div>
      <Input label="Descripción (opcional)" value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={300} />
      <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={form.is_published} onChange={(e) => set('is_published', e.target.checked)} /> Publicado en el sitio</label>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onClose} className="min-h-[44px]">Cancelar</Button>
        <Button type="submit" loading={save.isPending} className="min-h-[44px]">Guardar</Button>
      </div>
    </form>
  );
}
