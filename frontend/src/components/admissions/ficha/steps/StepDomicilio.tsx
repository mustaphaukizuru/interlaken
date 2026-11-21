/** Paso 2 · Domicilio, in the order of a Mexican address. */
import { Field, RestFields } from '../fields';
import { Row } from '../parts';

const PLACED = [
  'address_street', 'address_ext_number', 'address_int_number', 'address_between_streets', 'address_state',
  'address_municipality', 'address_neighborhood', 'address_postal_code', 'home_phone',
] as const;

export function StepDomicilio() {
  return (
    <div className="space-y-5">
      <Field name="address_street" autoComplete="address-line1" />
      <Row>
        <Field name="address_ext_number" />
        <Field name="address_int_number" />
      </Row>
      <Field name="address_between_streets" />
      <Row>
        <Field name="address_neighborhood" />
        <Field name="address_postal_code" />
      </Row>
      <Row>
        <Field name="address_municipality" />
        <Field name="address_state" />
      </Row>
      <Field name="home_phone" />
      <RestFields placed={PLACED} />
    </div>
  );
}
