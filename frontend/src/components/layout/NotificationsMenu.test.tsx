import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  portalApi: {
    getNotifications: vi.fn(async () => ({ data: [
      {
        id: 1, notif_type: 'cafeteria', is_read: false, created_at: new Date().toISOString(),
        title: '2 recarga(s) en línea por cargar en el POS',
        message: 'Recargas pagadas con tarjeta (total $550.00):\n\n- Ana Ruiz · $350.00\n- Beto Lara · $200.00\n\nCárguelas en el POS.',
      },
    ] })),
    markNotificationRead: vi.fn(async () => ({ data: {} })),
    markAllNotificationsRead: vi.fn(async () => ({ data: {} })),
  },
}));

import { NotificationsMenu } from './NotificationsMenu';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';

describe('NotificationsMenu', () => {
  it('previews a long report on desktop: two clamped lines and the unread count, never the list', async () => {
    stubViewport(1280);
    renderWithProviders(<NotificationsMenu />);
    await userEvent.click(await screen.findByRole('button', { name: 'Notificaciones, 1 sin leer' }));
    expect(screen.getByText('1 sin leer')).toBeInTheDocument();
    expect(screen.getByText('Recargas pagadas con tarjeta (total $550.00)…')).toHaveClass('line-clamp-2');
    expect(screen.queryByText(/Beto Lara/)).toBeNull();
    expect(screen.getByRole('link', { name: /Ver todas/ })).toHaveAttribute('href', '/portal/notificaciones');
  });

  it('opens the phone sheet on <body>, above the tab bar, with «Ver todas» inside', async () => {
    stubViewport(390);
    const { container } = renderWithProviders(<NotificationsMenu />);
    await userEvent.click(await screen.findByRole('button', { name: /Notificaciones/ }));
    const sheet = screen.getByRole('dialog', { name: 'Notificaciones' });
    expect(container.contains(sheet)).toBe(false);
    expect(sheet.parentElement).toBe(document.body);
    expect(within(sheet).getByRole('link', { name: /Ver todas/ })).toBeInTheDocument();
  });
});
