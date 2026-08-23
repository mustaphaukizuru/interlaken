import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/api', () => ({
  portalApi: { getStudents: vi.fn() },
  bookingsApi: { getAdminBookings: vi.fn() },
}));

import { CommandPalette, actionsForRole } from './CommandPalette';
import { useAuthStore } from '@/store/authStore';
import { bookingsApi, portalApi } from '@/services/api';

const students = vi.mocked(portalApi.getStudents);
const bookings = vi.mocked(bookingsApi.getAdminBookings);

/** Exposes the router's current URL so tests can assert navigation. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderPalette() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CommandPalette />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: { id: 1, email: 'a@x.mx', first_name: 'Ada', last_name: 'Admin', full_name: 'Ada Admin', role: 'admin', avatar: '', whatsapp: '', last_login: null } as never, isAuthenticated: true });
  students.mockResolvedValue({
    data: {
      results: [{
        id: 7,
        user: { first_name: 'Ana', last_name: 'García' },
        student_id: 'INT-007',
        grade: '3',
        group: 'B',
      }],
    },
  } as never);
  bookings.mockResolvedValue({ data: [] } as never);
});

describe('CommandPalette', () => {
  it('stays hidden until Ctrl+K opens it', async () => {
    renderPalette();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog', { name: 'Búsqueda global' })).toBeInTheDocument();
  });

  it('asks for at least 2 characters before searching', async () => {
    renderPalette();
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(screen.getByText(/al menos 2 caracteres/i)).toBeInTheDocument();
    expect(students).not.toHaveBeenCalled();
  });

  it('searches both endpoints and shows grouped results', async () => {
    renderPalette();
    await userEvent.keyboard('{Control>}k{/Control}');
    // The palette input is a combobox now (aria-activedescendant wiring).
    await userEvent.type(screen.getByRole('combobox'), 'ana');

    await waitFor(() => expect(students).toHaveBeenCalledWith({ search: 'ana' }));
    expect(bookings).toHaveBeenCalledWith({ q: 'ana' });

    expect(await screen.findByText('Ana García')).toBeInTheDocument();
    expect(screen.getByText('Alumnos')).toBeInTheDocument();
    expect(screen.getByText(/INT-007/)).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    renderPalette();
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the Acciones group before typing and runs an action with its param', async () => {
    renderPalette();
    await userEvent.keyboard('{Control>}k{/Control}');

    // Actions are listed without any search (search endpoints untouched).
    expect(screen.getByText('Acciones')).toBeInTheDocument();
    expect(students).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('option', { name: /Crear comunicado/ }));

    // Navigates carrying the param AdminAnnouncements consumes to open its
    // composer (the page keeps its own validations/confirmations).
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/comunicados?nuevo=1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('filters actions accent-insensitively while typing', async () => {
    renderPalette();
    await userEvent.keyboard('{Control>}k{/Control}');
    await userEvent.type(screen.getByRole('combobox'), 'cafeteria');

    // The action list narrows once the debounced query settles.
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /Crear comunicado/ })).toBeNull());
    expect(
      screen.getByRole('option', { name: /Exportar saldos de cafetería/ }),
    ).toBeInTheDocument();
  });
});

describe('role-aware actions (P1-E7)', () => {
  it('families get navigation actions and no student search', async () => {
    expect(actionsForRole('parent').some((a) => a.to === '/portal/cafeteria')).toBe(true);
    expect(actionsForRole('staff').some((a) => a.to === '/staff/contenido')).toBe(true);
    expect(actionsForRole('admin').some((a) => a.to === '/admin/visitas')).toBe(true);
    useAuthStore.setState({ user: { id: 2, email: 'p@x.mx', first_name: 'Pa', last_name: 'Dre', full_name: 'Pa Dre', role: 'parent', avatar: '', whatsapp: '', last_login: null } as never, isAuthenticated: true });
    renderPalette();
    window.dispatchEvent(new Event('open-command-palette'));
    const box = await screen.findByRole('combobox');
    await userEvent.type(box, 'cafe');
    expect(await screen.findByRole('option', { name: /Cafetería/ })).toBeInTheDocument();
    expect(students).not.toHaveBeenCalled();
  });
});
