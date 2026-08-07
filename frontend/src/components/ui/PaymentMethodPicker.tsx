import { CreditCard, Landmark, Lock } from 'lucide-react';

/**
 * The two contractually-allowed gateways. Card data is entered on the bank's
 * hosted page after redirect — never in this app — so the picker's job is to let
 * the family choose the provider and make the secure-redirect promise explicit.
 */
export const PAYMENT_GATEWAYS = [
  {
    value: 'global_payments',
    name: 'Tarjeta de crédito o débito',
    sub: 'Visa · Mastercard · American Express',
    icon: CreditCard,
  },
  {
    value: 'banorte',
    name: 'Banorte Pago en Línea',
    sub: 'Tarjeta o cargo bancario Banorte',
    icon: Landmark,
  },
] as const;

export function PaymentMethodPicker({ value, onChange, disabled }: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="label mb-0">Elige cómo pagar</p>
      <div className="grid gap-2.5">
        {PAYMENT_GATEWAYS.map((g) => {
          const active = value === g.value;
          const Icon = g.icon;
          return (
            <button
              type="button"
              key={g.value}
              disabled={disabled}
              onClick={() => onChange(g.value)}
              aria-pressed={active}
              className={`flex items-center gap-3 rounded-xl2 border p-3.5 text-left transition disabled:opacity-60 ${
                active
                  ? 'border-purple bg-purple/[0.06] ring-2 ring-purple/25'
                  : 'border-line bg-white hover:border-purple/40 hover:bg-purple/[0.02]'
              }`}
            >
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                active ? 'bg-purple text-white' : 'bg-cream text-muted'
              }`}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink">{g.name}</span>
                <span className="block text-xs text-subtle">{g.sub}</span>
              </span>
              <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 ${
                active ? 'border-purple' : 'border-line'
              }`}>
                {active && <span className="h-2 w-2 rounded-full bg-purple" />}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-green/30 bg-green-50 px-3 py-2.5 text-xs text-green-700">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Te enviaremos a la página <strong>segura</strong> del banco para capturar tu tarjeta
          de crédito o débito. Colegio Interlaken nunca almacena los datos de tu tarjeta.
        </span>
      </div>
    </div>
  );
}

export default PaymentMethodPicker;
