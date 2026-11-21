import { test, expect, type Page } from '@playwright/test';
import { DEV_ADMIN } from './helpers';
import { CYCLE_START, choose, makeCurp, next } from './fichaHelpers';

/**
 * Ficha de inscripción (/pre-registro), end to end on a 390 px phone against
 * the real dev backend: a family starts the ficha, fills Alumno (the CURP
 * fills birth date, sex and state), Domicilio and Salud, and stops. The
 * office sends a fresh invitation from Admisiones; the family opens it in a
 * new browser, lands on the first step with something missing, finishes
 * Padre (no aplica), Madre (prefilled from who fills the ficha), Emergencia,
 * signs and sends.
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

test('a family fills the ficha in two sittings and sends it', async ({ page, browser, request }) => {
  test.setTimeout(180_000);
  const run = String(Date.now()).slice(-7);
  const email = `ficha.${run}@ejemplo.test`;

  // ── 0 · Antes de empezar ────────────────────────────────────────────────
  await page.goto('/pre-registro');
  await expect(page.getByRole('heading', { level: 2, name: 'Antes de empezar' })).toBeVisible();
  await shot(page, '00-inicio');
  await page.getByLabel('Nombre completo').fill('Marta Prueba Gil');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Celular').fill('55 1111 2222');
  await choose(page, 'Madre');
  await page.getByLabel('Nombre(s) del alumno').fill('Ana Sofía');
  await page.getByLabel('Apellido paterno del alumno').fill(`López${run}`);
  await page.getByLabel('Apellido materno del alumno').fill('Prueba');
  await page.getByLabel('Grado al que se inscribe').selectOption('1° Primaria');
  await choose(page, /ciclo en curso/);
  const started = page.waitForResponse((r) => r.url().endsWith('/api/v1/admissions/register/') && r.request().method() === 'POST');
  await page.getByRole('button', { name: /Comenzar la ficha/ }).click();
  const start = await (await started).json();
  expect(start.pre_registration).toBeTruthy();

  // ── 1 · Alumno ─────────────────────────────────────────────────────────
  await expect(page.getByRole('heading', { level: 2, name: 'Datos del alumno' })).toBeFocused();
  await expect(page.getByLabel('Apellido paterno')).toHaveValue(`López${run}`);
  await page.getByLabel('CURP').fill(CHILD_CURP.toLowerCase());
  await expect(page.getByLabel('Fecha de nacimiento')).toHaveValue(CHILD_DOB);
  await expect(page.getByRole('radio', { name: 'Femenino' })).toBeChecked();
  await expect(page.getByLabel('Estado de nacimiento')).toHaveValue('Ciudad de México');
  await shot(page, '01-alumno');
  await next(page, 'Domicilio');
  await expect(page.getByRole('status').filter({ hasText: 'Guardado' })).toBeVisible();

  // ── 2 · Domicilio ──────────────────────────────────────────────────────
  await page.getByLabel('Calle', { exact: true }).fill('Calle Ficticia');
  await page.getByLabel('Núm. exterior').fill('12');
  await page.getByLabel('Colonia', { exact: true }).fill('Colonia Inventada');
  await page.getByLabel('Código postal').fill('54000');
  await page.getByLabel('Municipio o alcaldía').fill('Tlalnepantla');
  await page.getByLabel('Estado', { exact: true }).selectOption('Estado de México');
  await shot(page, '02-domicilio');
  await next(page, 'Salud');

  // ── 3 · Salud, then stop ───────────────────────────────────────────────
  await choose(page, 'O+');
  await page.getByLabel('Estatura').fill('118');
  await choose(page, 'No');
  await page.getByLabel(/Autorizo al Colegio Interlaken a tratar los datos de salud/).check();
  await shot(page, '03-salud');
  await next(page, 'Datos del padre');
  await page.close();

  // ── The office sends a fresh invitation (Admisiones) ───────────────────
  const login = await request.post('/api/v1/accounts/token/', { data: { email: DEV_ADMIN.email, password: DEV_ADMIN.password } });
  expect(login.ok(), await login.text()).toBeTruthy();
  const { access } = await login.json();
  const invite = await request.post(`/api/v1/admissions/pre-register/${start.pre_registration}/invite/`, { headers: { Authorization: `Bearer ${access}` } });
  expect(invite.status(), await invite.text()).toBe(201);
  const link = new URL((await invite.json()).invite_url);
  expect(link.pathname).toBe('/pre-registro');

  // ── A new browser: the link opens the first step with something missing ─
  const context = await browser.newContext({ viewport: PHONE, serviceWorkers: 'block' });
  const later = await context.newPage();
  await later.goto(`${link.pathname}${link.search}`);
  await expect(later.getByRole('heading', { level: 2, name: 'Datos del padre' })).toBeFocused();
  await expect(later.getByText('Su ficha ya tiene los primeros datos.')).toBeVisible();
  await expect(later).toHaveURL(/\/pre-registro$/); // the token left the address bar
  await shot(later, '04-padre');

  // ── 4 · Padre: no aplica ───────────────────────────────────────────────
  await later.locator('label').filter({ has: later.getByRole('switch', { name: /No aplica/ }) }).click();
  await expect(later.getByText(/Marcó que este bloque no aplica/)).toBeVisible();
  await next(later, 'Datos de la madre');

  // ── 5 · Madre: prefilled from who fills the ficha ──────────────────────
  await expect(later.getByLabel('Nombre(s)')).toHaveValue('Marta');
  await expect(later.getByLabel('Correo electrónico')).toHaveValue(email);
  await later.getByLabel('CURP').fill(MOTHER_CURP);
  await expect(later.getByLabel('Fecha de nacimiento')).toHaveValue('1988-03-15');
  await choose(later, 'Casado/a');
  await choose(later, 'Lic. / Ing.');
  await choose(later, 'Independiente');
  await shot(later, '05-madre');
  await next(later, 'Contacto de emergencia');

  // ── 6 · Emergencia ─────────────────────────────────────────────────────
  await later.getByLabel('Nombre(s)').fill('Rosa');
  await later.getByLabel('Apellido(s)').fill('Gil Ramos');
  await later.getByLabel('Celular').fill('5577778888');
  await shot(later, '06-emergencia');
  await next(later, 'Revisión y firma');

  // ── 7 · Revisión y firma ───────────────────────────────────────────────
  const padre = later.getByRole('region', { name: 'Datos del padre' });
  await expect(padre).toContainText('No aplica');
  await expect(later.getByRole('region', { name: 'Datos del alumno' })).toContainText(CHILD_CURP);
  await later.getByLabel(/He leído y acepto el Aviso de Privacidad/).check();
  await later.getByLabel('Nombre completo de quien firma').fill('Marta Prueba Gil');
  await shot(later, '07-revision');
  await later.getByRole('button', { name: 'Enviar la ficha de inscripción' }).click();
  await expect(later.getByRole('heading', { level: 2, name: 'Recibimos su ficha de inscripción' })).toBeVisible();
  await shot(later, '08-enviada');
  // No horizontal scroll on the phone, at any step we passed.
  expect(await later.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await context.close();
});
