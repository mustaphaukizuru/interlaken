import { Info } from 'lucide-react';
import { Input } from '@/components/ui/Input';

import { cardholderErrors, MX_STATES, type Cardholder } from '@/lib/cardholder';

/** «Titular de la tarjeta» step of the top-up wizard (see lib/cardholder.ts). */
export function CardholderStep({ value, onChange, remember, onRemember, states, touched }: {
  value: Cardholder;
  onChange: (next: Cardholder) => void;
  remember: boolean;
  onRemember: (v: boolean) => void;
  states?: { code: string; name: string }[];
  /** Show the errors (after the parent tried to continue). */
  touched: boolean;
}) {
  const errors = touched ? cardholderErrors(value) : {};
  const set = (k: keyof Cardholder) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  const list = states?.length ? states : MX_STATES;
  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 rounded-xl border border-line bg-cream/60 px-3 py-2.5 text-xs leading-relaxed text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-purple" aria-hidden="true" />
        Banorte pide los datos del titular de la tarjeta para validar el pago. Escríbalos como aparecen en
        el estado de cuenta de la tarjeta.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Nombre(s) del titular" autoComplete="cc-given-name" maxLength={60} value={value.first_name} onChange={set('first_name')} error={errors.first_name} required />
        <Input label="Apellidos" autoComplete="cc-family-name" maxLength={60} value={value.last_name} onChange={set('last_name')} error={errors.last_name} required />
        <Input label="Calle" autoComplete="address-line1" maxLength={40} value={value.street} onChange={set('street')} error={errors.street} required />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Núm. exterior" maxLength={6} value={value.street_number} onChange={set('street_number')} error={errors.street_number} required />
          <Input label="Núm. interior" maxLength={10} value={value.street_number_2} onChange={set('street_number_2')} placeholder="Opcional" />
        </div>
        <Input label="Colonia" maxLength={30} value={value.colonia} onChange={set('colonia')} error={errors.colonia} required />
        <Input label="Municipio o alcaldía" maxLength={30} value={value.municipio} onChange={set('municipio')} error={errors.municipio} required />
        <Input label="Ciudad" autoComplete="address-level2" maxLength={50} value={value.city} onChange={set('city')} error={errors.city} required />
        <div>
          <label className="label" htmlFor="ch-state">Estado</label>
          <select
            id="ch-state"
            className="input-field min-h-[44px] text-base"
            value={value.state}
            onChange={set('state')}
            aria-invalid={!!errors.state}
            aria-describedby={errors.state ? 'ch-state-err' : undefined}
          >
            <option value="">Seleccione…</option>
            {list.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
          {errors.state && <p id="ch-state-err" className="mt-1 text-xs text-coral">{errors.state}</p>}
        </div>
        <Input label="Código postal" inputMode="numeric" autoComplete="postal-code" maxLength={5} value={value.postal_code} onChange={set('postal_code')} error={errors.postal_code} required />
        <Input label="Teléfono" type="tel" inputMode="tel" autoComplete="tel" maxLength={20} value={value.phone} onChange={set('phone')} error={errors.phone} required />
        <div className="sm:col-span-2">
          <Input label="Correo" type="email" inputMode="email" autoComplete="email" maxLength={100} value={value.email} onChange={set('email')} error={errors.email} required />
        </div>
      </div>
      <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm text-ink" htmlFor="ch-remember">
        <input id="ch-remember" type="checkbox" className="h-4 w-4 rounded border-line text-purple focus:ring-purple/40" checked={remember} onChange={(e) => onRemember(e.target.checked)} />
        Guardar estos datos para mis próximas recargas
      </label>
    </div>
  );
}

export default CardholderStep;
