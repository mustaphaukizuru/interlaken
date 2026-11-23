import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { areasFor, consoleHome } from '@/lib/areas';
import { AREA_LABEL } from '@/lib/areaCatalog';
import type { User } from '@/types';

type Who = Parameters<typeof consoleHome>[0];

/** «el área Cafetería y pagos» / «una de las áreas A o B» / admin-only sections. */
function needs(path: string): string {
  const areas = areasFor(path).map((a) => AREA_LABEL[a]);
  if (!areas.length) return 'Esta sección es solo para administradores.';
  if (areas.length === 1) return `Requiere el área «${areas[0]}».`;
  return `Requiere una de estas áreas: ${areas.map((a) => `«${a}»`).join(' o ')}.`;
}

/**
 * What a staff account sees when it opens a console section outside its
 * areas: the reason and a way to its own first section, instead of a silent
 * redirect (UX Phase 7). For ConsoleAreaGuard (components/layout), which
 * decides when to render it. The API refuses the section regardless.
 */
export function AreaDeniedState({ user, path }: { user: Who | Pick<User, 'role' | 'staff_areas'>; path: string }) {
  const home = consoleHome(user);
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center px-4 py-16 text-center">
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-cream text-muted">
        <Lock size={24} aria-hidden="true" />
      </span>
      <h1 className="mb-1 font-head text-lg font-bold text-ink">Sin acceso a esta sección</h1>
      <p className="mb-5 text-sm text-muted">{needs(path)} Pida el acceso a la dirección.</p>
      <Link to={home ?? '/staff'} className="btn-primary">Ir a mi consola</Link>
    </div>
  );
}

export default AreaDeniedState;
