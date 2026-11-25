import { describe, expect, it } from 'vitest';
import { plural, pluralWord } from './plural';

describe('plural', () => {
  it('agrees in number instead of «(s)»', () => {
    expect(plural(1, 'compra nueva', 'compras nuevas')).toBe('1 compra nueva');
    expect(plural(0, 'compra nueva', 'compras nuevas')).toBe('0 compras nuevas');
    expect(plural(3, 'imagen subida', 'imágenes subidas')).toBe('3 imágenes subidas');
  });

  it('writes thousands the es-MX way', () => {
    expect(plural(1250, 'consentimiento', 'consentimientos')).toBe('1,250 consentimientos');
  });

  it('pluralWord gives only the word (the number is shown apart)', () => {
    expect(pluralWord(1, 'alta', 'altas')).toBe('alta');
    expect(pluralWord(2, 'alta', 'altas')).toBe('altas');
  });
});
