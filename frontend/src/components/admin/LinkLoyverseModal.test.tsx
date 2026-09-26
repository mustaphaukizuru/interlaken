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

describe('LinkLoyverseModal — posible baja (customer kept, grade code removed)', () => {
  // The office does not always delete the customer when a pupil leaves;
  // sometimes it only strips the "-3SEC" suffix. Those students are linked,
  // so they never appear as "sin cliente": they get their own group and the
  // same Dar de baja action, and nothing changes status by itself.
  const withNoGrade = {
    ...report,
    possible_leavers: [
      { id: 21, matricula: '09932', loyverse_code: 'ci09932', name: 'Juan Antonio Chavez Lopez',
        grade: '4° Primaria', status: 'active', balance: '0.00' },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    linkLoyverse.mockResolvedValue({ data: withNoGrade } as never);
  });

  it('lists them under their own heading with the Loyverse code and a stat', async () => {
    render(<LinkLoyverseModal open onClose={() => {}} />);
    expect(await screen.findByText(/Sin grado en Loyverse \(posible baja\) \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Sin cliente en Loyverse \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/09932 \(Código Loyverse ci09932\) · 4° Primaria/)).toBeInTheDocument();
    expect(screen.getByText('Sin grado en Loyverse')).toBeInTheDocument();
    expect(screen.getByText(/Confirme con la oficina/)).toBeInTheDocument();
  });

  it('selects across both groups and withdraws through the same bulk endpoint', async () => {
    const user = userEvent.setup();
    render(<LinkLoyverseModal open onClose={() => {}} />);
    await screen.findByText('Juan Antonio Chavez Lopez');

    await user.click(screen.getByRole('checkbox', { name: /Seleccionar todos los alumnos sin grado/ }));
    await user.click(screen.getByRole('checkbox', { name: /Seleccionar a Sara/ }));
    await user.click(screen.getByRole('button', { name: /Dar de baja \(2\)/ }));
    expect(await screen.findByText(/queda un saldo de \$2\.00/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Dar de baja a 2/ }));

    await waitFor(() => expect(bulkStudents).toHaveBeenCalledWith({
      ids: [21, 11], action: 'status', value: 'withdrawn',
    }));
  });
});
