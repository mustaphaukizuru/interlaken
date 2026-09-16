import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  portalApi: {
    linkLoyverse: vi.fn(),
    bulkStudents: vi.fn(async () => ({ data: { updated: 2 } })),
  },
}));

import { LinkLoyverseModal } from './LinkLoyverseModal';
import { portalApi } from '@/services/api';

const linkLoyverse = vi.mocked(portalApi.linkLoyverse);
const bulkStudents = vi.mocked(portalApi.bulkStudents);

const report = {
  customers: 350, students: 386, linked: 0, already_linked: 350, skipped_conflict: 0,
  unmatched_customer_count: 0, duplicate_codes: [],
  // Two of last cycle's graduates, still "activo": the school deleted their
  // Loyverse customers and nothing told the app.
  unmatched_students: [
    { id: 11, matricula: '09238', name: 'Sara Isabella Duran Castillo', grade: '3° Secundaria', status: 'active', balance: '2.00' },
    { id: 12, matricula: '09240', name: 'Mayoli Renata Bravo Vazquez', grade: '3° Secundaria', status: 'active', balance: '16.00' },
  ],
};

describe('LinkLoyverseModal — leavers (sin cliente en Loyverse)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    linkLoyverse.mockResolvedValue({ data: report } as never);
  });

  it('lists every unmatched student with grade and leftover balance', async () => {
    render(<LinkLoyverseModal open onClose={() => {}} />);
    expect(await screen.findByText('Sara Isabella Duran Castillo')).toBeInTheDocument();
    expect(screen.getByText(/09240 · 3° Secundaria/)).toBeInTheDocument();
    expect(screen.getByText('$16.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dar de baja \(0\)/ })).toBeDisabled();
  });

  it('selects all, warns about the leftover money, and applies the baja through the bulk endpoint', async () => {
    const user = userEvent.setup();
    const onLinked = vi.fn();
    render(<LinkLoyverseModal open onClose={() => {}} onLinked={onLinked} />);
    await screen.findByText('Sara Isabella Duran Castillo');

    await user.click(screen.getByRole('checkbox', { name: /Seleccionar todos/ }));
    await user.click(screen.getByRole('button', { name: /Dar de baja \(2\)/ }));

    // The dialog names the money at stake: 2.00 + 16.00.
    expect(await screen.findByText(/queda un saldo de \$18\.00/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Dar de baja a 2/ }));

    await waitFor(() => expect(bulkStudents).toHaveBeenCalledWith({
      ids: [11, 12], action: 'status', value: 'withdrawn',
    }));
    expect(onLinked).toHaveBeenCalled();
  });

  it('only sends the rows the admin ticked', async () => {
    const user = userEvent.setup();
    render(<LinkLoyverseModal open onClose={() => {}} />);
    await screen.findByText('Sara Isabella Duran Castillo');

    await user.click(screen.getByRole('checkbox', { name: /Seleccionar a Mayoli/ }));
    await user.click(screen.getByRole('button', { name: /Dar de baja \(1\)/ }));
    await user.click(await screen.findByRole('button', { name: /Dar de baja a 1/ }));

    await waitFor(() => expect(bulkStudents).toHaveBeenCalledWith({
      ids: [12], action: 'status', value: 'withdrawn',
    }));
  });
});
