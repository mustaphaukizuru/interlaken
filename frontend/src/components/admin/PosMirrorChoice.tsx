import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { Link2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { formatMXN } from '@/lib/format';
import { apiErrorMessage } from '@/lib/apiErrors';
import { cafeteriaAdminApi } from '@/services/cafeteriaAdmin';
import { invalidateEntity } from '@/hooks/queries/keys';
import { CAF_MONEY_VIEWS, CAF_TOPUPS } from '@/hooks/queries/cafeteria';
import { PAYMENTS_ENTITY } from '@/hooks/queries/payments';
import type { PosMirror } from '@/types';

/**
 * «¿Es esta misma recarga?» (cafeteria.hand_loads, 2026-11-28). The POS mirror
 * recorded an anonymous cash recarga of the same student and amount after this
 * top-up was created: if someone loaded THIS top-up into the POS by hand,
 * applying it would count the money twice. «Es esta misma» links them (the
 * server relabels the ledger row; no money moves); «Es otra recarga» applies it
 * on purpose.
 */
export interface PosMirrorAsk {
  topupId: number;
  studentName: string;
  amount: string;
  /** `paid`: a card top-up from the portal; `office`: front desk or Caja Escolar. */
  kind: 'paid' | 'office';
  mirror: PosMirror;
}

/** The ask carried by a 409 `pos_already_mirrored` answer, or null. */
export function mirrorFromError(err: unknown): PosMirror | null {
  const data = (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
  if (!data || data.code !== 'pos_already_mirrored' || data.pos_transaction == null) return null;
  return {
    pos_transaction: Number(data.pos_transaction),
    pos_date: String(data.pos_date ?? ''),
    pos_amount: String(data.pos_amount ?? ''),
  };
}

const when = (iso: string) => {
  try {
    return format(parseISO(iso), "d 'de' MMM yyyy, HH:mm", { locale: es });
  } catch {
    return iso;
  }
};

export function PosMirrorChoice({ ask, onDone, onCancel }: { ask: PosMirrorAsk; onDone: () => void; onCancel?: () => void }) {
  const queryClient = useQueryClient();
  const refresh = () => invalidateEntity(queryClient, CAF_TOPUPS, [...CAF_MONEY_VIEWS, PAYMENTS_ENTITY]);
  const link = useMutation({
    mutationFn: () => cafeteriaAdminApi.linkTopUpToPos(ask.topupId, ask.mirror.pos_transaction),
    onSuccess: ({ data }) => {
      toast.success(data.detail || 'Listo: la recarga quedó vinculada a la de Loyverse.');
      void refresh();
      onDone();
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo vincular la recarga.')),
  });
  const other = useMutation({
    mutationFn: () => (ask.kind === 'paid'
      ? cafeteriaAdminApi.applyPaidTopUp(ask.topupId, { confirm_pos_duplicate: true })
      : cafeteriaAdminApi.applyOfficeTopUp(ask.topupId, { confirm_pos_duplicate: true })),
    onSuccess: ({ data }) => {
      toast.success(data.detail || 'Recarga aplicada.');
      void refresh();
      onDone();
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo aplicar la recarga.')),
  });
  const busy = link.isPending || other.isPending;
  return (
    <div className="space-y-4">
      <div role="alert" className="space-y-2 rounded-sm border border-amber/40 bg-amber/10 px-3 py-2 text-sm text-ink">
        <p>
          Loyverse ya registró una recarga de <strong>{formatMXN(ask.mirror.pos_amount)}</strong> para{' '}
          <strong>{ask.studentName}</strong> el {when(ask.mirror.pos_date)}.
        </p>
        <p>
          Si es esta misma recarga (alguien la cargó a mano en el POS), vincúlela: el saldo no cambia y no se cuenta
          dos veces. Aplíquela solo si es otra recarga distinta.
        </p>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancelar</Button>}
        <Button type="button" variant="secondary" loading={other.isPending} disabled={busy} onClick={() => other.mutate()}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Es otra recarga: aplicar {formatMXN(ask.amount)}
        </Button>
        <Button type="button" loading={link.isPending} disabled={busy} onClick={() => link.mutate()}>
          <Link2 className="h-4 w-4" aria-hidden="true" /> Es esta misma: vincular
        </Button>
      </div>
    </div>
  );
}

export function PosMirrorDialog({ ask, onClose }: { ask: PosMirrorAsk | null; onClose: () => void }) {
  return (
    <Modal open={!!ask} onClose={onClose} title="¿Es esta misma recarga?" maxWidth={520}>
      {ask && <PosMirrorChoice key={`${ask.topupId}-${ask.mirror.pos_transaction}`} ask={ask} onDone={onClose} onCancel={onClose} />}
    </Modal>
  );
}
