/** Paso 6 · Contacto de emergencia, one block (one phone at least). */
import { Field, RestFields } from '../fields';
import { useFichaForm } from '../context';
import { Block, Row } from '../parts';

const PLACED = ['emergency_surnames', 'emergency_given_names', 'emergency_rel', 'emergency_phone', 'emergency_mobile'] as const;

export function StepEmergencia() {
  const { copy } = useFichaForm();
  return (
    <Block title={copy.t('emergenciaBlockTitle')} hint={copy.t('emergenciaBlockHint')}>
      <Row>
        <Field name="emergency_given_names" />
        <Field name="emergency_surnames" />
      </Row>
      <Field name="emergency_rel" />
      <Row>
        <Field name="emergency_mobile" />
        <Field name="emergency_phone" />
      </Row>
      <RestFields placed={PLACED} />
    </Block>
  );
}
