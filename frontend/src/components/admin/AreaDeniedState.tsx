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
 * redirect (UX Phase 7). For ConsoleAreaGuard and AdminOnlyPage
 * (components/layout), which decide when to render it. The API refuses the
 * section regardless.
 *
 * An account with no console area at all (QA 2026-11-24: /staff is now for
 * administrators) is told so, and sent to its own cafetería or the portal.
 */
export function AreaDeniedState({ user, path }: {
  user: Who | Pick<User, 'role' | 'staff_areas' | 'cafeteria_account'>;
  path: string;
}) {
  const home = consoleHome(user);
  const ownCafe = !!(user && 'cafeteria_account' in user && user.cafeteria_account);
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center px-4 py-16 text-center">
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-cream text-muted">
        <Lock size={24} aria-hidden="true" />
      </span>
      {home ? (
        <>
          <h1 className="mb-1 font-head text-lg font-bold text-ink">Sin acceso a esta sección</h1>
          <p className="mb-5 text-sm text-muted">{needs(path)} Pida el acceso a la dirección.</p>
          <Link to={home} className="btn-primary">Ir a mi consola</Link>
        </>
      ) : (
        <>
          <h1 className="mb-1 font-head text-lg font-bold text-ink">Sin acceso a la consola</h1>
          <p className="mb-5 text-sm text-muted">
            Su cuenta del personal aún no tiene áreas de la consola. Pida el acceso a la dirección.
          </p>
          <Link to={ownCafe ? '/portal/mi-cafeteria' : '/portal'} className="btn-primary">
            {ownCafe ? 'Ir a Mi cafetería' : 'Ir al portal'}
          </Link>
        </>
      )}
    </div>
  );
}

export default AreaDeniedState;
