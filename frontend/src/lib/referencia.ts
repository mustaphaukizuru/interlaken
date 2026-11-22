/**
 * The «Referencia» staff type back from MultiCobros (Verificar / Conciliar).
 *
 * In MultiCobros the row of a payment shows several look-alike numbers: the
 * número de control (what staff search by, e.g. IK38J3ELRBWVL8), «Referencia
 * 1» (ours, PAGO38), the autorización (6 digits) and the bank's «Referencia»
 * (digits only), which is the one the server checks. On 2026-11-21 the
 * número de control went into the box and the server refused it with a
 * message about the wrong operation. These catch the look-alikes before the
 * request, with a message that says which column to copy.
 */

export const REFERENCIA_HINT =
  'El número de solo dígitos de la columna «Referencia» en MultiCobros (no el número de control ni «Referencia 1»).';

/** The value as sent: Payworks referencias are digits only, so spaces go. */
export const cleanReferencia = (value: string) => value.replace(/\s+/g, '');

/** Why `value` cannot be the bank's «Referencia» ('' when it can). */
export function referenciaProblem(value: string, controlNumber?: string | null): string {
  const v = cleanReferencia(value);
  if (!v) return '';
  if (controlNumber && v.toUpperCase() === controlNumber.replace(/\s+/g, '').toUpperCase()) {
    return 'Ese es el número de control: con él se busca la operación. Escriba el número de la columna «Referencia».';
  }
  if (/^pago\d*$/i.test(v)) {
    return 'Esa es la «Referencia 1». Escriba el número de la columna «Referencia» (solo dígitos).';
  }
  if (/\D/.test(v)) {
    return 'La «Referencia» de MultiCobros tiene solo dígitos. Revise que copió esa columna.';
  }
  return '';
}
