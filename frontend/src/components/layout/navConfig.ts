import {
  LayoutDashboard, CreditCard, Users, Coffee, ClipboardList,
  BarChart3, CalendarClock, Receipt, Megaphone, Settings, Wallet, type LucideIcon,
} from 'lucide-react';

export type Role = 'parent' | 'student' | 'admin' | 'staff';

export interface NavEntry {
  icon: LucideIcon;
  label: string;
  to: string;
  end?: boolean;
  badge?: number;
}

/** Full sidebar navigation per role. */
export const navByRole: Record<Role, NavEntry[]> = {
  admin: [
    { icon: BarChart3,     label: 'Dashboard',   to: '/admin', end: true },
    { icon: Users,         label: 'Alumnos',     to: '/admin/alumnos' },
    { icon: ClipboardList, label: 'Admisiones',  to: '/admin/admisiones' },
    { icon: CalendarClock, label: 'Visitas',     to: '/admin/visitas' },
    { icon: Receipt,       label: 'Finanzas',    to: '/admin/finanzas' },
    { icon: Wallet,        label: 'Planes',      to: '/admin/planes' },
    { icon: Coffee,        label: 'Cafetería',   to: '/admin/cafeteria' },
    { icon: Megaphone,     label: 'Comunicados', to: '/admin/comunicados' },
    { icon: Settings,      label: 'Ajustes',     to: '/admin/ajustes' },
  ],
  staff: [
    { icon: BarChart3,       label: 'Analítica', to: '/staff', end: true },
    { icon: LayoutDashboard, label: 'Portal',    to: '/portal', end: true },
  ],
  parent: [
    { icon: LayoutDashboard, label: 'Inicio',       to: '/portal', end: true },
    { icon: Receipt,         label: 'Colegiaturas', to: '/portal/colegiaturas' },
    { icon: CreditCard,      label: 'Pagos',        to: '/portal/pagos' },
    { icon: Coffee,          label: 'Cafetería',    to: '/portal/cafeteria' },
    { icon: ClipboardList,   label: 'Inscripciones', to: '/portal/inscripciones' },
    { icon: Megaphone,       label: 'Comunicados',  to: '/portal/comunicados' },
  ],
  student: [
    { icon: LayoutDashboard, label: 'Inicio',    to: '/alumno', end: true },
    { icon: Coffee,          label: 'Cafetería', to: '/alumno/cafeteria' },
  ],
};

/**
 * Curated 5-item mobile tab bar — must include daily-use destinations that
 * `.slice(0, 5)` on `navByRole` used to drop (parent Comunicados, admin Cafetería).
 */
export const mobileNavByRole: Record<Role, NavEntry[]> = {
  parent: [
    { icon: LayoutDashboard, label: 'Inicio',       to: '/portal', end: true },
    { icon: Receipt,         label: 'Colegiaturas', to: '/portal/colegiaturas' },
    { icon: Coffee,          label: 'Cafetería',    to: '/portal/cafeteria' },
    { icon: Megaphone,       label: 'Comunicados',  to: '/portal/comunicados' },
    { icon: CreditCard,      label: 'Pagos',        to: '/portal/pagos' },
  ],
  admin: [
    { icon: BarChart3,     label: 'Inicio',      to: '/admin', end: true },
    { icon: Users,         label: 'Alumnos',     to: '/admin/alumnos' },
    { icon: Coffee,        label: 'Cafetería',   to: '/admin/cafeteria' },
    { icon: Receipt,       label: 'Finanzas',    to: '/admin/finanzas' },
    { icon: ClipboardList, label: 'Admisiones',  to: '/admin/admisiones' },
  ],
  staff: navByRole.staff,
  student: navByRole.student,
};
