import { describe, it, expect } from 'vitest';
import { areasOf, canOpen, consoleHome, hasConsole, homePath } from './areas';
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

  it('keeps the admin-only sections and the dashboard for admins', () => {
    for (const path of ['/admin', '/admin/usuarios', '/admin/ajustes', '/admin/contenido', '/admin/auditoria', '/admin/arco', '/admin/nuevo-ciclo']) {
      expect(canOpen(secretaria, path)).toBe(false);
    }
  });

  it('does not judge paths outside the console', () => {
    expect(canOpen(teacher, '/staff')).toBe(true);
    expect(canOpen(cafeteria, '/portal/perfil')).toBe(true);
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
});
