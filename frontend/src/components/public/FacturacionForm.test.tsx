import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('@/services/api', () => ({ contactApi: { requestInvoice: vi.fn().mockResolvedValue({ data: {} }) } }));
import { contactApi } from '@/services/api';
import { FacturacionForm } from './FacturacionForm';

// Owner 2026-11-26: no email when the form is sent; the page says the
// confirmation comes when the school registers the data.
describe('FacturacionForm: after sending', () => {
  it('says the confirmation arrives by email once the data is registered', async () => {
    renderWithProviders(<FacturacionForm billingEmail="facturas@interlaken.com.mx" />);
    await userEvent.type(screen.getByLabelText('Nombre del alumno'), 'Ana Pérez');
    await userEvent.type(screen.getByLabelText('Razón social'), 'Luis Pérez');
    await userEvent.type(screen.getByLabelText('RFC'), 'PELU800101AB1');
    await userEvent.type(screen.getByLabelText('Código postal'), '54000');
    await userEvent.selectOptions(screen.getByLabelText('Régimen fiscal'), 'Régimen simplificado de confianza');
    await userEvent.type(screen.getByLabelText('Correo para enviar facturas'), 'luis@test.mx');
    await userEvent.type(screen.getByLabelText('Teléfono de contacto'), '5512345678');
    await userEvent.click(screen.getByRole('button', { name: /Enviar solicitud/ }));
    const done = await screen.findByRole('status');
    expect(done).toHaveTextContent('Recibimos sus datos. Le confirmaremos por correo a luis@test.mx cuando queden registrados');
    expect(done).not.toHaveTextContent('Le enviamos una confirmación');
    expect(contactApi.requestInvoice).toHaveBeenCalledTimes(1);
  });
});
