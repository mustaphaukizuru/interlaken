import { describe, expect, it } from 'vitest';
import { allTemplates } from '../../sections';
import { loadAllGroups } from '../../sections/loaders';
import { buildEmail, buildPhone, buildWeb, buildWhatsApp, describeHref, hrefKind, hrefProblem, parseWhatsApp, SITE_PAGES } from './links';

describe('link destinations', () => {
  it('lists every public page template by name (except the 404)', async () => {
    await loadAllGroups();
    const listed = new Set(SITE_PAGES.map((p) => p.path));
    const missing = allTemplates().filter((t) => t.slug !== 'no-encontrada' && !listed.has(t.path)).map((t) => t.path);
    expect(missing).toEqual([]);
  }, 30_000);

  it('says where a stored href goes, in words', () => {
    expect(describeHref('/admisiones/costos').title).toBe('Costos');
    expect(describeHref('/admisiones#estimador').title).toBe('Admisiones · Estimador de costos');
    expect(describeHref('/no-existe').warning).toMatch(/No encontramos/);
    expect(describeHref('https://www.classroom.google.com/x').title).toBe('Sitio web: classroom.google.com');
    expect(describeHref('http://ejemplo.mx').warning).toMatch(/https/);
    expect(describeHref('mailto:informes@ejemplo.mx').title).toBe('Correo: informes@ejemplo.mx');
    expect(describeHref('tel:+525553791188').title).toBe('Llamar al +525553791188');
    expect(describeHref('https://wa.me/5215512345678?text=Hola').title).toBe('WhatsApp: 5215512345678');
    expect(describeHref('').kind).toBe('empty');
  });

  it('flags hrefs that cannot work, with a plain reason', () => {
    for (const ok of ['', '/', '/admisiones', '#seccion', 'https://a.mx', 'https://a.mx/b?c=1', 'mailto:a@b.mx', 'tel:+52 55 1234 5678']) expect(hrefProblem(ok), ok).toBeNull();
    expect(hrefProblem('admisiones')).toMatch(/página del sitio/);
    expect(hrefProblem('javascript:alert(1)')).toMatch(/no está permitido/);
    expect(hrefProblem('https://sin-punto')).toMatch(/incompleta/);
    expect(hrefProblem('//otro.mx')).toMatch(/https/);
    expect(hrefProblem('mailto:sin-arroba')).toMatch(/correo/);
    expect(hrefProblem('/con espacio')).toMatch(/espacios/);
    expect(hrefKind('//otro.mx')).toBe('invalid');
  });

  it('builds hrefs from what the office types', () => {
    expect(buildWeb('classroom.google.com')).toBe('https://classroom.google.com');
    expect(buildWeb('https://a.mx')).toBe('https://a.mx');
    expect(buildEmail(' a@b.mx ')).toBe('mailto:a@b.mx');
    expect(buildPhone('55 5379 1188')).toBe('tel:+525553791188');
    expect(buildPhone('+1 (555) 010-0000')).toBe('tel:+15550100000');
    expect(buildWhatsApp('55 1234 5678', 'Hola, quiero informes')).toBe('https://wa.me/525512345678?text=Hola%2C%20quiero%20informes');
    expect(parseWhatsApp('https://wa.me/525512345678?text=Hola')).toEqual({ number: '525512345678', message: 'Hola' });
  });
});
