import { Link } from 'react-router-dom';
import { ArrowRight, UserCog } from 'lucide-react';

/** On top of the ficha when the staff opens it without a family's link. */
export function StaffBanner() {
  return (
    <aside aria-label="Vista del personal" className="mb-4 flex flex-col gap-3 rounded-md border border-purple/30 bg-purple-light px-4 py-3 text-[15px] text-ink sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-start gap-3">
        <UserCog className="mt-0.5 h-5 w-5 shrink-0 text-purple" aria-hidden="true" />
        <span>
          <strong>Vista del personal:</strong> las familias solo pueden abrir esta ficha con su enlace personal.
          Desde aquí puede llenarla con una familia en la oficina.
        </span>
      </p>
      <Link to="/admin/admisiones" className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 self-start rounded-sm px-3 text-sm font-semibold text-purple underline underline-offset-4 hover:bg-white/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 sm:self-auto">
        Ir a Expedientes <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </aside>
  );
}
