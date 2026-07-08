import { Outlet, Link, NavLink } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import {
  Menu, X, Phone, Mail, MapPin, ChevronDown,
  Facebook, Instagram, Youtube,
} from 'lucide-react';
import Logo from '@/components/ui/Logo';
import { RouteSeo } from '@/components/seo/Seo';

const NAV_LINKS = [
  { to: '/nosotros',          label: 'Nosotros' },
  { to: '/admisiones',        label: 'Admisiones' },
  { to: '/puertas-abiertas',  label: 'Puertas Abiertas' },
  { to: '/agendar-visita',    label: 'Agendar Visita' },
  { to: '/contacto',          label: 'Contacto' },
];

/** Grouped entries for the "Programas ▾" mega-menu. Routes are unchanged: the
 *  levels point at Admisiones and the extracurriculars at Nosotros. */
const PROGRAM_GROUPS = [
  {
    heading: 'Niveles',
    items: [
      { label: 'Preescolar', to: '/admisiones' },
      { label: 'Primaria', to: '/admisiones' },
      { label: 'Secundaria', to: '/admisiones' },
    ],
  },
  {
    heading: 'Programas',
    items: [
      { label: 'Inglés', to: '/nosotros' },
      { label: 'Deportes', to: '/nosotros' },
      { label: 'Arte y Música', to: '/nosotros' },
      { label: 'Ciencia y Robótica', to: '/nosotros' },
    ],
  },
];

const FOOTER_GROUPS = [
  {
    heading: 'Niveles',
    links: [
      { label: 'Preescolar', to: '/admisiones' },
      { label: 'Primaria', to: '/admisiones' },
      { label: 'Secundaria', to: '/admisiones' },
    ],
  },
  {
    heading: 'Admisiones',
    links: [
      { label: 'Proceso de admisión', to: '/admisiones' },
      { label: 'Pre-Registro', to: '/pre-registro' },
      { label: 'Puertas Abiertas', to: '/puertas-abiertas' },
      { label: 'Agendar Visita', to: '/agendar-visita' },
    ],
  },
  {
    heading: 'Comunidad',
    links: [
      { label: 'Nosotros', to: '/nosotros' },
      { label: 'Contacto', to: '/contacto' },
      { label: 'Portal Escolar', to: '/login' },
    ],
  },
];

const SOCIALS = [
  { label: 'Facebook', href: 'https://facebook.com', Icon: Facebook },
  { label: 'Instagram', href: 'https://instagram.com', Icon: Instagram },
  { label: 'YouTube', href: 'https://youtube.com', Icon: Youtube },
];

/** Accessible desktop "Programas ▾" dropdown: hover + click, aria-expanded,
 *  Escape to close (restoring focus), and outside-click dismissal. */
function ProgramsDropdown() {
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
        Programas
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Programas"
          className="absolute left-1/2 -translate-x-1/2 top-full pt-3 w-[420px]"
        >
          <div className="rounded-2xl border border-line bg-white shadow-xl p-5 grid grid-cols-2 gap-5">
            {PROGRAM_GROUPS.map((group) => (
              <div key={group.heading}>
                <p className="text-xs font-bold uppercase tracking-wider text-brand-400 mb-2">{group.heading}</p>
                <ul className="space-y-0.5">
                  {group.items.map((item) => (
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
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function PublicLayout() {
  const [open, setOpen] = useState(false);
  const [mobileProgramsOpen, setMobileProgramsOpen] = useState(false);

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
      {/* Top bar */}
      <div className="hidden md:flex bg-brand-800 text-white text-xs px-6 py-1.5 justify-end gap-6">
        <a href="tel:+525512345678" className="flex items-center gap-1 hover:text-brand-200 transition-colors">
          <Phone className="w-3 h-3" /> (55) 1234-5678
        </a>
        <a href="mailto:colegio@interlaken.edu.mx" className="flex items-center gap-1 hover:text-brand-200 transition-colors">
          <Mail className="w-3 h-3" /> colegio@interlaken.edu.mx
        </a>
      </div>

      {/* Main nav */}
      <div className="accent-bar" />
      <header className="bg-white border-b border-line sticky top-0 z-50 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center" aria-label="Colegio Interlaken — Inicio">
            <Logo variant="horizontal" size={40} theme="light" eager />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6">
            <ProgramsDropdown />
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `text-sm font-medium transition-colors ${
                    isActive ? 'text-brand-600' : 'text-muted hover:text-brand-600'
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          {/* CTA */}
          <div className="hidden md:flex items-center gap-3">
            <Link to="/pre-registro" className="btn-primary text-xs px-4 py-2">
              Pre-Registro
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
            className="md:hidden p-2 rounded-lg text-muted hover:bg-cream focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile menu */}
        {open && (
          <div className="md:hidden bg-white border-t border-line px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-1 max-h-[calc(100dvh-4rem)] overflow-y-auto">
            {/* Programas accordion */}
            <button
              type="button"
              aria-expanded={mobileProgramsOpen}
              onClick={() => setMobileProgramsOpen((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium text-ink hover:bg-cream focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            >
              Programas
              <ChevronDown className={`w-4 h-4 transition-transform ${mobileProgramsOpen ? 'rotate-180' : ''}`} />
            </button>
            {mobileProgramsOpen && (
              <div className="pl-3 space-y-0.5">
                {PROGRAM_GROUPS.flatMap((g) => g.items).map((item, i) => (
                  <Link
                    key={`${item.label}-${i}`}
                    to={item.to}
                    onClick={() => setOpen(false)}
                    className="block px-3 py-2 rounded-lg text-sm text-muted hover:bg-cream"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            )}

            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-ink hover:bg-cream'
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
            <div className="pt-2 flex flex-col gap-2">
              <Link to="/pre-registro" onClick={() => setOpen(false)} className="btn-primary justify-center">
                Pre-Registro
              </Link>
              <Link to="/login" onClick={() => setOpen(false)} className="btn-secondary justify-center">
                Portal Escolar
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* Page content */}
      <main id="contenido" className="flex-1">
        <Outlet />
      </main>

      {/* Sticky mobile CTA — quick path to pre-inscripción, phones only. */}
      <Link
        to="/pre-registro"
        className="btn-pink fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-40 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 justify-center shadow-lg md:hidden"
      >
        Pre-inscripción
      </Link>

      {/* Footer */}
      <footer className="bg-dark text-white/60 text-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 grid grid-cols-2 md:grid-cols-5 gap-8">
          {/* Brand column */}
          <div className="col-span-2">
            <div className="mb-3">
              <Logo variant="horizontal" size={40} theme="dark" />
            </div>
            <p className="text-xs leading-relaxed max-w-xs">
              Educación bilingüe de excelencia para el desarrollo integral de sus hijos.
              Tlalnepantla, Estado de México.
            </p>
            <div className="flex items-center gap-3 mt-5">
              {SOCIALS.map(({ label, href, Icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white transition-colors"
                >
                  <Icon className="w-4 h-4" />
                </a>
              ))}
            </div>
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
              <li className="flex items-start gap-2">
                <Phone className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <a href="tel:+525512345678" className="hover:text-white transition-colors">(55) 1234-5678</a>
              </li>
              <li className="flex items-start gap-2">
                <Mail className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <a href="mailto:colegio@interlaken.edu.mx" className="hover:text-white transition-colors break-all">colegio@interlaken.edu.mx</a>
              </li>
              <li className="flex items-start gap-2">
                <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>Tlalnepantla de Baz, Estado de México</span>
              </li>
            </ul>
            <a
              href="https://wa.me/5215512345678?text=Hola%2C%20me%20gustar%C3%ADa%20obtener%20m%C3%A1s%20informaci%C3%B3n"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 mt-4 text-xs bg-green-600 text-white px-3 py-1.5 rounded-full hover:bg-green-700 transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              WhatsApp
            </a>
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
