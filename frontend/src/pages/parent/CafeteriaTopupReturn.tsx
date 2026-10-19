import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatMXN } from '@/lib/format';
import { CheckCircle2, XCircle, Clock, Coffee, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import Logo from '@/components/ui/Logo';
import { WhatsAppIcon } from '@/components/icons/WhatsAppIcon';
import { downloadBlob, paymentsApi } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { PAYMENT_FAILURE } from '@/lib/status/payment';
import { applyNotice, applyPhrase, DEFAULT_WHATSAPP, formatWhatsapp, whatsappHref } from '@/lib/topupApply';
import type { Payment } from '@/types';

type Outcome = 'loading' | 'success' | 'failed' | 'refunded' | 'pending';

// Banorte's answer is forwarded by the payment page just before it navigates
// here and can land a beat later, so we poll the payment a few times before
// concluding it's still pending.
const MAX_POLLS = 5;
const POLL_MS = 2000;

type Paid = Pick<Payment, 'id' | 'amount' | 'student_name' | 'bank_reference' | 'auth_code' | 'gateway_tx_id' | 'topup'>;

export default function CafeteriaTopupReturn() {
  const [params] = useSearchParams();
  const paymentId = params.get('payment_id');
  // Without a payment_id there is nothing to poll — that outcome is derived
  // at render (the old code set it from the effect), state only tracks polling.
  const [polledOutcome, setPolledOutcome] = useState<Outcome>('loading');
  // Details of the confirmed payment for the receipt line (BACKLOG P1-D7).
  const [paid, setPaid] = useState<Paid | null>(null);
  // Why it failed (cancelled, expired, declined...): the copy must match the real cause.
  const [failureReason, setFailureReason] = useState('');
  const outcome: Outcome = paymentId ? polledOutcome : 'failed';

  // The school's WhatsApp and load time for the "por aplicar" message.
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data: availability } = useQuery({
    queryKey: ['payments-availability', userId],
    queryFn: () => paymentsApi.getAvailability().then((r) => r.data),
    staleTime: 60_000,
  });
  const policy = availability?.topup_policy;
  const whatsapp = policy?.whatsapp ?? DEFAULT_WHATSAPP;

  // Paid but waiting for the school's POS load (scheduled apply): the balance
  // does not change yet, and the page must say so plainly.
  const awaitingApply = outcome === 'success' && paid?.topup?.status === 'paid';

  useEffect(() => {
    if (!paymentId) return;

    let active = true;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const { data } = await paymentsApi.getPaymentStatus(Number(paymentId)) as { data: Payment };
        if (!active) return;
        if (data.status === 'success') {
          setPaid({
            id: data.id, amount: data.amount, student_name: data.student_name, gateway_tx_id: data.gateway_tx_id,
            bank_reference: data.bank_reference, auth_code: data.auth_code, topup: data.topup,
          });
          setPolledOutcome('success');
          toast.success(data.topup?.status === 'paid'
            ? 'Pago recibido. El colegio aplicará el saldo en la próxima carga.'
            : 'Pago confirmado. El colegio cargará el saldo en el POS.');
          return;
        }
        if (data.status === 'refunded') {
          setPolledOutcome('refunded');
          return;
        }
        if (data.status === 'failed') {
          setFailureReason(data.failure_reason ?? '');
          setPolledOutcome('failed');
          return;
        }
      } catch {
        if (!active) return;
      }
      attempts += 1;
      if (attempts >= MAX_POLLS) {
        if (active) setPolledOutcome('pending');
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    };

    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [paymentId]);

  const downloadReceipt = async () => {
    if (!paid) return;
    try {
      const { data } = await paymentsApi.getReceipt(paid.id);
      downloadBlob(data as Blob, `comprobante_${paid.id}.pdf`);
    } catch {
      toast.error('No se pudo descargar el comprobante. Intente de nuevo.');
    }
  };

  const content = {
    loading: {
      icon: <LoadingSpinner size="lg" />,
      accent: 'bg-cream',
      ring: 'ring-line',
      title: 'Confirmando su pago…',
      text: 'Estamos verificando el estado de su recarga. Esto tomará unos segundos.',
    },
    success: awaitingApply ? {
      icon: <CheckCircle2 className="h-10 w-10 text-green-dark" />,
      accent: 'bg-green/10',
      ring: 'ring-green/25',
      title: 'Pago recibido',
      text: applyNotice(policy),
    } : {
      icon: <CheckCircle2 className="h-10 w-10 text-green-dark" />,
      accent: 'bg-green/10',
      ring: 'ring-green/25',
      title: 'Pago confirmado',
      text: 'Su pago quedó registrado y el saldo ya aparece en el portal. El colegio cargará el monto en el POS de cafetería para que su hijo(a) pueda usarlo al comprar; esto puede tomar un momento.',
    },
    failed: {
      icon: <XCircle className="h-10 w-10 text-coral" />,
      accent: 'bg-coral-50',
      ring: 'ring-coral/30',
      title: PAYMENT_FAILURE[failureReason]?.family
        ? `La recarga no se completó: ${PAYMENT_FAILURE[failureReason].family.toLowerCase()}`
        : 'La recarga no se completó',
      text: PAYMENT_FAILURE[failureReason]?.help
        ?? 'Puede intentarlo nuevamente desde la página de cafetería. Si ve un cargo en su estado de cuenta, avise al colegio.',
    },
    refunded: {
      icon: <XCircle className="h-10 w-10 text-coral" />,
      accent: 'bg-coral-50',
      ring: 'ring-coral/30',
      title: 'Pago devuelto',
      text: 'El colegio devolvió este pago: el cargo se reembolsó a su tarjeta y el saldo de cafetería se ajustó.',
    },
    pending: {
      icon: <Clock className="h-10 w-10 text-amber" />,
      accent: 'bg-amber/10',
      ring: 'ring-amber/30',
      title: 'Recarga en proceso',
      text: 'Su pago se está procesando. Cuando se confirme lo verá en la página de cafetería; el colegio aplica el saldo cuando lo carga en la caja de cafetería.',
    },
  }[outcome];

  return (
    <div className="min-h-[70vh] bg-cream-2 px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo variant="horizontal" size={36} theme="light" />
        </div>
        {outcome === 'success' && (
          <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-green/20" aria-hidden="true">
            <div className="h-full w-full rounded-full bg-green" />
          </div>
        )}
        <div
          role="status"
          aria-live="polite"
          className={`rounded-xl2 border border-line bg-white p-8 text-center shadow-card ring-1 ${content.ring}`}
        >
          <div className={`mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl ${content.accent}`}>
            {content.icon}
          </div>
          {outcome === 'success' && (
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[1.5px] text-green-dark">
              Colegio Interlaken
            </p>
          )}
          <h1 className="font-head text-fluid-xl font-bold text-ink">{content.title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{content.text}</p>
          {outcome === 'success' && paid && (
            <dl className="mt-5 divide-y divide-line rounded-xl border border-line text-left text-sm">
              {paid.student_name && <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-muted">Alumno</dt><dd className="font-medium text-ink">{paid.student_name}</dd></div>}
              {paid.amount && <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-muted">Recarga</dt><dd className="font-bold text-ink">{formatMXN(paid.amount)}</dd></div>}
              {awaitingApply && (
                <div className="flex justify-between gap-3 bg-amber/[0.06] px-4 py-2.5">
                  <dt className="whitespace-nowrap text-muted">Se aplica</dt>
                  <dd className="text-right font-semibold text-ink">{applyPhrase(paid.topup?.apply_due_at)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-muted">Folio</dt><dd className="font-mono text-xs text-ink">{paid.id}</dd></div>
              {paid.bank_reference && <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-muted">Referencia bancaria</dt><dd className="font-mono text-xs text-ink">{paid.bank_reference}</dd></div>}
              {paid.auth_code && <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-muted">Autorización</dt><dd className="font-mono text-xs text-ink">{paid.auth_code}</dd></div>}
              {paid.gateway_tx_id && <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-muted">Número de control</dt><dd className="font-mono text-xs text-ink">{paid.gateway_tx_id}</dd></div>}
            </dl>
          )}
          <div className="mt-7 grid gap-2">
            {outcome === 'success' && paid && (
              <button
                type="button"
                onClick={() => void downloadReceipt()}
                className="btn-outline min-h-[44px] w-full text-sm focus-visible:ring-2 focus-visible:ring-purple/40"
              >
                <Download className="h-4 w-4" aria-hidden="true" /> Descargar comprobante (PDF)
              </button>
            )}
            {awaitingApply && whatsapp && (
              <a
                href={whatsappHref(whatsapp, { folio: paid?.id, amount: paid?.amount })}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-green-600/40 bg-green-50 px-4 text-sm font-semibold text-green-700 transition hover:bg-green-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600/40"
              >
                <WhatsAppIcon className="h-4 w-4" /> La necesito hoy: WhatsApp {formatWhatsapp(whatsapp)}
              </a>
            )}
            <Link
              to="/portal/cafeteria"
              className={`${outcome === 'success' ? 'btn-primary' : 'btn-secondary'} min-h-[44px] w-full focus-visible:ring-2 focus-visible:ring-purple/40`}
            >
              <Coffee className="h-4 w-4" /> {outcome === 'failed' ? 'Intentar de nuevo' : 'Ver saldo de cafetería'}
            </Link>
            {outcome !== 'loading' && outcome !== 'success' && (
              <Link to="/portal/cafeteria" className="btn-outline min-h-[44px] w-full text-sm">
                Ver historial de pagos
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
