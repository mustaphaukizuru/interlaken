/**
 * The rules every form shares for an e-mail address and a phone number, with
 * their es-MX messages. The server checks the same (backend/apps/core/phones.py
 * for phones); these only answer sooner.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const EMAIL_MESSAGES = {
  /** An empty required field asks for it (QA 2026-11-24: it said «inválido»). */
  empty: 'Escriba su correo.',
  invalid: 'Revise el correo: debe ser como nombre@ejemplo.com.',
};

/**
 * The message for an e-mail field, or null when it is fine. Blank is fine when
 * the field is optional; `required` asks for it instead of calling it invalid.
 */
export function emailProblem(
  value: string,
  { required = true, messages = EMAIL_MESSAGES }: { required?: boolean; messages?: { empty: string; invalid: string } } = {},
): string | null {
  const text = value.trim();
  if (!text) return required ? messages.empty : null;
  return EMAIL_RE.test(text) ? null : messages.invalid;
}

export const PHONE_MIN_DIGITS = 10;
export const PHONE_MAX_DIGITS = 15;
const PHONE_ALLOWED = /^[0-9+\s()-]+$/;

export const PHONE_MESSAGES = {
  chars: 'Escriba solo números; puede usar espacios, guiones, paréntesis y el signo +.',
  length: `El número debe tener de ${PHONE_MIN_DIGITS} a ${PHONE_MAX_DIGITS} dígitos.`,
};

/**
 * The message for a phone or WhatsApp number, or null when it is fine: digits
 * plus +, spaces, dashes and parentheses, 10 to 15 digits. Blank is fine
 * (whether the field is required is the form's rule). `saved` is the value
 * the record already holds: a number saved before this rule is sent back
 * unchanged without complaint, so it never blocks saving another field.
 */
export function phoneProblem(value: string, saved?: string | null): string | null {
  const text = value.trim();
  if (!text) return null;
  if (saved != null && text === saved.trim()) return null;
  if (!PHONE_ALLOWED.test(text)) return PHONE_MESSAGES.chars;
  const digits = text.replace(/\D/g, '').length;
  if (digits < PHONE_MIN_DIGITS || digits > PHONE_MAX_DIGITS) return PHONE_MESSAGES.length;
  return null;
}

/**
 * The highest low-balance alert (saldo bajo) a family may set: the largest
 * single top-up, $1,000 (backend `low_balance_threshold_max`, which follows
 * CAFETERIA_TOPUP_MAX). The parent page passes the live value from
 * /payments/availability/ when it has it.
 */
export const LOW_BALANCE_THRESHOLD_MAX = 1000;

export function thresholdProblem(value: string, max = LOW_BALANCE_THRESHOLD_MAX): string | null {
  if (value.trim() === '') return 'Escriba el monto de la alerta.';
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 'Escriba un monto de $0 o más.';
  if (n > max) return `El monto máximo de la alerta es $${max.toLocaleString('es-MX')}.`;
  return null;
}

export const DAILY_OVER_WEEKLY = 'El límite diario no puede ser mayor que el semanal.';

/** «Presupuesto de cafetería»: both caps set (0 or blank = none) and the daily one above the weekly one. */
export function budgetProblem(daily: string, weekly: string): string | null {
  const d = daily.trim() === '' ? 0 : Number(daily);
  const w = weekly.trim() === '' ? 0 : Number(weekly);
  if (!Number.isFinite(d) || !Number.isFinite(w)) return null;
  return d > 0 && w > 0 && d > w ? DAILY_OVER_WEEKLY : null;
}
