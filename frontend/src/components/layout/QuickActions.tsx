import { Link } from 'react-router-dom';
import { Plus, Megaphone, UserPlus, Coffee, KeyRound, Siren } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';

const ACTIONS = [
  { icon: UserPlus,  label: 'Nuevo alumno',          to: '/admin/alumnos?nuevo=1' },
  { icon: Megaphone, label: 'Nuevo comunicado',      to: '/admin/comunicados?nuevo=1' },
  // It opens the cafetería list, where the balance is adjusted per person
  // («Ajustar saldo» on the alumno): the label says so (QA 2026-11-24, was «Recarga manual»).
  { icon: Coffee,    label: 'Ajustar saldo (elegir alumno)', to: '/admin/cafeteria' },
  { icon: KeyRound,  label: 'Registrar solicitud de contraseña', to: '/admin/contrasenas?nuevo=1' },
];
/** Set apart below a divider, in the danger colour: it reaches every family at once. */
const EMERGENCY = { icon: Siren, label: 'Emergencia (a todos)', to: '/admin/comunicados?emergencia=1' };

const ITEM = 'flex min-h-[44px] items-center gap-3 rounded-sm px-2.5 py-1.5 text-[15px] font-medium leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple/40';

/** Admin "+ Nuevo" menu in the shell header (BACKLOG P1-E8). Stays on screen on phones (Dropdown clamps it). */
export function QuickActions() {
  return (
    <Dropdown
      width={300}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label="Crear"
          aria-expanded={open}
          aria-haspopup="menu"
          className="flex h-11 items-center gap-1.5 rounded-sm bg-purple px-3.5 text-[13px] font-semibold text-white shadow-[0_8px_20px_-6px_rgba(64,26,142,0.6)] hover:bg-purple-mid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
        >
          <Plus size={17} aria-hidden="true" /> <span className="hidden sm:inline">Nuevo</span>
        </button>
      )}
    >
      {({ close }) => (
        <div role="menu" aria-label="Crear" className="p-1.5">
          {ACTIONS.map(({ icon: Icon, label, to }) => (
            <Link key={to} role="menuitem" to={to} onClick={close} className={`${ITEM} text-ink hover:bg-cream-2 focus-visible:bg-cream-2`}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-purple/10 text-purple">
                <Icon size={17} aria-hidden="true" />
              </span>
              {label}
            </Link>
          ))}
          <div role="separator" className="mx-2.5 my-1 h-px bg-line" />
          <Link role="menuitem" to={EMERGENCY.to} onClick={close} className={`${ITEM} text-danger hover:bg-danger-bg focus-visible:bg-danger-bg`}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-danger-bg text-danger">
              <EMERGENCY.icon size={17} aria-hidden="true" />
            </span>
            {EMERGENCY.label}
          </Link>
        </div>
      )}
    </Dropdown>
  );
}

export default QuickActions;
