import { test, expect, request as pwRequest, type APIRequestContext, type Page } from '@playwright/test';
import { DEV_ADMIN, login } from './helpers';

/**
 * Families (hermanos), end to end against the real dev backend: the office
 * links two siblings from a student's Familia tab (search → preview of who
 * gains access → confirm), the family shows up in Familias, and the first
 * child's own login then sees BOTH children in the portal.
 *
 * Students are created through the admin API with a unique surname per run,
 * so the spec needs nothing seeded beyond `seed_e2e_user`.
 * FAMILY_SHOTS=<dir> also saves full-page screenshots there (design review).
 */
// Trailing slash + relative paths: a leading «/» would drop the /api/v1 prefix.
const API = 'http://localhost:8800/api/v1/';
const FAMILY_PASSWORD = 'Hermanos-E2E-2026!';
const SHOTS = process.env.FAMILY_SHOTS;

/** Desktop and phone screenshots for a design review (local only, FAMILY_SHOTS set). */
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  const size = page.viewportSize() ?? { width: 1280, height: 720 };
  // Let the entrance fades finish so the shot shows what a person sees.
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/${name}-phone.png` });
  await page.setViewportSize(size);
}

async function adminApi(): Promise<APIRequestContext> {
  const anon = await pwRequest.newContext({ baseURL: API });
  const res = await anon.post('accounts/token/', { data: { email: DEV_ADMIN.email, password: DEV_ADMIN.password } });
  expect(res.ok(), await res.text()).toBeTruthy();
  const { access } = await res.json();
  await anon.dispose();
  return pwRequest.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${access}` } });
}

interface Created { id: number; userId: number; email: string; name: string }

async function createStudent(api: APIRequestContext, data: Record<string, string>): Promise<Created> {
  const res = await api.post('accounts/admin/students/', { data });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  return { id: body.id, userId: body.user.id, email: body.user.email, name: body.user.full_name };
}

test.describe('Familias (hermanos)', () => {
  test('link two siblings from the file and see both from one family login', async ({ page, browser }) => {
    const run = String(Date.now()).slice(-7);
    const surname = `Hermanos${run}`;
    const api = await adminApi();
    const ana = await createStudent(api, {
      student_id: `91${run}`, first_name: 'Ana', last_name: `${surname} Ruiz`, grade: '3° Primaria', group: 'A',
    });
    const luis = await createStudent(api, {
      student_id: `92${run}`, first_name: 'Luis', last_name: `${surname} Ruiz`, grade: '1° Secundaria', group: 'B',
    });
    const pwd = await api.post(`accounts/admin/users/${ana.userId}/set-password/`, {
      data: { password: FAMILY_PASSWORD, reason: 'e2e familias' },
    });
    expect(pwd.ok(), await pwd.text()).toBeTruthy();

    // ── the office links the siblings ────────────────────────────────────
    await login(page);
    await page.goto(`/admin/alumnos/${ana.id}`);
    await page.getByRole('tab', { name: 'Familia' }).click();
    await expect(page.getByText('Sin hermanos vinculados')).toBeVisible();
    // Same two surnames: the engine already suggests Luis.
    await expect(page.getByText('Posibles hermanos')).toBeVisible();
    await shot(page, '01-familia-vacia-con-sugerencia');

    await page.getByRole('button', { name: /Vincular hermano/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Vincular hermano' });
    await dialog.getByLabel('Buscar alumno').fill(surname);
    await dialog.getByRole('button', { name: new RegExp(`Luis ${surname}`) }).click();
    await shot(page, '02-elegir-hermano');
    await dialog.getByRole('button', { name: /Revisar \(1\)/ }).click();

    await expect(dialog.getByText('Se creará una familia nueva')).toBeVisible();
    await expect(dialog.getByText(`verá a ${luis.name}`)).toBeVisible();
    await expect(dialog.getByText(`verá a ${ana.name}`)).toBeVisible();
    await shot(page, '03-vista-previa');
    await dialog.getByRole('button', { name: 'Crear familia' }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText('2 hermanos · 2 cuentas con acceso')).toBeVisible();
    await expect(page.getByRole('link', { name: luis.name })).toHaveAttribute('href', `/admin/alumnos/${luis.id}`);
    await shot(page, '04-familia-vinculada');

    // ── the Familias table finds it by a child's name ─────────────────────
    await page.goto(`/admin/familias?q=${surname}`);
    const table = page.getByRole('table', { name: 'Familias' });
    await expect(table.getByRole('link', { name: /Luis/ })).toBeVisible();
    await expect(table.getByText('2 cuentas')).toBeVisible();
    await shot(page, '05-tabla-familias');
    await page.goto('/admin/familias?vista=sugerencias');
    await expect(page.getByRole('heading', { name: 'Familias' })).toBeVisible();
    await shot(page, '06-sugerencias');

    // ── Ana's own login now sees Luis too ─────────────────────────────────
    const family = await browser.newContext();
    const fpage = await family.newPage();
    await login(fpage, { email: ana.email, password: FAMILY_PASSWORD });
    await fpage.goto('/portal');
    await expect(fpage.getByText(/Luis/).first()).toBeVisible();
    await expect(fpage.getByText(/Ana/).first()).toBeVisible();
    await shot(fpage, '07-portal-familia');
    await fpage.goto('/portal/cafeteria');
    await expect(fpage.getByText(/Luis/).first()).toBeVisible();
    await shot(fpage, '08-cafeteria-familia');
    await family.close();

    // ── unlinking takes the access away again ─────────────────────────────
    const tab = await api.get(`accounts/admin/students/${ana.id}/family/`);
    const familyId = (await tab.json()).family.id;
    const removed = await api.delete(`accounts/admin/families/${familyId}/students/${luis.id}/`);
    expect(await removed.json()).toEqual({ dissolved: true });
    await api.dispose();
  });
});
