import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import AdminGuardianMerge from './AdminGuardianMerge';

const { merge, user } = vi.hoisted(() => ({
  merge: vi.fn().mockResolvedValue({ data: { moved: { children: 1, 'portal.Notification.user': 3 }, skipped: {}, keep: 1, drop: 2 } }),
  user: (id: number, email: string) => ({ id, email, full_name: 'Mamá López', is_active: true, last_login: null, has_password: true, google: false, phone: '', children: [{ id: 9, name: 'Ana López', grade: '2° Primaria' }] }),
}));
vi.mock('@/services/api', () => ({
  portalApi: {
    guardianMergePreview: vi.fn().mockResolvedValue({ data: { keep: user(1, 'a@x.mx'), drop: user(2, 'b@x.mx'), references: { 'portal.Notification.user': 3 } } }),
    guardianMerge: (...a: unknown[]) => merge(...a),
  },
}));

describe('AdminGuardianMerge', () => {
  it('previews then merges after typing FUSIONAR', async () => {
    const u = userEvent.setup();
    renderWithProviders(<AdminGuardianMerge />, { route: '/admin/fusionar-cuentas' });
    await u.type(screen.getByLabelText(/se conserva/), 'a@x.mx');
    await u.type(screen.getByLabelText(/se fusiona y desactiva/), 'b@x.mx');
    await u.click(screen.getByRole('button', { name: /Ver qué se movería/ }));
    expect(await screen.findByText('Notification: 3')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Fusionar cuentas' });
    expect(btn).toBeDisabled();
    await u.type(screen.getByLabelText(/Escriba FUSIONAR/), 'fusionar');
    await u.click(btn);
    expect(await screen.findByText('Fusión completada')).toBeInTheDocument();
    expect(merge).toHaveBeenCalledWith({ keep: 1, drop: 2, confirm: 'FUSIONAR' });
  });
});
