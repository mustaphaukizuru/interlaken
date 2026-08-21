import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  portalApi: {
    listGuardians: vi.fn(),
    linkGuardian: vi.fn(),
    unlinkGuardian: vi.fn(),
    setUserPassword: vi.fn(),
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
const setUserPassword = vi.mocked(portalApi.setUserPassword);
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
    setUserPassword.mockResolvedValue({
      data: { detail: 'Contraseña restablecida.', sessions_revoked: 0 },
    } as never);
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

describe('StudentGuardians — admin password reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listGuardians.mockResolvedValue({
      data: { student: STUDENT, guardians: [GUARDIAN] },
    } as never);
    setUserPassword.mockResolvedValue({
      data: { detail: 'Contraseña restablecida.', sessions_revoked: 1 },
    } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const openDialogFor = async (name: RegExp) => {
    renderWithProviders(<StudentGuardians studentId={7} />);
    await screen.findByText('Ana López');
    await userEvent.click(screen.getByRole('button', { name }));
    return screen.findByRole('dialog', { name: /Restablecer contraseña/i });
  };

  it('opens the reset dialog for a guardian with the generate option preselected', async () => {
    const dialog = await openDialogFor(/Restablecer la contraseña de Ana López/i);

    expect(within(dialog).getByText('ana@example.com')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('radio', { name: /Generar contraseña temporal/i }),
    ).toBeChecked();
    expect(
      within(dialog).getByRole('radio', { name: /Escribir una contraseña/i }),
    ).not.toBeChecked();
    // Nothing is sent just by opening the dialog.
    expect(setUserPassword).not.toHaveBeenCalled();
  });

  it('generates a temporary password and shows it once, with a copy button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    setUserPassword.mockResolvedValueOnce({
      data: {
        detail: 'Contraseña restablecida.',
        temporary_password: 'Jkma-7Rqt-4Wxy-Pn3D',
        sessions_revoked: 2,
      },
    } as never);

    const dialog = await openDialogFor(/Restablecer la contraseña de Ana López/i);
    fireEvent.change(within(dialog).getByLabelText(/Motivo/i), {
      target: { value: 'Mamá en recepción' },
    });

    // Explicit confirmation step before anything is applied.
    await userEvent.click(within(dialog).getByRole('button', { name: /Continuar/i }));
    expect(setUserPassword).not.toHaveBeenCalled();
    expect(await screen.findByText(/se cerrarán todas sus sesiones abiertas/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Sí, restablecer/i }));

    await waitFor(() => {
      expect(setUserPassword).toHaveBeenCalledWith(31, {
        password: undefined,
        reason: 'Mamá en recepción',
      });
    });

    expect(await screen.findByText('Jkma-7Rqt-4Wxy-Pn3D')).toBeInTheDocument();
    expect(screen.getByText(/no se volverá a mostrar/i)).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: /Copiar la contraseña temporal/i }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Jkma-7Rqt-4Wxy-Pn3D'));
  });

  it('posts the typed password and never displays it back', async () => {
    const dialog = await openDialogFor(/Restablecer la contraseña de Ana López/i);

    await userEvent.click(within(dialog).getByRole('radio', { name: /Escribir una contraseña/i }));
    fireEvent.change(within(dialog).getByLabelText(/Nueva contraseña/i), {
      target: { value: 'ClaveFamiliar2026' },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: /Continuar/i }));
    await userEvent.click(screen.getByRole('button', { name: /Sí, restablecer/i }));

    await waitFor(() => {
      expect(setUserPassword).toHaveBeenCalledWith(31, {
        password: 'ClaveFamiliar2026',
        reason: undefined,
      });
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      'Contraseña actualizada. Se cerraron las sesiones abiertas.',
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Restablecer contraseña/i })).toBeNull(),
    );
  });

  it('rejects a too-short typed password client-side without calling the API', async () => {
    const dialog = await openDialogFor(/Restablecer la contraseña de Ana López/i);

    await userEvent.click(within(dialog).getByRole('radio', { name: /Escribir una contraseña/i }));
    fireEvent.change(within(dialog).getByLabelText(/Nueva contraseña/i), {
      target: { value: 'corta' },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: /Continuar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/al menos 10 caracteres/i);
    expect(setUserPassword).not.toHaveBeenCalled();
  });

  it('surfaces the API validation error and keeps the dialog open', async () => {
    setUserPassword.mockRejectedValueOnce({
      response: { data: { password: ['Esta contraseña es demasiado común.'] } },
    });

    const dialog = await openDialogFor(/Restablecer la contraseña de Ana López/i);
    await userEvent.click(within(dialog).getByRole('button', { name: /Continuar/i }));
    await userEvent.click(screen.getByRole('button', { name: /Sí, restablecer/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Esta contraseña es demasiado común.',
    );
    expect(toastError).toHaveBeenCalledWith('Esta contraseña es demasiado común.');
    expect(screen.getByRole('dialog', { name: /Restablecer contraseña/i })).toBeInTheDocument();
  });

  it('offers the reset for the student own account before it is linked', async () => {
    listGuardians.mockResolvedValue({
      data: { student: STUDENT, guardians: [] },
    } as never);
    renderWithProviders(<StudentGuardians studentId={7} />);
    await screen.findByText('Sin tutores vinculados');

    await userEvent.click(
      screen.getByRole('button', {
        name: /Restablecer la contraseña de la cuenta del alumno/i,
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: /Restablecer contraseña/i });
    await userEvent.click(within(dialog).getByRole('button', { name: /Continuar/i }));
    await userEvent.click(screen.getByRole('button', { name: /Sí, restablecer/i }));

    // STUDENT.user_id — the alumno's own login, not the StudentProfile id.
    await waitFor(() => {
      expect(setUserPassword).toHaveBeenCalledWith(70, {
        password: undefined,
        reason: undefined,
      });
    });
  });
});
