import { Outlet, Link, NavLink, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import {
  Menu, X, Phone, Mail, MapPin, ChevronDown,
  GraduationCap, ClipboardList, Users, BookOpen, Camera, Blocks, Pencil,
  FileText, CircleDollarSign, DoorOpen, UserPlus, MonitorSmartphone, Receipt,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Facebook, Instagram, Youtube } from '@/components/icons/brand-icons';
import Logo from '@/components/ui/Logo';
import { RouteTransition } from '@/components/layout/RouteTransition';
import { RouteSeo } from '@/components/seo/Seo';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { socialEntries } from '@/lib/siteContact';
import { WhatsAppFloat } from '@/components/ui/WhatsAppFloat';

/** Routes where the sticky "Agendar visita" bar would fight an in-page CTA. */
const HIDE_STICKY_CTA = [
  '/agendar-visita',
  '/pre-registro',
  '/registro',
  '/puertas-abiertas',
  '/login',
  '/olvide-contrasena',
  '/restablecer-contrasena',
];

/** Menú confirmado por el cliente (2026-07): 4 grupos + Contacto + CTAs.
 *  Los iconos viven en los SUBMENÚS (petición del cliente), no en la barra. */
const MENU: { label: string; items: { label: string; to: string; icon: LucideIcon }[] }[] = [
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
      { label: 'Puertas Abiertas', to: '/puertas-abiertas', icon: DoorOpen },
      { label: 'Pre-Registro', to: '/pre-registro', icon: UserPlus },
    ],
  },
  {
    label: 'Comunidad',
    items: [
      { label: 'Plataformas', to: '/comunidad/plataformas', icon: MonitorSmartphone },
      { label: 'Facturación', to: '/comunidad/facturacion', icon: Receipt },
    ],
  },
];

/** El pie refleja los mismos 4 grupos del menú; Portal/Aviso van en la barra inferior. */
const FOOTER_GROUPS = MENU.map((g) => ({ heading: g.label, links: g.items }));

// Icons per social key; URLs come from the admin-editable site settings
// (CMS Phase 1) — entries without a configured URL are not rendered.
const SOCIAL_ICONS = {
  facebook: Facebook,
  instagram: Instagram,
  youtube: Youtube,
} as const;

/** Accessible desktop dropdown (hover + click, aria-expanded, Escape restores
 *  focus, outside-click dismissal). One per grupo del menú del cliente. */
function NavDropdown({ label, items }: { label: string; items: { label: string; to: string; icon: LucideIcon }[] }) {
  const [open, setOpen] = useState(false);
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
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={btnRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-sm font-medium text-muted hover:text-brand-600 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-2 rounded"
      >
        {label}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute left-1/2 -translate-x-1/2 top-full pt-3 w-64"
        >
          <ul className="overflow-hidden rounded-2xl border border-line bg-white p-2 shadow-xl ring-1 ring-ink/5">
            {items.map((item) => (
              <li key={item.label}>
                <Link
                  to={item.to}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink transition-colors hover:bg-brand-50 hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                >
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-green/10 text-green-dark transition-colors group-hover:bg-green group-hover:text-white">
                    <item.icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="font-medium">{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function PublicLayout() {
  const [open, setOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  /** Footer link groups collapse into an accordion below md. */
  const [footerOpen, setFooterOpen] = useState<string | null>(null);
  const { pathname } = useLocation();
  const settings = useSiteSettings();
  // Only socials with a real URL — never render href="#" (GO-LIVE-AUDIT #41).
  const displaySocials = socialEntries(settings);
  const showStickyCta = !HIDE_STICKY_CTA.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

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
    <div className="min-h-screen flex flex-col overflow-x-hidden">
      <RouteSeo />
      <a href="#contenido" className="skip-link">Saltar al contenido</a>
      {/* Preheader — solo escritorio/tablet. Mismo contenedor que la barra de
          navegación: las redes quedan alineadas al borde del logo y el correo
          termina al ras del botón «Portal». */}
      <div className="hidden md:block bg-brand-800 text-white text-xs">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-1.5 sm:px-6">
          <div className="flex items-center gap-2">
            {displaySocials.map(({ key, label, href }) => {
              const Icon = SOCIAL_ICONS[key];
              return (
                <a
                  key={key}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-white/85 transition-colors hover:bg-white/25 hover:text-white"
                >
                  <Icon className="h-3 w-3" aria-hidden="true" />
                </a>
              );
            })}
          </div>
          <div className="flex items-center gap-6">
            {settings.phone_display && (
              <a href={`tel:${settings.phone_e164}`} className="flex items-center gap-1 hover:text-brand-200 transition-colors">
                <Phone className="w-3 h-3" aria-hidden="true" /> {settings.phone_display}
              </a>
            )}
            {settings.contact_email && (
              <a href={`mailto:${settings.contact_email}`} className="flex items-center gap-1 hover:text-brand-200 transition-colors">
                <Mail className="w-3 h-3" aria-hidden="true" /> {settings.contact_email}
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Main nav */}
      <div className="accent-bar" />
      <header className="bg-white border-b border-line sticky top-0 z-50 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center" aria-label="Colegio Interlaken — Inicio">
            <Logo variant="horizontal" size={40} theme="light" eager />
          </Link>

          {/* Desktop nav — menú confirmado por el cliente */}
          <nav className="hidden lg:flex items-center gap-5">
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
              Contacto
            </NavLink>
          </nav>

          {/* CTA */}
          <div className="hidden lg:flex items-center gap-3">
            <Link to="/agendar-visita" className="btn-primary text-xs px-4 py-2">
              Agendar Visita
            </Link>
            <Link to="/login" className="btn-secondary text-xs px-4 py-2">
              Portal
            </Link>
          </div>

          {/* Mobile burger */}
          <button
            onClick={() => setOpen(!open)}
            aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={open}
            className="lg:hidden p-2 rounded-lg text-muted hover:bg-cream focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile menu — CTAs near top, then Contacto, then acordeón por grupo */}
        {open && (
          <div className="lg:hidden bg-white border-t border-line px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-1 max-h-[calc(100dvh-4rem)] overflow-y-auto">
            <div className="flex flex-col gap-2 pb-2">
              <Link to="/agendar-visita" onClick={() => setOpen(false)} className="btn-pink justify-center min-h-[44px]">
                Agendar Visita
              </Link>
              <Link to="/login" onClick={() => setOpen(false)} className="btn-secondary justify-center min-h-[44px]">
                Portal
              </Link>
            </div>

            <NavLink
              to="/contacto"
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `block px-3 py-2.5 min-h-[44px] rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-ink hover:bg-cream'
                }`
              }
            >
              Contacto
            </NavLink>

            <div className="border-t border-line pt-1" />

            {MENU.map((group) => (
              <div key={group.label}>
                <button
                  type="button"
                  aria-expanded={openGroup === group.label}
                  onClick={() => setOpenGroup((g) => (g === group.label ? null : group.label))}
                  className="w-full flex items-center justify-between px-3 py-2.5 min-h-[44px] rounded-lg text-sm font-medium text-ink hover:bg-cream focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                >
                  {group.label}
                  <ChevronDown className={`w-4 h-4 transition-transform ${openGroup === group.label ? 'rotate-180' : ''}`} />
                </button>
                {openGroup === group.label && (
                  <div className="space-y-0.5 pl-2">
                    {group.items.map((item) => (
                      <Link
                        key={item.label}
                        to={item.to}
                        onClick={() => setOpen(false)}
                        className="flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted hover:bg-cream hover:text-ink"
                      >
                        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-green/10 text-green-dark">
                          <item.icon className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                        {item.label}
                      </Link>
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
        className={`flex-1 ${
          showStickyCta
            ? 'pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-0'
            : ''
        }`}
      >
        <RouteTransition><Outlet /></RouteTransition>
      </main>

      {/* Sticky mobile CTA — hidden on funnel/auth pages that already have a primary action. */}
      {showStickyCta && (
        <Link
          to="/agendar-visita"
          className="btn-pink fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-40 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 justify-center shadow-lg md:hidden"
        >
          Agendar visita
        </Link>
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
              <Logo variant="horizontal" size={40} theme="dark" />
            </div>
            <p className="text-xs leading-relaxed">
              Educación bilingüe de excelencia para el desarrollo integral de sus hijos.
              Tlalnepantla, Estado de México.
            </p>
            {displaySocials.length > 0 && (
              <div className="flex items-center gap-3 mt-5">
                {displaySocials.map(({ key, label, href }) => {
                  const Icon = SOCIAL_ICONS[key];
                  return (
                    <a
                      key={key}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={label}
                      className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white transition-colors"
                    >
                      <Icon className="w-4 h-4" />
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          {/* Mobile (&lt;md): accordion link groups — desktop: open grid */}
          <div className="md:hidden divide-y divide-white/10 border-y border-white/10">
            {[...FOOTER_GROUPS, { heading: 'Contacto', links: [] as typeof FOOTER_GROUPS[number]['links'] }].map((group) => {
              const isContact = group.heading === 'Contacto';
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
                    <ChevronDown className={`h-4 w-4 text-white/60 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                  </button>
                  {expanded && (
                    isContact ? (
                      <ul className="space-y-2.5 pb-4 text-xs">
                        {settings.phone_display && (
                          <li className="flex items-start gap-2">
                            <Phone className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                            <a href={`tel:${settings.phone_e164}`} className="hover:text-white transition-colors">{settings.phone_display}</a>
                          </li>
                        )}
                        {settings.contact_email && (
                          <li className="flex items-start gap-2">
                            <Mail className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                            <a href={`mailto:${settings.contact_email}`} className="hover:text-white transition-colors break-all">{settings.contact_email}</a>
                          </li>
                        )}
                        <li className="flex items-start gap-2">
                          <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                          <a
                            href={settings.maps_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={settings.address}
                            className="hover:text-white transition-colors"
                          >
                            Av. de los Reyes 67, Tlalnepantla, Edo. Méx.
                          </a>
                        </li>
                      </ul>
                    ) : (
                      <ul className="space-y-2.5 pb-4 text-xs">
                        {group.links.map((l) => (
                          <li key={l.label}>
                            <Link to={l.to} className="hover:text-white transition-colors">{l.label}</Link>
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
          <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-5 gap-8">
            {FOOTER_GROUPS.map((group) => (
              <div key={group.heading}>
                <h4 className="text-white font-semibold mb-3">{group.heading}</h4>
                <ul className="space-y-2 text-xs">
                  {group.links.map((l) => (
                    <li key={l.label}>
                      <Link to={l.to} className="hover:text-white transition-colors">{l.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div>
              <h4 className="text-white font-semibold mb-3">Contacto</h4>
              <ul className="space-y-2 text-xs">
                {settings.phone_display && (
                  <li className="flex items-start gap-2">
                    <Phone className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <a href={`tel:${settings.phone_e164}`} className="hover:text-white transition-colors">{settings.phone_display}</a>
                  </li>
                )}
                {settings.contact_email && (
                  <li className="flex items-start gap-2">
                    <Mail className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <a href={`mailto:${settings.contact_email}`} className="hover:text-white transition-colors break-all">{settings.contact_email}</a>
                  </li>
                )}
                <li className="flex items-start gap-2">
                  <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <a
                    href={settings.maps_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={settings.address}
                    className="hover:text-white transition-colors"
                  >
                    Av. de los Reyes 67, Tlalnepantla, Edo. Méx.
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-col gap-2 text-xs text-center sm:flex-row sm:items-center sm:justify-between">
            <span>© {new Date().getFullYear()} Colegio Interlaken · Todos los derechos reservados</span>
            <div className="flex items-center gap-4">
              <Link to="/aviso-de-privacidad" className="hover:text-white transition-colors">Aviso de Privacidad</Link>
              <span className="text-white/45">Reconocimiento de validez oficial · SEP</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
