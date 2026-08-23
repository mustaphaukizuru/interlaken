import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Quote, Plus, Pencil, Trash2 } from 'lucide-react';
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
import { contentApi, type Testimonial, type TestimonialWrite } from '@/services/api';

const EMPTY: TestimonialWrite = { quote: '', author: '', role: '', level: '', is_published: true, order: 0 };

/** /admin/testimonios — quotes shown on Home and Admisiones (BACKLOG P2-15). */
export default function AdminTestimonials() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Testimonial | null | 'new'>(null);
  const [toDelete, setToDelete] = useState<Testimonial | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-testimonials'], queryFn: async () => (await contentApi.adminListTestimonials()).data });
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['admin-testimonials'] }); qc.invalidateQueries({ queryKey: ['testimonials'] }); };
  const remove = useMutation({
    mutationFn: (id: number) => contentApi.adminDeleteTestimonial(id),
    onSuccess: () => { toast.success('Eliminado.'); setToDelete(null); invalidate(); },
    onError: () => toast.error('No se pudo eliminar.'),
  });
  const rows = (data?.results ?? data ?? []) as Testimonial[];
  return (
    <>
      <PageHeader title="Testimonios" subtitle="Frases de familias y egresados que aparecen en Inicio y Admisiones."
        actions={<Button onClick={() => setEditing('new')}><Plus size={16} aria-hidden="true" /> Nuevo testimonio</Button>} />
      <Card>
        {isError ? <ErrorState onRetry={() => refetch()} /> : isLoading ? <ListSkeleton /> : rows.length === 0 ? (
          <EmptyState icon={Quote} title="Sin testimonios" description="Agregue frases reales de familias; aparecerán en el sitio al publicarlas." />
        ) : (
          <ul className="divide-y divide-cream">
            {rows.map((t) => (
              <li key={t.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm text-ink">“{t.quote}”</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-subtle">
                    {t.author}{t.role ? ` · ${t.role}` : ''}
                    {!t.is_published && <Badge variant="warning">Borrador</Badge>}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(t)}><Pencil className="h-4 w-4" aria-hidden="true" /> Editar</Button>
                  <Button size="sm" variant="ghost" onClick={() => setToDelete(t)}><Trash2 className="h-4 w-4" aria-hidden="true" /> Eliminar</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Nuevo testimonio' : 'Editar testimonio'} maxWidth={520}>
        {editing !== null && <TestimonialForm key={editing === 'new' ? 'new' : editing.id} item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={invalidate} />}
      </Modal>
      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        title="Eliminar testimonio" message={`¿Eliminar el testimonio de ${toDelete?.author ?? ''}?`} confirmLabel="Eliminar" loading={remove.isPending} />
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
            <option value="">General</option><option value="preescolar">Preescolar</option><option value="primaria">Primaria</option><option value="secundaria">Secundaria</option>
          </select>
        </div>
        <Input label="Orden" type="number" inputMode="numeric" value={String(form.order)} onChange={(e) => setForm({ ...form, order: Number(e.target.value) || 0 })} />
      </div>
      <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={form.is_published} onChange={(e) => setForm({ ...form, is_published: e.target.checked })} /> Publicado</label>
      {error && <p className="text-xs text-coral-600">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onClose} className="min-h-[44px]">Cancelar</Button>
        <Button type="submit" loading={save.isPending} className="min-h-[44px]">Guardar</Button>
      </div>
    </form>
  );
}
