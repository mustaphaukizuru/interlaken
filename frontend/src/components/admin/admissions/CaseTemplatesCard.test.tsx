import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

import { CaseTemplatesCard } from './CaseTemplatesCard';
import { api } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const DEFAULTS = {
  costs: 'Hola {tutor}, le compartimos las cuotas de {nivel}: {liga}',
  exam_date: 'Hola {tutor}, el examen de {alumno} es el {fecha}.',
};
const PAYLOAD = {
  templates: { ...DEFAULTS, exam_date: 'Texto propio para {alumno}.' },
  customized: ['exam_date'],
  defaults: DEFAULTS,
  placeholders: { costs: ['{tutor}', '{nivel}', '{liga}'], exam_date: ['{tutor}', '{alumno}', '{fecha}'] },
  labels: { costs: 'Cuotas por nivel', exam_date: 'Fecha del examen' },
};

describe('CaseTemplatesCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ data: PAYLOAD } as never);
    vi.mocked(api.patch).mockImplementation(async (_u: string, body: unknown) => ({ data: { ...PAYLOAD, templates: { ...PAYLOAD.templates, ...(body as object) } } }) as never);
  });

  it('lists each message with its data as chips, marks the customized ones and inserts a chip', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CaseTemplatesCard />);
    const costs = await screen.findByLabelText('Cuotas por nivel');
    expect(screen.getByText('Personalizado')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Datos disponibles para «Cuotas por nivel»' })).toHaveTextContent('{tutor}{nivel}{liga}');
    await user.clear(costs);
    await user.type(costs, 'Cuotas: ');
    await user.click(screen.getAllByRole('button', { name: 'Insertar {liga}' })[0]);
    expect(costs).toHaveValue('Cuotas: {liga}');
    await user.click(screen.getByRole('button', { name: 'Guardar mensajes' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/admissions/admin/cases/templates/', { costs: 'Cuotas: {liga}' }));
    expect(await screen.findByText('Mensajes guardados.')).toBeInTheDocument();
  });

  it('«Restaurar» goes back to the system text, saved as no customization', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CaseTemplatesCard />);
    const exam = await screen.findByLabelText('Fecha del examen');
    expect(exam).toHaveValue('Texto propio para {alumno}.');
    await user.click(screen.getByRole('button', { name: /Restaurar el texto del sistema/ }));
    expect(exam).toHaveValue(DEFAULTS.exam_date);
    await user.click(screen.getByRole('button', { name: 'Guardar mensajes' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/admissions/admin/cases/templates/', { exam_date: '' }));
  });

  it('an unknown placeholder comes back on its message', async () => {
    const user = userEvent.setup();
    vi.mocked(api.patch).mockRejectedValueOnce({ response: { status: 400, data: { costs: ['«{precio}» no es un dato disponible. Use solo {tutor}, {nivel}, {liga}.'] } } });
    renderWithProviders(<CaseTemplatesCard />);
    const costs = await screen.findByLabelText('Cuotas por nivel');
    await user.type(costs, ' {{precio}');
    await user.click(screen.getByRole('button', { name: 'Guardar mensajes' }));
    expect(await screen.findByText(/no es un dato disponible/)).toBeInTheDocument();
    expect(costs).toHaveAttribute('aria-invalid', 'true');
  });
});
