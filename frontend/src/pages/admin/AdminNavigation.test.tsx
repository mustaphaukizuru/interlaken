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

describe('AdminNavigation header, version 3 (2026-11-23)', () => {
  const LIVE = {
    header_buttons: [
      { label: 'Cafetería', href: '/login', icon: 'Coffee', primary: false },
      { label: 'Colegiaturas', href: 'https://interlaken.servoescolar.mx', icon: 'CircleDollarSign', primary: false },
      { label: 'Agendar visita', href: '/agendar-visita', primary: true },
    ],
    sticky_label: 'Agendar visita', sticky_href: '/agendar-visita',
  };

  it('names what the saved header still lacks and «Usar la versión 3» fills the form (saved only with «Guardar»)', async () => {
    const user = userEvent.setup();
    vi.mocked(contentApi.adminGetSettings).mockResolvedValue({ data: { menu: [], chrome: LIVE } } as never);
    vi.mocked(contentApi.adminUpdateSettings).mockResolvedValue({ data: {} } as never);
    renderWithProviders(<AdminNavigation />, { route: '/admin/navegacion' });
    const notice = await screen.findByText('El encabezado aún no está como la versión 3 aprobada');
    const box = notice.closest('[data-header-v3-notice]') as HTMLElement;
    expect(within(box).getAllByRole('listitem')).toHaveLength(3);
    // Three buttons: no «Agregar botón», and a warning about 1024 px.
    expect(screen.queryByRole('button', { name: /Agregar botón/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Con 3 botones el encabezado queda muy justo/)).toBeInTheDocument();

    await user.click(within(box).getByRole('button', { name: 'Usar la versión 3' }));
    expect(contentApi.adminUpdateSettings).not.toHaveBeenCalled();
    expect(screen.queryByText('El encabezado aún no está como la versión 3 aprobada')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Portal Cafetería')).toBeInTheDocument();
    expect(screen.getByLabelText('Botón de la barra móvil')).toHaveValue('Pagos');

    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    const sent = vi.mocked(contentApi.adminUpdateSettings).mock.calls[0][0] as { chrome: Record<string, unknown> };
    expect(sent.chrome.header_buttons).toEqual([
      { label: 'Portal Cafetería', href: '/login', icon: 'Coffee' },
      { label: 'Colegiaturas', href: 'https://interlaken.servoescolar.mx/', icon: 'CreditCard' },
    ]);
    expect([sent.chrome.sticky_label, sent.chrome.sticky_href]).toEqual(['Pagos', '/pagos']);
  });

  it('no notice once the header is version 3', async () => {
    vi.mocked(contentApi.adminGetSettings).mockResolvedValue({ data: { menu: [], chrome: {} } } as never);
    renderWithProviders(<AdminNavigation />, { route: '/admin/navegacion' });
    expect(await screen.findByRole('button', { name: /Agregar botón/ })).toBeInTheDocument();
    expect(screen.queryByText('El encabezado aún no está como la versión 3 aprobada')).not.toBeInTheDocument();
  });
});
