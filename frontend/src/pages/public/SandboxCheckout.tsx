import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Lock, ShieldCheck, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '@/services/api';

// Deliberately neutral (non-Interlaken) styling: this page stands in for the
// BANK's hosted payment page in sandbox/dev, so it should not look like our app.
const GATEWAY_NAME: Record<string, string> = {
  global_payments: 'Global Payments',
  banorte: 'Banorte Pago en Línea',
};

// Only a same-origin relative path (single leading slash) — never an absolute,
// scheme, or protocol-relative URL — so return_url can't be used as an open
// redirect even though this page is DEV-only.
function safeReturn(raw: string | null): string {
  return raw && /^\/(?!\/)/.test(raw) ? raw : '/';
}

export default function SandboxCheckout() {
  const [params] = useSearchParams();
  const orderId = params.get('order_id') || params.get('reference') || '';
  const amount = params.get('amount') || '0.00';
  const currency = params.get('currency') || 'MXN';
  const returnUrl = safeReturn(params.get('return_url'));
  const gateway = params.get('gateway') || 'global_payments';
  const [busy, setBusy] = useState<'success' | 'failed' | null>(null);

  async function finish(result: 'success' | 'failed') {
    setBusy(result);
    try {
      await api.post('/payments/sandbox/complete/', { order_id: orderId, result });
    } catch {
      /* dev-only endpoint — proceed to the return page regardless */
    }
    window.location.href = returnUrl;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="bg-slate-900 px-6 py-5 text-white">
          <div className="flex items-center gap-1.5 text-xs text-white/60">
            <Lock size={13} /> Pago seguro
          </div>
          <div className="mt-1 text-lg font-bold">{GATEWAY_NAME[gateway] ?? gateway}</div>
        </div>

        <div className="space-y-5 p-6">
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <strong>Modo de prueba (sandbox).</strong> No se realiza ningún cargo real —
            simula el resultado del pago para probar el flujo completo.
          </div>

          <div className="text-center">
            <div className="text-sm text-slate-500">Total a pagar</div>
            <div className="text-4xl font-extrabold tracking-tight text-slate-900">
              ${parseFloat(amount).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
            </div>
            <div className="mt-1 text-xs text-slate-400">{currency} · Ref. {orderId}</div>
          </div>

          <div className="flex items-center justify-center gap-1.5 text-xs text-slate-400">
            <ShieldCheck size={13} /> Conexión cifrada · PCI DSS
          </div>

          <div className="space-y-2 pt-1">
            <button
              type="button"
              onClick={() => finish('success')}
              disabled={!!busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-3 font-semibold text-white transition hover:bg-green-700 disabled:opacity-60"
            >
              <CheckCircle2 size={18} /> {busy === 'success' ? 'Procesando…' : 'Simular pago exitoso'}
            </button>
            <button
              type="button"
              onClick={() => finish('failed')}
              disabled={!!busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
            >
              <XCircle size={18} /> Simular pago fallido
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
