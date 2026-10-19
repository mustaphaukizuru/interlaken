/**
 * Admin-console areas for staff accounts (mirror of backend apps/core/areas.py).
 *
 * `role=admin` uses the whole console. A `role=staff` account uses only the
 * areas in `user.staff_areas` (the API sends the effective list: every area for
 * an admin). The API refuses everything else; this file only decides what the
 * console shows and where a staff account lands. Kept small: every page loads it
 * through the route guard (labels and puestos live in lib/areaCatalog.ts).
 */
import type { User } from '@/types';

export type AreaKey = 'alumnos' | 'accesos' | 'admisiones' | 'visitas' | 'mensajes' | 'comunicados' | 'cafeteria';

/** Area keys in console order (labels and puestos: lib/areaCatalog.ts). */
export const AREA_KEYS: readonly AreaKey[] = ['alumnos', 'accesos', 'admisiones', 'visitas', 'mensajes', 'comunicados', 'cafeteria'];

/**
 * Console sections by path prefix and the areas that open them. A section not
 * listed (Dashboard, Usuarios, Ajustes, site content, Auditoría, ARCO, Nuevo
 * ciclo, Fusionar cuentas) is admin-only. Order = where a staff account lands.
 */
const SECTIONS: [prefix: string, areas: AreaKey[]][] = [
  ['/admin/alumnos', ['alumnos']],
  ['/admin/admisiones', ['admisiones']],
  ['/admin/visitas', ['visitas']],
  ['/admin/cafeteria', ['cafeteria']],
  ['/admin/pagos', ['cafeteria']],
  ['/admin/comunicados', ['comunicados']],
  ['/admin/calendario', ['comunicados']],
  ['/admin/mensajes', ['mensajes']],
  ['/admin/formularios', ['mensajes']],
  ['/admin/contrasenas', ['accesos']],
];

type Who = Pick<User, 'role'> & { staff_areas?: string[] } | null | undefined;

export const isAdmin = (user: Who) => user?.role === 'admin';

export function areasOf(user: Who): Set<AreaKey> {
  if (!user) return new Set();
  if (user.role === 'admin') return new Set(AREA_KEYS);
  if (user.role !== 'staff') return new Set();
  const known = new Set<string>(AREA_KEYS);
  return new Set((user.staff_areas ?? []).filter((a): a is AreaKey => known.has(a)));
}

/** A staff account with at least one area (or an admin) has the console. */
export const hasConsole = (user: Who) => isAdmin(user) || areasOf(user).size > 0;

function sectionOf(path: string): [string, AreaKey[]] | undefined {
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  return SECTIONS.find(([prefix]) => clean === prefix || clean.startsWith(`${prefix}/`));
}

/** May `user` open this console path? Paths outside /admin are not judged here. */
export function canOpen(user: Who, path: string): boolean {
  if (!path.startsWith('/admin')) return true;
  if (isAdmin(user)) return true;
  const section = sectionOf(path);
  if (!section) return false;
  const held = areasOf(user);
  return section[1].some((a) => held.has(a));
}

/** Where `user` lands in the console (null = no console). */
export function consoleHome(user: Who): string | null {
  if (isAdmin(user)) return '/admin';
  const held = areasOf(user);
  const first = SECTIONS.find(([, areas]) => areas.some((a) => held.has(a)));
  return first ? first[0] : null;
}

/** Home after login / when a role guard bounces: the console for staff that have one. */
export function homePath(user: Who): string {
  switch (user?.role) {
    case 'admin': return '/admin';
    case 'staff': return consoleHome(user) ?? '/staff';
    default: return '/portal';
  }
}
