import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Plus, Clock, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { legalApi, type ArcoRequest } from '@/services/api';
import { toPaged } from '@/lib/pagination';
import { apiErrors } from '@/cms/editor/helpers';
import { useUrlFilters } from '@/hooks/useUrlFilters';

const TYPE: Record<string, string> = { access: 'Acceso', rectification: 'Rectificación', cancellation: 'Cancelación', opposition: 'Oposición' };
const STATUS: Record<string, { label: string; tone: 'info' | 'warning' | 'success' | 'error' }> = {
  received: { label: 'Recibida', tone: 'info' }, in_review: { label: 'En revisión', tone: 'warning' }, resolved: { label: 'Resuelta', tone: 'success' }, rejected: { label: 'Rechazada', tone: 'error' },
};
const CHANNEL: Record<string, string> = { portal: 'Portal', email: 'Correo', whatsapp: 'WhatsApp', in_person: 'Presencial' };

/** Days-left label for the statutory deadline (20 business days). */
export function deadlineLabel(r: Pick<ArcoRequest, 'status' | 'days_left' | 'is_overdue'>): string {
  if (r.status === 'resolved' || r.status === 'rejected') return 'Cerrada';
  if (r.is_overdue) return `Vencida hace ${Math.abs(r.days_left)} d`;
  if (r.days_left === 0) return 'Vence hoy';
  return `${r.days_left} d restantes`;
}

/** /admin/arco — ARCO workflow status view + privacidad@ intake (BACKLOG P5-5). */
export default function AdminArco() {
  const qc = useQueryClient();
  const { get, set } = useUrlFilters();
  const status = get('status') || 'open';
  const { data, isLoading } = useQuery({ queryKey: ['admin-arco', status], queryFn: async () => toPaged<ArcoRequest>((await legalApi.adminListArco(status === 'open' || status === 'all' ? undefined : status)).data) });
  const rows = (data?.results ?? []).filter((r) => status !== 'open' || r.status === 'received' || r.status === 'in_review');
  const [intake, setIntake] = useState(false);
  const [resolving, setResolving] = useState<{ r: ArcoRequest; status: 'resolved' | 'rejected' | 'in_review' } | null>(null);
  const [note, setNote] = useState('');
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['admin-arco'] }); qc.invalidateQueries({ queryKey: ['badges'] }); };
  const setStatus = useMutation({
    mutationFn: () => legalApi.adminSetArcoStatus(resolving!.r.id, resolving!.status, note),
    onSuccess: () => { toast.success('Solicitud actualizada; se notificó al solicitante.'); setResolving(null); setNote(''); invalidate(); },
    onError: () => toast.error('No se pudo actualizar.'),
  });
  const overdue = rows.filter((r) => r.is_overdue).length;

  return (
    <>
      <PageHeader title="Solicitudes ARCO" subtitle="Acceso, rectificación, cancelación y oposición. Plazo legal: 20 días hábiles desde la recepción. Las que llegan a privacidad@ o por WhatsApp se registran aquí."
        actions={<Button onClick={() => setIntake(true)}><Plus size={16} aria-hidden="true" /> Registrar solicitud recibida</Button>} />
      {overdue > 0 && <p className="mb-4 flex items-center gap-2 rounded-xl border border-coral-200 bg-coral-50 px-4 py-2 text-sm text-coral-700" role="alert"><AlertTriangle size={16} aria-hidden="true" /> {overdue} {overdue === 1 ? 'solicitud vencida' : 'solicitudes vencidas'}: responda hoy y documente la causa del retraso.</p>}
      <Card>
        <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Filtrar por estado">
          {[['open', 'Abiertas'], ['all', 'Todas'], ['resolved', 'Resueltas'], ['rejected', 'Rechazadas']].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={status === k} onClick={() => set({ status: k === 'open' ? null : k })} className={`rounded-full px-3 py-1 text-sm ${status === k ? 'bg-purple text-white' : 'bg-cream-2 text-muted hover:text-ink'}`}>{label}</button>
          ))}
        </div>
        {isLoading ? <ListSkeleton /> : rows.length === 0 ? <EmptyState icon={ShieldCheck} title="Sin solicitudes" description="Cuando una familia ejerza sus derechos ARCO aparecerá aquí con su fecha límite." /> : (
          <ul className="divide-y divide-line" aria-label="Solicitudes ARCO">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{TYPE[r.request_type] ?? r.request_type} · {r.requester_name || r.requester_email}</p>
                  <p className="truncate text-xs text-subtle">{r.requester_email} · {CHANNEL[r.channel] ?? r.channel} · recibida {new Date(r.created_at).toLocaleDateString('es-MX')}{r.details ? ` · ${r.details}` : ''}</p>
                  {r.resolution_note && <p className="text-xs text-muted">Resolución: {r.resolution_note}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={STATUS[r.status]?.tone ?? 'neutral'}>{STATUS[r.status]?.label ?? r.status}</Badge>
                  <span className={`inline-flex items-center gap-1 text-xs ${r.is_overdue ? 'font-semibold text-coral-600' : 'text-subtle'}`}><Clock size={12} aria-hidden="true" /> {deadlineLabel(r)}</span>
                  {(r.status === 'received' || r.status === 'in_review') && (
                    <>
                      {r.status === 'received' && <Button size="sm" variant="ghost" onClick={() => { setResolving({ r, status: 'in_review' }); setNote(''); }}>En revisión</Button>}
                      <Button size="sm" variant="secondary" onClick={() => { setResolving({ r, status: 'resolved' }); setNote(''); }}>Resolver</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setResolving({ r, status: 'rejected' }); setNote(''); }}>Rechazar</Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <IntakeModal open={intake} onClose={() => setIntake(false)} onSaved={() => { setIntake(false); invalidate(); }} />
      <Modal open={!!resolving} onClose={() => setResolving(null)} title={resolving?.status === 'resolved' ? 'Resolver solicitud' : resolving?.status === 'rejected' ? 'Rechazar solicitud' : 'Marcar en revisión'} maxWidth={480}>
        <div className="space-y-3">
          <p className="text-sm text-muted">{resolving?.status === 'in_review' ? 'Sin correo al solicitante.' : 'El solicitante recibirá un correo con esta nota.'}</p>
          {resolving?.status !== 'in_review' && <div><label className="label" htmlFor="arco-note">{resolving?.status === 'rejected' ? 'Motivo (obligatorio)' : 'Qué se hizo'}</label><textarea id="arco-note" className="input-field" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></div>}
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setResolving(null)}>Cancelar</Button><Button onClick={() => setStatus.mutate()} loading={setStatus.isPending} disabled={resolving?.status === 'rejected' && !note.trim()}>Confirmar</Button></div>
        </div>
      </Modal>
    </>
  );
}

function IntakeModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ requester_email: '', requester_name: '', request_type: 'access', channel: 'email', details: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: () => legalApi.adminIntakeArco(form),
    onSuccess: () => { toast.success('Solicitud registrada; se envió acuse con la fecha límite.'); setForm({ requester_email: '', requester_name: '', request_type: 'access', channel: 'email', details: '' }); onSaved(); },
    onError: (e) => setErrors(apiErrors(e)),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setErrors({}); create.mutate(); };
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Modal open={open} onClose={onClose} title="Registrar solicitud recibida" maxWidth={520}>
      <form onSubmit={submit} className="space-y-3">
        <Input label="Correo del solicitante" type="email" required value={form.requester_email} onChange={(e) => set('requester_email', e.target.value)} error={errors.requester_email} />
        <Input label="Nombre (opcional)" value={form.requester_name} onChange={(e) => set('requester_name', e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="arco-type">Derecho</label><select id="arco-type" className="input-field" value={form.request_type} onChange={(e) => set('request_type', e.target.value)}>{Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div><label className="label" htmlFor="arco-channel">Llegó por</label><select id="arco-channel" className="input-field" value={form.channel} onChange={(e) => set('channel', e.target.value)}>{Object.entries(CHANNEL).filter(([k]) => k !== 'portal').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        </div>
        <div><label className="label" htmlFor="arco-details">Detalle de la solicitud</label><textarea id="arco-details" className="input-field" rows={3} value={form.details} onChange={(e) => set('details', e.target.value)} /></div>
        {errors.detail && <p className="text-sm text-coral-600">{errors.detail}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={create.isPending}>Registrar y enviar acuse</Button></div>
      </form>
    </Modal>
  );
}
