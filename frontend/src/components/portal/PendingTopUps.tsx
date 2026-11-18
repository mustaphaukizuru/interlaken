import { Clock, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { WhatsAppIcon } from '@/components/icons/WhatsAppIcon';
import { downloadBlob, paymentsApi } from '@/services/api';
import { formatMXN } from '@/lib/format';
import {
  applyPhrase, DEFAULT_APPLY_TIME, DEFAULT_WHATSAPP, formatClock, formatWhatsapp, sentence, whatsappHref,
} from '@/lib/topupApply';
import type { PendingTopUp } from '@/types';

/**
 * Paid card top-ups that are not in the balance yet: the school confirms each
 * one with the bank and loads it at the cafetería (school days, from the
 * policy's apply time, 7:30). Shown under the balance so a paid recarga never
 * looks lost, with the same-day route the school offers: send the
 * comprobante by WhatsApp.
 */
export function PendingTopUps({ items, whatsapp = DEFAULT_WHATSAPP, applyTime = DEFAULT_APPLY_TIME }: {
  items: PendingTopUp[];
  whatsapp?: string;
  /** "07:30": when the school loads paid top-ups (``topup_policy.apply_time``). */
  applyTime?: string;
}) {
  if (!items.length) return null;

  const downloadReceipt = async (folio: number) => {
    try {
      const { data } = await paymentsApi.getReceipt(folio);
      downloadBlob(data as Blob, `comprobante_${folio}.pdf`);
    } catch {
      toast.error('No se pudo descargar el comprobante. Intente de nuevo.');
    }
  };

  return (
    <section aria-label="Recargas por aplicar" className="mt-3 space-y-2">
      {items.map((t) => (
        <div key={t.id} className="rounded-xl border border-amber/35 bg-amber/[0.06] px-3 py-2.5">
          <p className="flex items-start gap-2 text-sm font-semibold text-ink">
            <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber" aria-hidden="true" />
            <span>
              Recarga por aplicar · {formatMXN(t.amount)}
            </span>
          </p>
          <p className="mt-1 pl-6 text-xs leading-snug text-muted">
            Recibimos su pago. El colegio lo confirma con el banco y lo carga en la cafetería en días hábiles,
            a partir de las {formatClock(applyTime || DEFAULT_APPLY_TIME)}
          </p>
          <p className="mt-1 pl-6 text-xs leading-snug text-muted">
            {sentence(`Se sumará a su saldo ${applyPhrase(t.apply_due_at)}`)}
            {t.folio ? <> · Folio {t.folio}</> : null}
          </p>
          {(whatsapp || t.folio) && (
            <div className="mt-2 flex flex-wrap gap-2 pl-6">
              {whatsapp && (
                <a
                  href={whatsappHref(whatsapp, { folio: t.folio, amount: t.amount })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-green-600/30 bg-white px-3 text-xs font-semibold text-green-700 transition hover:border-green-600/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600/40"
                  aria-label={`La necesito hoy: enviar comprobante por WhatsApp al ${formatWhatsapp(whatsapp)}`}
                >
                  <WhatsAppIcon className="h-3.5 w-3.5" /> ¿La necesita hoy? WhatsApp
                </a>
              )}
              {t.folio && (
                <button
                  type="button"
                  onClick={() => void downloadReceipt(t.folio as number)}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-line bg-white px-3 text-xs font-semibold text-muted transition hover:border-purple/40 hover:text-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/30"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" /> Comprobante
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

export default PendingTopUps;
