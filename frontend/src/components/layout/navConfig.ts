import {
  LayoutDashboard, CreditCard, Users, Coffee, ClipboardList, BarChart3,
  CalendarClock, Megaphone, Settings, ShieldCheck, UserCircle, QrCode, KeyRound, Bell, Inbox, UserCog, Image, FileText, Compass, CalendarRange, Merge, Scale, KanbanSquare, CalendarDays, FormInput, MessageSquareQuote, House, CircleDollarSign, FileLock2, FolderCheck, type LucideIcon } from 'lucide-react';

export type Role = 'parent' | 'student' | 'admin' | 'staff';

/** Keys returned by GET /core/badges/ (BACKLOG P1-E3). */
export type BadgeKey = 'admisiones' | 'visitas' | 'cafeteria' | 'cafeteria_verificar' | 'contrasenas' | 'notificaciones' | 'mensajes' | 'formularios' | 'arco';

export interface NavEntry {
  icon: LucideIcon;
  label: string;
  to: string;
  end?: boolean;
  /** Live counter from /core/badges/ to show next to the label. */
  badgeKey?: BadgeKey;
  /** A second counter that needs its own words, shown under the label as
   *  «label: N» while it is above zero (e.g. «Por verificar: 2»). */
  subBadge?: { key: BadgeKey; label: string };
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
      { icon: Bell,            label: 'Avisos',         to: '/portal/notificaciones', badgeKey: 'notificaciones' },
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
        { icon: BarChart3,     label: 'Inicio',     to: '/admin', end: true },
        { icon: Users,         label: 'Alumnos',    to: '/admin/alumnos' },
        { icon: House,         label: 'Familias',   to: '/admin/familias' },
        { icon: ClipboardList, label: 'Admisiones', to: '/admin/admisiones', end: true, badgeKey: 'admisiones' },
        { icon: KanbanSquare, label: 'Pipeline', to: '/admin/admisiones/pipeline' },
        { icon: FolderCheck, label: 'Documentos requeridos', to: '/admin/admisiones/documentos' },
        { icon: CalendarClock, label: 'Visitas',    to: '/admin/visitas', end: true, badgeKey: 'visitas' },
        { icon: CalendarDays, label: 'Agenda semanal', to: '/admin/visitas/semana' },
      ],
    },
    {
      heading: 'Cafetería y pagos',
      items: [
        // «Por verificar»: card top-ups nothing applies until someone checks
        // them in MultiCobros (2026-11-18: two sat in Loyverse all morning).
        { icon: Coffee,     label: 'Cafetería', to: '/admin/cafeteria', badgeKey: 'cafeteria',
          subBadge: { key: 'cafeteria_verificar', label: 'Por verificar' } },
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
        { icon: FileText,      label: 'Páginas',     to: '/admin/contenido', end: true },
        { icon: FormInput,     label: 'Formularios', to: '/admin/formularios', badgeKey: 'formularios' },
        { icon: Compass,       label: 'Navegación', to: '/admin/navegacion' },
        { icon: Image,         label: 'Biblioteca de medios', to: '/admin/contenido/medios' },
        { icon: CircleDollarSign, label: 'Costos y precios', to: '/admin/costos' },
        { icon: FileLock2,     label: 'Aviso de privacidad', to: '/admin/aviso-privacidad' },
        { icon: CalendarDays,  label: 'Calendario',  to: '/admin/calendario' },
        { icon: MessageSquareQuote, label: 'Testimonios', to: '/admin/testimonios' },
      ],
    },
    {
      heading: 'Sistema',
      items: [
        { icon: Settings,    label: 'Ajustes',   to: '/admin/ajustes' },
        { icon: UserCog,     label: 'Usuarios',  to: '/admin/usuarios' },
        { icon: Merge,       label: 'Fusionar cuentas', to: '/admin/fusionar-cuentas' },
        { icon: ShieldCheck, label: 'Auditoría', to: '/admin/auditoria' },
        { icon: Scale,       label: 'Solicitudes ARCO', to: '/admin/arco', badgeKey: 'arco' },
        { icon: CalendarRange, label: 'Nuevo ciclo', to: '/admin/nuevo-ciclo' },
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
    {
      heading: 'Contenido del sitio',
      items: [
        { icon: FileText, label: 'Páginas',              to: '/staff/contenido', end: true },
        { icon: Image,    label: 'Biblioteca de medios', to: '/staff/contenido/medios' },
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
const FAMILY_MOBILE: NavEntry[] = [
    { icon: LayoutDashboard, label: 'Inicio',       to: '/portal', end: true },
    { icon: Coffee,          label: 'Cafetería',    to: '/portal/cafeteria' },
    { icon: QrCode,          label: 'Credencial',   to: '/portal/credencial' },
    { icon: Bell,            label: 'Avisos',       to: '/portal/notificaciones', badgeKey: 'notificaciones' },
    { icon: CreditCard,      label: 'Pagos',        to: '/portal/pagos' },
];

export const mobileNavByRole: Record<Role, NavEntry[]> = {
  parent: FAMILY_MOBILE,
  admin: [
    { icon: BarChart3,     label: 'Inicio',      to: '/admin', end: true },
    { icon: Users,         label: 'Alumnos',     to: '/admin/alumnos' },
    { icon: Coffee,        label: 'Cafetería',   to: '/admin/cafeteria', badgeKey: 'cafeteria' },
    { icon: Megaphone,     label: 'Comunicados', to: '/admin/comunicados' },
    { icon: ClipboardList, label: 'Admisiones',  to: '/admin/admisiones', badgeKey: 'admisiones' },
  ],
  staff: navByRole.staff,
  // Same shell, same destinations as parents (see navGroupsByRole.student).
  student: FAMILY_MOBILE,
};

/**
 * The account menu, shared by the header (AccountMenu) and the sidebar's user
 * card so both offer the same entries in the same order (Phase 4.7). Sign-out
 * is rendered after these by each menu. Console logins also get a way back
 * to their console home and, for admins, Ajustes.
 */
export function accountEntries(role: Role | string | undefined, home: string): NavEntry[] {
  // A staff account without console areas has no panel: /staff is for
  // administrators (QA 2026-11-24), so no «Mi panel» that only says so.
  const console = role === 'admin' || (role === 'staff' && home !== '/staff');
  return [
    ...(console && home !== '/portal' ? [{ icon: LayoutDashboard, label: 'Mi panel', to: home }] : []),
    { icon: UserCircle, label: 'Mi perfil', to: '/portal/perfil' },
    // The notification preferences (the list itself is «Avisos» in the menu).
    { icon: Bell, label: 'Preferencias de avisos', to: '/portal/perfil?tab=avisos' },
    { icon: FileLock2, label: 'Privacidad', to: '/portal/privacidad' },
    ...(role === 'admin' ? [{ icon: Settings, label: 'Ajustes', to: '/admin/ajustes' }] : []),
  ];
}

/** Header icon button (hamburger, bell): transparent 44 × 44 with a hover
 *  tint; no box, no border, no glow (Phase 4.7, flat header). */
export const HEADER_ICON_BUTTON =
  'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-ink/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40';
