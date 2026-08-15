import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/api', () => ({
  portalApi: { getStudents: vi.fn() },
  bookingsApi: { getAdminBookings: vi.fn() },
  financeApi: { getAdminInvoices: vi.fn() },
}));

import { CommandPalette } from './CommandPalette';
import { bookingsApi, financeApi, portalApi } from '@/services/api';

const students = vi.mocked(portalApi.getStudents);
const bookings = vi.mocked(bookingsApi.getAdminBookings);
const invoices = vi.mocked(financeApi.getAdminInvoices);

function renderPalette() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
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
  invoices.mockResolvedValue({ data: { results: [] } } as never);
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

  it('searches the three endpoints and shows grouped results', async () => {
    renderPalette();
    await userEvent.keyboard('{Control>}k{/Control}');
    // The palette input is a combobox now (aria-activedescendant wiring).
    await userEvent.type(screen.getByRole('combobox'), 'ana');

    await waitFor(() => expect(students).toHaveBeenCalledWith({ search: 'ana' }));
    expect(bookings).toHaveBeenCalledWith({ q: 'ana' });
    expect(invoices).toHaveBeenCalledWith({ q: 'ana' });

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
});
