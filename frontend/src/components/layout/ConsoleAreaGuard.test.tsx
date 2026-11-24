import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AdminOnlyPage } from './ConsoleAreaGuard';
import { useAuthStore, type User } from '@/store/authStore';

const base: User = {
  id: 5, email: 'caja@test.mx', first_name: 'Caja', last_name: 'Demo', full_name: 'Caja Demo',
  role: 'staff', avatar: '', whatsapp: '',
};

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/staff" element={<AdminOnlyPage><h1>Panel de Dirección</h1></AdminOnlyPage>} />
        <Route path="/staff/contenido" element={<AdminOnlyPage><h1>Páginas del sitio</h1></AdminOnlyPage>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminOnlyPage: /staff is for administrators (QA 2026-11-24)', () => {
  beforeEach(() => useAuthStore.setState({ user: null, accessToken: null, isAuthenticated: false }));

  it('an administrator opens the panel and the content pages', () => {
    useAuthStore.setState({ user: { ...base, role: 'admin' }, accessToken: 't', isAuthenticated: true });
    renderAt('/staff');
    expect(screen.getByRole('heading', { name: 'Panel de Dirección' })).toBeInTheDocument();
  });

  it('a cafetería cashier opening /staff lands on her own area', () => {
    useAuthStore.setState({ user: { ...base, staff_areas: ['cafeteria'] }, accessToken: 't', isAuthenticated: true });
    renderAt('/staff');
    expect(screen.queryByRole('heading', { name: 'Panel de Dirección' })).toBeNull();
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/cafeteria');
  });

  it('a deep link to the site content says it is for administrators, with the way back', () => {
    useAuthStore.setState({ user: { ...base, staff_areas: ['cafeteria'] }, accessToken: 't', isAuthenticated: true });
    renderAt('/staff/contenido');
    expect(screen.queryByRole('heading', { name: 'Páginas del sitio' })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Esta sección es solo para administradores.');
    expect(screen.getByRole('link', { name: 'Ir a mi consola' })).toHaveAttribute('href', '/admin/cafeteria');
  });

  it('an account without console areas is told so and sent to its own cafetería', () => {
    useAuthStore.setState({
      user: { ...base, staff_areas: [], cafeteria_account: { id: 3, tipo: 'personal' } as never },
      accessToken: 't', isAuthenticated: true,
    });
    renderAt('/staff');
    expect(screen.getByRole('heading', { name: 'Sin acceso a la consola' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a Mi cafetería' })).toHaveAttribute('href', '/portal/mi-cafeteria');
    expect(screen.queryByRole('heading', { name: 'Panel de Dirección' })).toBeNull();
  });
});
