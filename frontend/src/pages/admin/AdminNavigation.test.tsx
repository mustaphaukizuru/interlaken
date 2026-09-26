import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn(), loading: vi.fn(() => 't'), dismiss: vi.fn() } }));
vi.mock('@/services/AdminContentApi', () => ({
  redirectsAdminApi: { list: vi.fn(), export: vi.fn(), bulk: vi.fn(), import: { template: vi.fn(), upload: vi.fn() } },
}));
vi.mock('@/services/api', () => ({
  contentApi: { adminGetSettings: vi.fn(), adminUpdateSettings: vi.fn(), adminCreateRedirect: vi.fn(), adminDeleteRedirect: vi.fn() },
  downloadBlob: vi.fn(),
}));

import { redirectsAdminApi } from '@/services/AdminContentApi';
import { contentApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';
import AdminNavigation from './AdminNavigation';

beforeEach(() => {
  vi.clearAllMocks();
  stubViewport(1280);
  vi.mocked(contentApi.adminGetSettings).mockResolvedValue({ data: { menu: [] } } as never);
  vi.mocked(redirectsAdminApi.list).mockResolvedValue({
    data: { count: 1, next: null, previous: null, results: [{ id: 6, from_path: '/viejo', to_path: '/nuevo', permanent: false, hits: 2, created_at: '' }] },
  } as never);
});

describe('AdminNavigation redirects', () => {
  it('lists redirects on the list contract and opens the import dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminNavigation />, { route: '/admin/navegacion?q=viejo&tipo=0&orden=-hits' });
    const row = await screen.findByRole('row', { name: /\/viejo/ });
    expect(within(row).getByText('302')).toBeInTheDocument();
    expect(redirectsAdminApi.list).toHaveBeenCalledWith({ page: 1, q: 'viejo', permanent: '0', ordering: '-hits' });
    await user.click(screen.getByRole('button', { name: /^Importar$/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Importar redirecciones' });
    expect(within(dialog).getByText('permanente')).toBeInTheDocument();
  });
});
