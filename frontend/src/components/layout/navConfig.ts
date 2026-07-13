import {
  LayoutDashboard, CreditCard, Users, Coffee, ClipboardList,
  BarChart3, CalendarClock, Receipt, Megaphone, type LucideIcon,
} from 'lucide-react';

export type Role = 'parent' | 'student' | 'admin' | 'staff';

export interface NavEntry {
  icon: LucideIcon;
  label: string;
  to: string;
  end?: boolean;
  badge?: number;
}

/** Primary navigation per role — shared by the desktop Sidebar and the mobile
 * bottom tab bar so they never drift apart. */
export const navByRole: Record<Role, NavEntry[]> = {
  admin: [
    { icon: BarChart3,     label: 'Dashboard',   to: '/admin', end: true },
    { icon: Users,         label: 'Alumnos',     to: '/admin/alumnos' },
    { icon: ClipboardList, label: 'Admisiones',  to: '/admin/admisiones' },
    { icon: CalendarClock, label: 'Visitas',     to: '/admin/visitas' },
    { icon: Receipt,       label: 'Finanzas',    to: '/admin/finanzas' },
    { icon: Coffee,        label: 'Cafetería',   to: '/admin/cafeteria' },
    { icon: Megaphone,     label: 'Comunicados', to: '/admin/comunicados' },
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
  ],
  student: [
    { icon: LayoutDashboard, label: 'Inicio',    to: '/alumno', end: true },
    { icon: Coffee,          label: 'Cafetería', to: '/alumno/cafeteria' },
  ],
};
