/** Navegación with the editor's pickers (contract C5): destinations by page name, icons by Spanish name. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn(), loading: vi.fn(() => 't'), dismiss: vi.fn() } }));
vi.mock('@/services/AdminContentApi', () => ({
  redirectsAdminApi: { list: vi.fn(), export: vi.fn(), bulk: vi.fn(), import: { template: vi.fn(), upload: vi.fn() } },
}));
vi.mock('@/services/api', () => ({
  contentApi: { adminGetSettings: vi.fn(), adminUpdateSettings: vi.fn(), adminCreateRedirect: vi.fn(), adminDeleteRedirect: vi.fn(), adminListPages: vi.fn(), getSettings: vi.fn() },
  downloadBlob: vi.fn(),
}));

import { redirectsAdminApi } from '@/services/AdminContentApi';
import { contentApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';
import AdminNavigation from './AdminNavigation';

beforeEach(() => {
  stubViewport(1280);
  vi.mocked(contentApi.adminGetSettings).mockResolvedValue({ data: { menu: [{ label: 'Propio', items: [{ label: 'Costos', to: '/admisiones', icon: 'Users' }] }] } } as never);
  vi.mocked(contentApi.adminUpdateSettings).mockResolvedValue({ data: {} } as never);
  vi.mocked(contentApi.adminListPages).mockResolvedValue({ data: [] } as never);
  vi.mocked(contentApi.getSettings).mockResolvedValue({ data: {} } as never);
  vi.mocked(redirectsAdminApi.list).mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } } as never);
});

describe('AdminNavigation pickers', () => {
  it('menu links show where they go and change by page name; icons by Spanish name', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminNavigation />, { route: '/admin/navegacion' });
    const change = await screen.findByRole('button', { name: /Cambiar destino de Destino \(ahora: Admisiones\)/ });
    await user.click(change);
    const dialog = await screen.findByRole('dialog', { name: /a dónde lleva/ });
    await user.click(within(dialog).getByRole('button', { name: /^Costos/ }));

    await user.click(screen.getByRole('button', { name: /Ícono: Personas/ }));
    await user.click(await screen.findByRole('button', { name: /Moneda/ }));
    expect(screen.getByRole('button', { name: /Ícono: Moneda/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Guardar menú' }));
    expect(contentApi.adminUpdateSettings).toHaveBeenCalledWith({ menu: [{ label: 'Propio', items: [{ label: 'Costos', to: '/admisiones/costos', icon: 'CircleDollarSign' }] }] });
  });
});
