/**
 * /pagos, header version 3 (2026-11-23): the cafetería card has the header's
 * name, «Portal Cafetería», and a signed-in family goes straight to its
 * cafetería instead of /login.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { useAuthStore, type User } from '@/store/authStore';
import { sections } from './pagos';

const platforms = () => sections.find((s) => s.type === 'pagos.platforms')!;
const parent: User = { id: 2, email: 'familia@test.mx', first_name: 'Ana', last_name: 'López', full_name: 'Ana López', role: 'parent', avatar: '', whatsapp: '' };

describe('/pagos cards', () => {
  afterEach(() => useAuthStore.setState({ user: null, accessToken: null, isAuthenticated: false }));

  it('names the cafetería card «Portal Cafetería», as the header does', () => {
    const items = (platforms().defaults as { items: { name: string; href: string; cta: string }[] }).items;
    expect(items.find((i) => i.href === '/login')).toMatchObject({ name: 'Portal Cafetería', cta: 'Entrar al Portal Cafetería' });
  });

  it('signed out: the card opens /login; signed in: the family\'s cafetería', () => {
    const View = platforms().component;
    const { unmount } = renderWithProviders(<View {...(platforms().defaults as object)} />);
    expect(screen.getByRole('link', { name: /Entrar al Portal Cafetería/ })).toHaveAttribute('href', '/login');
    unmount();
    useAuthStore.setState({ user: parent, accessToken: 't', isAuthenticated: true });
    renderWithProviders(<View {...(platforms().defaults as object)} />);
    expect(screen.getByRole('link', { name: /Entrar al Portal Cafetería/ })).toHaveAttribute('href', '/portal/cafeteria');
  });
});
