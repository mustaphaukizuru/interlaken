import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Wallet } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { TableSkeleton } from '@/components/ui/TableSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/layout/PageHeader';
import { financeApi } from '@/services/api';

interface Fee {
  id: number; name: string; level: string; grade: string; monthly_amount: string;
  currency: string; due_day: number; late_fee_type: string; late_fee_amount: string;
  late_fee_grace_days: number; active: boolean;
}
const EMPTY = {
  name: '', level: '', grade: '', monthly_amount: '', currency: 'MXN', due_day: 5,
  late_fee_type: 'none', late_fee_amount: '0', late_fee_grace_days: 0, active: true,
};
const LATE_LABEL: Record<string, string> = { none: 'Sin recargo', fixed: 'Monto fijo', percent: 'Porcentaje' };

export default function AdminFees() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Fee | null>(null);
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);
  const [toDelete, setToDelete] = useState<Fee | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-fees'],
    queryFn: async () => (await financeApi.adminListFees()).data.results as Fee[],
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-fees'] });
  const set = (k: keyof typeof EMPTY, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => editing ? financeApi.adminUpdateFee(editing.id, form) : financeApi.adminCreateFee(form),
    onSuccess: () => { invalidate(); toast.success(editing ? 'Plan actualizado.' : 'Plan creado.'); setOpen(false); },
    onError: () => toast.error('No se pudo guardar el plan.'),
  });
  const toggle = useMutation({
    mutationFn: (f: Fee) => financeApi.adminUpdateFee(f.id, { active: !f.active }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number) => financeApi.adminDeleteFee(id),
    onSuccess: () => { invalidate(); toast.success('Plan eliminado.'); setToDelete(null); },
    onError: () => toast.error('No se pudo eliminar.'),
  });

  const openNew = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (f: Fee) => {
    setEditing(f);
    setForm({ name: f.name, level: f.level, grade: f.grade, monthly_amount: f.monthly_amount,
      currency: f.currency, due_day: f.due_day, late_fee_type: f.late_fee_type,
      late_fee_amount: f.late_fee_amount, late_fee_grace_days: f.late_fee_grace_days, active: f.active });
    setOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Planes de Colegiatura"
        subtitle="Define las mensualidades, día de pago y recargos por nivel o grado."
        actions={<Button onClick={openNew}><Plus className="h-4 w-4" /> Nuevo plan</Button>}
      />

      <Card>
        {isLoading ? <TableSkeleton /> : isError ? <ErrorState onRetry={() => refetch()} />
          : !data?.length ? (
            <EmptyState icon={Wallet} title="Sin planes" description="Crea un plan de colegiatura para poder generar facturas." />
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Plan</th><th>Aplica a</th><th>Mensualidad</th><th>Vence</th><th>Recargo</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                  {data.map((f) => (
                    <tr key={f.id}>
                      <td className="font-medium text-ink">{f.name}</td>
                      <td className="text-muted">{[f.level, f.grade].filter(Boolean).join(' · ') || 'Todos'}</td>
                      <td className="font-semibold text-ink">${parseFloat(f.monthly_amount).toFixed(2)} {f.currency}</td>
                      <td className="text-muted">Día {f.due_day}</td>
                      <td className="text-muted">{LATE_LABEL[f.late_fee_type] ?? f.late_fee_type}{f.late_fee_type !== 'none' ? ` (${f.late_fee_amount})` : ''}</td>
                      <td><Badge variant={f.active ? 'success' : 'neutral'}>{f.active ? 'Activo' : 'Inactivo'}</Badge></td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" onClick={() => toggle.mutate(f)} className="rounded-lg border border-line px-2 py-1 text-xs font-semibold text-muted hover:bg-cream whitespace-nowrap">
                            {f.active ? 'Desactivar' : 'Activar'}
                          </button>
                          <button type="button" onClick={() => openEdit(f)} aria-label="Editar" className="rounded-lg p-1.5 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center text-subtle hover:bg-cream hover:text-ink"><Pencil className="h-4 w-4" /></button>
                          <button type="button" onClick={() => setToDelete(f)} aria-label="Eliminar" className="rounded-lg p-1.5 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center text-subtle hover:bg-coral-50 hover:text-coral-dark"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar plan' : 'Nuevo plan'} maxWidth={560}>
        <div className="space-y-4">
          <Input label="Nombre del plan" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ej. Primaria 2026-2027" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Nivel (opcional)" value={form.level} onChange={(e) => set('level', e.target.value)} placeholder="primaria" />
            <Input label="Grado (opcional)" value={form.grade} onChange={(e) => set('grade', e.target.value)} placeholder="3° Primaria" />
            <Input label="Mensualidad (MXN)" type="number" inputMode="decimal" value={form.monthly_amount} onChange={(e) => set('monthly_amount', e.target.value)} />
            <Input label="Día de vencimiento" type="number" value={form.due_day} onChange={(e) => set('due_day', Number(e.target.value))} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="late-type" className="label">Recargo</label>
              <select id="late-type" className="input-field" value={form.late_fee_type} onChange={(e) => set('late_fee_type', e.target.value)}>
                {Object.entries(LATE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <Input label="Monto/%" type="number" inputMode="decimal" value={form.late_fee_amount} onChange={(e) => set('late_fee_amount', e.target.value)} disabled={form.late_fee_type === 'none'} />
            <Input label="Días de gracia" type="number" value={form.late_fee_grace_days} onChange={(e) => set('late_fee_grace_days', Number(e.target.value))} />
          </div>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)}
              className="h-4 w-4 rounded border-line text-purple focus-visible:ring-2 focus-visible:ring-purple/40" /> Activo
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!form.name.trim() || !form.monthly_amount}>
              {editing ? 'Guardar' : 'Crear'}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        title="Eliminar plan"
        message={`Se eliminará el plan "${toDelete?.name}". Las facturas ya emitidas no se modifican.`}
        confirmLabel="Eliminar"
        loading={remove.isPending}
      />
    </>
  );
}
