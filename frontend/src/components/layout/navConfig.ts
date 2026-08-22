import {
  LayoutDashboard, CreditCard, Users, Coffee, ClipboardList, BarChart3,
  CalendarClock, Megaphone, Settings, ShieldCheck, UserCircle, QrCode, KeyRound, Bell, Inbox, UserCog, Image, FileText, Compass, type LucideIcon } from 'lucide-react';

export type Role = 'parent' | 'student' | 'admin' | 'staff';

/** Keys returned by GET /core/badges/ (BACKLOG P1-E3). */
export type BadgeKey = 'admisiones' | 'visitas' | 'cafeteria' | 'contrasenas' | 'notificaciones' | 'mensajes' | 'formularios';

export interface NavEntry {
  icon: LucideIcon;
  label: string;
  to: string;
  end?: boolean;
  /** Live counter from /core/badges/ to show next to the label. */
  badgeKey?: BadgeKey;
}

export interface NavGroup {
  heading: string;
  items: NavEntry[];
}

const FAMILY_GROUPS: NavGroup[] = [
  {
    heading: 'Familia',
    items: [
      { icon: LayoutDashboard, label: 'Inicio',         to: '/portal', end: true },
      { icon: Megaphone,       label: 'Comunicados',    to: '/portal/comunicados' },
      { icon: Bell,            label: 'Notificaciones', to: '/portal/notificaciones', badgeKey: 'notificaciones' },
      { icon: ClipboardList,   label: 'Inscripciones',  to: '/portal/inscripciones' },
    ],
  },
  {
    heading: 'Cafetería y pagos',
    items: [
      { icon: Coffee,     label: 'Cafetería',  to: '/portal/cafeteria' },
      { icon: CreditCard, label: 'Pagos',      to: '/portal/pagos' },
      { icon: QrCode,     label: 'Credencial', to: '/portal/credencial' },
    ],
  },
  {
    heading: 'Cuenta',
    items: [
      { icon: UserCircle, label: 'Mi perfil', to: '/portal/perfil' },
    ],
  },
];

/** Grouped sidebar navigation per role (BACKLOG P1-E2). */
export const navGroupsByRole: Record<Role, NavGroup[]> = {
  admin: [
    {
      heading: 'Operación',
      items: [
        { icon: BarChart3,     label: 'Dashboard',  to: '/admin', end: true },
        { icon: Users,         label: 'Alumnos',    to: '/admin/alumnos' },
        { icon: ClipboardList, label: 'Admisiones', to: '/admin/admisiones', badgeKey: 'admisiones' },
        { icon: CalendarClock, label: 'Visitas',    to: '/admin/visitas', badgeKey: 'visitas' },
      ],
    },
    {
      heading: 'Cafetería y pagos',
      items: [
        { icon: Coffee,     label: 'Cafetería', to: '/admin/cafeteria', badgeKey: 'cafeteria' },
        { icon: CreditCard, label: 'Pagos',     to: '/admin/pagos' },
      ],
    },
    {
      heading: 'Comunicación',
      items: [
        { icon: Megaphone, label: 'Comunicados', to: '/admin/comunicados' },
        { icon: Inbox,     label: 'Mensajes',    to: '/admin/mensajes', badgeKey: 'mensajes' },
        { icon: KeyRound,  label: 'Contraseñas', to: '/admin/contrasenas', badgeKey: 'contrasenas' },
      ],
    },
    {
      heading: 'Contenido del sitio',
      items: [
        { icon: FileText,      label: 'Páginas',     to: '/admin/contenido' },
        { icon: ClipboardList, label: 'Formularios', to: '/admin/formularios', badgeKey: 'formularios' },
        { icon: Compass,       label: 'Navegación', to: '/admin/navegacion' },
        { icon: Image,         label: 'Biblioteca de medios', to: '/admin/contenido/medios' },
        { icon: CalendarClock, label: 'Calendario',  to: '/admin/calendario' },
        { icon: Megaphone,     label: 'Testimonios', to: '/admin/testimonios' },
      ],
    },
    {
      heading: 'Sistema',
      items: [
        { icon: Settings,    label: 'Ajustes',   to: '/admin/ajustes' },
        { icon: UserCog,     label: 'Usuarios',  to: '/admin/usuarios' },
        { icon: ShieldCheck, label: 'Auditoría', to: '/admin/auditoria' },
      ],
    },
  ],
  staff: [
    {
      heading: 'Personal',
      items: [
        { icon: BarChart3,       label: 'Analítica', to: '/staff', end: true },
        { icon: LayoutDashboard, label: 'Portal',    to: '/portal', end: true },
      ],
    },
  ],
  parent: FAMILY_GROUPS,
  // School-email students use the family portal shell (`/portal/*`); `/alumno/*`
  // only redirects there. Keep the same destinations as parents.
  student: FAMILY_GROUPS,
};

/** Flat list (kept for callers that only need destinations, e.g. the command palette). */
export const navByRole: Record<Role, NavEntry[]> = Object.fromEntries(
  (Object.keys(navGroupsByRole) as Role[]).map((r) => [r, navGroupsByRole[r].flatMap((g) => g.items)]),
) as Record<Role, NavEntry[]>;

/**
 * Curated 5-item mobile tab bar — must include daily-use destinations that
 * `.slice(0, 5)` on `navByRole` used to drop (parent Comunicados, admin Cafetería).
 */
export const mobileNavByRole: Record<Role, NavEntry[]> = {
  parent: [
    { icon: LayoutDashboard, label: 'Inicio',       to: '/portal', end: true },
    { icon: Coffee,          label: 'Cafetería',    to: '/portal/cafeteria' },
    { icon: QrCode,          label: 'Credencial',   to: '/portal/credencial' },
    { icon: Megaphone,       label: 'Comunicados',  to: '/portal/comunicados' },
    { icon: CreditCard,      label: 'Pagos',        to: '/portal/pagos' },
  ],
  admin: [
    { icon: BarChart3,     label: 'Inicio',      to: '/admin', end: true },
    { icon: Users,         label: 'Alumnos',     to: '/admin/alumnos' },
    { icon: Coffee,        label: 'Cafetería',   to: '/admin/cafeteria', badgeKey: 'cafeteria' },
    { icon: Megaphone,     label: 'Comunicados', to: '/admin/comunicados' },
    { icon: ClipboardList, label: 'Admisiones',  to: '/admin/admisiones', badgeKey: 'admisiones' },
  ],
  staff: navByRole.staff,
  student: [
    { icon: LayoutDashboard, label: 'Inicio',       to: '/portal', end: true },
    { icon: Coffee,          label: 'Cafetería',    to: '/portal/cafeteria' },
    { icon: QrCode,          label: 'Credencial',   to: '/portal/credencial' },
    { icon: Megaphone,       label: 'Comunicados',  to: '/portal/comunicados' },
    { icon: CreditCard,      label: 'Pagos',        to: '/portal/pagos' },
  ],
};
