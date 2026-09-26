import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';

vi.mock('@/services/api', () => ({
  portalApi: {
    getNotifications: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
  },
}));

import NotificationsPage from './NotificationsPage';
import { portalApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const getNotifications = vi.mocked(portalApi.getNotifications);
const markAll = vi.mocked(portalApi.markAllNotificationsRead);

function LocationProbe() {
  const { search } = useLocation();
  return <output data-testid="location">{search}</output>;
}
const urlParams = () => new URLSearchParams(screen.getByTestId('location').textContent ?? '');

const notif = {
  id: 1, title: 'Saldo bajo', message: 'El saldo de Emma es bajo', notif_type: 'cafeteria',
  is_read: false, created_at: '2026-09-10T12:00:00Z', link: '',
};

describe('NotificationsPage (Data Ops Phase 9)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads type, unread and page from the URL', async () => {
    getNotifications.mockResolvedValue({ data: { count: 41, results: [notif] } } as never);
    renderWithProviders(<NotificationsPage />, { route: '/portal/notificaciones?tipo=cafeteria&sin_leer=1&page=2' });
    await waitFor(() => expect(getNotifications).toHaveBeenCalledWith({ page: 2, type: 'cafeteria', unread: '1' }));
  });

  it('"Marcar todas como leídas" still calls the API and refreshes the list', async () => {
    getNotifications.mockResolvedValue({ data: { count: 1, results: [notif] } } as never);
    markAll.mockResolvedValue({ data: {} } as never);
    renderWithProviders(<NotificationsPage />, { route: '/portal/notificaciones' });
    await screen.findByText('Saldo bajo');
    await userEvent.click(screen.getByRole('button', { name: /Marcar todas como leídas/i }));
    await waitFor(() => expect(markAll).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getNotifications).toHaveBeenCalledTimes(2));
  });

  it('a filtered empty list offers "Ver todas", which clears the filters', async () => {
    getNotifications.mockResolvedValue({ data: { count: 0, results: [] } } as never);
    renderWithProviders(<><NotificationsPage /><LocationProbe /></>, { route: '/portal/notificaciones?sin_leer=1&page=2' });
    expect(await screen.findByText('Está al día')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ver todas' }));
    await waitFor(() => expect(urlParams().get('sin_leer')).toBeNull());
    expect(urlParams().get('page')).toBeNull();
  });

  it('shows the shared error state with a retry', async () => {
    getNotifications.mockRejectedValue(new Error('down'));
    renderWithProviders(<NotificationsPage />, { route: '/portal/notificaciones' });
    expect(await screen.findByRole('button', { name: /Reintentar/i })).toBeInTheDocument();
  });
});
