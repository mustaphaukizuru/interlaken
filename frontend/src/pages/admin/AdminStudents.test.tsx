import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';

vi.mock('@/services/api', () => ({
  portalApi: {
    getStudents: vi.fn(),
    exportStudents: vi.fn(),
    importStudents: vi.fn(),
    importLoyverse: vi.fn(),
    linkLoyverse: vi.fn(),
  },
  downloadBlob: vi.fn(),
}));

import AdminStudents from './AdminStudents';
import { portalApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const mockedStudents = vi.mocked(portalApi.getStudents);

/** Exposes the router's current URL so tests can assert on filter sync. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

describe('AdminStudents states', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows an error state (not "Sin alumnos") and recovers on retry', async () => {
    mockedStudents
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ data: { results: [], count: 0 } } as never);

    renderWithProviders(<AdminStudents />, { route: '/admin/alumnos' });

    expect(await screen.findByText('No se pudo cargar la información')).toBeInTheDocument();
    expect(screen.queryByText('Sin alumnos')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    expect(await screen.findByText('Sin alumnos')).toBeInTheDocument();
    expect(screen.queryByText('No se pudo cargar la información')).toBeNull();
    expect(mockedStudents).toHaveBeenCalledTimes(2);
  });
});

describe('AdminStudents URL-synced filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedStudents.mockResolvedValue({ data: { results: [], count: 0 } } as never);
  });

  it('writes the debounced search to the URL (?q=)', async () => {
    renderWithProviders(
      <>
        <AdminStudents />
        <LocationProbe />
      </>,
      { route: '/admin/alumnos' },
    );

    await userEvent.type(screen.getByLabelText('Buscar alumnos'), 'ana');

    // Debounced (300 ms): the URL catches up once, not per keystroke.
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/admin/alumnos?q=ana'));
    await waitFor(() =>
      expect(mockedStudents).toHaveBeenCalledWith({ page: 1, search: 'ana' }));
  });

  it('mounting from a URL with filters restores the state', async () => {
    renderWithProviders(
      <>
        <AdminStudents />
        <LocationProbe />
      </>,
      { route: '/admin/alumnos?q=garcia&page=3' },
    );

    // Input restored from ?q=, and the query fires with the URL's filter+page.
    expect(screen.getByLabelText('Buscar alumnos')).toHaveValue('garcia');
    await waitFor(() =>
      expect(mockedStudents).toHaveBeenCalledWith({ page: 3, search: 'garcia' }));

    // Active-filter chip row appears with the search chip.
    expect(await screen.findByLabelText('Filtros activos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Quitar filtro: Búsqueda/ })).toBeInTheDocument();
  });

  it('clearing the chip removes the filter from the URL', async () => {
    renderWithProviders(
      <>
        <AdminStudents />
        <LocationProbe />
      </>,
      { route: '/admin/alumnos?q=garcia' },
    );

    await userEvent.click(
      await screen.findByRole('button', { name: /Quitar filtro: Búsqueda/ }));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/admin\/alumnos$/));
    expect(screen.getByLabelText('Buscar alumnos')).toHaveValue('');
  });
});
