import { describe, it, expect } from 'vitest';
import { areasFor, areasOf, canOpen, consoleHome, hasConsole, homePath } from './areas';
import { PUESTOS } from './areaCatalog';

const admin = { role: 'admin' as const };
const secretaria = { role: 'staff' as const, staff_areas: PUESTOS[0].areas };
const cafeteria = { role: 'staff' as const, staff_areas: ['cafeteria'] };
const teacher = { role: 'staff' as const, staff_areas: [] };
const parent = { role: 'parent' as const, staff_areas: ['cafeteria'] };

describe('console areas', () => {
  it('admins open everything, staff only their sections', () => {
    expect(canOpen(admin, '/admin/usuarios')).toBe(true);
    expect(canOpen(cafeteria, '/admin/cafeteria/12')).toBe(true);
    expect(canOpen(cafeteria, '/admin/pagos')).toBe(true);
    expect(canOpen(cafeteria, '/admin/alumnos')).toBe(false);
    expect(canOpen(secretaria, '/admin/admisiones/pipeline')).toBe(true);
    expect(canOpen(secretaria, '/admin/calendario')).toBe(true);
    expect(canOpen(secretaria, '/admin/cafeteria')).toBe(false);
  });

  it('«Personal» belongs to the roster area; the Admisiones puesto lands in Admisiones (2026-11-25)', () => {
    expect(canOpen(secretaria, '/admin/personal')).toBe(true);
    expect(canOpen(secretaria, '/admin/personal/51')).toBe(true);
    expect(canOpen(cafeteria, '/admin/personal')).toBe(false);
    expect(areasFor('/admin/personal')).toEqual(['alumnos']);
    const admisiones = PUESTOS.find((p) => p.key === 'admisiones')!;
    expect(admisiones.areas).toEqual(['admisiones', 'visitas', 'mensajes']);
    const pm = { role: 'staff' as const, staff_areas: admisiones.areas };
    expect(homePath(pm)).toBe('/admin/admisiones');
    expect(canOpen(pm, '/admin/visitas/semana')).toBe(true);
    expect(canOpen(pm, '/admin/mensajes')).toBe(true);
    expect(canOpen(pm, '/admin/personal')).toBe(false);
    expect(canOpen(pm, '/admin/cafeteria')).toBe(false);
  });

  it('keeps the admin-only sections and the dashboard for admins', () => {
    for (const path of ['/admin', '/admin/usuarios', '/admin/ajustes', '/admin/contenido', '/admin/auditoria', '/admin/arco', '/admin/nuevo-ciclo']) {
      expect(canOpen(secretaria, path)).toBe(false);
    }
  });

  it('does not judge the family portal', () => {
    expect(canOpen(cafeteria, '/portal/perfil')).toBe(true);
    expect(canOpen(teacher, '/portal')).toBe(true);
  });

  it('keeps the «Panel de Dirección» and the site content (/staff) for administrators (QA 2026-11-24)', () => {
    for (const path of ['/staff', '/staff/', '/staff/contenido', '/staff/contenido/medios', '/staff/contenido/4', '/staff?x=1']) {
      expect(canOpen(admin, path)).toBe(true);
      expect(canOpen(cafeteria, path)).toBe(false);
      expect(canOpen(teacher, path)).toBe(false);
    }
    expect(canOpen(cafeteria, '/staffing')).toBe(true);
  });

  it('lands each account where it works', () => {
    expect(homePath(admin)).toBe('/admin');
    expect(homePath(secretaria)).toBe('/admin/alumnos');
    expect(homePath(cafeteria)).toBe('/admin/cafeteria');
    expect(homePath(teacher)).toBe('/staff');
    expect(homePath(parent)).toBe('/portal');
    expect(consoleHome(teacher)).toBeNull();
  });

  it('ignores unknown areas and never grants a family any', () => {
    expect([...areasOf({ role: 'staff', staff_areas: ['cafeteria', 'root'] })]).toEqual(['cafeteria']);
    expect(hasConsole(parent)).toBe(false);
    expect(canOpen(parent, '/admin/cafeteria')).toBe(false);
  });

  it('names the areas a path needs (for the «Requiere el área…» state)', () => {
    expect(areasFor('/admin/pagos?estado=failed')).toEqual(['cafeteria']);
    expect(areasFor('/admin/calendario')).toEqual(['comunicados']);
    expect(areasFor('/admin/usuarios')).toEqual([]);
  });
});
