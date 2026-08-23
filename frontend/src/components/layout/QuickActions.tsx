import { Link } from 'react-router-dom';
import { Plus, Megaphone, UserPlus, Coffee, KeyRound, Siren } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';

const ACTIONS = [
  { icon: UserPlus,  label: 'Nuevo alumno',          to: '/admin/alumnos?nuevo=1' },
  { icon: Megaphone, label: 'Nuevo comunicado',      to: '/admin/comunicados?nuevo=1' },
  { icon: Coffee,    label: 'Recarga manual',        to: '/admin/cafeteria' },
  { icon: KeyRound,  label: 'Registrar solicitud de contraseña', to: '/admin/contrasenas?nuevo=1' },
  { icon: Siren,     label: 'Emergencia (broadcast)', to: '/admin/comunicados?emergencia=1' },
];

/** Admin "+ Nuevo" menu in the shell header (BACKLOG P1-E8). */
export function QuickActions() {
  return (
    <Dropdown
      width={280}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label="Crear"
          aria-expanded={open}
          aria-haspopup="menu"
          className="flex h-11 items-center gap-1.5 rounded-xl bg-purple px-3.5 text-[13px] font-semibold text-white shadow-[0_8px_20px_-6px_rgba(64,26,142,0.6)] hover:bg-purple-mid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
        >
          <Plus size={17} aria-hidden="true" /> <span className="hidden sm:inline">Nuevo</span>
        </button>
      )}
    >
      {({ close }) => (
        <div role="menu" className="p-1.5">
          {ACTIONS.map(({ icon: Icon, label, to }) => (
            <Link key={to} role="menuitem" to={to} onClick={close} className="flex min-h-[40px] items-center gap-2.5 rounded-lg px-3 text-sm text-ink hover:bg-cream-2">
              <Icon size={16} className="text-purple" aria-hidden="true" /> {label}
            </Link>
          ))}
        </div>
      )}
    </Dropdown>
  );
}

export default QuickActions;
