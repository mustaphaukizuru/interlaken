import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  contentApi: { getPricing: vi.fn(), getSettings: vi.fn() },
}));

import { CostEstimator } from './CostEstimator';
import { contentApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const getPricing = vi.mocked(contentApi.getPricing);
const getSettings = vi.mocked(contentApi.getSettings);

// P4 /content/pricing/ bundle shape — section names deliberately differ from
// the UI labels ('Sección Maternal', '1° a 3° de Preescolar') to exercise the
// icontains-style matching.
const BUNDLE = {
  enrollment_fees: [
    { section: 'Preescolar', modality: 'nuevo_ingreso', gastos_administrativos: '2500.00', cuota: '6800.00', order: 1 },
    { section: 'Preescolar', modality: 'reinscripcion', gastos_administrativos: '2000.00', cuota: '5760.00', order: 1 },
    { section: 'Primaria', modality: 'nuevo_ingreso', gastos_administrativos: '2500.00', cuota: '8800.00', order: 2 },
  ],
  tuition: [
    { section: 'Sección Maternal', inscripcion: null, colegiatura: '4190.00', order: 1 },
    { section: '1° a 3° de Preescolar', inscripcion: '6800.00', colegiatura: '4920.00', order: 2 },
    { section: 'Primaria', inscripcion: '8800.00', colegiatura: '6450.00', order: 3 },
  ],
  fixed_concepts: [
    { name: 'Seguro accidentes', cost: '500.00', mandatory: true, order: 1 },
    { name: 'Seguro orfandad', cost: '700.00', mandatory: true, order: 2 },
    { name: 'Credenciales', cost: '350.00', mandatory: true, order: 3 },
  ],
  extracurriculars: [],
  daycare: [],
  policies: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  getPricing.mockResolvedValue({ data: BUNDLE } as never);
  getSettings.mockResolvedValue({ data: { whatsapp_number: '5215512345678' } } as never);
});

describe('CostEstimator', () => {
  it('shows Preescolar nuevo ingreso by default, matching loose section names', async () => {
    renderWithProviders(<CostEstimator />);

    expect(await screen.findByText('$2,500.00')).toBeInTheDocument(); // gastos
    expect(screen.getByText('$6,800.00')).toBeInTheDocument(); // cuota
    expect(screen.getByText('$4,920.00')).toBeInTheDocument(); // colegiatura (1° a 3° de Preescolar)
    expect(screen.getByText('1° a 3° de Preescolar')).toBeInTheDocument();
    expect(screen.getByText('Cuota de inscripción')).toBeInTheDocument();
  });

  it('switching to reinscripción changes the figures', async () => {
    renderWithProviders(<CostEstimator />);
    expect(await screen.findByText('$6,800.00')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reinscripción' }));

    expect(await screen.findByText('$5,760.00')).toBeInTheDocument();
    expect(screen.getByText('$2,000.00')).toBeInTheDocument();
    expect(screen.getByText('Cuota de reinscripción')).toBeInTheDocument();
    expect(screen.queryByText('$6,800.00')).not.toBeInTheDocument();
  });

  it('Maternal (no enrollment fee row) shows SIN COSTO like CostosPage', async () => {
    renderWithProviders(<CostEstimator />);
    expect(await screen.findByText('$6,800.00')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Maternal' }));

    // Gastos administrativos + cuota de inscripción both show SIN COSTO.
    expect(screen.getAllByText('SIN COSTO')).toHaveLength(2);
    expect(screen.getByText('$4,190.00')).toBeInTheDocument(); // Sección Maternal tuition
  });

  it('totals the seguros y credenciales concepts with the obligatorios note', async () => {
    renderWithProviders(<CostEstimator />);

    // 500 + 700 + 350
    expect(await screen.findByText('$1,550.00')).toBeInTheDocument();
    expect(screen.getByText(/Anual · obligatorios/)).toBeInTheDocument();
  });

  it('prefills the per-section WhatsApp message and links to full costs', async () => {
    renderWithProviders(<CostEstimator />);
    expect(await screen.findByText('$6,800.00')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Primaria' }));

    const wa = await screen.findByRole('link', { name: /Solicitar información/i });
    expect(wa.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/\d+\?text=/);
    expect(wa.getAttribute('href')).toContain('Primaria');
    expect(screen.getByRole('link', { name: /Ver todos los costos/i })).toHaveAttribute(
      'href',
      '/admisiones/costos',
    );
  });

  it('shows the error state and recovers on retry', async () => {
    getPricing
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ data: BUNDLE } as never);

    renderWithProviders(<CostEstimator />);
    expect(await screen.findByText('No fue posible cargar el estimador')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Reintentar/i }));

    expect(await screen.findByText('$6,800.00')).toBeInTheDocument();
    expect(getPricing).toHaveBeenCalledTimes(2);
  });
});
