import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, XCircle, Clock, Coffee } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
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
          toast.success('Recarga acreditada correctamente.');
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
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [paymentId]);

  const content = {
    loading: {
      icon: <LoadingSpinner size="lg" />,
      title: 'Confirmando su pago…',
      text: 'Estamos verificando el estado de su recarga. Esto tomará unos segundos.',
    },
    success: {
      icon: <CheckCircle2 className="w-12 h-12 text-brand-600" />,
      title: 'Recarga exitosa',
      text: 'El saldo de cafetería se acreditó correctamente. Ya puede verlo en su portal.',
    },
    failed: {
      icon: <XCircle className="w-12 h-12 text-red-500" />,
      title: 'La recarga no se completó',
      text: 'No se realizó ningún cargo. Puede intentarlo nuevamente desde la página de cafetería.',
    },
    pending: {
      icon: <Clock className="w-12 h-12 text-amber-500" />,
      title: 'Recarga en proceso',
      text: 'Su pago se está procesando. El saldo se actualizará en cuanto se confirme; puede revisar el historial en unos minutos.',
    },
  }[outcome];

  return (
    <div className="max-w-md mx-auto mt-10">
      <Card className="text-center">
        <div className="flex justify-center mb-4">{content.icon}</div>
        <h1 className="text-lg font-bold text-slate-900">{content.title}</h1>
        <p className="text-sm text-slate-500 mt-2">{content.text}</p>
        <div className="mt-6">
          <Link to="/portal/cafeteria">
            <Button variant="primary" className="w-full">
              <Coffee className="w-4 h-4" /> Volver a cafetería
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
