import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { DEV_ADMIN } from './helpers';

/**
 * Helpers for driving the ficha de inscripción (/pre-registro) the way a
 * family does: valid synthetic CURPs, tap-to-choose option cards and the
 * «Guardar y continuar» step change. Shared by ficha.spec.ts and the
 * admissions journey. The ficha is private (2026-11-21): a family reaches
 * it only through the personal link the office sends once the exam is
 * «Aceptado» (`admitAndSendFicha` does that through the admin API).
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
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeFocused();
}

/** The dev administrator's JWT, as request headers. */
export async function adminAuth(request: APIRequestContext): Promise<Record<string, string>> {
  const res = await request.post('/api/v1/accounts/token/', { data: { email: DEV_ADMIN.email, password: DEV_ADMIN.password } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return { Authorization: `Bearer ${(await res.json()).access}` };
}

export interface Prospect {
  child_name: string;
  parent_name: string;
  parent_phone: string;
  parent_email: string;
  relationship: string;
  grade_applying: string;
}

/**
 * What the office does in the Expediente before a family can fill the ficha:
 * «Nuevo prospecto», the exam (date, then «Aceptado») and «Enviar resultado
 * y ficha» (as WhatsApp). Before «Aceptado» the ficha link is refused (409
 * not_admitted). Returns the case and the family's link.
 */
export async function admitAndSendFicha(request: APIRequestContext, auth: Record<string, string>, prospect: Prospect) {
  const created = await request.post('/api/v1/admissions/admin/cases/', { headers: auth, data: { ...prospect, cycle: 'actual' } });
  expect(created.status(), await created.text()).toBe(201);
  const caseId: number = (await created.json()).id;
  const base = `/api/v1/admissions/admin/cases/${caseId}`;

  const early = await request.post(`${base}/actions/send-ficha-link/`, { headers: auth, data: { channel: 'whatsapp' } });
  expect(early.status(), await early.text()).toBe(409);
  expect((await early.json()).code).toBe('not_admitted');

  const exam = new Date();
  exam.setDate(exam.getDate() - 1);
  const scheduled = await request.patch(`${base}/examen/`, { headers: auth, data: { exam_at: exam.toISOString() } });
  expect(scheduled.status(), await scheduled.text()).toBe(200);
  const accepted = await request.patch(`${base}/examen/`, { headers: auth, data: { result: 'aceptado' } });
  expect(accepted.status(), await accepted.text()).toBe(200);
  expect((await accepted.json()).stage).toBe('documentacion');

  const sent = await request.post(`${base}/actions/send-exam-result/`, { headers: auth, data: { channel: 'whatsapp' } });
  expect(sent.status(), await sent.text()).toBe(200);
  const body = await sent.json();
  expect(body.whatsapp_text).toContain(body.link);
  return { caseId, link: new URL(body.link) };
}
