/** Paso 2 · Domicilio, in the order of a Mexican address, then the home phone. */
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
          <Field name="address_neighborhood" />
          <Field name="address_postal_code" />
        </Row>
        <Row>
          <Field name="address_municipality" />
          <Field name="address_state" />
        </Row>
      </Block>
      <Block title={copy.t('domicilioPhoneTitle')} hint={copy.t('domicilioPhoneHint')}>
        <Field name="home_phone" className={HALF} />
        <RestFields placed={PLACED} />
      </Block>
    </Blocks>
  );
}
