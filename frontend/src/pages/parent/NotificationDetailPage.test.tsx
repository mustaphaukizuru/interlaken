import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/api', () => ({
  portalApi: {
    getNotification: vi.fn(),
    markNotificationRead: vi.fn(async () => ({ data: {} })),
  },
}));

import NotificationDetailPage from './NotificationDetailPage';
import { portalApi } from '@/services/api';

const getNotification = vi.mocked(portalApi.getNotification);
const markRead = vi.mocked(portalApi.markNotificationRead);

const notif = {
  id: 7,
  notif_type: 'warning' as const,
  type_label: 'Advertencia',
  title: 'Saldo bajo',
  message: 'Primera línea.\nSegunda línea con el detalle completo.',
  is_read: false,
  created_at: '2026-08-20T15:00:00Z',
  delivered_at: '2026-08-20T15:01:00Z',
  announcement: null,
  announcement_title: '',
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/portal/notificaciones/7']}>
        <Routes>
          <Route path="/portal/notificaciones/:id" element={<NotificationDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NotificationDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getNotification.mockResolvedValue({ data: notif } as any);
  });

  it('shows the whole message, not the two-line clamp the list uses', async () => {
    renderPage();
    expect(await screen.findByText('Saldo bajo')).toBeInTheDocument();
    expect(screen.getByText(/Segunda línea con el detalle completo/)).toBeInTheDocument();
    expect(screen.getByText('Advertencia')).toBeInTheDocument();
  });

  it('marks the notification read on open — that is what tapping it means', async () => {
    renderPage();
    await screen.findByText('Saldo bajo');
    await waitFor(() => expect(markRead).toHaveBeenCalledWith(7));
  });

  it('does not re-mark a notification that was already read', async () => {
    getNotification.mockResolvedValue({ data: { ...notif, is_read: true } } as any);
    renderPage();
    await screen.findByText('Saldo bajo');
    expect(markRead).not.toHaveBeenCalled();
  });

  it('links to the comunicado when the notification is about one', async () => {
    getNotification.mockResolvedValue({
      data: { ...notif, announcement: 12, announcement_title: 'Junta de padres' },
      } as any);
    renderPage();
    const link = await screen.findByRole('link', { name: /Abrir el comunicado/ });
    expect(link).toHaveAttribute('href', '/portal/comunicados/12');
    expect(screen.getByText('Junta de padres')).toBeInTheDocument();
  });

  it('surfaces an error state instead of a blank page', async () => {
    getNotification.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText(/No se pudo abrir la notificación/)).toBeInTheDocument();
  });
});
