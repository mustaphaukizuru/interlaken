import { Outlet, Link, NavLink } from 'react-router-dom';
import { useState } from 'react';
import { Menu, X, Phone, Mail } from 'lucide-react';
import Logo from '@/components/ui/Logo';

const NAV_LINKS = [
  { to: '/nosotros',          label: 'Nosotros' },
  { to: '/admisiones',        label: 'Admisiones' },
  { to: '/puertas-abiertas',  label: 'Puertas Abiertas' },
  { to: '/contacto',          label: 'Contacto' },
];

export function PublicLayout() {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
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
      <header className="bg-white border-b border-slate-100 sticky top-0 z-50 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center">
            <Logo variant="horizontal" size={36} theme="light" />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `text-sm font-medium transition-colors ${
                    isActive ? 'text-brand-600' : 'text-slate-600 hover:text-brand-600'
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
            className="md:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-50"
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile menu */}
        {open && (
          <div className="md:hidden bg-white border-t border-slate-100 px-4 pb-4 pt-2 space-y-1">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50'
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
      <main className="flex-1">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 text-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <div className="mb-3">
              <Logo variant="horizontal" size={34} theme="dark" />
            </div>
            <p className="text-xs leading-relaxed">
              Educación bilingüe de excelencia para el desarrollo integral de sus hijos.
              Tlalnepantla, Estado de México.
            </p>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-3">Navegación</h4>
            <ul className="space-y-2 text-xs">
              {NAV_LINKS.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="hover:text-white transition-colors">{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-3">Contacto</h4>
            <ul className="space-y-2 text-xs">
              <li><a href="tel:+525512345678" className="hover:text-white transition-colors">(55) 1234-5678</a></li>
              <li><a href="mailto:colegio@interlaken.edu.mx" className="hover:text-white transition-colors">colegio@interlaken.edu.mx</a></li>
              <li>Tlalnepantla de Baz, Estado de México</li>
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
        <div className="border-t border-slate-800 py-4 text-center text-xs">
          © {new Date().getFullYear()} Colegio Interlaken · Todos los derechos reservados
        </div>
      </footer>
    </div>
  );
}
