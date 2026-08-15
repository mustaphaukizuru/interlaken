import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';

vi.mock('@/services/api', () => ({
  contentApi: { getPricing: vi.fn(), getSettings: vi.fn() },
}));

import AdmissionsPage from './AdmissionsPage';
import { contentApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const getPricing = vi.mocked(contentApi.getPricing);
const getSettings = vi.mocked(contentApi.getSettings);

const BUNDLE = {
  enrollment_fees: [
    { section: 'Preescolar', modality: 'nuevo_ingreso', gastos_administrativos: '2500.00', cuota: '6800.00', order: 1 },
  ],
  tuition: [
    { section: '1° a 3° de Preescolar', inscripcion: '6800.00', colegiatura: '4920.00', order: 2 },
  ],
  fixed_concepts: [
    { name: 'Seguro accidentes', cost: '500.00', mandatory: true, order: 1 },
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

describe('AdmissionsPage — funnel timeline', () => {
  it('renders the 4 steps with their CTAs and correct hrefs', async () => {
    renderWithProviders(<AdmissionsPage />, { route: '/admisiones' });

    // The four step titles.
    expect(screen.getByRole('heading', { name: 'Informes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Visita guiada' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Documentación' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Inscripción' })).toBeInTheDocument();

    // Step CTAs point at the funnel destinations.
    expect(screen.getByRole('link', { name: /Agendar visita/i })).toHaveAttribute(
      'href',
      '/agendar-visita',
    );
    expect(screen.getByRole('link', { name: /Ver documentación/i })).toHaveAttribute(
      'href',
      '/admisiones/documentacion',
    );
    expect(screen.getByRole('link', { name: 'Iniciar pre-registro' })).toHaveAttribute(
      'href',
      '/pre-registro',
    );

    // Step 1 reaches a human on WhatsApp with the prefilled informes message.
    const wa = screen.getByRole('link', { name: 'WhatsApp' });
    expect(wa.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/\d+\?text=/);
    expect(decodeURIComponent(wa.getAttribute('href')!)).toContain('informes de admisión');
  });

  it('includes the linkable cost estimator section', async () => {
    const { container } = renderWithProviders(<AdmissionsPage />, { route: '/admisiones' });

    expect(container.querySelector('#estimador')).not.toBeNull();
    expect(
      await screen.findByRole('heading', { name: '¿Cuánto cuesta por sección?' }),
    ).toBeInTheDocument();
  });
});
