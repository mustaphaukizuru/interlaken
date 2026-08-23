import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import AdminSchoolYear from './AdminSchoolYear';

const { run } = vi.hoisted(() => ({ run: vi.fn().mockResolvedValue({ data: { promoted: 40, graduated: 12, thresholds_reset: 0, school_year: '2027-2028' } }) }));
vi.mock('@/services/api', () => ({
  portalApi: {
    schoolYearPreview: vi.fn().mockResolvedValue({ data: { moves: [{ from: '1° Primaria', to: '2° Primaria', count: 40 }, { from: '3° Secundaria', to: 'Egresado', count: 12 }], graduates: 12, active_total: 52, skipped: 3, current_cycle: '2026-2027', suggested_cycle: '2027-2028', last_rollover_at: null } }),
    schoolYearRun: (...a: unknown[]) => run(...a),
  },
}));

describe('AdminSchoolYear', () => {
  it('previews, requires AVANZAR, then shows the result', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminSchoolYear />, { route: '/admin/nuevo-ciclo' });
    expect(await screen.findByText(/52 alumnos activos · 12 egresan/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Continuar/ }));
    const apply = screen.getByRole('button', { name: /Aplicar nuevo ciclo/ });
    expect(apply).toBeDisabled();
    await user.type(screen.getByLabelText(/Escriba AVANZAR/), 'avanzar');
    expect(apply).toBeEnabled();
    await user.click(apply);
    expect(await screen.findByText(/Ciclo 2027-2028 aplicado/)).toBeInTheDocument();
    expect(run).toHaveBeenCalledWith({ confirm: 'AVANZAR', new_cycle: '2027-2028', reset_threshold: null });
  });
});
