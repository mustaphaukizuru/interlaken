import { describe, expect, it } from 'vitest';
import { pendingRows, speaksPendientes } from './PendingList';

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
