import { describe, it, expect } from 'vitest';
import { movementSign } from './cafeteria';

const tx = (over: Record<string, unknown>) => ({ id: 1, transaction_type: 'adjustment', amount: '12.50', balance_after: null, ...over });

describe('movementSign (QA 2026-11-24: a «Descontar» read like a credit)', () => {
  it('purchases debit and top-ups credit', () => {
    expect(movementSign(tx({ transaction_type: 'purchase' }))).toBe(-1);
    expect(movementSign(tx({ transaction_type: 'topup' }))).toBe(1);
  });

  it('an adjustment or a refund takes the sign of its audit row', () => {
    expect(movementSign(tx({ adjustment_amount: '-12.50' }))).toBe(-1);
    expect(movementSign(tx({ transaction_type: 'refund', adjustment_amount: '40.00' }))).toBe(1);
    expect(movementSign(tx({}), { trail: new Map([[1, '-12.50']]) })).toBe(-1);
  });

  it('else the step from the next older balance, only when it equals the amount', () => {
    expect(movementSign(tx({ balance_after: '107.50' }), { olderBalance: '120.00' })).toBe(-1);
    expect(movementSign(tx({ balance_after: '132.50' }), { olderBalance: '120.00' })).toBe(1);
    // A gap (another movement in between, or a history-only row): unknown.
    expect(movementSign(tx({ balance_after: '100.00' }), { olderBalance: '120.00' })).toBeNull();
    expect(movementSign(tx({}), { olderBalance: '120.00' })).toBeNull();
    expect(movementSign(tx({}))).toBeNull();
  });
});
