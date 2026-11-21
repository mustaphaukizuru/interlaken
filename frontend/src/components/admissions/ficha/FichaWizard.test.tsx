/**
 * The ficha de inscripción wizard against a mocked API: the private ficha
 * (no link: «La ficha de inscripción es personal», the default since
 * 2026-11-21), the public start when Ajustes allows it, per-step saves
 * (format errors, missing data, CURP auto-fill), «Reciba uno nuevo», the
 * submit with an «incomplete» answer, and a staff link that skips step 0
 * with its data prefilled.
 *
 * The schema is the server's own (fixtures/schema.json, exported from
 * ficha_schema.schema_json for 2026-11-20); regenerate it when the schema
 * changes. Synthetic people only; the CURP carries a valid check digit.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
import { exchangeOnce } from '@/lib/inviteExchange';
import { trackEvent } from '@/services/analytics';
import { renderWithProviders } from '@/test/renderWithProviders';
import { useAuthStore, type User } from '@/store/authStore';
import { FichaWizard } from './FichaWizard';
import { defaultCopy } from './copy';
import schemaJson from './fixtures/schema.json';
import type { Completeness, FichaPayload, FichaSchema, Values } from './types';

const schema = schemaJson as unknown as FichaSchema;
const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const patch = vi.mocked(api.patch);
const exchange = vi.mocked(exchangeOnce);

const CURP = 'LOHA200501MDFRRNA5'; // 2020-05-01 · femenino · Ciudad de México (backend-generated)
const RID = 7;

const SECTIONS = ['contacto', 'alumno', 'domicilio', 'salud', 'padre', 'madre', 'emergencia'];

function blankSection(key: string): Values {
  const step = schema.steps.find((s) => s.key === key)!;
  return Object.fromEntries(step.fields.map((f) => [f.name, f.type === 'boolean' ? false : f.type === 'date' ? null : '']));
}

function completeness(done: string[] = []): Completeness {
  return {
    sections: Object.fromEntries(SECTIONS.map((k) => [k, { complete: done.includes(k), missing: done.includes(k) ? [] : ['x'] }])),
    complete: done.length === SECTIONS.length,
  };
}

function payload(sections: Record<string, Values> = {}, done: string[] = ['contacto']): FichaPayload {
  return {
    id: RID, status: 'draft', status_label: 'Borrador', ficha_version: 2, editable: true,
    child_name: 'Ana Sofía López Hernández', level: 'primaria', level_label: 'Primaria', cycle: '2026-2027',
    pre_registration: 3,
    sections: Object.fromEntries(SECTIONS.map((k) => [k, { ...blankSection(k), ...(sections[k] ?? {}) }])),
    medical_masked: false,
    firma: { privacy_accepted_at: null, privacy_notice_version: '', signed_name: '', signed_at: null, consent_photos_media: false },
    completeness: completeness(done),
    submitted_at: null, created_at: '2026-11-20T10:00:00Z', updated_at: '2026-11-20T10:00:00Z',
  };
}

const CONTACT = {
  contact_name: 'Marta Hernández Gil', contact_email: 'marta.ficha@ejemplo.test', contact_phone: '5511112222', contact_relationship: 'Madre',
};
const ALUMNO_START = { child_given_names: 'Ana Sofía', child_paternal_surname: 'López', child_maternal_surname: 'Hernández', grade_applying: '1° Primaria', cycle: '2026-2027' };

const fail = (status: number, data: unknown) => Promise.reject({ response: { status, data } });

/** api.get by URL: the schema, and the ficha of RID. */
function serve(ficha: FichaPayload | null, s: FichaSchema = schema) {
  get.mockImplementation((url: string) => {
    if (url === '/admissions/ficha/schema/') return Promise.resolve({ data: s }) as never;
    if (url === `/admissions/register/${RID}/ficha/` && ficha) return Promise.resolve({ data: ficha }) as never;
    return fail(404, { detail: 'No encontrado.' }) as never;
  });
}

const renderWizard = (route = '/pre-registro') => renderWithProviders(<FichaWizard copy={defaultCopy} />, { route });

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  useAuthStore.getState().logout();
});

/** A signed-in account; `access: null` = remembered, the session not restored yet. */
function signIn(role: User['role'], staffAreas: string[] = [], access: string | null = 'A1') {
  useAuthStore.setState({
    user: {
      id: 1, email: `${role}@ejemplo.test`, first_name: 'Ana', last_name: 'Prueba', full_name: 'Ana Prueba', role,
      avatar: '', whatsapp: '', staff_areas: staffAreas,
    },
    isAuthenticated: true,
    accessToken: access,
  });
}

describe('FichaWizard · public start', () => {
  it('asks for the missing data, then starts the ficha and opens the alumno step', async () => {
    const user = userEvent.setup();
    serve(null);
    post.mockImplementation((url: string) => {
      if (url === '/admissions/register/') {
        return Promise.resolve({ data: {
          id: RID, session_token: 'S1', session_expires_at: '2099-01-01T00:00:00Z', status: 'draft', cycle: '2026-2027', pre_registration: 3,
          ficha: payload({ contacto: CONTACT, alumno: ALUMNO_START }),
        } }) as never;
      }
      return fail(404, {}) as never;
    });
    renderWizard();

    expect(await screen.findByRole('heading', { name: 'Antes de empezar' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Comenzar la ficha/ }));
    const summary = await screen.findByRole('alert');
    expect(within(summary).getByText('Revise estos datos para continuar:')).toBeInTheDocument();
    expect(within(summary).getByRole('link', { name: 'Nombre completo' })).toBeInTheDocument();
    await waitFor(() => expect(summary).toHaveFocus());
    expect(post).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Nombre completo'), CONTACT.contact_name);
    await user.type(screen.getByLabelText('Correo electrónico'), CONTACT.contact_email);
    await user.type(screen.getByLabelText('Celular'), '55 1111 2222');
    await user.click(screen.getByRole('radio', { name: 'Madre' }));
    await user.type(screen.getByLabelText('Nombre(s) del alumno'), 'Ana Sofía');
    await user.type(screen.getByLabelText('Apellido paterno del alumno'), 'López');
    await user.selectOptions(screen.getByLabelText('Grado al que se inscribe'), '1° Primaria');
    await user.click(screen.getByRole('radio', { name: /2026-2027/ }));
    await user.click(screen.getByRole('button', { name: /Comenzar la ficha/ }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/admissions/register/', expect.objectContaining({
      contact_name: CONTACT.contact_name, contact_email: CONTACT.contact_email, contact_relationship: 'Madre',
      child_given_names: 'Ana Sofía', child_paternal_surname: 'López', grade_applying: '1° Primaria', cycle: '2026-2027', wants_visit: false,
    })));
    const heading = await screen.findByRole('heading', { name: 'Datos del alumno' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByLabelText('Apellido paterno')).toHaveValue('López');
    expect(screen.getByText('Paso 1 de 7')).toBeInTheDocument();
    expect(trackEvent).toHaveBeenCalledWith('funnel_submit_pre_registro', { grade: '1° Primaria' });
    expect(JSON.parse(sessionStorage.getItem('interlaken:ficha-session')!)).toMatchObject({ id: RID, token: 'S1' });
  });

  it('sends a new link with the same neutral answer', async () => {
    const user = userEvent.setup();
    serve(null);
    post.mockResolvedValue({ data: { detail: 'Si hay una ficha…' } } as never);
    renderWizard();
    await user.click(await screen.findByRole('button', { name: '¿Ya recibió su enlace y venció? Reciba uno nuevo' }));
    await user.type(screen.getByLabelText('Correo electrónico', { selector: 'input[autocomplete="email"]:not([name])' }), 'nadie@ejemplo.test');
    await user.click(screen.getByRole('button', { name: 'Enviar enlace' }));
    expect(post).toHaveBeenCalledWith('/admissions/register/resume/', { email: 'nadie@ejemplo.test' });
    expect(await screen.findByText(/Si hay una ficha en proceso con ese correo/)).toBeInTheDocument();
  });

  it('switches to «La ficha de inscripción es personal» when the server refuses the start (403)', async () => {
    const user = userEvent.setup();
    serve(null);
    post.mockImplementation(() => fail(403, { detail: 'Solo con enlace.', code: 'public_start_disabled' }) as never);
    renderWizard();
    await screen.findByRole('heading', { name: 'Antes de empezar' });
    await user.type(screen.getByLabelText('Nombre completo'), CONTACT.contact_name);
    await user.type(screen.getByLabelText('Correo electrónico'), CONTACT.contact_email);
    await user.type(screen.getByLabelText('Celular'), '5511112222');
    await user.click(screen.getByRole('radio', { name: 'Madre' }));
    await user.type(screen.getByLabelText('Nombre(s) del alumno'), 'Ana');
    await user.type(screen.getByLabelText('Apellido paterno del alumno'), 'López');
    await user.selectOptions(screen.getByLabelText('Grado al que se inscribe'), '1° Primaria');
    await user.click(screen.getByRole('radio', { name: /2027-2028/ }));
    await user.click(screen.getByRole('button', { name: /Comenzar la ficha/ }));
    expect(await screen.findByRole('heading', { name: 'La ficha de inscripción es personal' })).toBeInTheDocument();
  });
});

describe('FichaWizard · private ficha (no link)', () => {
  it('explains the process and offers a visit, WhatsApp and a new link', async () => {
    const user = userEvent.setup();
    serve(null, { ...schema, public_start_enabled: false });
    renderWizard();
    const heading = await screen.findByRole('heading', { level: 2, name: 'La ficha de inscripción es personal' });
    expect(heading).toBeInTheDocument();
    expect(screen.getByText(/El colegio envía la ficha de inscripción por correo o WhatsApp a cada familia cuando su hijo\/a es admitido\./)).toBeInTheDocument();
    // The three steps that lead to the ficha, in order.
    const steps = within(screen.getByRole('list', { name: 'Así es el proceso de admisión' })).getAllByRole('listitem');
    expect(steps.map((li) => li.textContent)).toEqual([
      '1Agende una visita o solicite informes.',
      '2Su hijo/a presenta el examen de valoración.',
      '3Si su hijo/a es admitido, el colegio le envía su ficha de inscripción por correo o WhatsApp.',
    ]);
    expect(screen.getByRole('link', { name: 'Agendar visita' })).toHaveAttribute('href', '/agendar-visita');
    const wa = screen.getByRole('link', { name: /Escribir por WhatsApp/ });
    expect(wa.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/\d+\?text=/);
    expect(decodeURIComponent(wa.getAttribute('href')!)).toContain('recibir informes de admisión');
    expect(screen.getByRole('link', { name: '(55) 5379-1188' })).toHaveAttribute('href', 'tel:+525553791188');
    // Nothing of the form, and no way to start one.
    expect(screen.queryByRole('heading', { name: 'Antes de empezar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Comenzar la ficha/ })).not.toBeInTheDocument();
    // A family whose link expired asks for a new one (the same neutral answer).
    post.mockResolvedValue({ data: { detail: 'Si hay una ficha…' } } as never);
    await user.click(screen.getByRole('button', { name: '¿Ya recibió su enlace y venció? Reciba uno nuevo' }));
    await user.type(screen.getByLabelText('Correo electrónico'), 'marta.ficha@ejemplo.test');
    await user.click(screen.getByRole('button', { name: 'Enviar enlace' }));
    expect(post).toHaveBeenCalledWith('/admissions/register/resume/', { email: 'marta.ficha@ejemplo.test' });
    expect(await screen.findByText(/Si hay una ficha en proceso con ese correo/)).toBeInTheDocument();
  });

  it('a valid link still opens the ficha when the public start is off', async () => {
    serve(payload({ contacto: CONTACT, alumno: ALUMNO_START }), { ...schema, public_start_enabled: false });
    exchange.mockResolvedValue({ data: { session_token: 'S9', expires_at: '2099-01-01T00:00:00Z' } } as never);
    renderWizard(`/pre-registro?rid=${RID}&token=un-token-de-prueba`);
    expect(await screen.findByRole('heading', { name: 'Datos del alumno' })).toBeInTheDocument();
    expect(exchange).toHaveBeenCalledWith(RID, 'un-token-de-prueba');
    expect(screen.queryByRole('heading', { name: 'La ficha de inscripción es personal' })).not.toBeInTheDocument();
  });

  it('a session this tab already holds reopens the ficha too', async () => {
    serve(payload({ contacto: CONTACT, alumno: ALUMNO_START }), { ...schema, public_start_enabled: false });
    sessionStorage.setItem('interlaken:ficha-session', JSON.stringify({ id: RID, token: 'S8', expires: '2099-01-01T00:00:00Z' }));
    renderWizard();
    expect(await screen.findByRole('heading', { name: 'Datos del alumno' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'La ficha de inscripción es personal' })).not.toBeInTheDocument();
  });

  it('the private copy has no em dashes', () => {
    for (const key of ['privateTitle', 'privateText', 'privateStepsTitle', 'privateWhatsapp', 'privateWaMessage', 'privateCall', 'resumeToggle', 'resumeText'] as const) {
      expect(defaultCopy.t(key)).not.toMatch(/[\u2014\u2013]/);
    }
    for (const step of defaultCopy.list('privateSteps')) expect(step).not.toMatch(/[\u2014\u2013]/);
  });
});

describe('FichaWizard · staff link and saving', () => {
  const invited = () => {
    serve(payload({ contacto: CONTACT, alumno: { ...ALUMNO_START, grade_applying: 'Primaria 1°' } }));
    exchange.mockResolvedValue({ data: { session_token: 'S2', expires_at: '2099-01-01T00:00:00Z' } } as never);
    return renderWizard(`/pre-registro?rid=${RID}&token=un-token-de-prueba`);
  };

  it('exchanges the link once, skips step 0 and opens the prefilled alumno step', async () => {
    invited();
    expect(await screen.findByRole('heading', { name: 'Datos del alumno' })).toBeInTheDocument();
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(exchange).toHaveBeenCalledWith(RID, 'un-token-de-prueba');
    expect(get).toHaveBeenCalledWith(`/admissions/register/${RID}/ficha/`, { headers: { 'X-Session-Token': 'S2' } });
    expect(screen.queryByRole('heading', { name: 'Antes de empezar' })).not.toBeInTheDocument();
    expect(screen.getByText('Su ficha ya tiene los primeros datos.')).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre(s)')).toHaveValue('Ana Sofía');
    // The old spelling of the grade («Primaria 1°») shows as the schema's option.
    expect(screen.getByLabelText('Grado al que se inscribe')).toHaveValue('1° Primaria');
  });

  it('fills birth date, sex and state from the CURP, saves the step and moves on', async () => {
    const user = userEvent.setup();
    invited();
    await screen.findByRole('heading', { name: 'Datos del alumno' });
    await user.type(screen.getByLabelText('CURP'), CURP.toLowerCase());
    expect(screen.getByLabelText('Fecha de nacimiento')).toHaveValue('2020-05-01');
    expect(screen.getByRole('radio', { name: 'Femenino' })).toBeChecked();
    expect(screen.getByLabelText('Estado de nacimiento')).toHaveValue('Ciudad de México');
    expect(screen.getByText(/Llenamos la fecha de nacimiento, el sexo y el estado con la CURP/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /2026-2027/ }));

    patch.mockImplementation((_url: string, body: unknown) => Promise.resolve({ data: {
      section: 'alumno', data: { ...(body as Values), level: 'primaria' }, completeness: completeness(['contacto', 'alumno']),
      status: 'draft', ficha_version: 2, updated_at: '2026-11-20T10:05:00Z',
    } }) as never);
    await user.click(screen.getByRole('button', { name: /Guardar y continuar$/ }));

    expect(patch).toHaveBeenCalledWith(`/admissions/register/${RID}/ficha/alumno/`, expect.objectContaining({
      child_curp: CURP, child_dob: '2020-05-01', child_sex: 'femenino', child_birth_country: 'México',
      child_birth_state: 'Ciudad de México', grade_applying: '1° Primaria',
    }), { headers: { 'X-Session-Token': 'S2' } });
    expect(await screen.findByRole('heading', { name: 'Domicilio' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Guardado');
  });

  it('shows the server format errors next to the field and in the summary', async () => {
    const user = userEvent.setup();
    invited();
    await screen.findByRole('heading', { name: 'Datos del alumno' });
    patch.mockImplementation(() => fail(400, { child_curp: ['El último dígito de la CURP no corresponde a los demás.'] }) as never);
    await user.click(screen.getByRole('button', { name: /Guardar y continuar$/ }));
    const summary = await screen.findByRole('alert');
    expect(within(summary).getByRole('link', { name: 'CURP' })).toHaveAttribute('href', `#ficha-alumno-child_curp`);
    expect(screen.getByLabelText('CURP')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('heading', { name: 'Datos del alumno' })).toBeInTheDocument();
  });

  it('stays on the step and names what is missing after a save', async () => {
    const user = userEvent.setup();
    invited();
    await screen.findByRole('heading', { name: 'Datos del alumno' });
    patch.mockImplementation((_url: string, body: unknown) => Promise.resolve({ data: {
      section: 'alumno', data: body as Values,
      completeness: { ...completeness(['contacto']), sections: { ...completeness(['contacto']).sections, alumno: { complete: false, missing: ['child_dob'] } } },
      status: 'draft', ficha_version: 2, updated_at: '2026-11-20T10:05:00Z',
    } }) as never);
    await user.click(screen.getByRole('button', { name: /Guardar y continuar$/ }));
    const summary = await screen.findByRole('alert');
    expect(within(summary).getByRole('link', { name: 'Fecha de nacimiento' })).toBeInTheDocument();
    expect(within(summary).getByText(/Este dato es obligatorio/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Datos del alumno' })).toBeInTheDocument();
  });

  it('a block marked «No aplica» with data asks first, then collapses', async () => {
    const user = userEvent.setup();
    serve(payload({ contacto: CONTACT, padre: { paternal_surname: 'Ríos' } }, ['contacto', 'alumno', 'domicilio', 'salud']));
    sessionStorage.setItem('interlaken:ficha-session', JSON.stringify({ id: RID, token: 'S3', expires: '2099-01-01T00:00:00Z' }));
    renderWizard();
    expect(await screen.findByRole('heading', { name: 'Datos del padre' })).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: /No aplica/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Sí, no aplica' }));
    expect(screen.getByText(/Marcó que este bloque no aplica/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Apellido paterno')).not.toBeInTheDocument();
  });
});

describe('FichaWizard · review and submit', () => {
  const filled = {
    contacto: CONTACT,
    alumno: { ...ALUMNO_START, child_curp: CURP, child_dob: '2020-05-01', child_sex: 'femenino', child_birth_country: 'México', child_birth_state: 'Ciudad de México', level: 'primaria' },
    madre: { not_applicable: false, given_names: 'Marta', paternal_surname: 'Hernández', email: CONTACT.contact_email },
    padre: { not_applicable: true },
  };

  it('maps an «incomplete» answer back to its step and field', async () => {
    const user = userEvent.setup();
    serve(payload(filled, SECTIONS));
    sessionStorage.setItem('interlaken:ficha-session', JSON.stringify({ id: RID, token: 'S4', expires: '2099-01-01T00:00:00Z' }));
    post.mockImplementation(() => fail(400, {
      detail: 'Faltan datos.', code: 'incomplete',
      sections: { alumno: { child_curp: ['La CURP indica que la fecha de nacimiento es 01/05/2020.'] } },
    }) as never);
    renderWizard();

    expect(await screen.findByRole('heading', { name: 'Revisión y firma' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Datos del padre' }).closest('section')).toHaveTextContent('No aplica');
    // Signature first: the form checks it before asking the server.
    await user.click(screen.getByRole('button', { name: 'Enviar la ficha de inscripción' }));
    expect(await screen.findByText('Debe aceptar el Aviso de Privacidad para enviar la ficha.', { selector: 'p' })).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();

    await user.click(screen.getByLabelText(/He leído y acepto el Aviso de Privacidad/));
    await user.type(screen.getByLabelText('Nombre completo de quien firma'), 'Marta Hernández Gil');
    await user.click(screen.getByRole('button', { name: 'Enviar la ficha de inscripción' }));
    expect(post).toHaveBeenCalledWith(`/admissions/register/${RID}/submit/`,
      { accept_privacy: true, signed_name: 'Marta Hernández Gil', consent_photos_media: false }, { headers: { 'X-Session-Token': 'S4' } });

    const summary = await screen.findByRole('alert');
    expect(within(summary).getByText('Faltan datos en algunas secciones')).toBeInTheDocument();
    await user.click(within(summary).getByRole('button', { name: 'Corregir' }));
    expect(await screen.findByRole('heading', { name: 'Datos del alumno' })).toBeInTheDocument();
    expect(screen.getByText(/La CURP indica que la fecha de nacimiento es 01\/05\/2020/, { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Guardar y volver a la revisión/ })).toBeInTheDocument();
  });

  it('confirms the sent ficha and forgets the session', async () => {
    const user = userEvent.setup();
    serve(payload(filled, SECTIONS));
    sessionStorage.setItem('interlaken:ficha-session', JSON.stringify({ id: RID, token: 'S5', expires: '2099-01-01T00:00:00Z' }));
    post.mockResolvedValue({ data: { status: 'submitted', message: 'Ficha de inscripción enviada.', submitted_at: '2026-11-20T11:00:00Z' } } as never);
    renderWizard();
    await screen.findByRole('heading', { name: 'Revisión y firma' });
    await user.click(screen.getByLabelText(/He leído y acepto el Aviso de Privacidad/));
    await user.click(screen.getByLabelText(/Autorizo el uso de fotografías/));
    await user.type(screen.getByLabelText('Nombre completo de quien firma'), 'Marta Hernández Gil');
    await user.click(screen.getByRole('button', { name: 'Enviar la ficha de inscripción' }));
    expect(await screen.findByRole('heading', { name: 'Recibimos su ficha de inscripción' })).toBeInTheDocument();
    expect(screen.getByText('Ana Sofía López Hernández')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ver los documentos requeridos/ })).toHaveAttribute('href', '/admisiones/documentacion');
    expect(sessionStorage.getItem('interlaken:ficha-session')).toBeNull();
    expect(trackEvent).toHaveBeenCalledWith('funnel_submit_ficha', { grade: '1° Primaria' });
  });
});

describe('FichaWizard · the school staff (Vista del personal)', () => {
  const privateSchema = () => ({ ...schema, public_start_enabled: false });

  it.each([
    ['an administrator', 'admin', []],
    ['staff with the «admisiones» area', 'staff', ['admisiones']],
  ] as const)('%s sees the whole ficha with the staff banner, the switch off', async (_who, role, areas) => {
    signIn(role, [...areas]);
    serve(null, privateSchema());
    renderWizard();
    expect(await screen.findByRole('heading', { name: 'Antes de empezar' })).toBeInTheDocument();
    const banner = screen.getByRole('complementary', { name: 'Vista del personal' });
    expect(banner).toHaveTextContent('Vista del personal: las familias solo pueden abrir esta ficha con su enlace personal. Desde aquí puede llenarla con una familia en la oficina.');
    expect(within(banner).getByRole('link', { name: /Ir a Expedientes/ })).toHaveAttribute('href', '/admin/admisiones');
    expect(screen.queryByRole('heading', { name: 'La ficha de inscripción es personal' })).not.toBeInTheDocument();
  });

  it('starts a ficha for a family and keeps the banner (no website conversion tracked)', async () => {
    const user = userEvent.setup();
    signIn('staff', ['admisiones']);
    serve(null, privateSchema());
    post.mockImplementation((url: string) => {
      if (url === '/admissions/register/') {
        return Promise.resolve({ data: {
          id: RID, session_token: 'S1', session_expires_at: '2099-01-01T00:00:00Z', status: 'draft', cycle: '2026-2027', pre_registration: 3,
          ficha: payload({ contacto: CONTACT, alumno: ALUMNO_START }),
        } }) as never;
      }
      return fail(404, {}) as never;
    });
    renderWizard();
    await screen.findByRole('heading', { name: 'Antes de empezar' });
    await user.type(screen.getByLabelText('Nombre completo'), CONTACT.contact_name);
    await user.type(screen.getByLabelText('Correo electrónico'), CONTACT.contact_email);
    await user.type(screen.getByLabelText('Celular'), '5511112222');
    await user.click(screen.getByRole('radio', { name: 'Madre' }));
    await user.type(screen.getByLabelText('Nombre(s) del alumno'), 'Ana Sofía');
    await user.type(screen.getByLabelText('Apellido paterno del alumno'), 'López');
    await user.selectOptions(screen.getByLabelText('Grado al que se inscribe'), '1° Primaria');
    await user.click(screen.getByRole('radio', { name: /2026-2027/ }));
    await user.click(screen.getByRole('button', { name: /Comenzar la ficha/ }));
    expect(await screen.findByRole('heading', { name: 'Datos del alumno' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Vista del personal' })).toBeInTheDocument();
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it.each([
    ['a family (parent account)', 'parent', []],
    ['staff without the «admisiones» area', 'staff', ['visitas']],
  ] as const)('%s keeps seeing «La ficha de inscripción es personal»', async (_who, role, areas) => {
    signIn(role, [...areas]);
    serve(null, privateSchema());
    renderWizard();
    expect(await screen.findByRole('heading', { name: 'La ficha de inscripción es personal' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Antes de empezar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Vista del personal' })).not.toBeInTheDocument();
  });

  it('an anonymous visitor never sees the form, not even for a moment', async () => {
    serve(null, privateSchema());
    renderWizard();
    // Every render on the way to the panel: never the start form, never the banner.
    expect(screen.queryByRole('heading', { name: 'Antes de empezar' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'La ficha de inscripción es personal' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Antes de empezar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Vista del personal' })).not.toBeInTheDocument();
  });

  it('a remembered staff login waits for the session: loading, then the form', async () => {
    signIn('admin', [], null);
    serve(null, privateSchema());
    renderWizard();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/admissions/ficha/schema/'));
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Antes de empezar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'La ficha de inscripción es personal' })).not.toBeInTheDocument();
    act(() => { useAuthStore.getState().setAccess('A2'); });
    expect(await screen.findByRole('heading', { name: 'Antes de empezar' })).toBeInTheDocument();
  });

  it('a remembered login whose session cannot be restored gets the private panel', async () => {
    signIn('staff', ['admisiones'], null);
    serve(null, privateSchema());
    renderWizard();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/admissions/ficha/schema/'));
    expect(screen.queryByRole('heading', { name: 'Antes de empezar' })).not.toBeInTheDocument();
    act(() => { useAuthStore.getState().logout(); });
    expect(await screen.findByRole('heading', { name: 'La ficha de inscripción es personal' })).toBeInTheDocument();
  });

  it('with a family link, staff see that family\'s ficha (no banner)', async () => {
    signIn('admin');
    serve(payload({ contacto: CONTACT, alumno: ALUMNO_START }), privateSchema());
    exchange.mockResolvedValue({ data: { session_token: 'S7', expires_at: '2099-01-01T00:00:00Z' } } as never);
    renderWizard(`/pre-registro?rid=${RID}&token=un-token-de-prueba`);
    expect(await screen.findByRole('heading', { name: 'Datos del alumno' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Vista del personal' })).not.toBeInTheDocument();
  });
});
