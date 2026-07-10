import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/api', () => ({
  contentApi: { getCosts: vi.fn() },
}));

import CostosPage from './CostosPage';
import { contentApi } from '@/services/api';

const getCosts = vi.mocked(contentApi.getCosts);

const ROWS = [
  { section: 'Sección Maternal', inscripcion: null, colegiatura: '3550.00', order: 1 },
  { section: 'Primaria', inscripcion: '8800.00', colegiatura: '6000.00', order: 3 },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CostosPage />
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getCosts.mockResolvedValue({ data: ROWS } as never);
});

describe('CostosPage', () => {
  it('shows the auto-computed Mexican school cycle', async () => {
    renderPage();
    const y = new Date().getFullYear();
    expect(await screen.findByText(`Ciclo Escolar ${y}–${y + 1}`)).toBeInTheDocument();
  });

  it('renders CMS rows with SIN COSTO for null inscripción and MXN amounts', async () => {
    renderPage();
    expect(await screen.findByText('SIN COSTO')).toBeInTheDocument();
    // Ambas tablas (inscripción y colegiatura) listan cada sección.
    expect(screen.getAllByText('Sección Maternal')).toHaveLength(2);
    expect(screen.getAllByText(/8,800\.00/)).not.toHaveLength(0);
  });

  it('shows the error state when the API fails', async () => {
    getCosts.mockRejectedValue(new Error('down'));
    renderPage();
    expect(
      await screen.findByText(/No fue posible cargar los costos/i),
    ).toBeInTheDocument();
  });
});
