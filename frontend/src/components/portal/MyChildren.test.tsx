import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/myFamilyApi', () => ({
  myFamilyApi: { get: vi.fn(), add: vi.fn(), confirm: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import toast from 'react-hot-toast';
import { MyChildren } from './MyChildren';
import { myFamilyApi } from '@/services/myFamilyApi';
import { renderWithProviders } from '@/test/renderWithProviders';

const olivia = {
  id: 1, name: 'Olivia Alvarado Felix', first_name: 'Olivia', last_name: 'Alvarado Felix', email: 'ci10073@interlaken.com.mx',
  student_id: '10073', grade: '2° Primaria', group: 'A', status: 'active', status_label: 'Activo', archived: false, family: null,
};
const alejandro = { ...olivia, id: 2, name: 'Alejandro Alvarado Felix', first_name: 'Alejandro', student_id: '09628', grade: '1° Secundaria' };

const get = vi.mocked(myFamilyApi.get);
const add = vi.mocked(myFamilyApi.add);
const confirm = vi.mocked(myFamilyApi.confirm);

describe('MyChildren (Mi perfil → Mis hijos)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue({ data: { children: [olivia], can_add: true } } as never);
  });

  it('lists the children and adds another one with the emailed code', async () => {
    add.mockResolvedValue({ data: {
      sent_to: ['ci…@interlaken.com.mx'], expires_in_minutes: 15,
      student: { name: 'Alejandro Alvarado Felix', first_name: 'Alejandro', grade: '1° Secundaria', group: 'A' },
    } } as never);
    confirm.mockResolvedValue({ data: { linked: 'Alejandro Alvarado Felix', children: [olivia, alejandro] } } as never);

    renderWithProviders(<MyChildren />);
    expect(await screen.findByText('Olivia Alvarado Felix')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Agregar otro hijo/ }));
    const field = screen.getByLabelText('Correo escolar o matrícula de su otro hijo');
    await userEvent.type(field, 'ci09628@interlaken.com.mx');
    await userEvent.click(screen.getByRole('button', { name: /Enviar código/ }));
    await waitFor(() => expect(add).toHaveBeenCalledWith('ci09628@interlaken.com.mx'));

    // Step 2 says where the code went and for whom.
    expect(await screen.findByText('ci…@interlaken.com.mx')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: /Agregar a Alejandro/ });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Código de 6 números'), '123 456');
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('ci09628@interlaken.com.mx', '123 456'));
    expect(toast.success).toHaveBeenCalledWith('Alejandro Alvarado Felix ya aparece en su cuenta.');
  });

  it('shows the server reason next to the field', async () => {
    add.mockRejectedValue({ isAxiosError: true, response: { status: 400, data: { detail: 'No encontramos a ningún alumno con ese correo o matrícula.' } } });
    renderWithProviders(<MyChildren />);
    await userEvent.click(await screen.findByRole('button', { name: /Agregar otro hijo/ }));
    await userEvent.type(screen.getByLabelText('Correo escolar o matrícula de su otro hijo'), 'nadie');
    await userEvent.click(screen.getByRole('button', { name: /Enviar código/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No encontramos');
  });

  it('a wrong code keeps the person on the code step with the message', async () => {
    add.mockResolvedValue({ data: {
      sent_to: ['ci…@interlaken.com.mx'], expires_in_minutes: 15,
      student: { name: 'Alejandro Alvarado Felix', first_name: 'Alejandro', grade: '1° Secundaria', group: 'A' },
    } } as never);
    confirm.mockRejectedValue({ isAxiosError: true, response: { status: 400, data: { detail: 'El código no coincide. Le quedan 4 intentos.' } } });
    renderWithProviders(<MyChildren />);
    await userEvent.click(await screen.findByRole('button', { name: /Agregar otro hijo/ }));
    await userEvent.type(screen.getByLabelText('Correo escolar o matrícula de su otro hijo'), '09628');
    await userEvent.click(screen.getByRole('button', { name: /Enviar código/ }));
    await userEvent.type(await screen.findByLabelText('Código de 6 números'), '000000');
    await userEvent.click(screen.getByRole('button', { name: /Agregar a Alejandro/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Le quedan 4 intentos');
    expect(screen.getByLabelText('Código de 6 números')).toBeInTheDocument();
  });
});
