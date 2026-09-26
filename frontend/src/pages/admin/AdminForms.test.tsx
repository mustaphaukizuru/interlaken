import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn(), loading: vi.fn(() => 't'), dismiss: vi.fn() } }));
vi.mock('@/services/AdminContentApi', () => ({
  formsAdminApi: { list: vi.fn(), export: vi.fn(), bulk: vi.fn() },
  submissionsAdminApi: { list: vi.fn(), export: vi.fn(), bulk: vi.fn() },
}));
vi.mock('@/services/api', () => ({
  contentApi: { adminDeleteForm: vi.fn(), adminHandleSubmission: vi.fn(), adminCreateForm: vi.fn(), adminUpdateForm: vi.fn() },
  downloadBlob: vi.fn(),
}));

import { formsAdminApi, submissionsAdminApi } from '@/services/AdminContentApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';
import AdminForms from './AdminForms';

const FORM = {
  id: 2, slug: 'informes', title: 'Informes', description: '', consent_text: '', success_message: '', submit_label: 'Enviar',
  fields: [{ key: 'nombre', label: 'Nombre', type: 'text' }, { key: 'acepta', label: 'Acepta', type: 'checkbox' }],
  notify_to: '', is_published: true, submissions_count: 2, pending_count: 1, updated_at: '2026-09-20T10:00:00Z',
};
const SUB = { id: 8, form: 2, form_title: 'Informes', data: { nombre: 'Lucía', acepta: true }, page: '/contacto', is_handled: false, reply_to: 'l@x.mx', created_at: '2026-09-20T10:00:00Z' };

beforeEach(() => {
  vi.clearAllMocks();
  stubViewport(1280);
  vi.mocked(formsAdminApi.list).mockResolvedValue({ data: { count: 1, next: null, previous: null, results: [FORM] } } as never);
  vi.mocked(submissionsAdminApi.list).mockResolvedValue({ data: { count: 1, next: null, previous: null, results: [SUB] } } as never);
});

describe('AdminForms', () => {
  it('lists forms with pending counts and sorts through the URL', async () => {
    renderWithProviders(<AdminForms />, { route: '/admin/formularios?orden=-pending' });
    const row = await screen.findByRole('row', { name: /Informes/ });
    expect(within(row).getByRole('button', { name: /Envíos \(1\)/ })).toBeInTheDocument();
    expect(formsAdminApi.list).toHaveBeenCalledWith(expect.objectContaining({ ordering: '-pending' }));
  });

  it('opens the paginated inbox from the URL, pending by default, answers as columns', async () => {
    renderWithProviders(<AdminForms />, { route: '/admin/formularios?envios=2&eq=lucia' });
    const dialog = await screen.findByRole('dialog', { name: 'Envíos: Informes' });
    const row = await within(dialog).findByRole('row', { name: /Lucía/ });
    expect(within(row).getByText('Sí')).toBeInTheDocument();
    expect(submissionsAdminApi.list).toHaveBeenCalledWith(2, { page: 1, q: 'lucia', handled: '0', from: undefined, to: undefined, ordering: undefined });
  });

  it('bulk "select all matching" sends the form id in the filters', async () => {
    const user = userEvent.setup();
    vi.mocked(submissionsAdminApi.list).mockResolvedValue({ data: { count: 30, next: null, previous: null, results: [SUB] } } as never);
    vi.mocked(submissionsAdminApi.bulk).mockResolvedValue({ data: { action: 'mark_handled', requested: 30, ok: 30, failed: [], skipped: [], dry_run: true } } as never);
    renderWithProviders(<AdminForms />, { route: '/admin/formularios?envios=2' });
    const dialog = await screen.findByRole('dialog', { name: 'Envíos: Informes' });
    await within(dialog).findByRole('row', { name: /Lucía/ });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Seleccionar todas las filas de esta página' }));
    await user.click(within(dialog).getByRole('button', { name: /Seleccionar las 30 que coinciden/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Marcar atendidos' }));
    await waitFor(() => expect(submissionsAdminApi.bulk).toHaveBeenCalledWith(expect.objectContaining({
      action: 'mark_handled', all_matching: true, dry_run: true, filters: expect.objectContaining({ form: 2, handled: '0' }),
    })));
  });
});
