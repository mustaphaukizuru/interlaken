import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/services/api', () => ({ paymentsApi: { getReceipt: vi.fn() }, downloadBlob: vi.fn() }));

import { PendingTopUps } from './PendingTopUps';

const item = { id: 7, amount: '244.00', paid_at: '2030-01-04T22:00:00Z', apply_due_at: '2030-01-07T13:30:00Z', folio: 41 };

describe('PendingTopUps (family view while a paid top-up waits)', () => {
  it('says the payment arrived and what the school is doing with it, calmly', () => {
    render(<PendingTopUps items={[item]} />);
    expect(screen.getByText(/Recarga por aplicar · \$244\.00/)).toBeInTheDocument();
    expect(screen.getByText(
      'Recibimos su pago. El colegio lo confirma con el banco y lo carga en la cafetería en días hábiles, a partir de las 7:30 a.m.',
    )).toBeInTheDocument();
    // The promise is still only the school's existing rule.
    expect(screen.getByText(/Se sumará a su saldo el lunes 7 de enero a las 7:30 a\.m\. · Folio 41/)).toBeInTheDocument();
    expect(screen.queryByText(/\.\./)).toBeNull();
  });

  it('follows the apply time the school configured', () => {
    render(<PendingTopUps items={[item]} applyTime="08:15" />);
    expect(screen.getByText(/a partir de las 8:15 a\.m\./)).toBeInTheDocument();
  });

  it('a top-up past its promised time stays calm, no date already gone', () => {
    render(<PendingTopUps items={[{ ...item, apply_due_at: '2020-01-07T13:30:00Z' }]} />);
    expect(screen.getByText(/Se sumará a su saldo en la próxima carga del colegio\./)).toBeInTheDocument();
  });

  it('renders nothing without pending top-ups', () => {
    const { container } = render(<PendingTopUps items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
