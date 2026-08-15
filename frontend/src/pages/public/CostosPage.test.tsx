import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/api', () => ({
  contentApi: { getPricing: vi.fn() },
}));

import CostosPage from './CostosPage';
import { contentApi } from '@/services/api';

const getPricing = vi.mocked(contentApi.getPricing);

const BUNDLE = {
  enrollment_fees: [
    { section: 'Preescolar', modality: 'nuevo_ingreso', gastos_administrativos: '2500.00', cuota: '6800.00', order: 1 },
    { section: 'Secundaria', modality: 'nuevo_ingreso', gastos_administrativos: '2500.00', cuota: '9600.00', order: 3 },
    { section: 'Preescolar', modality: 'reinscripcion', gastos_administrativos: '2000.00', cuota: '5760.00', order: 1 },
  ],
  tuition: [
    { section: 'Sección Maternal', inscripcion: null, colegiatura: '4190.00', order: 1 },
    { section: 'Primaria', inscripcion: '8800.00', colegiatura: '6450.00', order: 3 },
  ],
  fixed_concepts: [
    { name: 'Seguro accidentes', cost: '500.00', mandatory: true, order: 1 },
    { name: 'Credenciales', cost: '350.00', mandatory: true, order: 3 },
  ],
  extracurriculars: [
    { name: 'Karate', levels: 'Preescolar y Primaria', annual_cost: '4200.00', order: 1 },
  ],
  daycare: [
    { schedule: 'Hasta 15:50', service: 'Comida y estancia', daily_cost: '150.00', monthly_cost: '2670.00', monthly_note: '', order: 3 },
    { schedule: 'Después de 18:00', service: 'Multa de estancia', daily_cost: '300.00', monthly_cost: null, monthly_note: 'Se cancela el servicio definitivamente', order: 6 },
  ],
  policies: [
    { text: 'La cuota de inscripción y reinscripción se divide en 4 parcialidades, de enero a abril.', order: 1 },
    { text: 'A partir del día 17 del mes se aplica un recargo del 5% mensual sobre el saldo insoluto.', order: 3 },
  ],
};

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
  getPricing.mockResolvedValue({ data: BUNDLE } as never);
});

describe('CostosPage (paquete de precios 2026)', () => {
  it('shows the auto-computed Mexican school cycle', async () => {
    renderPage();
    const y = new Date().getFullYear();
    expect(await screen.findByText(`Ciclo Escolar ${y}–${y + 1}`)).toBeInTheDocument();
  });

  it('renders enrollment fees for nuevo ingreso by default and switches to reinscripción', async () => {
    renderPage();
    expect(await screen.findByText(/9,600\.00/)).toBeInTheDocument();
    // Both nuevo-ingreso rows share the same gastos figure.
    expect(screen.getAllByText(/Gastos administrativos: \$2,500\.00/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/5,760\.00/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Alumnos Interlaken/i }));
    expect(await screen.findByText(/5,760\.00/)).toBeInTheDocument();
    expect(screen.queryByText(/9,600\.00/)).not.toBeInTheDocument();
  });

  it('renders colegiaturas, seguros obligatorios, extraescolares y estancia', async () => {
    renderPage();
    expect(await screen.findByText(/4,190\.00/)).toBeInTheDocument();
    expect(screen.getByText('Seguro accidentes')).toBeInTheDocument();
    expect(screen.getByText(/Contratación obligatoria/i)).toBeInTheDocument();
    expect(screen.getByText('Karate')).toBeInTheDocument();
    expect(screen.getByText(/Se cancela el servicio/i)).toBeInTheDocument();
  });

  it('highlights recargo/devolución policies', async () => {
    renderPage();
    const recargo = await screen.findByText(/recargo del 5%/i);
    expect(recargo).toHaveClass('font-medium');
  });

  it('shows the error state when the API fails', async () => {
    getPricing.mockRejectedValue(new Error('down'));
    renderPage();
    expect(
      await screen.findByText(/No fue posible cargar los costos/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reintentar/i })).toBeInTheDocument();
  });

  it('shows a Spanish empty state with CTAs when the bundle is empty', async () => {
    getPricing.mockResolvedValue({
      data: { enrollment_fees: [], tuition: [], fixed_concepts: [], extracurriculars: [], daycare: [], policies: [] },
    } as never);
    renderPage();
    expect(await screen.findByText(/Costos próximamente/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Contactar al colegio/i })).toHaveAttribute(
      'href',
      '/contacto',
    );
  });
});
