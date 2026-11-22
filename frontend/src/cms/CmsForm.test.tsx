import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { CmsForm, visibleFields } from './CmsForm';
import type { FormField } from '@/services/api';

const { FIELDS, submitForm } = vi.hoisted(() => ({
  FIELDS: [
    { key: 'nombre', label: 'Nombre', type: 'text', required: true },
    { key: 'nivel', label: 'Nivel', type: 'select', options: ['Preescolar', 'Primaria'], required: true },
    { key: 'grado', label: 'Grado', type: 'text', show_if: { field: 'nivel', equals: 'Primaria' } },
  ] as FormField[],
  submitForm: vi.fn().mockResolvedValue({ data: { ok: true, message: 'Gracias, Ana.' } }),
}));
vi.mock('@/services/api', () => ({
  contentApi: {
    getForm: vi.fn().mockResolvedValue({ data: { slug: 'informes', title: 'Informes', description: '', fields: FIELDS, consent_text: 'Acepto el aviso.', success_message: 'x', submit_label: 'Enviar' } }),
    submitForm: (...a: unknown[]) => submitForm(...a),
  },
}));

describe('visibleFields', () => {
  it('hides conditional fields until the condition holds', () => {
    expect(visibleFields(FIELDS, {}).map((f) => f.key)).toEqual(['nombre', 'nivel']);
    expect(visibleFields(FIELDS, { nivel: 'Primaria' }).map((f) => f.key)).toEqual(['nombre', 'nivel', 'grado']);
  });
});

describe('CmsForm', () => {
  it('reveals conditional field, submits with consent and shows the success message', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CmsForm slug="informes" />, { route: '/admisiones' });
    // Required fields carry no mark; optional ones say «(opcional)».
    await user.type(await screen.findByLabelText('Nombre'), 'Ana');
    expect(screen.getByLabelText('Nombre')).toHaveAttribute('autocomplete', 'name');
    expect(screen.queryByLabelText(/Grado/)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Nivel'), 'Primaria');
    await user.type(screen.getByLabelText('Grado (opcional)'), '2');
    await user.click(screen.getByRole('checkbox', { name: /Acepto el aviso/ }));
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Gracias, Ana.'));
    expect(submitForm).toHaveBeenCalledWith('informes', expect.objectContaining({ nombre: 'Ana', nivel: 'Primaria', grado: '2', consent: true, _page: '/admisiones' }));
  });

  it('a rejected field keeps its message under it, described by it, and takes the focus', async () => {
    const user = userEvent.setup();
    submitForm.mockRejectedValueOnce({ isAxiosError: true, response: { status: 400, data: { nivel: ['Elija un nivel.'], consent: ['Debe aceptar el aviso.'] } } });
    renderWithProviders(<CmsForm slug="informes" />, { route: '/admisiones' });
    await user.type(await screen.findByLabelText('Nombre'), 'Ana');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    const nivel = screen.getByLabelText('Nivel');
    await waitFor(() => expect(nivel).toHaveFocus());
    expect(nivel).toHaveAttribute('aria-invalid', 'true');
    expect(nivel).toHaveAccessibleDescription('Elija un nivel.');
    expect(screen.getByRole('checkbox', { name: /Acepto el aviso/ })).toHaveAccessibleDescription('Debe aceptar el aviso.');
  });
});
