import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, Link } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/services/api';
import Logo from '@/components/ui/Logo';
import { Users, LogOut, PanelLeftClose, PanelLeftOpen, ChevronUp, ChevronDown, ChevronRight, BarChart3, LayoutDashboard, Coffee } from 'lucide-react';
import { accountEntries, navGroupsByRole, type NavGroup, type Role } from './navConfig';
import { canOpen, consoleHome, homePath, myCafeteriaPath } from '@/lib/areas';
import { useBadges } from '@/hooks/useBadges';
import { Avatar } from '@/components/ui/Avatar';

interface SidebarProps {
  role: Role;
  /** Drawer open state (mobile only). */
  open?: boolean;
  onNavigate?: () => void;
}

const FOLD_KEY = 'sidebar.folded';
function readFolded(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]') as string[]); } catch { return new Set(); }
}
const COLLAPSE_KEY = 'portal.sidebar.collapsed';
const ROLE_LABEL: Record<string, string> = { admin: 'Administración', staff: 'Personal', student: 'Familia', parent: 'Familia' };

const panelIdOf = (heading: string) => `nav-group-${heading.replace(/\W+/g, '-').toLowerCase()}`;

function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
}

/**
 * Portal sidebar: grouped navigation with live badges (BACKLOG P1-E2/E3), a
 * collapsible icon rail on desktop (E1) and a user card that opens the account
 * actions (E5). On phones it is the off-canvas drawer (swipe-left closes).
 */
export default function Sidebar({ role, open = false, onNavigate }: SidebarProps) {
  const { user } = useAuthStore();
  const badges = useBadges();
  // Staff in the console see only the sections of their areas (lib/areas.ts),
  // and a way between the console and their staff dashboard.
  const home = consoleHome(user);
  const bridge: NavGroup[] = user?.role !== 'staff' || !home ? [] : role === 'admin'
    ? [{ heading: 'Personal', items: [{ icon: BarChart3, label: 'Analítica', to: '/staff', end: true }] }]
    : role === 'staff'
      ? [{ heading: 'Consola', items: [{ icon: LayoutDashboard, label: user.staff_title || 'Mi consola', to: home }] }]
      : [];
  // A console user who also eats at the cafetería (their own staff wallet),
  // opened inside the console so the admin menu stays (owner, 2026-11-25).
  const myCafePath = myCafeteriaPath(user);
  const myCafe: NavGroup[] = myCafePath
    ? [{ heading: 'Mi cuenta', items: [{ icon: Coffee, label: 'Mi cafetería', to: myCafePath }] }]
    : [];
  // A staff member whose only login is the portal one (a «Personal del
  // colegio» cafetería account): the portal reads «Personal», not «Familia».
  // (The family portal renders with role «parent» for every family login.)
  const staffPortal = (role === 'parent' || role === 'student')
    && user?.role === 'student' && user.cafeteria_account?.tipo === 'personal';
  // Only what the account may open: the «Panel de Dirección» and the site
  // content (/staff) are for administrators (QA 2026-11-24).
  const allowed = (gs: NavGroup[]) => gs
    .map((g) => ({ ...g, items: g.items.filter((item) => canOpen(user, item.to)) }))
    .filter((g) => g.items.length > 0);
  const groups = [
    ...(role === 'staff' ? allowed(bridge) : []),
    ...allowed(navGroupsByRole[role] ?? navGroupsByRole.parent)
      .map((g) => (!staffPortal ? g : {
        heading: g.heading === 'Familia' ? 'Personal' : g.heading,
        items: g.items.map((item) => (item.to === '/portal/cafeteria' ? { ...item, label: 'Mi cafetería' } : item)),
      })),
    ...(role === 'admin' ? allowed(bridge) : []),
    ...myCafe,
  ];
  const asideRef = useRef<HTMLElement>(null);
  const touchX = useRef<number | null>(null);
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname, search } = useLocation();
  // Folded group headings, persisted per browser. The admin menu is 23 entries
  // in five groups; an office that lives in Cafetería should not scroll past
  // Contenido del sitio every time.
  const [folded, setFolded] = useState<Set<string>>(readFolded);
  // A group opened near the bottom scrolls into view, so its entries never
  // open below the fold of the menu.
  const reveal = useRef<string | null>(null);
  const toggleGroup = (heading: string) => {
    if (folded.has(heading)) reveal.current = panelIdOf(heading);
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(heading)) next.delete(heading); else next.add(heading);
      try { localStorage.setItem(FOLD_KEY, JSON.stringify([...next])); } catch { /* private mode */ }
      return next;
    });
  };
  useEffect(() => {
    const id = reveal.current;
    reveal.current = null;
    if (!id) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(id)?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [folded]);

  // Scroll cues: the list scrolls inside the sidebar (the header and the user
  // card stay put), and a soft fade at an edge says there is more that way.
  const navRef = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => setEdges((prev) => {
      const top = nav.scrollTop > 4;
      const bottom = nav.scrollTop + nav.clientHeight < nav.scrollHeight - 4;
      return prev.top === top && prev.bottom === bottom ? prev : { top, bottom };
    });
    measure();
    nav.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(nav);
    if (nav.firstElementChild) ro?.observe(nav.firstElementChild);
    return () => { nav.removeEventListener('scroll', measure); ro?.disconnect(); };
  }, [folded, open]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); } catch { /* private mode */ }
      return !c;
    });
  };

  // Mobile drawer (BACKLOG P1-B5): move focus in when it opens so keyboard and
  // screen-reader users land on the menu, and let a leftward swipe close it.
  useEffect(() => {
    if (!open) return;
    if (window.matchMedia?.('(min-width: 1024px)').matches) return;
    asideRef.current?.querySelector<HTMLElement>('a, button')?.focus();
  }, [open]);
  const onTouchStart = (e: React.TouchEvent) => { touchX.current = e.touches[0]?.clientX ?? null; };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchX.current;
    touchX.current = null;
    if (start === null) return;
    const dx = (e.changedTouches[0]?.clientX ?? start) - start;
    if (dx < -60) onNavigate?.();
  };

  // Collapsed rail only applies at lg+ (the drawer is always full width).
  const rail = collapsed;

  return (
    <aside
      ref={asideRef}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      aria-label="Navegación del portal"
      data-collapsed={rail || undefined}
      className={`fixed inset-y-0 left-0 z-drawer flex h-[100dvh] w-[264px] flex-shrink-0 flex-col gap-3 overflow-hidden border-r border-line bg-white px-4 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] transition-[transform,width] duration-300 ease-out [padding-left:max(1rem,env(safe-area-inset-left))] print:hidden lg:static lg:h-auto lg:translate-x-0 ${
        open ? 'translate-x-0' : '-translate-x-full'
      } ${rail ? 'lg:w-[76px] lg:px-2.5' : ''}`}
    >
      {/* Logo + collapse toggle */}
      <div className={`flex items-center ${rail ? 'lg:flex-col lg:gap-2' : 'justify-between'}`}>
        {/* The horizontal lockup: the stacked one took ~150 px of height from the menu on a phone. */}
        <Link to="/" className="flex justify-center px-1" aria-label="Colegio Interlaken, ir al inicio">
          <Logo variant={rail ? 'icon' : 'horizontal'} size={rail ? 40 : 38} theme="light" eager />
        </Link>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={rail ? 'Expandir menú' : 'Contraer menú'}
          aria-pressed={rail}
          className="hidden h-11 w-11 items-center justify-center rounded-sm text-subtle hover:bg-cream hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 lg:flex"
        >
          {rail ? <PanelLeftOpen size={20} aria-hidden="true" /> : <PanelLeftClose size={20} aria-hidden="true" />}
        </button>
      </div>

      {/* Role badge */}
      {!rail && (
        <div className="flex items-center gap-2.5 rounded-md bg-purple-light px-3 py-2">
          <Users size={18} className="text-purple" aria-hidden="true" />
          <div>
            <div className="font-head text-[11px] font-bold uppercase tracking-[1.4px] text-purple">Portal</div>
            <div className="font-head text-[13px] font-bold tracking-[0.5px] text-ink">{staffPortal ? 'Personal' : (ROLE_LABEL[role] ?? role)}</div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      <nav ref={navRef} aria-label="Menú del portal" className="scrollbar-none relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain">
        {groups.map((group) => {
          // The group holding the current page is always open: folding it would
          // hide the highlighted "you are here" entry.
          const holdsCurrent = group.items.some((i) => (i.end ? pathname === i.to : pathname.startsWith(i.to)));
          const isFolded = !rail && folded.has(group.heading) && !holdsCurrent;
          const panelId = panelIdOf(group.heading);
          // A folded group still says how much is waiting inside it.
          const waiting = isFolded ? group.items.reduce((n, i) => n + (i.badgeKey ? badges[i.badgeKey] ?? 0 : 0), 0) : 0;
          return (
          <div key={group.heading}>
            {!rail && (
              <button
                type="button"
                aria-expanded={!isFolded}
                aria-controls={panelId}
                aria-label={waiting > 0 ? `${group.heading}, ${waiting} pendientes` : undefined}
                onClick={() => toggleGroup(group.heading)}
                className="flex min-h-[36px] w-full items-center gap-2 rounded-sm px-3.5 py-1 text-left font-head text-[11px] font-bold uppercase tracking-[1.6px] text-subtle hover:bg-cream-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
              >
                <span className="flex-1">{group.heading}</span>
                {waiting > 0 && (
                  <span aria-hidden="true" className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-coral px-1.5 text-[10px] font-bold normal-case tracking-normal text-white">
                    {waiting > 99 ? '99+' : waiting}
                  </span>
                )}
                <ChevronDown size={16} aria-hidden="true" className={`shrink-0 transition-transform ${isFolded ? '-rotate-90' : ''}`} />
              </button>
            )}
            {rail && <div className="mx-auto mb-1 h-px w-8 bg-line" aria-hidden="true" />}
            <div id={panelId} className={`${isFolded ? 'hidden' : 'flex'} flex-col gap-0.5`}>
              {group.items.map(({ icon: Icon, label, to, end, badgeKey, subBadge }) => {
                const count = badgeKey ? badges[badgeKey] ?? 0 : 0;
                const sub = subBadge ? badges[subBadge.key] ?? 0 : 0;
                // A sub-badge with its own address (owner, 2026-11-25: «Por
                // verificar» opens exactly those top-ups) is a separate link
                // under the entry: an anchor inside the entry's anchor is
                // invalid HTML and unreachable by keyboard.
                const subLink = sub > 0 && subBadge?.to ? { ...subBadge, to: subBadge.to } : null;
                const name = [label, count ? `${count} pendientes` : '', sub && subBadge && !subLink ? `${subBadge.label.toLowerCase()}: ${sub}` : '']
                  .filter(Boolean).join(', ');
                const entry = (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    onClick={onNavigate}
                    title={rail ? label : undefined}
                    aria-label={name}
                    className={({ isActive }) =>
                      `relative flex min-h-[44px] items-center gap-3 rounded-sm px-3.5 py-2 text-[14px] font-medium no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 ${
                        rail ? 'lg:justify-center lg:px-0' : ''
                      } ${
                        isActive
                          ? 'bg-purple text-white'
                          : 'text-muted hover:bg-cream hover:text-ink'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon size={20} className="flex-shrink-0" aria-hidden="true" />
                        <span className={`flex-1 ${rail ? 'lg:hidden' : ''}`}>
                          {label}
                          {sub > 0 && subBadge && !subLink && (
                            <span aria-hidden="true" className={`block text-[11px] font-semibold leading-tight ${isActive ? 'text-white/85' : 'text-amber'}`}>
                              {subBadge.label}: {sub > 99 ? '99+' : sub}
                            </span>
                          )}
                        </span>
                        {count > 0 && (
                          <span className={`flex h-[19px] min-w-[20px] items-center justify-center rounded-full bg-coral px-1.5 text-[11px] font-bold text-white ${rail ? 'lg:absolute lg:-right-0.5 lg:-top-0.5 lg:h-4 lg:min-w-[16px] lg:px-1 lg:text-[10px]' : ''}`}>
                            {count > 99 ? '99+' : count}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                );
                if (!subLink) return entry;
                return (
                  <div key={to} className="flex flex-col">
                    {entry}
                    {/* Lined up with the entry's label (14px padding + 20px icon + 12px gap). */}
                    <Link
                      to={subLink.to}
                      onClick={onNavigate}
                      aria-current={`${pathname}${search}` === subLink.to ? 'page' : undefined}
                      aria-label={`${subLink.label}: ${sub}. Ver la lista`}
                      className={`ml-10 inline-flex min-h-[32px] items-center gap-1 self-start rounded-sm px-1.5 text-[12px] font-semibold leading-tight text-amber no-underline hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 ${rail ? 'lg:hidden' : ''}`}
                    >
                      {subLink.label}: {sub > 99 ? '99+' : sub}
                      <ChevronRight size={14} aria-hidden="true" />
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
          );
        })}
      </nav>
        {/* Scroll cues (decorative): fade where more of the menu is hidden. */}
        <div aria-hidden="true" className={`pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-white to-transparent transition-opacity duration-200 ${edges.top ? 'opacity-100' : 'opacity-0'}`} />
        <div aria-hidden="true" className={`pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white to-transparent transition-opacity duration-200 ${edges.bottom ? 'opacity-100' : 'opacity-0'}`} />
      </div>

      {/* User card → account actions (P1-E5) */}
      <div className="relative">
        {menuOpen && (
          // The same entries as the header's account menu (navConfig.accountEntries).
          <div role="menu" className="absolute bottom-full left-0 right-0 z-10 mb-2 overflow-hidden rounded-md bg-white p-1.5 shadow-raised">
            {accountEntries(user?.role, homePath(user)).map(({ icon: Icon, label, to }) => (
              <Link key={to} role="menuitem" to={to} onClick={() => { setMenuOpen(false); onNavigate?.(); }} className="flex min-h-[44px] items-center gap-3 rounded-sm px-3 text-sm font-medium text-ink hover:bg-cream focus-visible:bg-cream focus-visible:outline-none">
                <Icon size={20} className="text-muted" aria-hidden="true" /> {label}
              </Link>
            ))}
            <button role="menuitem" type="button" onClick={() => { void authApi.logout(); }} className="flex min-h-[44px] w-full items-center gap-3 rounded-sm px-3 text-left text-sm font-semibold text-danger hover:bg-danger-bg focus-visible:bg-danger-bg focus-visible:outline-none">
              <LogOut size={20} aria-hidden="true" /> Cerrar sesión
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Opciones de la cuenta"
          className={`flex min-h-[56px] w-full items-center gap-2.5 rounded-md bg-cream-2 px-3 py-2 text-left transition-colors hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 ${rail ? 'lg:justify-center lg:px-0' : ''}`}
        >
          <Avatar user={user} size={36} />
          <div className={`min-w-0 flex-1 ${rail ? 'lg:hidden' : ''}`}>
            <div className="truncate text-[13px] font-semibold text-ink">{user?.first_name} {user?.last_name}</div>
            <div className="truncate text-[12px] text-subtle">{user?.email}</div>
          </div>
          <ChevronUp size={16} aria-hidden="true" className={`text-subtle transition-transform ${menuOpen ? 'rotate-180' : ''} ${rail ? 'lg:hidden' : ''}`} />
        </button>
      </div>
    </aside>
  );
}
