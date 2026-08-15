import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, XCircle, Clock, Coffee } from 'lucide-react';
import toast from 'react-hot-toast';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import Logo from '@/components/ui/Logo';
import { paymentsApi } from '@/services/api';

type Outcome = 'loading' | 'success' | 'failed' | 'pending';

// The hosted page confirms the charge server-to-server (webhook), which can land a
// beat after the browser redirect — so we poll the payment a few times before
// concluding it's still pending.
const MAX_POLLS = 5;
const POLL_MS = 2000;

export default function CafeteriaTopupReturn() {
  const [params] = useSearchParams();
  const paymentId = params.get('payment_id');
  // Without a payment_id there is nothing to poll — that outcome is derived
  // at render (the old code set it from the effect), state only tracks polling.
  const [polledOutcome, setPolledOutcome] = useState<Outcome>('loading');
  const outcome: Outcome = paymentId ? polledOutcome : 'failed';

  useEffect(() => {
    if (!paymentId) return;

    let active = true;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const { data } = await paymentsApi.getPaymentStatus(Number(paymentId));
        if (!active) return;
        if (data.status === 'success') {
          setPolledOutcome('success');
          toast.success('Pago confirmado. El colegio cargará el saldo en el POS.');
          return;
        }
        if (data.status === 'failed' || data.status === 'refunded') {
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

  const content = {
    loading: {
      icon: <LoadingSpinner size="lg" />,
      accent: 'bg-cream',
      ring: 'ring-line',
      title: 'Confirmando su pago…',
      text: 'Estamos verificando el estado de su recarga. Esto tomará unos segundos.',
    },
    success: {
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
      title: 'La recarga no se completó',
      text: 'No se realizó ningún cargo. Puede intentarlo nuevamente desde la página de cafetería.',
    },
    pending: {
      icon: <Clock className="h-10 w-10 text-amber" />,
      accent: 'bg-amber/10',
      ring: 'ring-amber/30',
      title: 'Recarga en proceso',
      text: 'Su pago se está procesando. Cuando se confirme verá el saldo en el portal; el colegio lo cargará después en el POS de cafetería.',
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
          <div className="mt-7">
            <Link
              to="/portal/cafeteria"
              className={`${outcome === 'success' ? 'btn-primary' : 'btn-secondary'} min-h-[44px] w-full focus-visible:ring-2 focus-visible:ring-purple/40`}
            >
              <Coffee className="h-4 w-4" /> Volver a cafetería
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
