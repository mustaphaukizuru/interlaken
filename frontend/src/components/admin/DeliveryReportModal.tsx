import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { portalApi, type DeliveryReport } from '@/services/api';

interface Props {
  announcementId: number | null;
  title?: string;
  onClose: () => void;
}

const LABEL: Record<string, string> = { sent: 'Enviados', pending: 'Pendientes', skipped: 'Omitidos', failed: 'Fallidos' };

/** Per-channel delivery report for one comunicado with "resend failed" (BACKLOG P1-C6). */
export function DeliveryReportModal({ announcementId, title, onClose }: Props) {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['announcement-delivery', announcementId],
    queryFn: async () => (await portalApi.getAnnouncementDelivery(announcementId!)).data,
    enabled: !!announcementId,
  });
  const resend = useMutation({
    mutationFn: () => portalApi.resendAnnouncementFailed(announcementId!),
    onSuccess: ({ data: r }) => {
      toast.success(`${r.requeued} correo(s) en cola para reintento.`);
      qc.invalidateQueries({ queryKey: ['announcement-delivery', announcementId] });
    },
    onError: () => toast.error('No se pudo reenviar.'),
  });

  return (
    <Modal open={!!announcementId} onClose={onClose} title={title ? `Entrega: ${title}` : 'Entrega del comunicado'} maxWidth={600}>
      {isError ? <ErrorState onRetry={() => refetch()} /> : isLoading || !data ? <ListSkeleton rows={3} /> : (
        <div className="space-y-4">
          <dl className="grid grid-cols-3 gap-3 text-center">
            <Stat label="Destinatarios" value={data.recipients} />
            <Stat label="Leídos en portal" value={data.read} />
            {data.requires_ack && <Stat label="Enterados" value={data.acknowledged ?? 0} />}
            <Stat label="Por despachar" value={data.pending_dispatch} />
          </dl>
          <Channel name="Correo" counts={data.email} />
          <Channel name="Push" counts={data.push} />
          {data.failed.length > 0 && (
            <div className="rounded-xl border border-coral/30 bg-coral-50/50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-coral-dark">{data.failed.length} correo(s) no entregado(s)</p>
                <Button size="sm" variant="secondary" loading={resend.isPending} onClick={() => resend.mutate()}>
                  <RefreshCw className="h-4 w-4" aria-hidden="true" /> Reintentar fallidos
                </Button>
              </div>
              <ul className="max-h-48 divide-y divide-line/60 overflow-y-auto text-xs">
                {data.failed.map((f) => (
                  <li key={f.id} className="flex justify-between gap-2 py-1.5">
                    <span className="min-w-0 truncate">{f.user} · {f.email}</span>
                    <span className="shrink-0 text-subtle">{f.error || `${f.attempts} intentos`}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Button className="w-full" onClick={onClose}>Cerrar</Button>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-cream-2 p-3">
      <dt className="text-[10.5px] font-bold uppercase tracking-wide text-subtle">{label}</dt>
      <dd className="mt-0.5 font-head text-xl font-extrabold text-ink">{value}</dd>
    </div>
  );
}

function Channel({ name, counts }: { name: string; counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  return (
    <div>
      <p className="mb-1 text-sm font-semibold text-ink">{name}</p>
      <div className="flex h-2 overflow-hidden rounded-full bg-cream-2" aria-hidden="true">
        <span style={{ width: `${(counts.sent / total) * 100}%` }} className="bg-green" />
        <span style={{ width: `${(counts.pending / total) * 100}%` }} className="bg-amber" />
        <span style={{ width: `${(counts.failed / total) * 100}%` }} className="bg-coral" />
      </div>
      <p className="mt-1 text-xs text-subtle">
        {(['sent', 'pending', 'skipped', 'failed'] as const).map((k) => `${LABEL[k]} ${counts[k] ?? 0}`).join(' · ')}
      </p>
    </div>
  );
}

export default DeliveryReportModal;
