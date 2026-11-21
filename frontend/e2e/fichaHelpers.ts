import { expect, type Page } from '@playwright/test';

/**
 * Helpers for driving the ficha de inscripción (/pre-registro) the way a
 * family does: valid synthetic CURPs, tap-to-choose option cards and the
 * «Guardar y continuar» step change. Shared by ficha.spec.ts and the
 * admissions journey.
 */
const ALPHABET = '0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';

/** A synthetic CURP with a valid check digit (no real person). */
export function makeCurp(dob: string, sex: 'H' | 'M', initials: string, state: string, consonants = 'RRN') {
  const [y, m, d] = dob.split('-');
  const body = `${initials}${y.slice(2)}${m}${d}${sex}${state}${consonants}${Number(y) >= 2000 ? 'A' : '0'}`;
  let total = 0;
  for (let i = 0; i < 17; i += 1) total += ALPHABET.indexOf(body[i]) * (18 - i);
  return body + ((10 - (total % 10)) % 10);
}

/** First year of the school year in progress (August to July). */
const now = new Date();
export const CYCLE_START = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;

/** Tap a tap-to-choose option card (the label around its native radio), as a person does. */
export async function choose(page: Page, name: string | RegExp) {
  const radio = page.getByRole('radio', { name, exact: typeof name === 'string' });
  await page.locator('label').filter({ has: radio }).click();
  await expect(radio).toBeChecked();
}

/** «Guardar y continuar», then the next step's heading takes the focus. */
export async function next(page: Page, heading: string) {
  await page.getByRole('button', { name: 'Guardar y continuar', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: heading })).toBeFocused();
}
