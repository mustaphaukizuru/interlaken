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

describe('AdminNavigation menu editor', () => {
  it('shows an error and no «Guardar menú» when the stored menu fails to load', async () => {
    vi.mocked(contentApi.adminGetSettings).mockRejectedValue(new Error('500'));
    renderWithProviders(<AdminNavigation />, { route: '/admin/navegacion' });
    expect(await screen.findByText('No se pudo cargar el menú del sitio')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar menú' })).not.toBeInTheDocument();
    expect(screen.queryByText(/usa el menú integrado/)).not.toBeInTheDocument();
    expect(contentApi.adminUpdateSettings).not.toHaveBeenCalled();
  });

  it('asks before resetting a custom menu to the built-in one', async () => {
    const user = userEvent.setup();
    vi.mocked(contentApi.adminGetSettings).mockResolvedValue({
      data: { menu: [{ label: 'Propio', items: [{ label: 'Inicio', to: '/', icon: '' }] }] },
    } as never);
    vi.mocked(contentApi.adminUpdateSettings).mockResolvedValue({ data: { menu: [] } } as never);
    renderWithProviders(<AdminNavigation />, { route: '/admin/navegacion' });
    await user.click(await screen.findByRole('button', { name: /Volver al menú integrado/ }));
    expect(contentApi.adminUpdateSettings).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: '¿Volver al menú integrado?' });
    await user.click(within(dialog).getByRole('button', { name: 'Volver al menú integrado' }));
    expect(contentApi.adminUpdateSettings).toHaveBeenCalledWith({ menu: [] });
  });
});
