/**
 * The public forms' shared messages (contacto, agendar visita, the home
 * lead form, facturación): one inline error under a field, the same 14px
 * danger text the ficha uses, with the id the field's aria-describedby
 * points at. Hints stay visible next to an error (ui/Input does the same).
 */
export interface FieldErrorInfo { id: string; text: string }

export function FieldError({ error, className = '' }: { error: FieldErrorInfo | null | undefined; className?: string }) {
  if (!error?.text) return null;
  return <p id={error.id} className={`mt-1.5 text-sm font-medium text-danger ${className}`.trim()}>{error.text}</p>;
}

/** «(opcional)» after a label: forms mark the optional fields, like the ficha (required ones carry no mark). */
export function OptionalMark() {
  return <>{' '}<span className="ml-1 text-xs font-normal text-subtle">(opcional)</span></>;
}
