import { Bell, Search } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

export default function TopBar({ title, subtitle }: { title: string; subtitle?: string }) {
  const { user } = useAuthStore();
  const initials = `${user?.first_name?.[0] ?? ''}${user?.last_name?.[0] ?? ''}`.toUpperCase() || '?';
  return (
    <>
      {/* 3px accent bar */}
      <div style={{ height: 3, background: 'linear-gradient(90deg, #401a8e 0%, #5e3aad 28%, #ef2558 60%, #1da2ab 100%)', flexShrink: 0 }} />
      <header style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '14px 32px',
        position: 'sticky', top: 3, zIndex: 20, borderBottom: '1px solid #ECEAF3',
        background: 'rgba(245,244,250,0.92)', backdropFilter: 'blur(14px)',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 21, color: '#1A1130', letterSpacing: -0.4, lineHeight: 1.2 }}>{title}</h1>
          {subtitle && <p style={{ fontSize: 13, color: '#6E6885', marginTop: 2 }}>{subtitle}</p>}
        </div>
        {/* Search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', background: '#fff', border: '1px solid #ECEAF3', borderRadius: 12, width: 200, boxShadow: 'var(--shadow-card)' }} className="hidden md:flex">
          <Search size={15} color="#9A93AE" />
          <input placeholder="Buscar..." style={{ border: 'none', outline: 'none', fontSize: 13, background: 'transparent', flex: 1, color: '#1A1130' }} />
        </div>
        {/* Bell */}
        <button style={{ width: 42, height: 42, borderRadius: 11, background: '#fff', border: '1px solid #ECEAF3', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: 'var(--shadow-card)', position: 'relative' }}>
          <Bell size={19} color="#6E6885" />
          <span style={{ position: 'absolute', top: 10, right: 10, width: 7, height: 7, borderRadius: '50%', background: '#ef2558', border: '2px solid #fff' }} />
        </button>
        {/* Avatar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px 6px 14px', background: '#fff', border: '1px solid #ECEAF3', borderRadius: 14, boxShadow: 'var(--shadow-card)' }}>
          <div style={{ textAlign: 'right', lineHeight: 1.2 }} className="hidden sm:block">
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1130' }}>{user?.first_name} {user?.last_name}</div>
            <div style={{ fontSize: 11, color: '#9A93AE', textTransform: 'capitalize' }}>{user?.role}</div>
          </div>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #ef2558, #401a8e)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 13, color: '#fff' }}>
            {initials}
          </div>
        </div>
      </header>
    </>
  );
}
