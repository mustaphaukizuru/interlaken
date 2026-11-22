/**
 * Paso 2 · Domicilio, in the order of a Mexican address, then the home phone.
 * The family's own address: the browser may offer it (colonia = address-level3,
 * municipio = address-level2, estado = address-level1).
 */
import { Field, RestFields } from '../fields';
import { useFichaForm } from '../context';
import { Block, Blocks, HALF, Row } from '../parts';

const PLACED = [
  'address_street', 'address_ext_number', 'address_int_number', 'address_between_streets', 'address_state',
  'address_municipality', 'address_neighborhood', 'address_postal_code', 'home_phone',
] as const;

export function StepDomicilio() {
  const { copy } = useFichaForm();
  return (
    <Blocks>
      <Block title={copy.t('domicilioAddressTitle')} hint={copy.t('domicilioAddressHint')}>
        <Field name="address_street" autoComplete="address-line1" />
        <Row>
          <Field name="address_ext_number" />
          <Field name="address_int_number" />
        </Row>
        <Field name="address_between_streets" />
        <Row>
          <Field name="address_neighborhood" autoComplete="address-level3" />
          <Field name="address_postal_code" autoComplete="postal-code" />
        </Row>
        <Row>
          <Field name="address_municipality" autoComplete="address-level2" />
          <Field name="address_state" autoComplete="address-level1" />
        </Row>
      </Block>
      <Block title={copy.t('domicilioPhoneTitle')} hint={copy.t('domicilioPhoneHint')}>
        <Field name="home_phone" className={HALF} />
        <RestFields placed={PLACED} />
      </Block>
    </Blocks>
  );
}
