import { describe, expect, it } from 'vitest';
import { CreditCard, FileText, Users } from 'lucide-react';
import { DEFAULT_MENU, resolveMenu } from './PublicLayout';
import { DEFAULT_MENU as ADMIN_DEFAULT_MENU } from '@/pages/admin/AdminNavigation';
import { CHROME_DEFAULTS } from '@/lib/siteChrome';

const fallback = [{ label: 'A', items: [{ label: 'x', to: '/x', icon: Users }] }];

describe('resolveMenu', () => {
  it('keeps the built-in menu when the CMS menu is empty', () => {
    expect(resolveMenu(undefined, fallback)).toBe(fallback);
    expect(resolveMenu([], fallback)).toBe(fallback);
  });
  it('maps icon names and falls back to FileText', () => {
    const out = resolveMenu([{ label: 'G', items: [{ label: 'a', to: '/a', icon: 'Users' }, { label: 'b', to: 'https://x.mx', icon: 'Nope' }] }], fallback);
    expect(out[0].items[0].icon).toBe(Users);
    expect(out[0].items[1].icon).toBe(FileText);
    expect(out[0].items[1].to).toBe('https://x.mx');
  });
  it('the built-in menu no longer offers Calendario escolar (owner, 2026-11-08)', () => {
    const links = DEFAULT_MENU.flatMap((g) => g.items.map((i) => i.to));
    expect(links).not.toContain('/calendario');
    expect(links).toContain('/plataformas');
  });
  it('follows menu «Opción 3» (2026-11-20): «Pagos» is «Familias» with the online payment and Plataformas', () => {
    const shape = DEFAULT_MENU.map((g) => [g.label, g.items.map((i) => i.label)]);
    expect(shape).toEqual([
      ['El Colegio', ['Quiénes Somos', 'Modelo Educativo', 'Galería']],
      ['Niveles Educativos', ['Preescolar', 'Primaria', 'Secundaria']],
      ['Admisiones', ['Proceso de Inscripción', 'Documentación', 'Costos', 'Pre-Registro']],
      ['Familias', ['Pagar colegiatura', 'Colegiaturas y cafetería', 'Facturación', 'Plataformas']],
    ]);
    const pay = DEFAULT_MENU[3].items[0];
    expect(pay.to).toBe('https://interlaken.servoescolar.mx');
    expect(pay.icon).toBe(CreditCard);
  });
  it('the admin editor offers the same built-in menu as the public site', () => {
    const publicShape = DEFAULT_MENU.map((g) => [g.label, g.items.map((i) => [i.label, i.to])]);
    const adminShape = ADMIN_DEFAULT_MENU.map((g) => [g.label, g.items.map((i) => [i.label, i.to])]);
    expect(adminShape).toEqual(publicShape);
  });
  it('header buttons are «Portal Cafetería» (with a cup) and «Agendar visita»; «Pagos» moved into the menu', () => {
    expect(CHROME_DEFAULTS.header_buttons).toEqual([
      { label: 'Portal Cafetería', href: '/login', icon: 'Coffee' },
      { label: 'Agendar visita', href: '/agendar-visita', primary: true },
    ]);
  });
});
