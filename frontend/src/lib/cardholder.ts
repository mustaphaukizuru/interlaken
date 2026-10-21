/**
 * Cardholder data Banorte requires on every card payment (Cybersource fraud
 * screening, manual v1.8). Mirrors backend/apps/payments/billing.py; the server
 * re-validates everything.
 */
export interface Cardholder {
  first_name: string;
  last_name: string;
  street: string;
  street_number: string;
  street_number_2: string;
  colonia: string;
  municipio: string;
  city: string;
  state: string;
  postal_code: string;
  phone: string;
  email: string;
}

export const EMPTY_CARDHOLDER: Cardholder = {
  first_name: '', last_name: '', street: '', street_number: '', street_number_2: '',
  colonia: '', municipio: '', city: '', state: '', postal_code: '', phone: '', email: '',
};

/** Banorte's 32 two-letter state codes (fallback until the API list arrives). */
export const MX_STATES: { code: string; name: string }[] = [
  ['AG', 'Aguascalientes'], ['BC', 'Baja California'], ['BS', 'Baja California Sur'], ['CM', 'Campeche'],
  ['CS', 'Chiapas'], ['CH', 'Chihuahua'], ['CO', 'Coahuila'], ['CL', 'Colima'], ['DF', 'Ciudad de México'],
  ['DG', 'Durango'], ['EM', 'Estado de México'], ['GT', 'Guanajuato'], ['GR', 'Guerrero'], ['HG', 'Hidalgo'],
  ['JA', 'Jalisco'], ['MI', 'Michoacán'], ['MO', 'Morelos'], ['NA', 'Nayarit'], ['NL', 'Nuevo León'],
  ['OA', 'Oaxaca'], ['PU', 'Puebla'], ['QT', 'Querétaro'], ['QR', 'Quintana Roo'], ['SL', 'San Luis Potosí'],
  ['SI', 'Sinaloa'], ['SO', 'Sonora'], ['TB', 'Tabasco'], ['TM', 'Tamaulipas'], ['TL', 'Tlaxcala'],
  ['VC', 'Veracruz'], ['YC', 'Yucatán'], ['ZA', 'Zacatecas'],
].map(([code, name]) => ({ code, name }));

const digits = (v: string) => v.replace(/\D/g, '');
const hasText = (v: string) => /[A-Za-z0-9À-ÿ]/.test(v);

/** Field errors as the server would give them ({} = ready to pay). */
export function cardholderErrors(c: Cardholder): Partial<Record<keyof Cardholder, string>> {
  const e: Partial<Record<keyof Cardholder, string>> = {};
  const required: (keyof Cardholder)[] = ['first_name', 'last_name', 'street', 'street_number', 'colonia', 'municipio', 'city'];
  for (const k of required) if (!hasText(c[k])) e[k] = 'Requerido.';
  if (!MX_STATES.some((s) => s.code === c.state)) e.state = 'Elija el estado.';
  if (digits(c.postal_code).length !== 5) e.postal_code = 'Código postal de 5 dígitos.';
  const phone = digits(c.phone).length;
  if (phone < 10 || phone > 15) e.phone = 'Teléfono de 10 dígitos.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) e.email = 'Correo no válido.';
  return e;
}
