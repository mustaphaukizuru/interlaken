import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { DEV_ADMIN, login } from './helpers';
import { CYCLE_START, choose, makeCurp, next } from './fichaHelpers';

/**
 * The admission process end to end (Fase 5, «Expediente»), against the real
 * dev backend: the office creates a prospect, records the Informes outcome,
 * links the visit the family booked and marks it attended, schedules the
 * exam and records «Aceptado», sends the ficha link (copied); the family
 * fills the ficha on a 390 px phone; the office marks the documents
 * «Entregado en físico», adds a beca, records the inscripción payment,
 * «Marcar como inscrito», and downloads the ficha in Excel and PDF.
 *
 * Synthetic people only, unique per run (phone, email, surname). The staff
 * side runs at iPad landscape width (the office's device).
 */
const IPAD = { width: 1180, height: 820 };
const PHONE = { width: 390, height: 844 };

const CHILD_DOB = `${CYCLE_START - 6}-05-01`; // fits 1° Primaria in the running cycle
const CHILD_CURP = makeCurp(CHILD_DOB, 'M', 'LOVA', 'DF');
const MOTHER_CURP = makeCurp('1987-04-20', 'M', 'PEGM', 'PL');

test.use({ viewport: IPAD, serviceWorkers: 'block' });

async function token(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/v1/accounts/token/', { data: { email: DEV_ADMIN.email, password: DEV_ADMIN.password } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).access;
}

/** The stage chip of the Expediente header. */
const stageIs = (page: Page, label: string) => expect(page.getByTestId('case-stage')).toHaveText(label);

/** Open a stage card (if it is closed) through the StageBar. */
async function openCard(page: Page, stage: string, step: string) {
  const toggle = page.locator(`#etapa-${stage}-toggle`);
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await page.getByRole('navigation', { name: 'Etapas del proceso de admisión' }).getByRole('button', { name: new RegExp(`^${step}`) }).click();
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  return page.locator(`#etapa-${stage}`);
}

test('the office takes a prospect from the first call to «Inscrito»', async ({ page, browser, request }) => {
  test.setTimeout(300_000);
  const run = String(Date.now()).slice(-7);
  const phone = `55${run.padStart(8, '0').slice(-8)}`;
  const email = `expediente.${run}@ejemplo.test`;
  const surname = `Lozano${run}`;
  const child = `Valeria ${surname} Prueba`;
  const access = await token(request);
  const auth = { Authorization: `Bearer ${access}` };

  // A visit slot far enough ahead to be unique for this run.
  const day = new Date();
  day.setDate(day.getDate() + 20 + (Number(run) % 300));
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  const gen = await request.post('/api/v1/bookings/availability/', {
    headers: auth,
    data: { visit_type: 'individual', start_date: date, end_date: date, weekdays: [day.getDay()], window_start: '10:00', window_end: '10:30', interval_minutes: 30, capacity: 3 },
  });
  expect(gen.status(), await gen.text()).toBe(201);
  const slots = await (await request.get('/api/v1/bookings/admin/slots/', { headers: auth, params: { from: date, to: date, type: 'individual' } })).json();
  const slot = (slots.results ?? slots).find((s: { start_time: string }) => s.start_time.startsWith('10:00'));
  expect(slot, 'slot').toBeTruthy();

  // ── Nuevo prospecto ────────────────────────────────────────────────────
  await login(page);
  await page.goto('/admin/admisiones');
  await page.getByRole('button', { name: /Nuevo prospecto/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo prospecto' });
  await dialog.getByLabel('Nombre del alumno').fill(child);
  await dialog.getByLabel('Nombre del tutor').fill('Marta Prueba Gil');
  await dialog.getByLabel('Celular').fill(phone);
  await dialog.getByLabel('Correo (opcional)').fill(email);
  await dialog.getByLabel('Parentesco (opcional)').selectOption('Madre');
  await dialog.getByLabel('Grado al que ingresa').selectOption('1° Primaria');
  await dialog.getByLabel('Edad (opcional)').fill('6');
  await dialog.getByLabel('Colegio de procedencia (opcional)').fill('Colegio Ficticio');
  await choose(page, /ciclo en curso/);
  await dialog.getByRole('button', { name: 'Crear expediente' }).click();
  await expect(page).toHaveURL(/\/admin\/admisiones\/\d+$/);
  const caseId = Number(new URL(page.url()).pathname.split('/').pop());
  await expect(page.getByRole('heading', { level: 1, name: child })).toBeVisible();
  await stageIs(page, 'Informes');

  // ── 1 · Informes: continúa a visita ────────────────────────────────────
  const informes = page.locator('#etapa-informes');
  await informes.getByText('Continúa a visita guiada', { exact: true }).click();
  await informes.getByRole('button', { name: 'Guardar resultado' }).click();
  await stageIs(page, 'Visita guiada');

  // ── 2 · Visita: the family booked by phone; link it, mark it ───────────
  const booking = await request.post('/api/v1/bookings/', {
    data: { slot: slot.id, parent_name: 'Marta Prueba Gil', parent_email: email, parent_phone: phone, child_name: 'Valeria', num_attendees: 1 },
  });
  expect(booking.status(), await booking.text()).toBe(201);
  const visita = await openCard(page, 'visita', '2.');
  await visita.getByRole('button', { name: /Vincular una visita/ }).click();
  const link = page.getByRole('dialog', { name: 'Vincular una visita' });
  await link.getByRole('button', { name: /Buscar/ }).click();
  await link.getByRole('radio').first().check();
  await link.getByRole('button', { name: 'Vincular visita' }).click();
  await expect(visita.getByRole('list', { name: 'Visitas vinculadas' })).toContainText('10:00');
  await visita.getByText('Asistió y agenda examen', { exact: true }).click();
  await visita.getByRole('button', { name: 'Guardar resultado' }).click();
  await stageIs(page, 'Examen');
  await expect(visita.getByRole('list', { name: 'Visitas vinculadas' })).toContainText('Asistió');

  // ── 3 · Examen: date, then «Aceptado» ──────────────────────────────────
  const examen = await openCard(page, 'examen', '3.');
  const exam = new Date();
  exam.setDate(exam.getDate() + 3);
  const examLocal = `${exam.getFullYear()}-${String(exam.getMonth() + 1).padStart(2, '0')}-${String(exam.getDate()).padStart(2, '0')}T09:00`;
  await examen.getByLabel('Fecha y hora del examen').fill(examLocal);
  await examen.getByRole('button', { name: 'Agendar examen' }).click();
  await expect(examen.getByRole('button', { name: 'Guardar cambios' })).toBeVisible();
  await examen.getByText('Aceptado', { exact: true }).click();
  await examen.getByRole('button', { name: 'Guardar resultado' }).click();
  await stageIs(page, 'Documentación y acuerdos');

  // ── The ficha link, copied to send by another channel ──────────────────
  await examen.getByRole('button', { name: 'Enviar ficha de inscripción' }).click();
  const send = page.getByRole('dialog', { name: 'Enviar ficha de inscripción' });
  await send.getByRole('radio', { name: /Copiar liga/ }).check();
  await send.getByRole('button', { name: 'Copiar liga' }).click();
  await expect(send.getByRole('status')).toContainText(/Liga copiada|Copie el texto/);
  const fichaUrl = new URL((await send.locator('p.break-all span').first().textContent())!.trim());
  expect(fichaUrl.pathname).toBe('/pre-registro');
  await send.getByRole('button', { name: 'Listo' }).click();

  // ── The family fills the ficha on a phone ──────────────────────────────
  const family = await browser.newContext({ viewport: PHONE, serviceWorkers: 'block' });
  const f = await family.newPage();
  await f.goto(`${fichaUrl.pathname}${fichaUrl.search}`);
  await expect(f.getByRole('heading', { level: 2, name: 'Datos del alumno' })).toBeFocused();
  await expect(f.getByLabel('Apellido paterno')).toHaveValue(surname);
  await f.getByLabel('CURP').fill(CHILD_CURP);
  await expect(f.getByLabel('Fecha de nacimiento')).toHaveValue(CHILD_DOB);
  await next(f, 'Domicilio');
  await f.getByLabel('Calle', { exact: true }).fill('Calle Ficticia');
  await f.getByLabel('Núm. exterior').fill('7');
  await f.getByLabel('Colonia', { exact: true }).fill('Colonia Inventada');
  await f.getByLabel('Código postal').fill('54000');
  await f.getByLabel('Municipio o alcaldía').fill('Tlalnepantla');
  await f.getByLabel('Estado', { exact: true }).selectOption('Estado de México');
  await next(f, 'Salud');
  await choose(f, 'A+');
  await f.getByLabel('Estatura').fill('117');
  await choose(f, 'No');
  await f.getByLabel(/Autorizo al Colegio Interlaken a tratar los datos de salud/).check();
  await next(f, 'Datos del padre');
  await f.locator('label').filter({ has: f.getByRole('switch', { name: /No aplica/ }) }).click();
  await next(f, 'Datos de la madre');
  await expect(f.getByLabel('Correo electrónico')).toHaveValue(email);
  await f.getByLabel('CURP').fill(MOTHER_CURP);
  await choose(f, 'Casado/a');
  await choose(f, 'Lic. / Ing.');
  await choose(f, 'Independiente');
  await next(f, 'Contacto de emergencia');
  await f.getByLabel('Nombre(s)').fill('Rosa');
  await f.getByLabel('Apellido(s)').fill('Gil Ramos');
  await f.getByLabel('Celular').fill('5577778888');
  await next(f, 'Revisión y firma');
  await f.getByLabel(/He leído y acepto el Aviso de Privacidad/).check();
  await f.getByLabel('Nombre completo de quien firma').fill('Marta Prueba Gil');
  await f.getByRole('button', { name: 'Enviar la ficha de inscripción' }).click();
  await expect(f.getByRole('heading', { level: 2, name: 'Recibimos su ficha de inscripción' })).toBeVisible();
  expect(await f.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await family.close();

  // ── 4 · Documentación y acuerdos ───────────────────────────────────────
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: child })).toBeVisible();
  const docs = await openCard(page, 'documentacion', '4.');
  await expect(docs).toContainText('Enviado');
  // Every document still missing arrives on paper.
  const physical = docs.getByRole('button', { name: 'Entregado en físico' });
  await expect(physical.first()).toBeVisible();
  for (let guard = 0; guard < 20 && (await physical.count()) > 0; guard += 1) {
    await physical.first().click();
    await page.getByRole('dialog', { name: 'Marcar como entregado en físico' }).getByRole('button', { name: 'Marcar entregado' }).click();
    await expect(page.getByRole('dialog', { name: 'Marcar como entregado en físico' })).toBeHidden();
  }
  await expect(docs.getByText('Documentos completos', { exact: true })).toBeVisible();

  await docs.getByRole('button', { name: /Agregar beca o descuento/ }).click();
  const beca = page.getByRole('dialog', { name: 'Agregar beca o descuento' });
  await beca.getByLabel('Porcentaje (%)').fill('20');
  await beca.getByLabel('Autorizó').fill('Dirección general');
  await beca.getByRole('button', { name: 'Agregar' }).click();
  await expect(docs.getByRole('list', { name: 'Becas y descuentos' })).toContainText('Beca 20% en colegiatura');

  // ── 5 · Inscripción: payment, then «Marcar como inscrito» ──────────────
  const inscripcion = await openCard(page, 'inscrito', '5.');
  await inscripcion.getByRole('button', { name: /Registrar pago/ }).click();
  const pay = page.getByRole('dialog', { name: 'Registrar pago de inscripción' });
  await pay.getByLabel('Monto (MXN)').fill('9500');
  await pay.getByLabel('Referencia (opcional)').fill(`REF-${run}`);
  await pay.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(inscripcion.getByRole('list', { name: 'Pagos de inscripción' })).toContainText('9,500.00');
  await inscripcion.getByRole('button', { name: /Marcar como inscrito/ }).click();
  const enroll = page.getByRole('dialog', { name: /Marcar como inscrito/ });
  await enroll.getByLabel('Grupo (opcional)').fill('A');
  await enroll.getByRole('button', { name: 'Crear alumno y cuentas' }).click();
  const done = page.getByRole('dialog', { name: 'Alumno inscrito' });
  await expect(done.getByText(/Matrícula/)).toBeVisible();
  await expect(done.getByRole('list', { name: 'Cuentas de familia' })).toContainText(email);
  await done.getByRole('button', { name: 'Listo' }).click();
  await stageIs(page, 'Inscrito');

  // ── The ficha, in Excel and PDF ────────────────────────────────────────
  const detail = await (await request.get(`/api/v1/admissions/admin/cases/${caseId}/`, { headers: auth })).json();
  expect(detail.stage).toBe('inscrito');
  const fichaId = detail.ficha.id;
  for (const [fmt, label, type] of [['xlsx', 'Excel', 'spreadsheetml'], ['pdf', 'PDF', 'application/pdf']] as const) {
    await page.getByRole('button', { name: /Exportar ficha/ }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: new RegExp(label) }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${fmt}$`));
    const res = await request.get(`/api/v1/admissions/register/${fichaId}/ficha/export/`, { headers: auth, params: { fmt } });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain(type);
    expect((await res.body()).byteLength).toBeGreaterThan(2_000);
  }
  // No horizontal scroll on the office's iPad.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
