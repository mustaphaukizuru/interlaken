/** Quién llena la ficha (step 0 for a public start; opened from the review to correct it). */
import { Field, RestFields } from '../fields';
import { Row } from '../parts';

const PLACED = ['contact_name', 'contact_email', 'contact_phone', 'contact_relationship'] as const;

export function StepContacto() {
  return (
    <div className="space-y-5">
      <Field name="contact_name" autoComplete="name" />
      <Row>
        <Field name="contact_email" autoComplete="email" />
        <Field name="contact_phone" autoComplete="tel-national" />
      </Row>
      <Field name="contact_relationship" />
      <RestFields placed={PLACED} />
    </div>
  );
}
