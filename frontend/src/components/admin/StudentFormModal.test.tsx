import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/api', () => ({
  portalApi: { createStudent: vi.fn(), updateStudent: vi.fn() },
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
});
