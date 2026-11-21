import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/renderWithProviders';
import AdminPipeline, { columnParams } from './AdminPipeline';
import { api } from '@/services/api';

vi.mock('@/services/api', () => ({ api: { get: vi.fn() } }));

const COUNTS = { informes: 2, visita: 1, examen: 0, documentacion: 1, inscrito: 40, cerrado: 3 };

const row = (over: Record<string, unknown>) => ({
  id: 1, child_name: 'Lucía Prueba', parent_name: 'Marta Ejemplo', parent_phone: '5512345678', parent_email: '',
  level: 'primaria', level_label: 'Primaria', grade_applying: '2° Primaria', cycle: '2027-2028',
  stage: 'informes', stage_label: 'Informes', closed_outcome: '', closed_outcome_label: '', status: 'pending',
  next_action: { code: 'send_costs', label: 'Enviar cuotas' }, days_waiting: 9,
  stage_changed_at: null, exam_at: null, created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z',
  ...over,
});

const BY_STAGE: Record<string, unknown[]> = {
  informes: [row({ id: 1 }), row({ id: 2, child_name: 'Mateo Ejemplo', days_waiting: 1, next_action: { code: 'send_visit_link', label: 'Enviar liga de visita' } })],
  visita: [row({ id: 3, child_name: 'Sofía Prueba', stage: 'visita', next_action: { code: 'visit_outcome', label: 'Registrar resultado de la visita' } })],
  examen: [],
  documentacion: [row({ id: 4, child_name: 'Elena Prueba', stage: 'documentacion', next_action: { code: 'record_payment', label: 'Registrar pago de inscripción' } })],
  inscrito: [row({ id: 5, child_name: 'Iker Prueba', stage: 'inscrito', next_action: null })],
  cerrado: [row({ id: 6, child_name: 'Olga Prueba', stage: 'cerrado', closed_outcome: 'no_interesa', closed_outcome_label: 'No le interesa', next_action: null })],
};

const get = vi.mocked(api.get);

describe('AdminPipeline (stages board)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockImplementation(async (_url: string, cfg?: { params?: unknown }) => {
      const stage = (cfg?.params as { stage?: string } | undefined)?.stage ?? '';
      return { data: { count: COUNTS[stage as keyof typeof COUNTS] ?? 0, results: BY_STAGE[stage] ?? [], counts: COUNTS } } as never;
    });
  });

  it('asks for each column: open stages oldest first, done ones latest first', () => {
    expect(columnParams('visita')).toEqual({ stage: 'visita', page_size: 30, ordering: 'stage_changed_at' });
    expect(columnParams('cerrado')).toEqual({ stage: 'cerrado', page_size: 12, ordering: '-stage_changed_at' });
  });

  it('renders the five stages plus Cerrados with counts, next action and days waiting', async () => {
    renderWithProviders(<AdminPipeline />, { route: '/admin/admisiones/pipeline' });
    expect(await screen.findByText('Lucía Prueba')).toBeInTheDocument();
    const columns = screen.getAllByRole('listitem').filter((el) => el.tagName === 'SECTION');
    expect(columns.map((c) => within(c).getByRole('heading').textContent)).toEqual([
      'Informes2', 'Visita guiada1', 'Examen0', 'Documentación y acuerdos1', 'Inscrito40', 'Cerrados3',
    ]);
    const informes = columns[0];
    expect(within(informes).getByText('Enviar cuotas')).toBeInTheDocument();
    expect(within(informes).getByText('9 días')).toBeInTheDocument();
    expect(within(columns[5]).getByText('No le interesa')).toBeInTheDocument();
    // More cases than cards: the column links to the filtered list.
    expect(within(columns[4]).getByRole('link', { name: /Ver los 40/ })).toHaveAttribute('href', '/admin/admisiones?etapa=inscrito');
    expect(get).toHaveBeenCalledWith('/admissions/admin/cases/', { params: { stage: 'informes', page_size: 30, ordering: 'stage_changed_at' } });
  });

  it('a card opens its Expediente', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/admin/admisiones/pipeline" element={<AdminPipeline />} />
        <Route path="/admin/admisiones/:caseId" element={<p>Expediente abierto</p>} />
      </Routes>,
      { route: '/admin/admisiones/pipeline' },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir el expediente de Sofía Prueba' }));
    expect(await screen.findByText('Expediente abierto')).toBeInTheDocument();
  });

  it('shows the error state and retries', async () => {
    get.mockRejectedValueOnce(new Error('boom'));
    renderWithProviders(<AdminPipeline />, { route: '/admin/admisiones/pipeline' });
    await userEvent.click(await screen.findByRole('button', { name: /Reintentar/ }));
    await waitFor(() => expect(screen.getByText('Lucía Prueba')).toBeInTheDocument());
  });
});
