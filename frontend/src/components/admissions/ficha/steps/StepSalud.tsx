/**
 * Paso 3 · Información de salud (encrypted on the server): general data,
 * allergies and conditions («¿Cuáles?» only after «Sí»), and the family's
 * consent, which is part of the step.
 */
import { Field, RestFields } from '../fields';
import { useFichaForm } from '../context';
import { Block, Blocks, Row } from '../parts';

const PLACED = [
  'blood_type', 'estatura', 'peso', 'has_allergies', 'allergies', 'chronic_conditions', 'medical_notes', 'consent_medical_data',
] as const;

export function StepSalud() {
  const { copy } = useFichaForm();
  return (
    <Blocks>
      <Block title={copy.t('saludGeneralTitle')} hint={copy.t('saludGeneralHint')}>
        <Field name="blood_type" />
        <Row>
          <Field name="estatura" />
          <Field name="peso" />
        </Row>
      </Block>
      <Block title={copy.t('saludCareTitle')} hint={copy.t('saludCareHint')}>
        <Field name="has_allergies" />
        <Field name="allergies" />
        <Field name="chronic_conditions" />
        <Field name="medical_notes" />
        <RestFields placed={PLACED} />
      </Block>
      <Block title={copy.t('saludConsentTitle')} hint={copy.t('saludConsentHint')}>
        <Field name="consent_medical_data" as="checkbox" />
      </Block>
    </Blocks>
  );
}
