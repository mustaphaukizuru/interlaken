import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/api', () => ({
  portalApi: { createStudent: vi.fn(), updateStudent: vi.fn(), studentsBulk: vi.fn(), getStudent: vi.fn() },
}));

import { renderWithProviders } from '@/test/renderWithProviders';
import { StudentFormModal } from './StudentFormModal';
import { portalApi } from '@/services/api';

const createStudent = vi.mocked(portalApi.createStudent);

describe('StudentFormModal', () => {
  beforeEach(() => createStudent.mockReset());

  it('validates required fields before calling the API', async () => {
    renderWithProviders(<StudentFormModal open onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /crear alumno/i }));
    expect(screen.getAllByText('Requerido.').length).toBeGreaterThanOrEqual(3);
    expect(createStudent).not.toHaveBeenCalled();
  });

  it('creates a student with an uppercased matrícula and blank email', async () => {
    createStudent.mockResolvedValue({ data: { id: 9, user: { email: 'a1@alumnos.interlaken.edu.mx' } } } as never);
    const onClose = vi.fn();
    renderWithProviders(<StudentFormModal open onClose={onClose} />);
    await userEvent.type(screen.getByLabelText(/^nombre\(s\)/i), 'Ana');
    await userEvent.type(screen.getByLabelText(/apellidos/i), 'Pérez');
    await userEvent.type(screen.getByLabelText(/matrícula/i), 'a1');
    await userEvent.selectOptions(screen.getByLabelText(/grado/i), '1° Primaria');
    await userEvent.click(screen.getByRole('button', { name: /crear alumno/i }));
    await waitFor(() => expect(createStudent).toHaveBeenCalledTimes(1));
    expect(createStudent.mock.calls[0][0]).toMatchObject({ first_name: 'Ana', student_id: 'A1', grade: '1° Primaria', email: '', enrollment_date: null });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows DRF field errors next to the field', async () => {
    createStudent.mockRejectedValueOnce({ response: { status: 400, data: { student_id: ['Ya existe un alumno con esa matrícula.'] } } });
    renderWithProviders(<StudentFormModal open onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText(/^nombre\(s\)/i), 'Ana');
    await userEvent.type(screen.getByLabelText(/apellidos/i), 'Pérez');
    await userEvent.type(screen.getByLabelText(/matrícula/i), 'a1');
    await userEvent.selectOptions(screen.getByLabelText(/grado/i), '1° Primaria');
    await userEvent.click(screen.getByRole('button', { name: /crear alumno/i }));
    expect(await screen.findByText('Ya existe un alumno con esa matrícula.')).toBeInTheDocument();
  });

  it('points to the archived file that already holds the matrícula and restores it', async () => {
    createStudent.mockRejectedValueOnce({ response: { status: 400, data: {
      student_id: ['Ya existe un alumno con esa matrícula.'],
      existing: { id: 41, name: 'Beto Ruiz', student_id: 'B2', status: 'withdrawn', archived: true },
    } } });
    vi.mocked(portalApi.studentsBulk).mockResolvedValue({ data: { ok: 1 } } as never);
    const onClose = vi.fn();
    renderWithProviders(<StudentFormModal open onClose={onClose} />);
    await userEvent.type(screen.getByLabelText(/^nombre\(s\)/i), 'Beto');
    await userEvent.type(screen.getByLabelText(/apellidos/i), 'Ruiz');
    await userEvent.type(screen.getByLabelText(/matrícula/i), 'b2');
    await userEvent.selectOptions(screen.getByLabelText(/grado/i), '1° Primaria');
    await userEvent.click(screen.getByRole('button', { name: /crear alumno/i }));

    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent('La matrícula B2 ya pertenece a Beto Ruiz, que está archivado.');
    expect(screen.getByRole('link', { name: 'Abrir expediente' })).toHaveAttribute('href', '/admin/alumnos/41');
    await userEvent.click(screen.getByRole('button', { name: 'Restaurar a Beto' }));
    await waitFor(() => expect(portalApi.studentsBulk).toHaveBeenCalledWith(expect.objectContaining({ action: 'restore', ids: [41], dry_run: false })));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('StudentFormModal never overwrites medical data it did not show (launch review)', () => {
  const rosterRow = {
    id: 7, student_id: 'C3', grade: '2° Primaria', group: 'A', status: 'active', is_active: true,
    user: { id: 70, first_name: 'Caro', last_name: 'Díaz', email: 'c3@alumnos.interlaken.edu.mx', full_name: 'Caro Díaz' },
  };
  beforeEach(() => {
    vi.mocked(portalApi.updateStudent).mockReset().mockResolvedValue({ data: rosterRow } as never);
    vi.mocked(portalApi.getStudent).mockReset();
  });

  it('loads the file when opened from the roster, then sends only what changed', async () => {
    vi.mocked(portalApi.getStudent).mockResolvedValue({ data: {
      ...rosterRow, blood_type: 'O+', allergies: 'Nuez', medical_notes: 'Asma leve',
    } } as never);
    renderWithProviders(<StudentFormModal open onClose={() => {}} student={rosterRow as never} />);

    expect(await screen.findByDisplayValue('Nuez')).toBeInTheDocument();
    const group = screen.getByLabelText(/^grupo/i);
    await userEvent.clear(group);
    await userEvent.type(group, 'b');
    await userEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));

    await waitFor(() => expect(portalApi.updateStudent).toHaveBeenCalledTimes(1));
    expect(vi.mocked(portalApi.updateStudent).mock.calls[0]).toEqual([7, { group: 'B' }]);
  });

  it('shows a lock instead of masked values and never sends them', async () => {
    const masked = { ...rosterRow, medical_masked: 'role', blood_type: '●●●', allergies: '●●●', medical_notes: '●●●' };
    renderWithProviders(<StudentFormModal open onClose={() => {}} student={masked as never} />);

    expect(screen.getByText(/solo administración ve y edita los datos médicos/i)).toBeInTheDocument();
    expect(screen.queryByDisplayValue('●●●')).toBeNull();
    expect(portalApi.getStudent).not.toHaveBeenCalled();
    const group = screen.getByLabelText(/^grupo/i);
    await userEvent.clear(group);
    await userEvent.type(group, 'c');
    await userEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));

    await waitFor(() => expect(portalApi.updateStudent).toHaveBeenCalledTimes(1));
    expect(vi.mocked(portalApi.updateStudent).mock.calls[0]).toEqual([7, { group: 'C' }]);
  });
});
