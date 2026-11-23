import { describe, expect, it } from 'vitest';
import { pendingRows, speaksPendientes, verifyHint } from './PendingList';

describe('speaksPendientes', () => {
  it('trusts a payload with the Pendientes counters', () => {
    expect(speaksPendientes({ notificaciones: 0, admisiones: 2, preregistros: 2 })).toBe(true);
  });
  it('refuses an older payload with sidebar keys only (no false «Todo al día»)', () => {
    expect(speaksPendientes({ notificaciones: 0, admisiones: 2, cafeteria: 1 })).toBe(false);
  });
  it('accepts areas that never had a legacy key', () => {
    expect(speaksPendientes({ notificaciones: 0, contrasenas: 0 })).toBe(true);
  });
});

describe('pendingRows', () => {
  it('lists only non-zero queues', () => {
    const keys = pendingRows({ preregistros: 2, saldo_bajo: 0, loyverse_alertas: 1 }).map((r) => r.key);
    expect(keys).toContain('preregistros');
    expect(keys).toContain('loyverse_alertas');
    expect(keys).not.toContain('saldo_bajo');
  });
});

describe('verifyHint (school, 2026-11-22: say whether the money is already in the balance)', () => {
  it.each([
    [2, 0, /No llegan al saldo hasta verificarlas en MultiCobros/],
    [2, 2, /Ya están en el saldo y en Loyverse: solo falta confirmarlas en MultiCobros/],
    [2, 1, /1 ya está en el saldo y en Loyverse; 1 llega al saldo al verificarla en MultiCobros/],
    [1, 1, /Ya está en el saldo y en Loyverse: solo falta confirmarla en MultiCobros/],
  ])('%i to verify, %i auto-loaded', (count, loaded, text) => {
    expect(verifyHint(count, loaded, '444.00')).toMatch(text);
    expect(verifyHint(count, loaded, '444.00')).toMatch(/^Pagadas con tarjeta \(\$444\.00\)\./);
  });
  it('only asks for the check when the loaded count is unknown (staff payload)', () => {
    expect(verifyHint(2, undefined)).toBe('Pagadas con tarjeta. Verifíquelas en MultiCobros.');
  });
});
