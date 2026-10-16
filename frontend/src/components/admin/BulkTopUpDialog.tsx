import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Coins } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { cafeteriaApi, type BulkTopUpPreview, type BulkTopUpResult } from '@/services/api';
import { GRADES } from '@/lib/grades';
import { apiFieldErrors } from '@/lib/apiErrors';
import { formatMXN } from '@/lib/format';

/** Idempotency key of one bulk top-up: a retry or continuation with the same id never credits a student twice. */
function newBatchId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** The server stops after ~25 s of ledger work and reports `remaining`; post the same batch until done. */
const MAX_BULK_ROUNDS = 25;

/** Admin: credit many wallets at once by grado/grupo (BACKLOG P4-3). */
export function BulkTopUpDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [grade, setGrade] = useState('');
  const [group, setGroup] = useState('');
  const [preview, setPreview] = useState<BulkTopUpPreview | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // New id per preview; kept across retries of the same apply (see newBatchId).
  const [batchId, setBatchId] = useState('');
  const body = () => ({ amount: Number(amount), reason, grade: grade || undefined, group: group || undefined });
  const apply = async () => {
    let credited = 0;
    let total = 0;
    for (let round = 0; round < MAX_BULK_ROUNDS; round += 1) {
      const { data } = await cafeteriaApi.bulkTopUp({ ...body(), batch_id: batchId });
      const r = data as BulkTopUpResult;
      credited += r.credited;
      total += Number(r.total);
      if (!r.remaining) break;
    }
    return { credited, total: total.toFixed(2) };
  };
  const run = useMutation({
    mutationFn: async (isPreview: boolean) => (isPreview
      ? (await cafeteriaApi.bulkTopUp({ ...body(), preview: true })).data
      : apply()),
    onSuccess: (data, isPreview) => {
      setErrors({});
      if (isPreview) { setPreview(data as BulkTopUpPreview); setBatchId(newBatchId()); return; }
      const r = data as { credited: number; total: string };
      toast.success(`${r.credited} monederos recargados (${formatMXN(r.total)}).`);
      setOpen(false); setPreview(null); setBatchId(''); setAmount(''); setReason('');
      for (const entity of ['cafeteria-balances', 'cafeteria-low-balance', 'cafeteria-transactions']) {
        qc.invalidateQueries({ queryKey: ['admin', entity] });
      }
    },
    onError: (e) => { const f = apiFieldErrors(e); setErrors(f); toast.error(f.detail || f.amount || f.reason || 'No se pudo aplicar.'); },
  });
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}><Coins size={14} aria-hidden="true" /> Recarga masiva</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Recarga masiva por grupo" maxWidth={520}>
        <div className="space-y-3">
          <p className="text-sm text-muted">Acredita el mismo monto a todos los alumnos activos del grado/grupo elegido (beca, día de campo, devolución general). Cada familia ve su movimiento y recibe aviso.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Monto por alumno (MXN)" type="number" inputMode="decimal" min={1} max={5000} value={amount} onChange={(e) => { setAmount(e.target.value); setPreview(null); }} error={errors.amount} />
            <Input label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Beca de transporte" error={errors.reason} />
            <div>
              <label className="label" htmlFor="bulk-grade">Grado</label>
              <select id="bulk-grade" className="input-field" value={grade} onChange={(e) => { setGrade(e.target.value); setPreview(null); }}>
                <option value="">Todos los grados</option>
                {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <Input label="Grupo" value={group} maxLength={5} onChange={(e) => { setGroup(e.target.value.toUpperCase()); setPreview(null); }} placeholder="A (vacío = todos)" />
          </div>
          {errors.detail && <p className="text-sm text-coral-600" role="alert">{errors.detail}</p>}
          {preview && (
            <div className="rounded-xl border border-line bg-cream-2 p-3 text-sm">
              <p className="font-semibold text-ink">{preview.count} alumnos · total {formatMXN(preview.total)}</p>
              <p className="mt-1 text-xs text-muted">{preview.students.slice(0, 8).map((s) => s.name).join(', ')}{preview.count > 8 ? '…' : ''}</p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            {preview ? (
              <Button variant="danger" onClick={() => run.mutate(false)} loading={run.isPending}>Acreditar a {preview.count} alumnos</Button>
            ) : (
              <Button onClick={() => run.mutate(true)} loading={run.isPending} disabled={!amount || !reason || (!grade && !group)}>Ver a quién aplica</Button>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}

export default BulkTopUpDialog;
