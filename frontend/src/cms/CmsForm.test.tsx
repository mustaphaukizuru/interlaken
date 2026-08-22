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
    await user.type(await screen.findByLabelText('Nombre *'), 'Ana');
    expect(screen.queryByLabelText('Grado')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Nivel *'), 'Primaria');
    await user.type(screen.getByLabelText('Grado'), '2');
    await user.click(screen.getByRole('checkbox', { name: /Acepto el aviso/ }));
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Gracias, Ana.'));
    expect(submitForm).toHaveBeenCalledWith('informes', expect.objectContaining({ nombre: 'Ana', nivel: 'Primaria', grado: '2', consent: true, _page: '/admisiones' }));
  });
});
