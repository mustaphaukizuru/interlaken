import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationBody } from './NotificationBody';
import { NotificationList } from './NotificationList';
import type { Notif } from '@/lib/notifications';

const REPORT = [
  'Recargas pagadas con tarjeta que aún no están en el saldo de cafetería (total $550.00):',
  '',
  '- Emilia Torres Vega · cliente Loyverse C-0042 · $350.00 · folio 812',
  '- Joaquín Torres Vega · $200.00 · folio 815 · VENCIDA · SIN VERIFICAR: verifique en MultiCobros antes de cargarla',
  '',
  'Dudas: escriba a soporte@ejemplo.mx',
  'Manual: https://ejemplo.mx/manual',
].join('\n');

describe('NotificationBody', () => {
  it('renders paragraphs, a list of items with their details, label/value rows and links', () => {
    render(<NotificationBody message={REPORT} />);
    const body = screen.getByTestId('notification-body');
    expect(within(body).getByText(/Recargas pagadas con tarjeta/).tagName).toBe('P');
    const items = within(body).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('Emilia Torres Vega')).toBeInTheDocument();
    expect(within(items[1]).getByText('VENCIDA')).toHaveClass('badge-amber');
    expect(within(items[1]).getByText('SIN VERIFICAR')).toHaveClass('badge-amber');
    expect(within(body).getByText('Dudas').tagName).toBe('DT');
    expect(within(body).getByRole('link', { name: 'soporte@ejemplo.mx' })).toHaveAttribute('href', 'mailto:soporte@ejemplo.mx');
    const manual = within(body).getByRole('link', { name: 'https://ejemplo.mx/manual' });
    expect(manual).toHaveAttribute('target', '_blank');
    expect(manual).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('keeps a plain message as one readable paragraph', () => {
    render(<NotificationBody message="El saldo de Ana es de $12.50." />);
    expect(screen.getByText('El saldo de Ana es de $12.50.').tagName).toBe('P');
    expect(screen.queryByRole('list')).toBeNull();
  });
});

describe('NotificationList (bell and page preview)', () => {
  const long: Notif = {
    id: 1, notif_type: 'cafeteria', title: '2 recarga(s) en línea por cargar en el POS (1 sin verificar)',
    message: REPORT, is_read: false, created_at: new Date().toISOString(),
  };

  it('shows a two-line preview of the opening, never the whole report', () => {
    render(<NotificationList items={[long]} onOpen={() => {}} />);
    const preview = screen.getByText('Recargas pagadas con tarjeta que aún no están en el saldo de cafetería (total $550.00)…');
    expect(preview).toHaveClass('line-clamp-2');
    // `block` would override the clamp's display: the bug that filled the dropdown.
    expect(preview).not.toHaveClass('block');
    expect(screen.queryByText(/Emilia Torres Vega/)).toBeNull();
    expect(screen.getByText(long.title)).toHaveClass('line-clamp-2');
  });

  it('marks unread rows, names the category and opens the notification', async () => {
    const onOpen = vi.fn();
    render(<NotificationList items={[long, { ...long, id: 2, is_read: true, title: 'Leída', notif_type: 'info' }]} onOpen={onOpen} />);
    expect(screen.getAllByLabelText('Sin leer')).toHaveLength(1);
    expect(screen.getByText('Cafetería')).toBeInTheDocument();
    expect(screen.getByText('Comunicados')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /2 recarga\(s\)/ }));
    expect(onOpen).toHaveBeenCalledWith(long);
  });
});
