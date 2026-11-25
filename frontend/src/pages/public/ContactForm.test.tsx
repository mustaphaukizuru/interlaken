/**
 * /contacto message form (UX refinement 2026-11-21): one pattern with the
 * other public forms. The first invalid field takes the focus, each message
 * describes its field, and the outcome shows inline where the form was (not
 * only in a passing toast). Synthetic person only.
 */
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  contactApi: { send: vi.fn() },
  contentApi: { getSettings: vi.fn(() => new Promise(() => {})) },
}));

import { contactApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { sections } from '@/cms/sections/contacto';

const send = vi.mocked(contactApi.send);
const main = sections.find((s) => s.type === 'contacto.main')!;
const Main = main.component as ComponentType<Record<string, unknown>>;
const renderForm = () => renderWithProviders(<Main {...main.defaults} />, { route: '/contacto' });

describe('Contacto · formulario', () => {
  it('focuses the first invalid field and describes it with its message', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    const name = screen.getByLabelText('Nombre');
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAttribute('autocomplete', 'name');
    expect(name.getAttribute('aria-describedby')).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });

  it('an empty e-mail asks for it; only a typed one is «revise» (QA 2026-11-24: it said «inválido»)', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText('Nombre'), 'Marta Ejemplo');
    await user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    const email = screen.getByLabelText('Correo electrónico');
    await waitFor(() => expect(email).toHaveFocus());
    expect(screen.getByText('Escriba su correo.')).toBeInTheDocument();
    expect(screen.queryByText(/inválido/)).toBeNull();

    await user.type(email, 'marta@');
    await user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    expect(await screen.findByText('Revise el correo: debe ser como nombre@ejemplo.com.')).toBeInTheDocument();
    expect(screen.queryByText('Escriba su correo.')).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('shows the answer inline: the confirmation replaces the form; a failure sits above the button', async () => {
    const user = userEvent.setup();
    send.mockRejectedValueOnce(new Error('red'));
    renderForm();
    await user.type(screen.getByLabelText('Nombre'), 'Marta Ejemplo');
    await user.type(screen.getByLabelText('Correo electrónico'), 'marta@ejemplo.test');
    await user.type(screen.getByLabelText('Asunto'), 'Informes');
    await user.type(screen.getByLabelText('Mensaje'), 'Quisiera conocer los costos de primaria.');
    await user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo enviar el mensaje. Intente nuevamente.');

    send.mockResolvedValueOnce({ data: {} } as never);
    await user.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    const ok = await screen.findByRole('status');
    expect(ok).toHaveTextContent('Mensaje enviado. Le responderemos pronto.');
    await waitFor(() => expect(ok).toHaveFocus());
    expect(screen.queryByRole('button', { name: 'Enviar mensaje' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Escribir otro mensaje' }));
    expect(screen.getByLabelText('Nombre')).toHaveValue('');
  });
});
