import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, XCircle, Clock, Receipt } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { paymentsApi } from '@/services/api';

type Outcome = 'loading' | 'success' | 'failed' | 'pending';

// The hosted page confirms the charge server-to-server (webhook), which can land a
// beat after the browser redirect — poll the payment a few times before concluding.
const MAX_POLLS = 5;
const POLL_MS = 2000;

export default function ColegiaturaPaymentReturn() {
  const [params] = useSearchParams();
  const paymentId = params.get('payment_id');
  const [outcome, setOutcome] = useState<Outcome>('loading');

  useEffect(() => {
    if (!paymentId) {
      setOutcome('failed');
      return;
    }
    let active = true;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const { data } = await paymentsApi.getPaymentStatus(Number(paymentId));
        if (!active) return;
        if (data.status === 'success') {
          setOutcome('success');
          toast.success('Pago de colegiatura confirmado.');
          return;
        }
        if (data.status === 'failed' || data.status === 'refunded') {
          setOutcome('failed');
          return;
        }
      } catch {
        if (!active) return;
      }
      attempts += 1;
      if (attempts >= MAX_POLLS) {
        if (active) setOutcome('pending');
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    };

    poll();
    return () => { active = false; clearTimeout(timer); };
  }, [paymentId]);

  const content = {
    loading: {
      icon: <LoadingSpinner size="lg" />,
      title: 'Confirmando su pago…',
      text: 'Estamos verificando el estado de su pago. Esto tomará unos segundos.',
    },
    success: {
      icon: <CheckCircle2 className="w-12 h-12 text-green-600" />,
      title: 'Pago confirmado',
      text: 'Su colegiatura se registró como pagada. Ya puede descargar su comprobante.',
    },
    failed: {
      icon: <XCircle className="w-12 h-12 text-coral" />,
      title: 'El pago no se completó',
      text: 'No se realizó ningún cargo. Puede intentarlo nuevamente desde la página de colegiaturas.',
    },
    pending: {
      icon: <Clock className="w-12 h-12 text-amber" />,
      title: 'Pago en proceso',
      text: 'Su pago se está procesando. La colegiatura se actualizará en cuanto se confirme.',
    },
  }[outcome];

  return (
    <div className="mx-auto mt-10 w-full max-w-md px-4 sm:px-0">
      <Card className="text-center">
        <div className="mb-4 flex justify-center">{content.icon}</div>
        <h1 className="text-fluid-lg font-bold text-ink">{content.title}</h1>
        <p className="mt-2 text-fluid-sm text-muted">{content.text}</p>
        <div className="mt-6">
          <Link to="/portal/colegiaturas">
            <Button variant="primary" className="min-h-[44px] w-full focus-visible:ring-2 focus-visible:ring-purple/40">
              <Receipt className="w-4 h-4" /> Volver a colegiaturas
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
