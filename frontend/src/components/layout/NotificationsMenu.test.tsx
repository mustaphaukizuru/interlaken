import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const LIST = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock('@/services/api', () => ({
  portalApi: {
    getNotifications: vi.fn(async () => ({ data: LIST.items })),
    markNotificationRead: vi.fn(async () => ({ data: {} })),
    markAllNotificationsRead: vi.fn(async () => ({ data: {} })),
  },
}));

import { NotificationsMenu } from './NotificationsMenu';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';
import { portalApi } from '@/services/api';

const REPORT = {
  id: 1, notif_type: 'cafeteria', is_read: false, created_at: new Date().toISOString(),
  title: '2 recarga(s) en línea por cargar en el POS',
  message: 'Recargas pagadas con tarjeta (total $550.00):\n\n- Ana Ruiz · $350.00\n- Beto Lara · $200.00\n\nCárguelas en el POS.',
};

describe('NotificationsMenu', () => {
  it('previews a long report on desktop: two clamped lines, one unread dot, never the list', async () => {
    LIST.items = [REPORT];
    stubViewport(1280);
    renderWithProviders(<NotificationsMenu />);
    await userEvent.click(await screen.findByRole('button', { name: 'Avisos, 1 sin leer' }));
    expect(screen.getByText('Recargas pagadas con tarjeta (total $550.00)…')).toHaveClass('line-clamp-2');
    expect(screen.queryByText(/Beto Lara/)).toBeNull();
    // Unread reads as one dot per row, nothing else.
    expect(screen.getAllByRole('img', { name: 'Sin leer' })).toHaveLength(1);
    expect(screen.queryByText('1 sin leer')).toBeNull();
    expect(screen.getByRole('link', { name: /Ver todos los avisos/ })).toHaveAttribute('href', '/portal/notificaciones');
    await userEvent.click(screen.getByRole('button', { name: 'Marcar todo como leído' }));
    expect(portalApi.markAllNotificationsRead).toHaveBeenCalled();
  });

  it('the bell shows the real unread total of the account, not that of the first page (QA 2026-11-24)', async () => {
    const page = Array.from({ length: 20 }, (_, i) => ({ ...REPORT, id: i + 1, is_read: i === 19 }));
    LIST.items = { count: 83, results: page, unread_count: 75 } as never;
    stubViewport(1280);
    renderWithProviders(<NotificationsMenu />);
    expect(await screen.findByRole('button', { name: 'Avisos, 75 sin leer' })).toHaveTextContent('9+');
  });

  it('«Marcar todo como leído» stays on when the unread ones are past the first page', async () => {
    LIST.items = { count: 40, results: [{ ...REPORT, is_read: true }], unread_count: 12 } as never;
    stubViewport(1280);
    renderWithProviders(<NotificationsMenu />);
    await userEvent.click(await screen.findByRole('button', { name: 'Avisos, 12 sin leer' }));
    expect(screen.getByRole('button', { name: 'Marcar todo como leído' })).toBeEnabled();
  });

  it('«Marcar todo como leído» is disabled when nothing is unread', async () => {
    LIST.items = [{ ...REPORT, is_read: true }];
    stubViewport(1280);
    renderWithProviders(<NotificationsMenu />);
    await userEvent.click(await screen.findByRole('button', { name: 'Avisos' }));
    expect(screen.getByRole('button', { name: 'Marcar todo como leído' })).toBeDisabled();
  });

  it('pins unread urgent alerts first, under «Urgentes»', async () => {
    const at = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    LIST.items = [
      { id: 2, notif_type: 'info', is_read: false, created_at: at(0), title: 'Junta de padres', message: 'El viernes.' },
      { id: 3, notif_type: 'warning', is_read: false, created_at: at(30), title: 'Suspensión de clases', message: 'Mañana.' },
    ];
    stubViewport(1280);
    renderWithProviders(<NotificationsMenu />);
    await userEvent.click(await screen.findByRole('button', { name: 'Avisos, 2 sin leer' }));
    const sections = screen.getAllByRole('region');
    expect(sections[0]).toHaveAccessibleName('Urgentes');
    expect(within(sections[0]).getByText('Suspensión de clases')).toBeInTheDocument();
  });

  it('opens the phone sheet on <body>, above the tab bar, with «Ver todos los avisos» inside', async () => {
    LIST.items = [REPORT];
    stubViewport(390);
    const { container } = renderWithProviders(<NotificationsMenu />);
    await userEvent.click(await screen.findByRole('button', { name: /Avisos/ }));
    const sheet = screen.getByRole('dialog', { name: 'Avisos' });
    expect(container.contains(sheet)).toBe(false);
    expect(document.body.contains(sheet)).toBe(true);
    expect(within(sheet).getByRole('link', { name: /Ver todos los avisos/ })).toBeInTheDocument();
    // 44 px targets in the sheet header.
    expect(within(sheet).getByRole('button', { name: 'Marcar todo como leído' }).className).toMatch(/min-h-\[44px\]/);
  });
});
