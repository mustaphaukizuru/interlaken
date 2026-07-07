import { Outlet } from 'react-router-dom';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import Sidebar from './Sidebar';

interface Props {
  role: 'parent' | 'student' | 'admin';
}

export function PortalLayout({ role }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F5F4FA' }}>
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar role={role} />
      </div>

      {/* Mobile slide-over */}
      {open && (
        <div className="lg:hidden" style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex' }}>
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(8,5,22,0.55)', backdropFilter: 'blur(2px)' }} onClick={() => setOpen(false)} />
          <div style={{ position: 'relative', zIndex: 10 }}>
            <button onClick={() => setOpen(false)} style={{ position: 'absolute', top: 18, right: -46, width: 38, height: 38, borderRadius: 10, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <X size={18} />
            </button>
            <Sidebar role={role} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      {/* Main */}
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Mobile hamburger */}
        <button
          onClick={() => setOpen(true)}
          className="lg:hidden"
          style={{ position: 'fixed', top: 12, left: 12, zIndex: 50, width: 42, height: 42, borderRadius: 11, background: '#080516', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 8px 20px -6px rgba(64,26,142,0.6)' }}
        >
          <Menu size={20} />
        </button>
        <div style={{ flex: 1, padding: '24px clamp(16px, 4vw, 32px)' }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default PortalLayout;
