import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/api', () => ({
  admissionsApi: { getMyRegistrations: vi.fn() },
}));

import InscripcionesPage from './InscripcionesPage';
import { admissionsApi } from '@/services/api';

const getMine = vi.mocked(admissionsApi.getMyRegistrations);

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <InscripcionesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('InscripcionesPage', () => {
  it('shows empty state with pre-registro CTA when there are no registrations', async () => {
    getMine.mockResolvedValue({ data: [] } as never);
    renderPage();
    expect(await screen.findByText(/Sin inscripciones/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ir a pre-registro/i })).toHaveAttribute(
      'href',
      '/pre-registro',
    );
  });

  it('lists registrations with status badges', async () => {
    getMine.mockResolvedValue({
      data: [
        {
          id: 1,
          child_name: 'Ana Pérez',
          grade_applying: 'Primaria 2°',
          cycle: '2026-2027',
          status: 'reviewing',
          status_label: 'En revisión',
          submitted_at: '2026-08-01T12:00:00Z',
          created_at: '2026-08-01T12:00:00Z',
          updated_at: '2026-08-02T12:00:00Z',
        },
      ],
    } as never);
    renderPage();
    expect(await screen.findByText('Ana Pérez')).toBeInTheDocument();
    expect(screen.getByText(/Primaria 2°/)).toBeInTheDocument();
    expect(screen.getByText('En revisión')).toBeInTheDocument();
  });

  it('shows error state when the API fails', async () => {
    getMine.mockRejectedValue(new Error('down'));
    renderPage();
    expect(await screen.findByRole('button', { name: /Reintentar/i })).toBeInTheDocument();
  });
});
