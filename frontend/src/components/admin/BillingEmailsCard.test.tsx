import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { BillingEmailsCard, parseEmails } from './BillingEmailsCard';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/api', () => ({ contentApi: { adminUpdateSettings: vi.fn() } }));
import toast from 'react-hot-toast';
import { contentApi } from '@/services/api';

const SAVED = ['facturas@interlaken.com.mx', 'vvega@interlaken.com.mx'];

beforeEach(() => {
  vi.mocked(contentApi.adminUpdateSettings).mockReset();
  vi.mocked(toast.success).mockReset();
});

describe('Ajustes → «Solicitudes de factura» (owner 2026-11-26)', () => {
  it('shows the saved addresses, one per line, and saves only when something changed', () => {
    renderWithProviders(<BillingEmailsCard value={SAVED} loaded />);
    expect(screen.getByLabelText(/Correos que reciben las solicitudes de factura/)).toHaveValue(SAVED.join('\n'));
    expect(screen.getByRole('button', { name: 'Guardar correos' })).toBeDisabled();
  });

  it('saves the edited list as an array and says how many', async () => {
    vi.mocked(contentApi.adminUpdateSettings).mockResolvedValue({ data: { billing_emails: ['facturas@interlaken.com.mx'] } } as never);
    renderWithProviders(<BillingEmailsCard value={SAVED} loaded />);
    const box = screen.getByLabelText(/Correos que reciben/);
    await userEvent.clear(box);
    await userEvent.type(box, 'Facturas@Interlaken.com.mx');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar correos' }));
    await waitFor(() => expect(contentApi.adminUpdateSettings).toHaveBeenCalledWith({ billing_emails: ['facturas@interlaken.com.mx'] }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Listo: las solicitudes de factura llegan a 1 correo.'));
  });

  it('shows the server’s reason when an address is wrong', async () => {
    vi.mocked(contentApi.adminUpdateSettings).mockRejectedValue({
      isAxiosError: true, response: { status: 400, data: { billing_emails: ['Revise el correo «malo».'] } },
    });
    renderWithProviders(<BillingEmailsCard value={SAVED} loaded />);
    await userEvent.type(screen.getByLabelText(/Correos que reciben/), '\nmalo');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar correos' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Revise el correo «malo».');
  });

  it('reads commas and new lines alike', () => {
    expect(parseEmails('a@x.mx, B@x.mx\n\nc@x.mx;')).toEqual(['a@x.mx', 'b@x.mx', 'c@x.mx']);
  });
});
