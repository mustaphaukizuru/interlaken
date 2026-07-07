import { Outlet, Link, NavLink, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import {
  LayoutDashboard, Coffee, CreditCard, Users, ClipboardList,
  LogOut, Menu, X, Bell, User,
} from 'lucide-react';

interface Props {
  role: 'parent' | 'student' | 'admin';
}

const NAV_BY_ROLE = {
  parent: [
    { to: '/portal',           label: 'Inicio',     icon: LayoutDashboard, end: true },
    { to: '/portal/cafeteria', label: 'Cafetería',  icon: Coffee },
    { to: '/portal/pagos',     label: 'Pagos',      icon: CreditCard },
  ],
  student: [
    { to: '/alumno',           label: 'Inicio',     icon: LayoutDashboard, end: true },
    { to: '/alumno/cafeteria', label: 'Cafetería',  icon: Coffee },
  ],
  admin: [
    { to: '/admin',               label: 'Dashboard',   icon: LayoutDashboard, end: true },
    { to: '/admin/admisiones',    label: 'Admisiones',  icon: ClipboardList },
    { to: '/admin/cafeteria',     label: 'Cafetería',   icon: Coffee },
    { to: '/admin/alumnos',       label: 'Alumnos',     icon: Users },
  ],
};

export function PortalLayout({ role }: Props) {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navLinks = NAV_BY_ROLE[role];

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const Sidebar = ({ mobile = false }) => (
    <div className={`flex flex-col h-full ${mobile ? 'w-64 bg-white' : ''}`}>
      {/* Logo */}
      <div className="px-5 py-5 border-b border-slate-100">
        <Link to="/" className="flex items-center gap-2.5 font-bold text-brand-700">
          <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center text-white text-xs font-bold">CI</div>
          <span className="text-sm">Colegio Interlaken</span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navLinks.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`
            }
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* User */}
      <div className="px-3 py-4 border-t border-slate-100">
        <div className="flex items-center gap-3 px-3 py-2 mb-1">
          <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-semibold text-sm flex-shrink-0 overflow-hidden">
            {user?.avatar ? (
              <img src={user.avatar} alt={user.full_name} className="w-full h-full object-cover" />
            ) : (
              (user?.first_name?.[0] ?? <User className="w-4 h-4" />)
            )}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-900 truncate">{user?.full_name}</p>
            <p className="text-xs text-slate-500 truncate">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 px-3 py-2 rounded-xl text-sm text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Cerrar sesión
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-56 bg-white border-r border-slate-100 flex-shrink-0">
        <Sidebar />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/30" onClick={() => setSidebarOpen(false)} />
          <div className="relative z-10 flex flex-col w-64 bg-white shadow-xl">
            <div className="flex items-center justify-end p-3 border-b border-slate-100">
              <button onClick={() => setSidebarOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-50">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <Sidebar mobile />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-slate-100 px-4 sm:px-6 h-14 flex items-center justify-between flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-50"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 ml-auto">
            <button className="relative p-2 rounded-lg text-slate-500 hover:bg-slate-50">
              <Bell className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Page */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
