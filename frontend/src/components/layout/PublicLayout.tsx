import { Outlet, Link, NavLink } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import {
  Menu, X, Phone, Mail, MapPin, ChevronDown,
  Facebook, Instagram, Youtube,
  School, GraduationCap, ClipboardList, Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Logo from '@/components/ui/Logo';
import { RouteSeo } from '@/components/seo/Seo';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { socialEntries } from '@/lib/siteContact';
import { WhatsAppFloat } from '@/components/ui/WhatsAppFloat';

/** Menú confirmado por el cliente (2026-07): 4 grupos + Contacto + CTAs. */
const MENU: { label: string; icon: LucideIcon; items: { label: string; to: string }[] }[] = [
  {
    label: 'El Colegio',
    icon: School,
    items: [
      { label: 'Quiénes Somos', to: '/nosotros' },
      { label: 'Modelo Educativo', to: '/modelo-educativo' },
      { label: 'Galería', to: '/galeria' },
    ],
  },
  {
    label: 'Niveles Educativos',
    icon: GraduationCap,
    items: [
      { label: 'Preescolar', to: '/niveles/preescolar' },
      { label: 'Primaria', to: '/niveles/primaria' },
      { label: 'Secundaria', to: '/niveles/secundaria' },
    ],
  },
  {
    label: 'Admisiones',
    icon: ClipboardList,
    items: [
      { label: 'Proceso de Inscripción', to: '/admisiones' },
      { label: 'Documentación', to: '/admisiones#documentacion' },
      { label: 'Costos', to: '/admisiones#costos' },
      { label: 'Puertas Abiertas', to: '/puertas-abiertas' },
      { label: 'Pre-Registro', to: '/pre-registro' },
    ],
  },
  {
    label: 'Comunidad',
    icon: Users,
    items: [
      { label: 'Plataformas', to: '/comunidad/plataformas' },
      { label: 'Facturación', to: '/comunidad/facturacion' },
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
function NavDropdown({ label, icon: Icon, items }: { label: string; icon: LucideIcon; items: { label: string; to: string }[] }) {
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
        className="flex items-center gap-1.5 text-sm font-medium text-muted hover:text-brand-600 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-2 rounded"
      >
        <Icon className="w-4 h-4 text-green-dark" aria-hidden="true" />
        {label}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute left-1/2 -translate-x-1/2 top-full pt-3 w-60"
        >
          <ul className="rounded-2xl border border-line bg-white shadow-xl p-2 space-y-0.5">
            {items.map((item) => (
              <li key={item.label}>
                <Link
                  to={item.to}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2 text-sm text-ink hover:bg-brand-50 hover:text-brand-700 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                >
                  {item.label}
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
  const settings = useSiteSettings();
  const socials = socialEntries(settings);

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
            {socials.map(({ key, label, href }) => {
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
              <NavDropdown key={group.label} label={group.label} icon={group.icon} items={group.items} />
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

        {/* Mobile menu — acordeón por grupo del menú */}
        {open && (
          <div className="lg:hidden bg-white border-t border-line px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-1 max-h-[calc(100dvh-4rem)] overflow-y-auto">
            {MENU.map((group) => (
              <div key={group.label}>
                <button
                  type="button"
                  aria-expanded={openGroup === group.label}
                  onClick={() => setOpenGroup((g) => (g === group.label ? null : group.label))}
                  className="w-full flex items-center justify-between px-3 py-2.5 min-h-[44px] rounded-lg text-sm font-medium text-ink hover:bg-cream focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                >
                  <span className="flex items-center gap-2.5">
                    <group.icon className="w-4 h-4 text-green-dark" aria-hidden="true" />
                    {group.label}
                  </span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${openGroup === group.label ? 'rotate-180' : ''}`} />
                </button>
                {openGroup === group.label && (
                  <div className="pl-3 space-y-0.5">
                    {group.items.map((item) => (
                      <Link
                        key={item.label}
                        to={item.to}
                        onClick={() => setOpen(false)}
                        className="block px-3 py-2 min-h-[44px] rounded-lg text-sm text-muted hover:bg-cream"
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}

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
            <div className="pt-2 flex flex-col gap-2">
              <Link to="/agendar-visita" onClick={() => setOpen(false)} className="btn-primary justify-center">
                Agendar Visita
              </Link>
              <Link to="/login" onClick={() => setOpen(false)} className="btn-secondary justify-center">
                Portal
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* Page content */}
      <main id="contenido" className="flex-1">
        <Outlet />
      </main>

      {/* Sticky mobile CTA — el CTA principal del cliente, solo en teléfonos. */}
      <Link
        to="/agendar-visita"
        className="btn-pink fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-40 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 justify-center shadow-lg md:hidden"
      >
        Agendar visita
      </Link>

      {/* Floating WhatsApp bubble — right side, every public page. */}
      <WhatsAppFloat />

      {/* Footer */}
      <footer className="bg-dark text-white/60 text-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-8">
          {/* Brand column */}
          <div className="col-span-2">
            <div className="mb-3">
              <Logo variant="horizontal" size={40} theme="dark" />
            </div>
            <p className="text-xs leading-relaxed max-w-xs">
              Educación bilingüe de excelencia para el desarrollo integral de sus hijos.
              Tlalnepantla, Estado de México.
            </p>
            {socials.length > 0 && (
              <div className="flex items-center gap-3 mt-5">
                {socials.map(({ key, label, href }) => {
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

          {/* Link groups */}
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

          {/* Contact */}
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
