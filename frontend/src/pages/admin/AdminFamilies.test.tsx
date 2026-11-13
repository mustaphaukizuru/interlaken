import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  portalApi: { getStudents: vi.fn() },
}));

vi.mock('@/services/familiesApi', () => ({
  familiesApi: {
    list: vi.fn(),
    export: vi.fn(),
    bulk: vi.fn(),
    get: vi.fn(),
    link: vi.fn(),
    removeStudent: vi.fn(),
    dissolve: vi.fn(),
    update: vi.fn(),
    suggestions: vi.fn(),
    suggestionsBulk: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import AdminFamilies from './AdminFamilies';
import { familiesApi } from '@/services/familiesApi';
import { renderWithProviders } from '@/test/renderWithProviders';

const kid = (id: number, first: string, grade = '3° Primaria', group = 'A') => ({
  id, name: `${first} Pérez López`, first_name: first, last_name: 'Pérez López', email: `ci0000${id}@interlaken.com.mx`,
  student_id: `0000${id}`, grade, group, status: 'active', status_label: 'Activo', archived: false,
  family: { id: 5, name: 'Familia Pérez López' },
});

const FAMILY_ROW = {
  id: 5, name: 'Familia Pérez López', notes: 'Recoge la abuela', created_at: '2026-11-13T12:00:00Z',
  children_count: 2, students: [kid(1, 'Ana'), kid(2, 'Luis', '1° Secundaria', 'B')], logins_count: 3,
};

const SUGGESTION = {
  key: '7-8', confidence: 'alta', families: [],
  students: [{ ...kid(7, 'Eva'), family: null, last_name: 'Gil Mora', name: 'Eva Gil Mora' }, { ...kid(8, 'Iván'), family: null, last_name: 'Gil Mora', name: 'Iván Gil Mora' }],
  reasons: [{ kind: 'guardian', label: 'Mismo tutor', value: 'mama@correo.mx' }],
};

const list = vi.mocked(familiesApi.list);
const suggestions = vi.mocked(familiesApi.suggestions);

describe('AdminFamilies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue({ data: { count: 1, next: null, previous: null, results: [FAMILY_ROW] } } as never);
    suggestions.mockResolvedValue({ data: { count: 1, counts: { alta: 1, media: 0 }, results: [SUGGESTION] } } as never);
  });

  it('lists families with their children and opens one', async () => {
    vi.mocked(familiesApi.get).mockResolvedValue({
      data: { ...FAMILY_ROW, created_by: 'Admin', logins: [] },
    } as never);

    renderWithProviders(<AdminFamilies />, { route: '/admin/familias' });

    expect(await screen.findByRole('heading', { name: 'Familias' })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Familias' });
    expect(within(table).getByText('Familia Pérez López')).toBeInTheDocument();
    expect(within(table).getByText('Recoge la abuela')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: /Ana/ })).toHaveAttribute('href', '/admin/alumnos/1');
    expect(within(table).getByText('3 cuentas')).toBeInTheDocument();

    await userEvent.click(within(table).getByRole('button', { name: 'Familia Pérez López' }));
    const dialog = await screen.findByRole('dialog', { name: 'Detalle de la familia' });
    await waitFor(() => expect(familiesApi.get).toHaveBeenCalledWith(5));
    expect(await within(dialog).findByText('2 hermanos · 0 cuentas con acceso')).toBeInTheDocument();
  });

  it('shows the counts on both tabs', async () => {
    renderWithProviders(<AdminFamilies />, { route: '/admin/familias' });
    const tabs = await screen.findByRole('tablist', { name: 'Vista' });
    await waitFor(() => expect(within(tabs).getByRole('tab', { name: /Sugerencias/ })).toHaveTextContent('1'));
    expect(within(tabs).getByRole('tab', { name: /Familias/ })).toHaveTextContent('1');
  });

  it('accepts suggestions in bulk after the dry run, with the family notice', async () => {
    const bulk = vi.mocked(familiesApi.suggestionsBulk);
    bulk.mockImplementation(async (body) => ({
      data: { action: body.action, requested: 1, ok: 1, failed: [], skipped: [], dry_run: !!body.dry_run },
    }) as never);

    renderWithProviders(<AdminFamilies />, { route: '/admin/familias?vista=sugerencias' });

    const table = await screen.findByRole('table', { name: 'Sugerencias de hermanos' });
    expect(within(table).getByText('Mismo tutor:')).toBeInTheDocument();
    expect(within(table).getByText('Alta')).toBeInTheDocument();

    await userEvent.click(within(table).getByRole('checkbox', { name: /Eva, Iván/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Vincular/ }));
    await waitFor(() => expect(bulk).toHaveBeenCalledWith(expect.objectContaining({ action: 'accept', ids: ['7-8'], dry_run: true })));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('checkbox', { name: /Notificar a las familias/ })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /Vincular \(1\)/ }));
    await waitFor(() => expect(bulk).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'accept', ids: ['7-8'], dry_run: false })));
  });

  it('an empty list explains where families come from', async () => {
    list.mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } } as never);
    renderWithProviders(<AdminFamilies />, { route: '/admin/familias' });
    expect(await screen.findByText('Aún no hay familias')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Nueva familia/ }).length).toBeGreaterThan(1);
  });
});
