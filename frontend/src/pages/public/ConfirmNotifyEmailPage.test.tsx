import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

vi.mock('@/services/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

import { api as http } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import ConfirmNotifyEmailPage from './ConfirmNotifyEmailPage';

// The page's calls: GET previews, POST confirms (same endpoint).
const api = {
  previewNotifyEmailLink: vi.mocked(http.get),
  confirmNotifyEmailLink: vi.mocked(http.post),
};
const READY = {
  state: 'ready', email: 'mu…@gmail.com', expires_at: '2026-11-12T03:46:00Z', separate_account: false,
  account: { name: 'Carla R.', detail: '1° Secundaria · Grupo A', is_student: true },
};

const open = (route = '/confirmar-correo?token=tok123') => renderWithProviders(
  <Routes>
    <Route path="/confirmar-correo" element={<ConfirmNotifyEmailPage />} />
  </Routes>,
  { route },
);

describe('ConfirmNotifyEmailPage (/confirmar-correo, owner 2026-11-08)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows what it confirms, confirms only on the click, then says it is done', async () => {
    api.previewNotifyEmailLink.mockResolvedValue({ data: READY } as never);
    api.confirmNotifyEmailLink.mockResolvedValue({ data: { ...READY, state: 'confirmed', verified: true } } as never);
    const u = userEvent.setup();
    open();

    expect(await screen.findByRole('heading', { name: 'Confirme su correo para avisos' })).toBeInTheDocument();
    expect(screen.getByText('Carla R. · 1° Secundaria · Grupo A')).toBeInTheDocument();
    expect(screen.getAllByText('mu…@gmail.com').length).toBeGreaterThan(0);
    expect(screen.getByText(/No necesita iniciar sesión/)).toBeInTheDocument();
    expect(api.previewNotifyEmailLink).toHaveBeenCalledWith('/accounts/notify-email/confirm/', { params: { token: 'tok123' } });
    expect(api.confirmNotifyEmailLink).not.toHaveBeenCalled(); // opening the link never confirms

    await u.click(screen.getByRole('button', { name: 'Confirmar correo' }));
    expect(await screen.findByRole('heading', { name: 'Listo, correo confirmado' })).toBeInTheDocument();
    expect(api.confirmNotifyEmailLink).toHaveBeenCalledWith('/accounts/notify-email/confirm/', { token: 'tok123' });
  });

  it('tells an address with its own login that the accounts stay separate', async () => {
    api.previewNotifyEmailLink.mockResolvedValue({ data: { ...READY, separate_account: true } } as never);
    open();
    expect(await screen.findByText(/Son cuentas separadas: confirmar aquí no las une/)).toBeInTheDocument();
  });

  it.each([
    ['expired', 'El enlace venció', 'Pida uno nuevo desde el portal'],
    ['superseded', 'Este enlace ya no se usa', 'se pidió otro correo'],
    ['invalid', 'El enlace no es válido', 'Ábralo completo'],
  ])('a %s link explains itself and offers the way back', async (state, title, detail) => {
    api.previewNotifyEmailLink.mockResolvedValue({
      data: { state, detail: state === 'invalid' ? undefined : `… ${detail} …` },
    } as never);
    open();
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(detail))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir al Portal de Familias' })).toBeInTheDocument();
  });

  it('a link that expired between opening and clicking shows the server answer', async () => {
    api.previewNotifyEmailLink.mockResolvedValue({ data: READY } as never);
    api.confirmNotifyEmailLink.mockRejectedValue({ response: { data: { state: 'expired', detail: 'El enlace venció. Pida uno nuevo.' } } });
    const u = userEvent.setup();
    open();
    await u.click(await screen.findByRole('button', { name: 'Confirmar correo' }));
    expect(await screen.findByRole('heading', { name: 'El enlace venció' })).toBeInTheDocument();
  });
});
