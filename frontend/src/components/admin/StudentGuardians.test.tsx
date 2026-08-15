import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  portalApi: {
    listGuardians: vi.fn(),
    linkGuardian: vi.fn(),
    unlinkGuardian: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

import toast from 'react-hot-toast';
import { StudentGuardians } from './StudentGuardians';
import { portalApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const listGuardians = vi.mocked(portalApi.listGuardians);
const linkGuardian = vi.mocked(portalApi.linkGuardian);
const unlinkGuardian = vi.mocked(portalApi.unlinkGuardian);
const toastSuccess = vi.mocked(toast.success);
const toastError = vi.mocked(toast.error);

const STUDENT = {
  id: 7,
  user_id: 70,
  name: 'Luis López',
  email: 'luis.lopez@interlaken.edu.mx',
  student_id: 'A-7',
  grade: '3°',
};

const GUARDIAN = {
  id: 31,
  email: 'ana@example.com',
  full_name: 'Ana López',
  phone: '5511111111',
  relationship: 'Madre',
  is_self: false,
};

describe('StudentGuardians', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listGuardians.mockResolvedValue({
      data: { student: STUDENT, guardians: [] },
    } as never);
    linkGuardian.mockResolvedValue({
      data: { created_user: true, already_linked: false, guardian: GUARDIAN },
    } as never);
    unlinkGuardian.mockResolvedValue({ data: {} } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows empty state and the self-link CTA when no guardians exist', async () => {
    renderWithProviders(<StudentGuardians studentId={7} />);

    expect(await screen.findByText('Sin tutores vinculados')).toBeInTheDocument();
    expect(screen.getByText(STUDENT.email)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Vincular cuenta del alumno/i }),
    ).toBeInTheDocument();
  });

  it('links the student family account from the CTA', async () => {
    linkGuardian.mockResolvedValueOnce({
      data: {
        created_user: false,
        already_linked: false,
        guardian: {
          id: 70,
          email: STUDENT.email,
          full_name: STUDENT.name,
          is_self: true,
        },
      },
    } as never);
    renderWithProviders(<StudentGuardians studentId={7} />);
    await screen.findByText('Sin tutores vinculados');

    await userEvent.click(
      screen.getByRole('button', { name: /Vincular cuenta del alumno/i }),
    );

    await waitFor(() => {
      expect(linkGuardian).toHaveBeenCalledWith(7, { email: STUDENT.email });
    });
    expect(toastSuccess).toHaveBeenCalledWith('Cuenta familiar del alumno vinculada.');
  });

  it('links a new tutor from the form and surfaces API errors', async () => {
    renderWithProviders(<StudentGuardians studentId={7} />);
    await screen.findByText('Sin tutores vinculados');

    await userEvent.click(screen.getByRole('button', { name: /^Vincular$/i }));
    fireEvent.change(screen.getByLabelText(/Correo del tutor/i), {
      target: { value: 'ana@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/Nombre completo/i), {
      target: { value: 'Ana López' },
    });
    await userEvent.click(screen.getByRole('button', { name: /Vincular tutor/i }));

    await waitFor(() => {
      expect(linkGuardian).toHaveBeenCalledWith(7, {
        email: 'ana@example.com',
        full_name: 'Ana López',
        phone: undefined,
        relationship: 'Padre/Madre',
      });
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      'Tutor creado y vinculado. Puede activar su cuenta con «Olvidé mi contraseña».',
    );

    linkGuardian.mockRejectedValueOnce({
      response: { data: { error: 'Ese correo ya pertenece a un alumno.' } },
    });
    await userEvent.click(screen.getByRole('button', { name: /^Vincular$/i }));
    fireEvent.change(screen.getByLabelText(/Correo del tutor/i), {
      target: { value: 'otro@example.com' },
    });
    await userEvent.click(screen.getByRole('button', { name: /Vincular tutor/i }));
    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Ese correo ya pertenece a un alumno.');
    });
  });

  it('lists guardians and unlinks after confirmation', async () => {
    listGuardians.mockResolvedValue({
      data: { student: STUDENT, guardians: [GUARDIAN] },
    } as never);

    renderWithProviders(<StudentGuardians studentId={7} />);

    expect(await screen.findByText('Ana López')).toBeInTheDocument();
    expect(screen.getByText(/ana@example\.com · Madre · 5511111111/)).toBeInTheDocument();
    // Self-link CTA remains until the student's own email is linked.
    expect(
      screen.getByRole('button', { name: /Vincular cuenta del alumno/i }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Desvincular/i }));
    // App-styled ConfirmDialog replaces window.confirm.
    const dialog = await screen.findByRole('dialog', { name: /Desvincular tutor/i });
    expect(within(dialog).getByText(/¿Desvincular a Ana López/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /^Desvincular$/i }));
    await waitFor(() => {
      expect(unlinkGuardian).toHaveBeenCalledWith(7, 31);
    });
    expect(toastSuccess).toHaveBeenCalledWith('Tutor desvinculado.');
  });

  it('shows ErrorState with retry on load failure', async () => {
    listGuardians
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ data: { student: STUDENT, guardians: [] } } as never);

    renderWithProviders(<StudentGuardians studentId={7} />);

    expect(await screen.findByText(/No se pudo cargar la información/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Reintentar/i }));
    expect(await screen.findByText('Sin tutores vinculados')).toBeInTheDocument();
  });
});
