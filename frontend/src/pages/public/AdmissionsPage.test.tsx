import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

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
    { section: '1° a 3° de Preescolar', colegiatura: '4920.00', order: 2 },
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
    const { container } = renderWithProviders(<AdmissionsPage />, { route: '/admisiones' });

    // The four step titles: informes, visit, exam, then the inscripción.
    expect(await screen.findByRole('heading', { name: 'Informes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Visita guiada' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Examen de valoración' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Inscripción' })).toBeInTheDocument();
    // The school sends the ficha after admission: the page says so.
    expect(screen.getByText(/Si su hijo\/a es admitido, le enviamos por correo o WhatsApp su ficha de inscripción personal/)).toBeInTheDocument();

    // Step CTAs point at the funnel destinations.
    const visits = screen.getAllByRole('link', { name: /Agendar visita/i });
    expect(visits.length).toBeGreaterThan(0);
    for (const link of visits) expect(link).toHaveAttribute('href', '/agendar-visita');
    expect(screen.getByRole('link', { name: /Ver documentación/i })).toHaveAttribute(
      'href',
      '/admisiones/documentacion',
    );
    expect(screen.getByRole('link', { name: /Ver costos/i })).toHaveAttribute('href', '/admisiones/costos');

    // The ficha de inscripción is private: nothing on the page links to it.
    expect(container.querySelector('a[href^="/pre-registro"]')).toBeNull();
    expect(screen.queryByRole('link', { name: /ficha de inscripción/i })).toBeNull();

    // Step 1 reaches a human on WhatsApp with the prefilled informes message.
    const wa = screen.getByRole('link', { name: 'WhatsApp' });
    expect(wa.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/\d+\?text=/);
    expect(decodeURIComponent(wa.getAttribute('href')!)).toContain('informes de admisión');
  });

  it('«Solicitar informes» opens WhatsApp with the number from Ajustes', async () => {
    renderWithProviders(<AdmissionsPage />, { route: '/admisiones' });
    const informes = await screen.findByRole('link', { name: 'Solicitar informes' });
    await waitFor(() => expect(informes.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/5215512345678\?text=/));
    expect(decodeURIComponent(informes.getAttribute('href')!)).toContain('recibir informes de admisión');
  });

  it('includes the linkable cost estimator section', async () => {
    const { container } = renderWithProviders(<AdmissionsPage />, { route: '/admisiones' });

    await screen.findByRole('heading', { name: 'Estime su inversión' });
    expect(container.querySelector('#estimador')).not.toBeNull();
    expect(
      await screen.findByRole('heading', { name: '¿Cuánto cuesta por sección?' }),
    ).toBeInTheDocument();
  });
});
