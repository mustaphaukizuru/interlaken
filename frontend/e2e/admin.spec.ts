import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { login, portalNav, DEV_PARENT } from './helpers';

/**
 * Admin-critical flows. All announcement APIs are stubbed with page.route
 * (the point is the UI flow — composer, listing — not the data plumbing);
 * auth is real for both roles. The Alumnos data-ops flow runs against the
 * real dev backend (import, bulk and export are the plumbing under test).
 */

test('publishing a comunicado posts it and lists it in the admin console', async ({ page }) => {
  // Stateful stub: the list starts empty; a successful POST appears in the next GET.
  const items: Record<string, unknown>[] = [];
  let createPayload: Record<string, unknown> | null = null;

  await page.route('**/api/v1/portal/admin/announcements/**', (route) => {
    const url = route.request().url();
    if (url.includes('recipient-count')) {
      return route.fulfill({ json: { audience: 'all', count: 12 } });
    }
    if (route.request().method() === 'POST') {
      createPayload = route.request().postDataJSON();
      const item = {
        id: 101,
        ...createPayload,
        created_at: '2026-08-10T12:00:00Z',
        created_by_name: 'Dev Admin',
        read_count: 0,
      };
      items.unshift(item);
      return route.fulfill({ status: 201, json: item });
    }
    return route.fulfill({ json: { count: items.length, results: items } });
  });

  await login(page); // admin
  await portalNav(page).getByRole('link', { name: 'Comunicados', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/comunicados/);
  await expect(page.getByText('Sin comunicados')).toBeVisible();

  // Compose + publish (two same-named buttons: header action + empty state).
  await page.getByRole('button', { name: 'Nuevo comunicado' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Título').fill('Suspensión de clases');
  await dialog.getByLabel('Mensaje').fill('Mañana no habrá clases por mantenimiento del plantel.');
  await dialog.getByRole('button', { name: 'Publicar' }).click();

  await expect(page.getByText('Comunicado publicado y enviado.')).toBeVisible();
  await expect(page.getByText('Suspensión de clases')).toBeVisible();
  expect(createPayload).toMatchObject({
    title: 'Suspensión de clases',
    body: 'Mañana no habrá clases por mantenimiento del plantel.',
    audience: 'all',
    is_active: true,
    push_enabled: true,
  });
});

test('the parent portal no longer shows comunicados (bitácora punto 10)', async ({ page }) => {
  // Families stopped seeing Comunicados in the portal on 2026-10-13: the menu
  // has no entry and the old address lands on Notificaciones (the page and the
  // admin side are kept so the school can bring it back).
  await login(page, DEV_PARENT);
  await expect(portalNav(page).getByRole('link', { name: 'Comunicados', exact: true })).toHaveCount(0);

  // Client-side navigation (a full reload would drop the in-memory session).
  await page.evaluate(() => {
    window.history.pushState({}, '', '/portal/comunicados');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page).toHaveURL(/\/portal\/notificaciones/);
});

test('Alumnos data ops: import with errors, valid-only commit, bulk group change, XLSX export', async ({ page }) => {
  // Unique per run so reruns against the same dev DB always take the "crear"
  // path: 8 digits of the clock, suffixed 1/2/3 into three new matrículas.
  const stamp = String(Date.now()).slice(-8);
  const [m1, m2, m3] = [`${stamp}1`, `${stamp}2`, `${stamp}3`];
  const nombre = `E2E${stamp}`;
  // Two valid new students (so two rows can be bulk-edited after the commit),
  // a later row repeating the first matrícula (in-file duplicate) and a row
  // without apellidos (required column): 2 importable, 2 errors.
  const csv = [
    'matricula,nombre,apellidos,grado,grupo',
    `${m1},${nombre},Uno,4° Primaria,A`,
    `${m2},${nombre},Dos,4° Primaria,A`,
    `${m1},${nombre},Repetido,4° Primaria,A`,
    `${m3},${nombre},,4° Primaria,A`,
  ].join('\n');

  await login(page); // admin
  await page.goto('/admin/alumnos');
  await expect(page.getByRole('heading', { name: 'Alumnos', exact: true })).toBeVisible();

  // ── Import: dry run shows the errors ────────────────────────────────────
  await page.getByRole('button', { name: 'Más acciones' }).click();
  await page.getByRole('menuitem', { name: 'Importar archivo' }).click();
  const importDialog = page.getByRole('dialog', { name: 'Importar alumnos' });
  await importDialog.getByLabel('Elegir archivo').setInputFiles({
    name: 'alumnos_e2e.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf-8'),
  });
  await expect(importDialog.getByText('2 filas tienen errores.')).toBeVisible();
  await expect(importDialog.getByRole('button', { name: 'Crear (2)' })).toBeVisible();
  await expect(importDialog.getByRole('button', { name: 'Error (2)' })).toBeVisible();
  await expect(importDialog.getByText('Duplicado de la fila 2.')).toBeVisible();

  // The error report is the same file re-posted with report=csv.
  const reportDownload = page.waitForEvent('download');
  await importDialog.getByRole('button', { name: 'Descargar reporte de errores' }).click();
  const report = await reportDownload;
  expect(report.suggestedFilename()).toBe('reporte_alumnos.csv');
  const reportText = await readFile(await report.path(), 'utf-8');
  expect(reportText).toContain('resultado');
  expect(reportText).toContain(m3);

  // ── Commit only the valid rows ──────────────────────────────────────────
  await importDialog.getByRole('button', { name: 'Continuar' }).click();
  const commitButton = importDialog.getByRole('button', { name: 'Importar 2 filas' });
  await expect(commitButton).toBeDisabled(); // errors present, valid-only not ticked
  await importDialog.getByRole('checkbox', { name: /Importar solo las filas válidas/ }).check();
  await commitButton.click();
  await expect(importDialog.getByRole('status')).toContainText('Importación completa: 2 creados');
  await page.keyboard.press('Escape');
  await expect(importDialog).toBeHidden();

  // ── Select the two new students and change their group ──────────────────
  await page.getByRole('textbox', { name: 'Buscar alumnos', exact: true }).fill(nombre);
  // The search is debounced into ?q=, and a filter change resets the selection:
  // wait for the filtered view before ticking rows, or the reset eats a tick.
  await expect(page).toHaveURL(new RegExp(`[?&]q=${nombre}`));
  await expect(page.getByRole('heading', { name: '2 alumnos', exact: true })).toBeVisible();
  const uno = page.getByRole('checkbox', { name: `Seleccionar ${nombre} Uno` });
  const dos = page.getByRole('checkbox', { name: `Seleccionar ${nombre} Dos` });
  await uno.check();
  await dos.check();
  const bulkBar = page.getByRole('region', { name: 'Acciones en lote' });
  await expect(bulkBar).toContainText('2 alumnos seleccionados');
  await bulkBar.getByRole('button', { name: 'Cambiar grupo' }).click();

  const valueDialog = page.getByRole('dialog', { name: 'Cambiar grupo: 2 alumnos' });
  await valueDialog.getByLabel('Nuevo grupo').fill('b'); // uppercased as typed
  await valueDialog.getByRole('button', { name: 'Continuar' }).click();

  // Matched by prefix; the title keeps the count the dialog opened with.
  const confirmDialog = page.getByRole('dialog', { name: /^Cambiar grupo a «B»:/ });
  await expect(confirmDialog).toContainText('Se cambiará a «B» a 2 alumnos');
  await confirmDialog.getByRole('button', { name: 'Cambiar grupo a «B» (2)' }).click();
  await expect(confirmDialog.getByRole('status')).toContainText('2 alumnos procesados.');
  await page.keyboard.press('Escape');
  await expect(confirmDialog).toBeHidden();
  for (const apellido of ['Uno', 'Dos']) {
    await expect(page.getByRole('row', { name: new RegExp(`${nombre} ${apellido}`) }).getByRole('cell', { name: 'B', exact: true })).toBeVisible();
  }

  // ── Export the (filtered) view as Excel ─────────────────────────────────
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  const xlsxDownload = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: /Excel/ }).click();
  const xlsx = await xlsxDownload;
  expect(xlsx.suggestedFilename()).toMatch(/^alumnos_\d{4}-\d{2}-\d{2}\.xlsx$/);
  // An .xlsx is a zip: check the PK signature rather than trusting the name.
  const bytes = await readFile(await xlsx.path());
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
});
