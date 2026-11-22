import { Outlet, Link, NavLink, useLocation } from 'react-router-dom';
import { waHref } from '@/lib/siteContact';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Menu, X, Phone, Mail, MapPin, ChevronDown, ArrowUpRight,
  GraduationCap, ClipboardList, Users, BookOpen, Camera, Blocks, Pencil,
  FileText, CircleDollarSign, UserPlus, CalendarDays, MonitorSmartphone, Receipt,
  CreditCard, Coffee,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { MenuGroup } from '@/types/content';
import Logo from '@/components/ui/Logo';
import { RouteTransition } from '@/components/layout/RouteTransition';
import { RouteSeo } from '@/components/seo/Seo';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { isExternalHref, LAYOUT_TEXT_DEFAULTS, legalLinks, resolveChrome, siteTexts, withYear, type ChromeButton } from '@/lib/siteChrome';
import { setWaEstimatorTemplate, waMessage } from '@/lib/whatsapp';
import { saveOfflineCopy } from '@/lib/offlineCopy';
import { trackEvent, ConversionEvent } from '@/services/analytics';
import { WhatsAppFloat } from '@/components/ui/WhatsAppFloat';
import { WhatsAppIcon } from '@/components/icons/WhatsAppIcon';
import { SiteNoticeBanner } from '@/components/public/SiteNoticeBanner';
import { useMediaQuery } from '@/hooks/useMediaQuery';

/** Routes where the sticky "Agendar visita" bar would fight an in-page CTA. */
const HIDE_STICKY_CTA = [
  '/agendar-visita',
  '/pre-registro',
  '/login',
];

/** Menú confirmado por el cliente (2026-07): 4 grupos + Contacto + CTAs.
 *  Los iconos viven en los SUBMENÚS (petición del cliente), no en la barra.
 *  «Opción 3» (2026-11-20): «Pagos» se llama «Familias» y recibe «Plataformas»
 *  (antes en «El Colegio»). 2026-11-22: sin «Pagar colegiatura», que repetía
 *  «Colegiaturas y cafetería» (esa página enlaza al pago de colegiaturas). */
type MenuEntry = { label: string; to: string; icon: LucideIcon };
type MenuGroupEntry = { label: string; items: MenuEntry[] };

/** Icons the CMS menu editor can name (falls back to FileText). */
const ICONS: Record<string, LucideIcon> = {
  Users, BookOpen, Camera, Blocks, Pencil, GraduationCap, ClipboardList, FileText, CircleDollarSign, UserPlus, CalendarDays, MonitorSmartphone, Receipt, Phone, Mail, MapPin,
  CreditCard, Coffee,
};

/** CMS menu → renderable groups; empty/invalid CMS menu keeps the built-in one. */
export function resolveMenu(cms: MenuGroup[] | undefined, fallback: MenuGroupEntry[]): MenuGroupEntry[] {
  if (!cms || cms.length === 0) return fallback;
  return cms.map((g) => ({ label: g.label, items: g.items.map((it) => ({ label: it.label, to: it.to, icon: ICONS[it.icon ?? ''] ?? FileText })) }));
}

export const DEFAULT_MENU: MenuGroupEntry[] = [
  {
    label: 'El Colegio',
    items: [
      { label: 'Quiénes Somos', to: '/nosotros', icon: Users },
      { label: 'Modelo Educativo', to: '/modelo-educativo', icon: BookOpen },
      { label: 'Galería', to: '/galeria', icon: Camera },
    ],
  },
  {
    label: 'Niveles Educativos',
    items: [
      { label: 'Preescolar', to: '/niveles/preescolar', icon: Blocks },
      { label: 'Primaria', to: '/niveles/primaria', icon: Pencil },
      { label: 'Secundaria', to: '/niveles/secundaria', icon: GraduationCap },
    ],
  },
  {
    label: 'Admisiones',
    items: [
      { label: 'Proceso de Inscripción', to: '/admisiones', icon: ClipboardList },
      { label: 'Documentación', to: '/admisiones/documentacion', icon: FileText },
      { label: 'Costos', to: '/admisiones/costos', icon: CircleDollarSign },
      // The ficha de inscripción is private (sent after admission): the menu offers the visit.
      { label: 'Agendar visita', to: '/agendar-visita', icon: CalendarDays },
    ],
  },
  {
    label: 'Familias',
    items: [
      { label: 'Colegiaturas y cafetería', to: '/pagos', icon: CircleDollarSign },
      { label: 'Facturación', to: '/comunidad/facturacion', icon: Receipt },
      { label: 'Plataformas', to: '/plataformas', icon: MonitorSmartphone },
    ],
  },
];

/** The ↗ after a menu link that leaves the site (screen readers hear the new tab). */
function ExternalMark() {
  return (
    <>
      <ArrowUpRight className="ml-1 inline h-4 w-4 align-[-3px] opacity-60" aria-hidden="true" />
      <span className="sr-only"> (se abre en otra pestaña)</span>
    </>
  );
}

/** A menu or footer link: site pages use the router; https:// links (Servo Escolar) open in a new tab. */
function MenuLink({ to, className, onClick, children }: { to: string; className: string; onClick?: () => void; children: ReactNode }) {
  if (isExternalHref(to)) {
    return <a href={to} target="_blank" rel="noopener noreferrer" onClick={onClick} className={className}>{children}</a>;
  }
  return <Link to={to} onClick={onClick} className={className}>{children}</Link>;
}

/** A header/footer button from SiteSettings.chrome: external URLs open in a new tab; `icon` draws before the text.
 *  `compact` (desktop header): from 1024 to 1149 px the menu and three buttons
 *  only fit if the outlined buttons with an icon show just the icon (2026-11-22,
 *  Cafetería / Colegiaturas / Agendar visita). The name stays for screen
 *  readers and as a tooltip; from 1150 px (iPad landscape is 1180) it shows. */
function ChromeLink({ button, className, onClick, compact = false }: { button: ChromeButton; className: string; onClick?: () => void; compact?: boolean }) {
  const Icon = button.icon ? ICONS[button.icon] : undefined;
  const iconOnly = compact && !!Icon && !button.primary;
  const label = iconOnly ? <span className="sr-only min-[1150px]:not-sr-only">{button.label}</span> : button.label;
  const content = <>{Icon && <Icon className="h-4 w-4" aria-hidden="true" />}{label}</>;
  const title = iconOnly ? button.label : undefined;
  if (isExternalHref(button.href)) {
    return <a href={button.href} target="_blank" rel="noopener noreferrer" onClick={onClick} className={className} title={title}>{content}</a>;
  }
  return <Link to={button.href} onClick={onClick} className={className} title={title}>{content}</Link>;
}

/** Accessible desktop dropdown (hover + click, aria-expanded, Escape restores
 *  focus, outside-click dismissal). One per grupo del menú del cliente. */
function NavDropdown({ label, items }: { label: string; items: { label: string; to: string; icon: LucideIcon }[] }) {
  const [open, setOpen] = useState(false);
  // Hover-to-open only where hovering exists. On a touch screen the synthetic
  // mouseenter fires just before the click, so the tap opened and then
  // immediately closed the panel.
  const hoverCapable = useMediaQuery('(hover: hover) and (pointer: fine)');
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={hoverCapable ? () => setOpen(true) : undefined}
      onMouseLeave={hoverCapable ? () => setOpen(false) : undefined}
    >
      <button
        ref={btnRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-sm font-medium text-muted hover:text-brand-600 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-2 rounded-sm"
      >
        {label}
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        // Plain popover semantics (like ui/Dropdown): the trigger carries
        // aria-expanded/aria-haspopup; the panel is an unrole'd container of
        // ordinary links — role="menu"/"menuitem" would promise app-menu
        // keyboard behavior these plain links don't implement.
        <div className="absolute left-1/2 -translate-x-1/2 top-full pt-3 w-64">
          <ul className="overflow-hidden rounded-md bg-white p-2 shadow-xl ring-1 ring-ink/5">
            {items.map((item) => (
              <li key={item.label}>
                <MenuLink
                  to={item.to}
                  onClick={() => setOpen(false)}
                  className="group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-ink transition-colors hover:bg-brand-50 hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                >
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-sm bg-green/10 text-green-dark transition-colors group-hover:bg-green-strong group-hover:text-white">
                    <item.icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="font-medium">{item.label}{isExternalHref(item.to) && <ExternalMark />}</span>
                </MenuLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Footer link: 44px tall tap target (WCAG 2.5.5), 14px text. */
const FOOTER_LINK = 'inline-flex min-h-[44px] items-center text-sm hover:text-white transition-colors';

/** Phone, email and address in the footer (mobile accordion and desktop column). */
function FooterContact({ settings, className = '' }: { settings: ReturnType<typeof useSiteSettings>; className?: string }) {
  const row = 'flex min-h-[44px] items-center gap-2 text-sm hover:text-white transition-colors';
  return (
    <ul className={className}>
      {settings.phone_display && (
        <li>
          <a href={`tel:${settings.phone_e164}`} className={row}>
            <Phone className="h-4 w-4 flex-shrink-0" aria-hidden="true" />{settings.phone_display}
          </a>
        </li>
      )}
      {settings.contact_email && (
        <li>
          <a href={`mailto:${settings.contact_email}`} className={`${row} break-all`}>
            <Mail className="h-4 w-4 flex-shrink-0" aria-hidden="true" />{settings.contact_email}
          </a>
        </li>
      )}
      <li>
        <a href={settings.maps_url} target="_blank" rel="noopener noreferrer" title={settings.address} className={`${row} py-2`}>
          <MapPin className="h-4 w-4 flex-shrink-0 self-start mt-0.5" aria-hidden="true" />{settings.address}
        </a>
      </li>
    </ul>
  );
}

export function PublicLayout() {
  const [open, setOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  /** Footer link groups collapse into an accordion below md. */
  const [footerOpen, setFooterOpen] = useState<string | null>(null);
  const { pathname } = useLocation();
  const settings = useSiteSettings();
  const chrome = resolveChrome(settings.chrome);
  // Navegación → «Textos del sitio»: blank = the built-in text.
  const text = siteTexts(settings.chrome, LAYOUT_TEXT_DEFAULTS);
  const contactLabel = text.nav_contact;
  const footerContact = text.footer_contact;
  const LEGAL = legalLinks(settings.chrome);
  // The cost estimator and the offline page read the edited copy outside React.
  useEffect(() => { setWaEstimatorTemplate(settings.chrome); saveOfflineCopy(settings.chrome); }, [settings.chrome]);
  const MENU = resolveMenu(settings.menu, DEFAULT_MENU);
  /** El pie refleja los mismos grupos del menú; Portal/Aviso van en la barra inferior. */
  const FOOTER_GROUPS = MENU.map((g) => ({ heading: g.label, links: g.items }));
  // Only socials with a real URL — never render href="#" (GO-LIVE-AUDIT #41).
  const showStickyCta = !HIDE_STICKY_CTA.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  const menuRef = useRef<HTMLDivElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);

  // Focus management for the mobile menu: move focus in on open, keep Tab inside
  // it, and hand focus back to the burger on close (body scroll is locked below).
  useEffect(() => {
    if (!open) return;
    const panel = menuRef.current;
    const first = panel?.querySelector<HTMLElement>('a, button');
    first?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'))
        .filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const [head, tail] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === head) { e.preventDefault(); tail.focus(); }
      else if (!e.shiftKey && document.activeElement === tail) { e.preventDefault(); head.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      burgerRef.current?.focus();
    };
  }, [open]);

  // Lock body scroll while the mobile menu is open (prevents background scroll).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    // NOTE: PublicLayout is part of the STATIC app shell (main chunk, shared
    // with the portal), so the framer-motion provider does NOT live here —
    // motion-using public pages wrap themselves in <SiteMotionProvider>
    // (see lib/motion.tsx), keeping framer out of the portal's initial chunks.
    // overflow-x-CLIP, not hidden: `hidden` turns this wrapper into a scroll box, so the
    // sticky header stuck inside a box that never scrolls and left the screen with the
    // page. `clip` still cuts sideways overflow without creating a scroll box (body keeps
    // overflow-x: hidden as the fallback for browsers without `clip`).
    <div className="min-h-screen flex flex-col overflow-x-clip">
      <RouteSeo />
      <a href="#contenido" className="skip-link">{text.skip_link}</a>
      <SiteNoticeBanner />
      {/* Preheader — solo escritorio/tablet. Petición del colegio (2026-08-21):
          teléfono a la izquierda, correo a la derecha; sin redes sociales. */}
      <div className="hidden md:block bg-brand-800 text-white text-xs print:hidden">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-1.5 sm:px-6">
          <div className="flex items-center gap-6">
            {settings.phone_display && (
              <a href={`tel:${settings.phone_e164}`} className="flex items-center gap-1 hover:text-brand-200 transition-colors">
                <Phone className="w-4 h-4" aria-hidden="true" /> {settings.phone_display}
              </a>
            )}
          </div>
          <div className="flex items-center gap-6">
            {settings.contact_email && (
              <a href={`mailto:${settings.contact_email}`} className="flex items-center gap-1 hover:text-brand-200 transition-colors">
                <Mail className="w-4 h-4" aria-hidden="true" /> {settings.contact_email}
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Main nav */}
      <div className="accent-bar print:hidden" />
      <header className="bg-white border-b border-line sticky top-0 z-header shadow-sm print:hidden">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-[72px]">
          {/* Logo */}
          <Link to="/" className="flex items-center" aria-label="Colegio Interlaken — Inicio">
            <Logo variant="horizontal" size={52} theme="light" eager />
          </Link>

          {/* Desktop nav — menú confirmado por el cliente */}
          <nav className="hidden lg:flex items-center gap-4">
            {MENU.map((group) => (
              <NavDropdown key={group.label} label={group.label} items={group.items} />
            ))}
            <NavLink
              to="/contacto"
              className={({ isActive }) =>
                `text-sm font-medium transition-colors ${
                  isActive ? 'text-brand-600' : 'text-muted hover:text-brand-600'
                }`
              }
            >
              {contactLabel}
            </NavLink>
          </nav>

          {/* CTA */}
          <div className="hidden lg:flex items-center gap-2">
            {chrome.header_buttons.map((b) => (
              <ChromeLink key={b.label + b.href} button={b} compact className={`${b.primary ? 'btn-primary' : 'btn-secondary'} text-xs px-3.5 py-2`} />
            ))}
          </div>

          {/* Mobile: tap-to-call + burger (the phone strip above is desktop-only) */}
          <div className="flex items-center gap-1 lg:hidden">
            {settings.phone_e164 && (
              <a
                href={`tel:${settings.phone_e164}`}
                aria-label={`Llamar al colegio, ${settings.phone_display}`}
                onClick={() => trackEvent(ConversionEvent.PhoneCta, { context: 'header_movil' })}
                className="grid h-11 w-11 place-items-center rounded-sm text-muted hover:bg-cream focus:outline-none focus:ring-2 focus:ring-brand-500/40"
              >
                <Phone className="h-5 w-5" aria-hidden="true" />
              </a>
            )}
            <button
              ref={burgerRef}
              onClick={() => setOpen(!open)}
              aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
              aria-expanded={open}
              aria-controls="mobile-menu"
              className="grid h-11 w-11 place-items-center rounded-sm text-muted hover:bg-cream focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            >
              {open ? <X className="w-5 h-5" aria-hidden="true" /> : <Menu className="w-5 h-5" aria-hidden="true" />}
            </button>
          </div>
        </div>

        {/* Mobile menu — CTAs near top, then Contacto, then acordeón por grupo */}
        {open && (
          <div
            ref={menuRef}
            id="mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Menú de navegación"
            className="lg:hidden bg-white border-t border-line px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-1 max-h-[calc(100dvh-4rem)] overflow-y-auto"
          >
            <div className="flex flex-col gap-2 pb-2">
              {chrome.header_buttons.map((b) => (
                <ChromeLink key={b.label + b.href} button={b} onClick={() => setOpen(false)} className={`${b.primary ? 'btn-pink' : 'btn-secondary'} justify-center min-h-[44px]`} />
              ))}
            </div>

            <NavLink
              to="/contacto"
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `block px-3 py-2.5 min-h-[44px] rounded-sm text-sm font-medium transition-colors ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-ink hover:bg-cream'
                }`
              }
            >
              {contactLabel}
            </NavLink>

            <div className="border-t border-line pt-1" />

            {MENU.map((group) => (
              <div key={group.label}>
                <button
                  type="button"
                  aria-expanded={openGroup === group.label}
                  onClick={() => setOpenGroup((g) => (g === group.label ? null : group.label))}
                  className="w-full flex items-center justify-between px-3 py-2.5 min-h-[44px] rounded-sm text-sm font-medium text-ink hover:bg-cream focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                >
                  {group.label}
                  <ChevronDown className={`w-4 h-4 transition-transform ${openGroup === group.label ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
                {openGroup === group.label && (
                  <div className="space-y-0.5 pl-2">
                    {group.items.map((item) => (
                      <MenuLink
                        key={item.label}
                        to={item.to}
                        onClick={() => setOpen(false)}
                        className="flex min-h-[44px] items-center gap-3 rounded-sm px-3 py-2 text-sm text-muted hover:bg-cream hover:text-ink"
                      >
                        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-sm bg-green/10 text-green-dark">
                          <item.icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span>{item.label}{isExternalHref(item.to) && <ExternalMark />}</span>
                      </MenuLink>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </header>

      {/* Page content — bottom pad clears sticky CTA + WA on phones */}
      <main
        id="contenido"
        // Phones always reserve room at the bottom: either the sticky CTA bar or
        // (on the funnel pages that hide it) the WhatsApp float sits there.
        className={`flex-1 ${
          showStickyCta
            ? 'pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-0'
            : 'pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0'
        }`}
      >
        <RouteTransition><Outlet /></RouteTransition>
      </main>

      {/* Sticky mobile CTA — hidden on funnel/auth pages that already have a
          primary action. ONE bar with two actions: Agendar (primary) +
          WhatsApp (secondary, hidden when no number is configured). */}
      {showStickyCta && (
        // data-sticky-cta: the cookie banner lifts itself above this bar (CookieBanner.tsx).
        <div data-sticky-cta="" className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-sticky flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 items-stretch gap-2 md:hidden print:hidden">
          <ChromeLink button={{ label: chrome.sticky_label, href: chrome.sticky_href }} className="btn-pink min-w-0 flex-1 justify-center shadow-lg" />
          {settings.whatsapp_number && (
            <a
              href={waHref(settings.whatsapp_number, waMessage(settings.chrome, 'wa_visit'))}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Escribir por WhatsApp"
              title="Escribir por WhatsApp"
              onClick={() => trackEvent(ConversionEvent.WhatsappCta, { context: 'barra_fija' })}
              className="flex w-[52px] flex-shrink-0 items-center justify-center rounded-sm bg-green-600 text-white shadow-lg transition-colors hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
            >
              <WhatsAppIcon className="h-6 w-6" />
            </a>
          )}
        </div>
      )}

      {/* Floating WhatsApp bubble — right side, every public page. */}
      <WhatsAppFloat stickyCtaVisible={showStickyCta} />

      {/* Footer */}
      <footer
        className={`bg-dark text-white/60 text-sm ${
          showStickyCta ? 'pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0' : ''
        }`}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
          {/* Brand always visible */}
          <div className="mb-8 max-w-sm">
            <div className="mb-3">
              <Logo variant="horizontal" size={52} theme="dark" />
            </div>
            <p className="text-xs leading-relaxed">{chrome.footer_tagline}</p>
          </div>

          {/* Footer groups are h3s: one hidden h2 names the region for screen readers. */}
          <h2 className="sr-only">Mapa del sitio</h2>

          {/* Mobile (&lt;md): accordion link groups — desktop: open grid */}
          <div className="md:hidden divide-y divide-white/10 border-y border-white/10 print:hidden">
            {[...FOOTER_GROUPS.map((g) => ({ ...g, contact: false })), { heading: footerContact, links: [] as typeof FOOTER_GROUPS[number]['links'], contact: true }].map((group) => {
              const isContact = group.contact;
              const expanded = footerOpen === group.heading;
              return (
                <div key={group.heading}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setFooterOpen((h) => (h === group.heading ? null : group.heading))}
                    className="flex w-full min-h-[48px] items-center justify-between py-3 text-left text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  >
                    {group.heading}
                    <ChevronDown className={`h-4 w-4 text-white/60 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </button>
                  {expanded && (
                    isContact ? <FooterContact settings={settings} className="pb-3" /> : (
                      <ul className="pb-3">
                        {group.links.map((l) => (
                          <li key={l.label}>
                            <MenuLink to={l.to} className={FOOTER_LINK}>{l.label}{isExternalHref(l.to) && <ExternalMark />}</MenuLink>
                          </li>
                        ))}
                      </ul>
                    )
                  )}
                </div>
              );
            })}
          </div>

          {/* Desktop / tablet grid */}
          <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-5 gap-8 print:hidden">
            {FOOTER_GROUPS.map((group) => (
              <div key={group.heading}>
                <h3 className="text-white font-semibold mb-1 text-sm">{group.heading}</h3>
                <ul>
                  {group.links.map((l) => (
                    <li key={l.label}>
                      <MenuLink to={l.to} className={FOOTER_LINK}>{l.label}{isExternalHref(l.to) && <ExternalMark />}</MenuLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div>
              <h3 className="text-white font-semibold mb-1 text-sm">{footerContact}</h3>
              <FooterContact settings={settings} />
            </div>
          </div>

        </div>
        <div className="border-t border-white/10">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-col gap-2 text-xs text-center sm:flex-row sm:items-center sm:justify-between">
            <span>{withYear(chrome.footer_copyright).map((part, i) => <Fragment key={i}>{part}</Fragment>)}</span>
            <div className="flex flex-wrap items-center justify-center gap-x-4">
              {LEGAL.map((l) => <ChromeLink key={l.label + l.href} button={l} className="inline-flex min-h-[44px] items-center gap-1.5 hover:text-white transition-colors" />)}
              <span className="text-white/70">{chrome.footer_note}</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
