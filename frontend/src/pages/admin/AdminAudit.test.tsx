import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';

vi.mock('@/services/api', () => ({
  coreApi: { getAuditLog: vi.fn() },
}));

import AdminAudit from './AdminAudit';
import { coreApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const mockedAudit = vi.mocked(coreApi.getAuditLog);

const rows = [
  {
    id: 1,
    actor: 9,
    actor_label: 'ada@interlaken.mx',
    action: 'update',
    action_display: 'Modificación',
    object_type: 'finance.invoice',
    object_id: '42',
    changes: { reason: 'Pago en caja', status: ['pending', 'paid'] },
    context: 'finance.mark_paid',
    created_at: '2026-08-14T10:30:00Z',
  },
  {
    id: 2,
    actor: null,
    actor_label: 'system:webhook',
    action: 'update',
    action_display: 'Modificación',
    object_type: 'payments.payment',
    object_id: '7',
    changes: { status: ['pending', 'success'] },
    context: 'payments',
    created_at: '2026-08-13T09:00:00Z',
  },
];

describe('AdminAudit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders audit rows with actor, action and reason', async () => {
    mockedAudit.mockResolvedValue({ data: { results: rows, count: 2 } } as never);

    renderWithProviders(<AdminAudit />, { route: '/admin/auditoria' });

    expect(await screen.findByText('ada@interlaken.mx')).toBeInTheDocument();
    expect(screen.getByText('system:webhook')).toBeInTheDocument();
    expect(screen.getByText('finance.mark_paid')).toBeInTheDocument();
    expect(screen.getByText(/Motivo: Pago en caja/)).toBeInTheDocument();
    expect(screen.getByText('finance.invoice#42')).toBeInTheDocument();
    expect(mockedAudit).toHaveBeenCalledWith({
      page: 1, actor: undefined, action: undefined, from: undefined, to: undefined,
    });
  });

  it('shows the empty state when there are no rows', async () => {
    mockedAudit.mockResolvedValue({ data: { results: [], count: 0 } } as never);

    renderWithProviders(<AdminAudit />, { route: '/admin/auditoria' });

    expect(await screen.findByText('Sin registros de auditoría')).toBeInTheDocument();
  });

  it('passes URL filters through to the endpoint', async () => {
    mockedAudit.mockResolvedValue({ data: { results: [], count: 0 } } as never);

    renderWithProviders(<AdminAudit />, {
      route: '/admin/auditoria?actor=ada&accion=update&desde=2026-08-01',
    });

    expect(await screen.findByText('Sin resultados')).toBeInTheDocument();
    expect(mockedAudit).toHaveBeenCalledWith({
      page: 1, actor: 'ada', action: 'update', from: '2026-08-01', to: undefined,
    });
  });
});
