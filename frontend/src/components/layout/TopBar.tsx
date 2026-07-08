import { Bell, Search, Menu } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useMobileNav } from './PortalLayout';

export default function TopBar({ title, subtitle }: { title: string; subtitle?: string }) {
  const { user } = useAuthStore();
  const { open, toggle } = useMobileNav();
  const initials = `${user?.first_name?.[0] ?? ''}${user?.last_name?.[0] ?? ''}`.toUpperCase() || '?';
  return (
    <>
      {/* 3px accent bar */}
      <div className="h-[3px] flex-shrink-0" style={{ background: 'var(--grad-bar)' }} />
      <header className="sticky top-[3px] z-20 flex items-center gap-3 border-b border-[#ECEAF3] bg-cream/[0.92] px-4 py-3.5 backdrop-blur-[14px] sm:gap-4 sm:px-6 lg:px-8">
        {/* Mobile hamburger */}
        <button
          type="button"
          onClick={toggle}
          aria-label="Abrir menú"
          aria-expanded={open}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[11px] bg-dark text-white shadow-[0_8px_20px_-6px_rgba(64,26,142,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink/60 lg:hidden"
        >
          <Menu size={20} />
        </button>

        <div className="min-w-0 flex-1">
          <h1 className="font-head text-lg font-extrabold leading-tight tracking-[-0.4px] text-ink sm:text-[21px]">{title}</h1>
          {subtitle && <p className="mt-0.5 truncate text-[13px] text-muted">{subtitle}</p>}
        </div>

        {/* Search */}
        <div className="hidden w-[200px] items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-[9px] shadow-card md:flex">
          <Search size={15} className="text-subtle" />
          <input placeholder="Buscar..." aria-label="Buscar" className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-ink outline-none" />
        </div>

        {/* Bell */}
        <button aria-label="Notificaciones" className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[11px] border border-line bg-white shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink/60">
          <Bell size={19} className="text-muted" />
          <span className="absolute right-2.5 top-2.5 h-[7px] w-[7px] rounded-full border-2 border-white bg-pink" />
        </button>

        {/* Avatar */}
        <div className="flex flex-shrink-0 items-center gap-2.5 rounded-[14px] border border-line bg-white py-1.5 pl-3.5 pr-3 shadow-card">
          <div className="hidden text-right leading-tight sm:block">
            <div className="text-[13px] font-semibold text-ink">{user?.first_name} {user?.last_name}</div>
            <div className="text-[11px] capitalize text-subtle">{user?.role}</div>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-gradient-to-br from-pink to-purple font-head text-[13px] font-bold text-white">
            {initials}
          </div>
        </div>
      </header>
    </>
  );
}
