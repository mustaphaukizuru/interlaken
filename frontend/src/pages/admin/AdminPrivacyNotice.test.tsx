import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/legalNoticesApi', () => ({
  legalNoticesApi: { list: vi.fn(), get: vi.fn(), createDraft: vi.fn(), update: vi.fn(), discard: vi.fn(), publish: vi.fn() },
}));

import { legalNoticesApi } from '@/services/legalNoticesApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import AdminPrivacyNotice from './AdminPrivacyNotice';

const api = vi.mocked(legalNoticesApi);

// Dummy notice text with three parts (the page shows it by parts).
const BODY = 'Texto de prueba.\n\nPRIMER APARTADO DEL AVISO DE PRUEBA\n\nUno.\n\nSEGUNDO APARTADO DEL AVISO DE PRUEBA\n\nDos.\n\nTERCER APARTADO DEL AVISO DE PRUEBA\n\nTres.';
const base = { title: 'Aviso de Privacidad', integral_notice_url: '', created_at: '2026-07-09T10:00:00Z', registration_count: 0 };
const CURRENT = { ...base, id: 3, version: '2026.3', body: BODY, effective_date: '2026-07-09', is_active: true, status: 'vigente' as const, published_at: '2026-07-09T10:00:00Z', consent_count: 41, registration_count: 12 };
const OLD = { ...base, id: 1, version: '2026.1', effective_date: '2026-01-10', is_active: false, status: 'anterior' as const, published_at: '2026-01-10T10:00:00Z', consent_count: 7 };
const DRAFT = { ...base, id: 4, version: '2026.4', body: BODY, effective_date: '2026-11-20', is_active: false, status: 'borrador' as const, published_at: null, consent_count: 0 };

const open = (route: string) => renderWithProviders(
  <Routes>
    <Route path="/admin/aviso-privacidad" element={<AdminPrivacyNotice />} />
    <Route path="/admin/aviso-privacidad/:id" element={<AdminPrivacyNotice />} />
  </Routes>,
  { route },
);

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue({ data: { results: [CURRENT, OLD], current_id: 3 } } as never);
  api.get.mockImplementation(async (id: number) => ({ data: [CURRENT, { ...OLD, body: BODY }, DRAFT].find((v) => v.id === id) }) as never);
  api.createDraft.mockResolvedValue({ data: DRAFT } as never);
  api.update.mockImplementation(async (_id: number, patch) => ({ data: { ...DRAFT, ...patch } }) as never);
  api.publish.mockResolvedValue({ data: { ...DRAFT, status: 'vigente', is_active: true } } as never);
});

describe('AdminPrivacyNotice (/admin/aviso-privacidad)', () => {
  it('shows the current version with its consents and every version with its status', async () => {
    open('/admin/aviso-privacidad');
    expect(await screen.findByText('2026.3', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('41 consentimientos')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Versiones del aviso de privacidad' });
    expect(within(list).getByText('Vigente')).toBeInTheDocument();
    expect(within(list).getByText('Anterior')).toBeInTheDocument();
    expect(within(list).getByRole('link', { name: 'Ver la versión 2026.1' })).toHaveAttribute('href', '/admin/aviso-privacidad/1');
  });

  it('«Nueva versión» creates a draft from the current text and opens it', async () => {
    const user = userEvent.setup();
    open('/admin/aviso-privacidad');
    await user.click(await screen.findByRole('button', { name: /Nueva versión/ }));
    expect(api.createDraft).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('heading', { name: 'Borrador 2026.4' })).toBeInTheDocument();
    expect(screen.getByLabelText('Texto antes del primer apartado')).toHaveValue('Texto de prueba.');
    // Titles show as on the page; they are stored in capitals.
    expect(screen.getAllByLabelText('Título del apartado')[0]).toHaveValue('Primer apartado del aviso de prueba');
  });

  it('a version that does not exist (404) says so with the way back (QA 2026-11-24)', async () => {
    api.get.mockRejectedValue({ isAxiosError: true, response: { status: 404, data: { detail: 'No encontrado.' } } });
    open('/admin/aviso-privacidad/999');
    expect(await screen.findByText('No encontramos este registro')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver todas las versiones' })).toHaveAttribute('href', '/admin/aviso-privacidad');
    expect(screen.queryByRole('button', { name: /Reintentar/i })).toBeNull();
  });

  it('a published version is read-only and previews the public page', async () => {
    open('/admin/aviso-privacidad/1');
    expect(await screen.findByText(/Su texto quedó fijo/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    const preview = screen.getByRole('region', { name: 'Vista previa' });
    expect(within(preview).getByText('Primer apartado del aviso de prueba')).toBeInTheDocument();
  });

  it('edits a part, saves only the changed text, and publishes after the explained confirmation', async () => {
    const user = userEvent.setup();
    open('/admin/aviso-privacidad/4');
    const intro = await screen.findByLabelText('Texto antes del primer apartado');
    await user.clear(intro);
    await user.type(intro, 'Nuevo texto de prueba.');
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    const patch = api.update.mock.calls[0][1];
    expect(patch.body).toBe(BODY.replace('Texto de prueba.', 'Nuevo texto de prueba.'));

    await user.click(screen.getByRole('button', { name: /Publicar…/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/41 consentimientos de la versión 2026.3 siguen ligados a esa versión/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: /Publicar versión 2026.4/ });
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(confirm);
    await waitFor(() => expect(api.publish).toHaveBeenCalledWith(4));
  });

  it('marks a part title the page would not read as a part, next to the field, and blocks publishing', async () => {
    const user = userEvent.setup();
    open('/admin/aviso-privacidad/4');
    const title = (await screen.findAllByLabelText('Título del apartado'))[0];
    await user.clear(title);
    await user.type(title, 'Corto');
    expect(screen.getByText(/necesita al menos 15 letras/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Publicar…/ })).toBeDisabled();
  });
});
