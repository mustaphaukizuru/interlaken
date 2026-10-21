import { Lock } from 'lucide-react';

/**
 * Online top-ups are paid through Banorte only. The card is captured inside
 * Banorte's secure window (with 3D Secure); it never touches this app, so the
 * notice's job is to say who takes the card and that we never store it.
 */
export function BanortePaymentNotice() {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-xl border border-green/30 bg-green-50 px-3 py-2.5 text-xs text-green-700">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          Se abrirá la ventana <strong>segura de Banorte</strong> para capturar tu tarjeta Visa o Mastercard; tu banco
          puede pedirte confirmar la compra. Colegio Interlaken nunca ve ni guarda los datos de tu tarjeta.
        </span>
      </div>
    </div>
  );
}

export default BanortePaymentNotice;
