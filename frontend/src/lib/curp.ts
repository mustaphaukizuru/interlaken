/**
 * curp.ts — mirror of backend apps/admissions/validators.py (CURP part).
 *
 * The ficha de inscripción checks a CURP as the server does (official RENAPO
 * pattern and check digit) and reads what it encodes: the birth date
 * (position 17 sets the century: a digit is the 1900s, a letter the 2000s),
 * the sex (H masculino, M femenino, X neither) and the state of birth (NE =
 * born abroad). The messages are the server's, word for word, so the family
 * reads the same text before and after saving.
 */

export const CURP_ALPHABET = '0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';

/** RENAPO code inside the CURP → the entidad name the ficha stores (validators.ENTIDADES). */
export const CURP_STATES: Record<string, string> = {
  AS: 'Aguascalientes', BC: 'Baja California', BS: 'Baja California Sur', CC: 'Campeche',
  CS: 'Chiapas', CH: 'Chihuahua', DF: 'Ciudad de México', CL: 'Coahuila', CM: 'Colima',
  DG: 'Durango', MC: 'Estado de México', GT: 'Guanajuato', GR: 'Guerrero', HG: 'Hidalgo',
  JC: 'Jalisco', MN: 'Michoacán', MS: 'Morelos', NT: 'Nayarit', NL: 'Nuevo León', OC: 'Oaxaca',
  PL: 'Puebla', QT: 'Querétaro', QR: 'Quintana Roo', SP: 'San Luis Potosí', SL: 'Sinaloa',
  SR: 'Sonora', TC: 'Tabasco', TS: 'Tamaulipas', TL: 'Tlaxcala', VZ: 'Veracruz', YN: 'Yucatán',
  ZS: 'Zacatecas',
};
/** «Nacido en el extranjero». */
export const CURP_ABROAD = 'NE';

const STATE_CODES = [...Object.keys(CURP_STATES), CURP_ABROAD].sort();
const CURP_RE = new RegExp(
  '^[A-Z][AEIOUX][A-Z]{2}' // iniciales
  + '\\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\\d|3[01])' // AAMMDD
  + '[HMX]' // sexo
  + `(${STATE_CODES.join('|')})` // entidad de nacimiento
  + '[B-DF-HJ-NP-TV-Z]{3}' // consonantes internas
  + '[A-Z\\d]' // siglo
  + '\\d$', // dígito verificador
);

export const CURP_MESSAGES = {
  length: 'La CURP debe tener 18 caracteres (escribió {n}).',
  format: 'La CURP no tiene el formato oficial. Revísela en el acta de nacimiento o consúltela en gob.mx/curp.',
  date: 'La fecha de nacimiento que contiene la CURP no es válida. Revise la CURP.',
  digit: 'El último dígito de la CURP no corresponde a los demás. Revise que la haya escrito sin errores.',
  dob: 'La CURP indica que la fecha de nacimiento es {fecha}. Revise la fecha de nacimiento o la CURP.',
  sex: 'El sexo que eligió no coincide con la CURP. Revise ambos datos.',
} as const;

export type CurpSex = 'masculino' | 'femenino';

/** Uppercase, without spaces or dashes (what people paste from the PDF). */
export function cleanCurp(value: string): string {
  return String(value ?? '').replace(/[\s-]/g, '').toUpperCase();
}

/** The official check digit for the first 17 characters of a CURP. */
export function curpCheckDigit(first17: string): number {
  let total = 0;
  for (let i = 0; i < Math.min(17, first17.length); i += 1) {
    total += CURP_ALPHABET.indexOf(first17[i]) * (18 - i);
  }
  return (10 - (total % 10)) % 10;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The birth date a CURP encodes, as YYYY-MM-DD (null when it is not a real date). */
export function curpBirthDate(value: string): string | null {
  const curp = cleanCurp(value);
  if (curp.length < 17) return null;
  const yy = Number(curp.slice(4, 6));
  const mm = Number(curp.slice(6, 8));
  const dd = Number(curp.slice(8, 10));
  if (![yy, mm, dd].every(Number.isInteger) || !/^\d{6}$/.test(curp.slice(4, 10))) return null;
  const year = (/\d/.test(curp[16]) ? 1900 : 2000) + yy;
  const d = new Date(Date.UTC(year, mm - 1, dd));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return null;
  return `${year}-${pad(mm)}-${pad(dd)}`;
}

/** 'masculino' (H), 'femenino' (M) or null (X or unreadable). */
export function curpSex(value: string): CurpSex | null {
  const c = cleanCurp(value)[10];
  return c === 'H' ? 'masculino' : c === 'M' ? 'femenino' : null;
}

/** The state of birth a CURP encodes (null when abroad or unreadable). */
export function curpState(value: string): string | null {
  return CURP_STATES[cleanCurp(value).slice(11, 13)] ?? null;
}

/** True when the CURP says the person was born abroad («NE»). */
export function curpBornAbroad(value: string): boolean {
  return cleanCurp(value).slice(11, 13) === CURP_ABROAD;
}

/**
 * The server's verdict on a typed CURP: the canonical value and the message
 * to show (null when valid). Blank is valid (whether it is required is a
 * separate rule).
 */
export function checkCurp(value: string): { curp: string; error: string | null } {
  const curp = cleanCurp(value);
  if (!curp) return { curp, error: null };
  if (curp.length !== 18) return { curp, error: CURP_MESSAGES.length.replace('{n}', String(curp.length)) };
  if (!CURP_RE.test(curp)) return { curp, error: CURP_MESSAGES.format };
  if (curpBirthDate(curp) === null) return { curp, error: CURP_MESSAGES.date };
  if (curpCheckDigit(curp.slice(0, 17)) !== Number(curp[17])) return { curp, error: CURP_MESSAGES.digit };
  return { curp, error: null };
}

export const isValidCurp = (value: string): boolean => {
  const { curp, error } = checkCurp(value);
  return !!curp && error === null;
};

/** Messages for a valid CURP that disagrees with the typed birth date (YYYY-MM-DD) or sex. */
export function curpAgreementErrors(value: string, dob: string | null | undefined, sex: string | null | undefined): string[] {
  const out: string[] = [];
  if (!isValidCurp(value)) return out;
  const encoded = curpBirthDate(value);
  if (dob && encoded && encoded !== dob) {
    const [y, m, d] = encoded.split('-');
    out.push(CURP_MESSAGES.dob.replace('{fecha}', `${d}/${m}/${y}`));
  }
  const encodedSex = curpSex(value);
  if (sex && encodedSex && encodedSex !== sex) out.push(CURP_MESSAGES.sex);
  return out;
}
