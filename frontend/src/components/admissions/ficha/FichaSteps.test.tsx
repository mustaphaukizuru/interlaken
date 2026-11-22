/**
 * The step-by-step presentation of the ficha (2026-11-21): every numbered
 * step reads «Paso n de 7: título» (its focused h1, «Ver los pasos», the
 * review and «Corregir»); a step is made of short titled blocks with a hint
 * that all save with that step's PATCH; on a phone the action bar
 * («Anterior» / «Guardar y continuar») is sticky, docks while the keyboard
 * is up and takes the floating WhatsApp button's place; no axe violations
 * on a 320 px screen. Titles stay editable in Contenido, and a page that
 * stored a retired default shows today's.
 *
 * Synthetic people only (fixtures/wizardKit.ts).
 */
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';

vi.mock('@/services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  contentApi: { getSettings: vi.fn(() => new Promise(() => {})) },
}));
vi.mock('@/lib/inviteExchange', () => ({ exchangeOnce: vi.fn() }));
vi.mock('@/services/analytics', () => ({
  trackEvent: vi.fn(),
  FunnelEvent: { SubmitPreRegister: 'funnel_submit_pre_registro', SubmitFicha: 'funnel_submit_ficha' },
}));

import { api } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { useAuthStore } from '@/store/authStore';
import { FichaWizard } from './FichaWizard';
import { FICHA_TEXT, defaultCopy, type FichaCopy } from './copy';
import { ALUMNO_START, CONTACT, CURP, RID, SECTIONS, completeness, fail, payload, schema } from './fixtures/wizardKit';
import type { FichaPayload, Values } from './types';

const get = vi.mocked(api.get);
const patch = vi.mocked(api.patch);

const TITLES = [
  'Paso 1 de 7: Información del alumno',
  'Paso 2 de 7: Domicilio',
  'Paso 3 de 7: Información de salud',
  'Paso 4 de 7: Información del padre',
  'Paso 5 de 7: Información de la madre',
  'Paso 6 de 7: Contacto de emergencia',
  'Paso 7 de 7: Revisión y firma',
];

const FILLED: Record<string, Values> = {
  contacto: CONTACT,
  alumno: { ...ALUMNO_START, child_curp: CURP, child_dob: '2020-05-01', child_sex: 'femenino', child_birth_country: 'México', child_birth_state: 'Ciudad de México', level: 'primaria' },
  madre: { not_applicable: false, given_names: 'Marta', paternal_surname: 'Hernández', email: CONTACT.contact_email },
  padre: { not_applicable: true },
};

/** A family's session already in the tab: the wizard opens the first step with something missing. */
function openWith(ficha: FichaPayload, copy: FichaCopy = defaultCopy) {
  get.mockImplementation((url: string) => {
    if (url === '/admissions/ficha/schema/') return Promise.resolve({ data: schema }) as never;
    if (url === `/admissions/register/${RID}/ficha/`) return Promise.resolve({ data: ficha }) as never;
    return fail(404, {}) as never;
  });
  sessionStorage.setItem('interlaken:ficha-session', JSON.stringify({ id: RID, token: 'S1', expires: '2099-01-01T00:00:00Z' }));
  return renderWithProviders(<FichaWizard copy={copy} />, { route: '/pre-registro' });
}

const savesAs = (section: string) => patch.mockImplementation((_url: string, body: unknown) => Promise.resolve({ data: {
  section, data: body as Values, completeness: completeness(SECTIONS.filter((k) => k !== 'emergencia')),
  status: 'draft', ficha_version: 2, updated_at: '2026-11-21T10:00:00Z',
} }) as never);

const actionBar = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-ficha-actions]')!;

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  useAuthStore.getState().logout();
});

describe('numbered step titles', () => {
  it('the focused h1 reads «Paso 1 de 7: Información del alumno»; the eyebrow is not read twice', async () => {
    openWith(payload({ contacto: CONTACT, alumno: ALUMNO_START }));
    const heading = await screen.findByRole('heading', { level: 1, name: TITLES[0] });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveTextContent('Información del alumno');
    expect(screen.getByText('Paso 1 de 7')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Tenga a la mano el acta de nacimiento y la CURP del alumno.')).toBeInTheDocument();
  });

  it('«Ver los pasos» lists the seven numbered titles with their state, one tap per reachable step', async () => {
    const user = userEvent.setup();
    openWith(payload(FILLED, SECTIONS));
    await screen.findByRole('heading', { level: 1, name: TITLES[6] });
    const toggle = screen.getByRole('button', { name: 'Ver los pasos' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('navigation', { name: 'Pasos de la ficha' })).not.toBeInTheDocument(); // hidden

    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Ocultar' })).toHaveAttribute('aria-expanded', 'true');
    const nav = screen.getByRole('navigation', { name: 'Pasos de la ficha' });
    const rows = within(nav).getAllByRole('listitem');
    expect(rows).toHaveLength(7);
    TITLES.forEach((title, i) => expect(rows[i]).toHaveTextContent(title));
    expect(rows[6]).toHaveTextContent('Paso actual');
    expect(within(rows[6]).getByText(/Revisión y firma/).closest('[aria-current="step"]')).not.toBeNull();
    // A done step is a button named with its number, title and state.
    await user.click(within(nav).getByRole('button', { name: /^Paso 2 de 7: Domicilio\s*, Completo$/ }));
    const heading = await screen.findByRole('heading', { level: 1, name: TITLES[1] });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Ver los pasos' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('the review numbers every section and keeps «Quién llena la ficha» (unnumbered) last', async () => {
    openWith(payload(FILLED, SECTIONS));
    await screen.findByRole('heading', { level: 1, name: TITLES[6] });
    const headings = [...TITLES.slice(0, 6), 'Quién llena la ficha'].map((name) => screen.getByRole('heading', { level: 2, name }));
    headings.reduce((prev, h) => {
      expect(prev.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      return h;
    });
    expect(screen.getByRole('region', { name: TITLES[3] })).toHaveTextContent('No aplica');
    expect(screen.getByRole('button', { name: `Editar: ${TITLES[4]}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar: Quién llena la ficha' })).toBeInTheDocument();
  });

  it('«Quién llena la ficha», opened from the review, has no number and no step list', async () => {
    const user = userEvent.setup();
    openWith(payload(FILLED, SECTIONS));
    await screen.findByRole('heading', { level: 1, name: TITLES[6] });
    await user.click(screen.getByRole('button', { name: 'Editar: Quién llena la ficha' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Quién llena la ficha' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver los pasos' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Paso \d de 7/)).not.toBeInTheDocument();
  });

  it('titles and the «Paso n de 7» pattern come from Contenido', async () => {
    const custom: FichaCopy = {
      ...defaultCopy,
      t: (k) => ({ alumnoTitle: 'Datos del menor', stepOf: 'Etapa {n} de {total}' } as Partial<Record<keyof typeof FICHA_TEXT, string>>)[k] ?? defaultCopy.t(k),
    };
    openWith(payload({ contacto: CONTACT, alumno: ALUMNO_START }), custom);
    expect(await screen.findByRole('heading', { level: 1, name: 'Etapa 1 de 7: Datos del menor' })).toBeInTheDocument();
  });
});

describe('short titled blocks', () => {
  it('Información del alumno: Nombre, Nacimiento and Escuela, each with its hint', async () => {
    openWith(payload({ contacto: CONTACT, alumno: ALUMNO_START }));
    await screen.findByRole('heading', { level: 1, name: TITLES[0] });
    const nombre = screen.getByRole('group', { name: 'Nombre' });
    expect(nombre).toHaveAccessibleDescription('Como aparecen en el acta de nacimiento.');
    expect(within(nombre).getByLabelText('Apellido paterno')).toHaveValue('López');
    expect(within(nombre).getByLabelText('Nombre(s)')).toHaveValue('Ana Sofía');
    const nacimiento = screen.getByRole('group', { name: 'Nacimiento' });
    expect(nacimiento).toHaveAccessibleDescription('Con la CURP llenamos la fecha, el sexo y el estado.');
    expect(within(nacimiento).getByLabelText('CURP')).toBeInTheDocument();
    expect(within(nacimiento).getByLabelText('Fecha de nacimiento')).toBeInTheDocument();
    expect(within(nacimiento).getByRole('link', { name: 'Consultar la CURP en gob.mx' })).toBeInTheDocument();
    const escuela = screen.getByRole('group', { name: 'Escuela' });
    expect(within(escuela).getByLabelText('Grado al que se inscribe')).toBeInTheDocument();
    expect(within(escuela).getByLabelText(/Escuela anterior/)).toBeInTheDocument();
  });

  it('Domicilio: Dirección, then Teléfono', async () => {
    openWith(payload({ contacto: CONTACT, alumno: FILLED.alumno }, ['contacto', 'alumno']));
    await screen.findByRole('heading', { level: 1, name: TITLES[1] });
    const address = screen.getByRole('group', { name: 'Dirección' });
    expect(address).toHaveAccessibleDescription('Como aparece en un recibo de luz, agua o teléfono.');
    expect(within(address).getByLabelText('Código postal')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Teléfono' })).getByLabelText(/Teléfono de casa/)).toBeInTheDocument();
  });

  it('Contacto de emergencia is one block', async () => {
    openWith(payload({ contacto: CONTACT, alumno: FILLED.alumno, padre: { not_applicable: true } }, SECTIONS.filter((k) => k !== 'emergencia')));
    await screen.findByRole('heading', { level: 1, name: TITLES[5] });
    const block = screen.getByRole('group', { name: 'Datos del contacto' });
    expect(block).toHaveAccessibleDescription('Escriba al menos un teléfono.');
    for (const label of ['Nombre(s)', 'Apellido(s)', /Parentesco/, /Celular/, /^Teléfono/]) expect(within(block).getByLabelText(label)).toBeInTheDocument();
  });

  it('Información de salud: three blocks; «¿Cuáles?» only after «Sí»', async () => {
    const user = userEvent.setup();
    openWith(payload({ contacto: CONTACT, alumno: FILLED.alumno }, ['contacto', 'alumno', 'domicilio']));
    await screen.findByRole('heading', { level: 1, name: TITLES[2] });
    expect(within(screen.getByRole('group', { name: 'Datos generales' })).getByLabelText(/Estatura/)).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Autorización' })).getByLabelText(/Autorizo al Colegio Interlaken/)).toBeInTheDocument();
    const care = screen.getByRole('group', { name: 'Alergias y padecimientos' });
    expect(within(care).queryByLabelText(/¿Cuáles\?/)).not.toBeInTheDocument();
    await user.click(within(care).getByRole('radio', { name: 'Sí' }));
    expect(within(care).getByLabelText(/¿Cuáles\?/)).toBeInTheDocument();
  });

  it('Información del padre: four blocks that all save with the step\'s one PATCH', async () => {
    const user = userEvent.setup();
    openWith(payload({ contacto: CONTACT, alumno: FILLED.alumno }, ['contacto', 'alumno', 'domicilio', 'salud']));
    await screen.findByRole('heading', { level: 1, name: TITLES[3] });
    const personal = screen.getByRole('group', { name: 'Datos personales' });
    const birth = screen.getByRole('group', { name: 'Nacimiento y CURP' });
    const work = screen.getByRole('group', { name: 'Estudios y ocupación' });
    const contact = screen.getByRole('group', { name: 'Contacto' });
    expect(within(personal).getByRole('switch', { name: 'Es tutor/a legal' })).toBeInTheDocument();
    await user.type(within(personal).getByLabelText('Nombre(s)'), 'Luis');
    await user.type(within(birth).getByLabelText('CURP'), 'RIRL850212HDFSSS05');
    await user.click(within(work).getByRole('radio', { name: 'Negocio propio' }));
    await user.type(within(contact).getByLabelText('Correo electrónico'), 'luis.ficha@ejemplo.test');

    savesAs('padre');
    await user.click(screen.getByRole('button', { name: /^Guardar y continuar$/ }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith(`/admissions/register/${RID}/ficha/padre/`, expect.objectContaining({
      given_names: 'Luis', curp: 'RIRL850212HDFSSS05', occupation: 'negocio_propio', email: 'luis.ficha@ejemplo.test',
    }), { headers: { 'X-Session-Token': 'S1' } });
  });

  it('«No aplica» folds the four blocks away', async () => {
    const user = userEvent.setup();
    openWith(payload({ contacto: CONTACT }, ['contacto', 'alumno', 'domicilio', 'salud']));
    await screen.findByRole('heading', { level: 1, name: TITLES[3] });
    await user.click(screen.getByRole('switch', { name: /No aplica/ }));
    expect(screen.getByText(/Marcó que este bloque no aplica/)).toBeInTheDocument();
    for (const name of ['Datos personales', 'Nacimiento y CURP', 'Estudios y ocupación', 'Contacto']) {
      expect(screen.queryByRole('group', { name })).not.toBeInTheDocument();
    }
  });
});

describe('the phone action bar', () => {
  afterEach(() => {
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
  });

  it('is sticky with «Anterior» and «Guardar y continuar», then «continuar después» after it', async () => {
    const { container } = openWith(payload({ ...FILLED, madre: {}, padre: {} }, ['contacto', 'alumno']));
    await screen.findByRole('heading', { level: 1, name: TITLES[1] });
    const bar = actionBar(container);
    expect(bar).toHaveAttribute('data-sticky');
    expect(bar).toHaveClass('sticky', 'bottom-0', 'sm:static');
    expect(within(bar).getByRole('button', { name: 'Anterior' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /^Guardar y continuar$/ })).toHaveAttribute('type', 'submit');
    expect(within(bar).queryByRole('button', { name: 'Guardar y continuar después' })).not.toBeInTheDocument();
    // DOM order = visual order: the bar, then «continuar después».
    const later = screen.getByRole('button', { name: 'Guardar y continuar después' });
    expect(bar.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has no «Anterior» on the first step', async () => {
    const { container } = openWith(payload({ contacto: CONTACT, alumno: ALUMNO_START }));
    await screen.findByRole('heading', { level: 1, name: TITLES[0] });
    expect(within(actionBar(container)).queryByRole('button', { name: 'Anterior' })).not.toBeInTheDocument();
  });

  it('docks at the end of the form while a field has the keyboard up, and floats again after', async () => {
    const { container } = openWith(payload({ ...FILLED, madre: {}, padre: {} }, ['contacto', 'alumno']));
    await screen.findByRole('heading', { level: 1, name: TITLES[1] });
    const bar = actionBar(container);
    act(() => { screen.getByLabelText('Calle').focus(); });
    expect(bar).not.toHaveAttribute('data-sticky');
    expect(bar).toHaveClass('static');
    act(() => { screen.getByLabelText('Colonia').focus(); }); // field to field: stays docked
    expect(bar).not.toHaveAttribute('data-sticky');
    act(() => { screen.getByRole('button', { name: 'Anterior' }).focus(); });
    expect(bar).toHaveAttribute('data-sticky');
    expect(bar).toHaveClass('sticky');
  });

  it('a focused field with the keyboard put away (visual viewport full height) keeps it floating', async () => {
    const listeners = new Set<() => void>();
    const vv = {
      height: 800, scale: 1,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    };
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    const { container } = openWith(payload({ ...FILLED, madre: {}, padre: {} }, ['contacto', 'alumno']));
    await screen.findByRole('heading', { level: 1, name: TITLES[1] });
    const bar = actionBar(container);
    act(() => { screen.getByLabelText('Calle').focus(); });
    expect(bar).toHaveAttribute('data-sticky');
    // The keyboard comes up: the visual viewport shrinks.
    act(() => { vv.height = 420; listeners.forEach((fn) => fn()); });
    expect(bar).not.toHaveAttribute('data-sticky');
    act(() => { vv.height = 800; listeners.forEach((fn) => fn()); });
    expect(bar).toHaveAttribute('data-sticky');
  });

  it('marks <html> while the steps show, so the floating WhatsApp button steps aside on a phone', async () => {
    const { unmount } = openWith(payload({ contacto: CONTACT, alumno: ALUMNO_START }));
    await screen.findByRole('heading', { level: 1, name: TITLES[0] });
    expect(document.documentElement).toHaveAttribute('data-ficha-steps');
    unmount();
    expect(document.documentElement).not.toHaveAttribute('data-ficha-steps');
  });

  it('Enter in a field still sends the step', async () => {
    openWith(payload({ ...FILLED, madre: {}, padre: {} }, ['contacto', 'alumno']));
    await screen.findByRole('heading', { level: 1, name: TITLES[1] });
    savesAs('domicilio');
    fireEvent.submit(screen.getByLabelText('Calle').closest('form')!);
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/admissions/register/${RID}/ficha/domicilio/`, expect.anything(), expect.anything()));
  });
});

describe('accessibility on a 320 px phone (axe)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 320, configurable: true });
    window.dispatchEvent(new Event('resize'));
  });
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
  });
  // Rendered without the page around it: no <main> landmark to sit in.
  const run = async (container: HTMLElement) => (await axe(container, { rules: { region: { enabled: false } } })).violations;

  it('a step with its blocks and the list of steps open', async () => {
    const user = userEvent.setup();
    const { container } = openWith(payload({ contacto: CONTACT, alumno: FILLED.alumno }, ['contacto', 'alumno', 'domicilio', 'salud']));
    await screen.findByRole('heading', { level: 1, name: TITLES[3] });
    await user.click(screen.getByRole('button', { name: 'Ver los pasos' }));
    expect(await run(container)).toEqual([]);
  });

  it('a step with its error summary', async () => {
    const user = userEvent.setup();
    const { container } = openWith(payload({ contacto: CONTACT, alumno: ALUMNO_START }));
    await screen.findByRole('heading', { level: 1, name: TITLES[0] });
    patch.mockImplementation((_url: string, body: unknown) => Promise.resolve({ data: {
      section: 'alumno', data: body as Values,
      completeness: { ...completeness(['contacto']), sections: { ...completeness(['contacto']).sections, alumno: { complete: false, missing: ['child_dob', 'child_sex'] } } },
      status: 'draft', ficha_version: 2, updated_at: '2026-11-21T10:00:00Z',
    } }) as never);
    await user.click(screen.getByRole('button', { name: /^Guardar y continuar$/ }));
    await screen.findByRole('alert');
    expect(await run(container)).toEqual([]);
  });

  it('the review and signature', async () => {
    const { container } = openWith(payload(FILLED, SECTIONS));
    await screen.findByRole('heading', { level: 1, name: TITLES[6] });
    expect(await run(container)).toEqual([]);
  });
});

describe('Contenido: a page that stored a retired default', () => {
  it('shows today\'s title; a title the school wrote itself wins', async () => {
    const { sectionSpec } = await import('@/cms/sections');
    const { loadAllGroups } = await import('@/cms/sections/loaders');
    await loadAllGroups();
    const spec = sectionSpec('preregistro.form')!;
    const Form = spec.component as ComponentType<Record<string, unknown>>;
    get.mockImplementation((url: string) => {
      if (url === '/admissions/ficha/schema/') return Promise.resolve({ data: schema }) as never;
      if (url === `/admissions/register/${RID}/ficha/`) return Promise.resolve({ data: payload({ contacto: CONTACT, alumno: ALUMNO_START }) }) as never;
      return fail(404, {}) as never;
    });
    sessionStorage.setItem('interlaken:ficha-session', JSON.stringify({ id: RID, token: 'S1', expires: '2099-01-01T00:00:00Z' }));
    const stored = { ...spec.defaults, alumnoTitle: 'Datos del alumno', backLabel: 'Atrás', alumnoNameTitle: 'Nombre completo' };
    const { unmount } = renderWithProviders(<Form {...stored} />, { route: '/pre-registro' });
    expect(await screen.findByRole('heading', { level: 1, name: TITLES[0] })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Nombre completo' })).toBeInTheDocument();
    unmount();
  }, 30_000);
});
