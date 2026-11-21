/** Paso 3 · Salud (encrypted on the server; the family's consent is part of the step). */
import { Field, RestFields } from '../fields';
import { Row } from '../parts';

const PLACED = [
  'blood_type', 'estatura', 'peso', 'has_allergies', 'allergies', 'chronic_conditions', 'medical_notes', 'consent_medical_data',
] as const;

export function StepSalud() {
  return (
    <div className="space-y-5">
      <Field name="blood_type" />
      <Row>
        <Field name="estatura" />
        <Field name="peso" />
      </Row>
      <Field name="has_allergies" />
      <Field name="allergies" />
      <Field name="chronic_conditions" />
      <Field name="medical_notes" />
      <RestFields placed={PLACED} />
      <Field name="consent_medical_data" as="checkbox" />
    </div>
  );
}
