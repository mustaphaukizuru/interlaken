import { test, expect, type Page } from '@playwright/test';
import { CYCLE_START, admitAndSendFicha, adminAuth, choose, makeCurp, next } from './fichaHelpers';

/**
 * Ficha de inscripción (/pre-registro), end to end on a 390 px phone against
 * the real dev backend. The ficha is private (2026-11-21): without a link
 * the page says so («La ficha de inscripción es personal») and offers the
 * visit. The office records the exam as «Aceptado» and sends the result with
 * the family's personal link (admin API, as the Expediente does); the family
 * opens it, fills Alumno (the CURP fills birth date, sex and state),
 * Domicilio and Salud, and stops. The office resends the ficha; the family
 * opens it in a new browser, lands on the first step with something missing,
 * finishes Padre (no aplica), Madre (prefilled from who fills the ficha),
 * Emergencia, signs and sends.
 *
 * Synthetic people only, with a unique email per run; CURPs carry a valid
 * check digit and a birth date that fits 1° Primaria in the running cycle.
 * FICHA_SHOTS=<dir> also saves a screenshot of every screen (design review).
 */
const SHOTS = process.env.FICHA_SHOTS;
const PHONE = { width: 390, height: 844 };

// 1° Primaria: 6 years old on 31 December of the cycle's first year.
const CHILD_DOB = `${CYCLE_START - 6}-05-01`;
const CHILD_CURP = makeCurp(CHILD_DOB, 'M', 'LOHA', 'DF');
const MOTHER_CURP = makeCurp('1988-03-15', 'M', 'HEGM', 'PL');

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test.use({ viewport: PHONE, serviceWorkers: 'block' });

test('without a link, /pre-registro explains that the ficha is personal', async ({ page }) => {
  await page.goto('/pre-registro');
  await expect(page.getByRole('heading', { level: 2, name: 'La ficha de inscripción es personal' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Así es el proceso de admisión' }).getByRole('listitem')).toHaveCount(3);
  await expect(page.getByRole('link', { name: 'Agendar visita' }).first()).toHaveAttribute('href', '/agendar-visita');
  await expect(page.getByRole('button', { name: /Comenzar la ficha/ })).toHaveCount(0);
  // Never indexed (RouteSeo writes the route table's robots meta).
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await shot(page, '00-privada');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('a family fills the ficha in two sittings and sends it', async ({ page, browser, request }) => {
  test.setTimeout(180_000);
  const run = String(Date.now()).slice(-7);
  const email = `ficha.${run}@ejemplo.test`;
  const auth = await adminAuth(request);

  // ── The office: exam «Aceptado», the result goes with the ficha link ─────
  const { caseId, link } = await admitAndSendFicha(request, auth, {
    child_name: `Ana López${run} Prueba`,
    parent_name: 'Marta Prueba Gil',
    parent_phone: `55${run.padStart(8, '0').slice(-8)}`,
    parent_email: email,
    relationship: 'Madre',
    grade_applying: '1° Primaria',
  });
  expect(link.pathname).toBe('/pre-registro');
  await page.goto(`${link.pathname}${link.search}`);

  // ── 1 · Alumno ─────────────────────────────────────────────────────────
  await expect(page.getByRole('heading', { level: 1, name: 'Paso 1 de 7: Información del alumno' })).toBeFocused();
  await expect(page.getByText('Su ficha ya tiene los primeros datos.')).toBeVisible();
  await expect(page).toHaveURL(/\/pre-registro$/); // the token left the address bar
  // The phone's action bar floats at the bottom of the screen; the WhatsApp bubble steps aside.
  await expect(page.locator('[data-ficha-actions]')).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Contactar al colegio' })).toBeHidden();
  await expect(page.getByLabel('Apellido paterno')).toHaveValue(`López${run}`);
  await page.getByLabel('CURP', { exact: true }).fill(CHILD_CURP.toLowerCase());
  await expect(page.getByLabel('Fecha de nacimiento')).toHaveValue(CHILD_DOB);
  await expect(page.getByRole('radio', { name: 'Femenino' })).toBeChecked();
  await expect(page.getByLabel('Estado de nacimiento')).toHaveValue('Ciudad de México');
  await shot(page, '01-alumno');
  await next(page, 'Paso 2 de 7: Domicilio');
  await expect(page.getByRole('status').filter({ hasText: 'Guardado' })).toBeVisible();

  // ── 2 · Domicilio ──────────────────────────────────────────────────────
  await page.getByLabel('Calle', { exact: true }).fill('Calle Ficticia');
  await page.getByLabel('Núm. exterior').fill('12');
  await page.getByLabel('Colonia', { exact: true }).fill('Colonia Inventada');
  await page.getByLabel('Código postal').fill('54000');
  await page.getByLabel('Municipio o alcaldía').fill('Tlalnepantla');
  await page.getByLabel('Estado', { exact: true }).selectOption('Estado de México');
  await shot(page, '02-domicilio');
  await next(page, 'Paso 3 de 7: Información de salud');

  // ── 3 · Salud, then stop ───────────────────────────────────────────────
  await choose(page, 'O+');
  await page.getByLabel('Estatura').fill('118');
  await choose(page, 'No');
  await page.getByLabel(/Autorizo al Colegio Interlaken a tratar los datos de salud/).check();
  await shot(page, '03-salud');
  await next(page, 'Paso 4 de 7: Información del padre');
  await page.close();

  // ── The office resends the ficha (Expediente «Enviar ficha de inscripción») ─
  const resend = await request.post(`/api/v1/admissions/admin/cases/${caseId}/actions/send-ficha-link/`, { headers: auth, data: { channel: 'whatsapp' } });
  expect(resend.status(), await resend.text()).toBe(200);
  const again = new URL((await resend.json()).link);
  expect(again.pathname).toBe('/pre-registro');

  // ── A new browser: the link opens the first step with something missing ─
  const context = await browser.newContext({ viewport: PHONE, serviceWorkers: 'block' });
  const later = await context.newPage();
  await later.goto(`${again.pathname}${again.search}`);
  await expect(later.getByRole('heading', { level: 1, name: 'Paso 4 de 7: Información del padre' })).toBeFocused();
  await expect(later.getByText('Su ficha ya tiene los primeros datos.')).toBeVisible();
  await expect(later).toHaveURL(/\/pre-registro$/); // the token left the address bar
  await shot(later, '04-padre');

  // ── 4 · Padre: no aplica ───────────────────────────────────────────────
  await later.locator('label').filter({ has: later.getByRole('switch', { name: /No aplica/ }) }).click();
  await expect(later.getByText(/Marcó que este bloque no aplica/)).toBeVisible();
  await next(later, 'Paso 5 de 7: Información de la madre');

  // ── 5 · Madre: prefilled from who fills the ficha ──────────────────────
  await expect(later.getByLabel('Nombre(s)')).toHaveValue('Marta');
  await expect(later.getByLabel('Correo electrónico')).toHaveValue(email);
  await later.getByLabel('CURP', { exact: true }).fill(MOTHER_CURP);
  await expect(later.getByLabel('Fecha de nacimiento')).toHaveValue('1988-03-15');
  await choose(later, 'Casado/a');
  await choose(later, 'Lic. / Ing.');
  await choose(later, 'Independiente');
  await shot(later, '05-madre');
  await next(later, 'Paso 6 de 7: Contacto de emergencia');

  // ── 6 · Emergencia ─────────────────────────────────────────────────────
  await later.getByLabel('Nombre(s)').fill('Rosa');
  await later.getByLabel('Apellido(s)').fill('Gil Ramos');
  await later.getByLabel('Celular').fill('5577778888');
  await shot(later, '06-emergencia');
  await next(later, 'Paso 7 de 7: Revisión y firma');

  // ── 7 · Revisión y firma ───────────────────────────────────────────────
  const padre = later.getByRole('region', { name: 'Paso 4 de 7: Información del padre' });
  await expect(padre).toContainText('No aplica');
  await expect(later.getByRole('region', { name: 'Paso 1 de 7: Información del alumno' })).toContainText(CHILD_CURP);
  await later.getByLabel(/He leído y acepto el Aviso de Privacidad/).check();
  await later.getByLabel('Nombre completo de quien firma').fill('Marta Prueba Gil');
  await shot(later, '07-revision');
  await later.getByRole('button', { name: 'Enviar la ficha de inscripción' }).click();
  await expect(later.getByRole('heading', { level: 1, name: 'Recibimos su ficha de inscripción' })).toBeVisible();
  await shot(later, '08-enviada');
  // No horizontal scroll on the phone, at any step we passed.
  expect(await later.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await context.close();
});
