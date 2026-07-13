import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, GraduationCap } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { financeApi } from '@/services/api';

interface Discount {
  id: number; student: number; name: string; kind: string; method: string;
  value: string; active: boolean; start_period: string; end_period: string; note: string;
}
const KIND: Record<string, { label: string; variant: any }> = {
  scholarship: { label: 'Beca', variant: 'success' },
  sibling:     { label: 'Hermanos', variant: 'info' },
  family:      { label: 'Familiar', variant: 'info' },
  other:       { label: 'Otro', variant: 'neutral' },
};
const emptyForm = (studentId: number) => ({
  student: studentId, name: '', kind: 'scholarship', method: 'percent',
  value: '', start_period: '', end_period: '', note: '', active: true,
});

export function StudentDiscounts({ studentId }: { studentId: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Discount | null>(null);
  const [form, setForm] = useState(emptyForm(studentId));
  const [toDelete, setToDelete] = useState<Discount | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-discounts', studentId],
    queryFn: async () => (await financeApi.adminListDiscounts(studentId)).data.results as Discount[],
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-discounts', studentId] });
  const set = (k: keyof ReturnType<typeof emptyForm>, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => editing ? financeApi.adminUpdateDiscount(editing.id, form) : financeApi.adminCreateDiscount(form),
    onSuccess: () => { invalidate(); toast.success(editing ? 'Beca actualizada.' : 'Beca agregada.'); setOpen(false); },
    onError: () => toast.error('No se pudo guardar la beca.'),
  });
  const remove = useMutation({
    mutationFn: (id: number) => financeApi.adminDeleteDiscount(id),
    onSuccess: () => { invalidate(); toast.success('Beca eliminada.'); setToDelete(null); },
  });

  const openNew = () => { setEditing(null); setForm(emptyForm(studentId)); setOpen(true); };
  const openEdit = (d: Discount) => {
    setEditing(d);
    setForm({ student: studentId, name: d.name, kind: d.kind, method: d.method,
      value: d.value, start_period: d.start_period, end_period: d.end_period, note: d.note, active: d.active });
    setOpen(true);
  };
  const fmtValue = (d: Discount) => d.method === 'percent' ? `${parseFloat(d.value)}%` : `$${parseFloat(d.value).toFixed(2)}`;

  return (
    <Card
      title="Becas y descuentos"
      action={<button type="button" onClick={openNew} className="inline-flex items-center gap-1 text-sm font-semibold text-purple hover:underline"><Plus className="h-4 w-4" /> Agregar</button>}
    >
      {isLoading ? (
        <ListSkeleton />
      ) : !data?.length ? (
        <EmptyState icon={GraduationCap} title="Sin becas ni descuentos" description="Agrega una beca o descuento para aplicarlo a las colegiaturas de este alumno." />
      ) : (
        <ul className="divide-y divide-cream">
          {data.map((d) => {
            const meta = KIND[d.kind] ?? KIND.other;
            return (
              <li key={d.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`font-medium ${d.active ? 'text-ink' : 'text-subtle line-through'}`}>{d.name}</span>
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                    {!d.active && <Badge variant="neutral">Inactivo</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-subtle">
                    {fmtValue(d)}
                    {(d.start_period || d.end_period) ? ` · ${d.start_period || '…'} → ${d.end_period || '…'}` : ''}
                    {d.note ? ` · ${d.note}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => openEdit(d)} aria-label="Editar" className="rounded-lg p-1.5 text-subtle hover:bg-cream hover:text-ink"><Pencil className="h-4 w-4" /></button>
                  <button type="button" onClick={() => setToDelete(d)} aria-label="Eliminar" className="rounded-lg p-1.5 text-subtle hover:bg-coral-50 hover:text-coral-dark"><Trash2 className="h-4 w-4" /></button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar beca' : 'Nueva beca / descuento'} maxWidth={520}>
        <div className="space-y-4">
          <Input label="Nombre" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ej. Beca de excelencia" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="d-kind" className="label">Tipo</label>
              <select id="d-kind" className="input-field" value={form.kind} onChange={(e) => set('kind', e.target.value)}>
                {Object.entries(KIND).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="d-method" className="label">Aplicación</label>
              <select id="d-method" className="input-field" value={form.method} onChange={(e) => set('method', e.target.value)}>
                <option value="percent">Porcentaje (%)</option>
                <option value="fixed">Monto fijo (MXN)</option>
              </select>
            </div>
            <Input label="Valor" type="number" inputMode="decimal" value={form.value} onChange={(e) => set('value', e.target.value)} />
            <div />
            <Input label="Desde (YYYY-MM, opcional)" value={form.start_period} onChange={(e) => set('start_period', e.target.value)} placeholder="2026-08" />
            <Input label="Hasta (YYYY-MM, opcional)" value={form.end_period} onChange={(e) => set('end_period', e.target.value)} placeholder="2027-06" />
          </div>
          <Input label="Nota (opcional)" value={form.note} onChange={(e) => set('note', e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)}
              className="h-4 w-4 rounded border-line text-purple focus-visible:ring-2 focus-visible:ring-purple/40" /> Activa
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!form.name.trim() || !form.value}>
              {editing ? 'Guardar' : 'Agregar'}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        title="Eliminar beca"
        message={`Se eliminará "${toDelete?.name}". Las colegiaturas ya emitidas no cambian.`}
        confirmLabel="Eliminar"
        loading={remove.isPending}
      />
    </Card>
  );
}
