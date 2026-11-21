/** Paso 6 · Contacto de emergencia (one phone at least). */
import { Field, RestFields } from '../fields';
import { Row } from '../parts';

const PLACED = ['emergency_surnames', 'emergency_given_names', 'emergency_rel', 'emergency_phone', 'emergency_mobile'] as const;

export function StepEmergencia() {
  return (
    <div className="space-y-5">
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
    </div>
  );
}
