/**
 * Bitácora de pruebas 13/10/2026: the client's requests for the public site.
 * One test per point so a regression names the request it breaks.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import ContactPage from '@/pages/public/ContactPage';
import PagosPage from '@/pages/public/PagosPage';
import PlataformasPage from '@/pages/public/PlataformasPage';
import FacturacionPage from '@/pages/public/FacturacionPage';
import DocumentacionPage from '@/pages/public/DocumentacionPage';
import { contactApi } from '@/services/api';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return { ...actual, contactApi: { ...actual.contactApi, send: vi.fn(), requestInvoice: vi.fn() } };
});

describe('Bitácora 13/10/2026', () => {
  it('ref. 3 · Contacto: no email on the contact card, phone labelled with WhatsApp', () => {
    renderWithProviders(<ContactPage />);
    expect(screen.getByText('Teléfono o WhatsApp')).toBeInTheDocument();
    expect(screen.queryByText(/^Correo$/)).not.toBeInTheDocument();
  });

  it('ref. 6 · Pagos: colegiaturas y boletas (ServoEscolar) and cafetería, no top card', () => {
    renderWithProviders(<PagosPage />);
    expect(screen.getByRole('heading', { name: 'Colegiaturas y boletas' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cafetería' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ir a colegiaturas y boletas/ })).toHaveAttribute('href', 'https://interlaken.servoescolar.mx/');
    expect(screen.getByRole('link', { name: /Entrar a Cafetería/ })).toHaveAttribute('href', '/login');
    expect(screen.queryByText('ServoEscolar')).not.toBeInTheDocument();
  });

  it('ref. 6 · Plataformas: alumnos y docentes plus Educar es Padre, no payments', () => {
    renderWithProviders(<PlataformasPage />);
    for (const name of ['Google Classroom', 'Gmail institucional', 'Mosyle — registro de iPad', 'Educar es Padre']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('heading', { name: 'Cafetería' })).not.toBeInTheDocument();
  });

  it('ref. 8 · Facturación: the 7 official fields, all required, and the payments-portal link', async () => {
    renderWithProviders(<FacturacionPage />);
    const form = screen.getByRole('form', { name: 'Solicitud de facturación' });
    for (const label of ['Nombre del alumno', 'Razón social', 'RFC', 'Código postal', 'Correo para enviar facturas', 'Teléfono de contacto']) {
      expect(within(form).getByLabelText(new RegExp(label))).toBeInTheDocument();
    }
    const regimen = within(form).getByLabelText('Régimen fiscal');
    expect(within(regimen).getAllByRole('option')).toHaveLength(13); // placeholder + 12 regímenes
    expect(screen.queryByText(/Historial y comprobantes/)).not.toBeInTheDocument();
    expect(screen.getByText(/Si desea descargar sus facturas, puede consultarlas desde nuestro portal de pagos/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ir al portal de pagos/ })).toHaveAttribute('href', 'https://interlaken.servoescolar.mx/');

    await userEvent.click(within(form).getByRole('button', { name: /Enviar solicitud/ }));
    expect(within(form).getAllByText('Requerido.')).toHaveLength(7);
    expect(contactApi.requestInvoice).not.toHaveBeenCalled();
  });

  it('ref. 9 · Documentación: no «Trámites INE» link and no closing note', () => {
    renderWithProviders(<DocumentacionPage />);
    expect(screen.getByText(/INE de cada padre o tutor/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Trámites INE/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Los enlaces llevan a los portales oficiales/)).not.toBeInTheDocument();
  });
});
