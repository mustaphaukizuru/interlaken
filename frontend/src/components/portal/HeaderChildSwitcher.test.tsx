import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({ portalApi: { getDashboard: vi.fn() } }));

import { HeaderChildSwitcher } from './HeaderChildSwitcher';
import { shortNames } from './familyChildren';
import { portalApi } from '@/services/api';
import { useAuthStore, type User } from '@/store/authStore';
import { useSelectedChildStore } from '@/store/selectedChildStore';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';

const getDashboard = vi.mocked(portalApi.getDashboard);
const user = (role: User['role']) => ({ id: 1, email: 'x@example.com', first_name: 'Ana', last_name: 'López', full_name: 'Ana López', role, avatar: '', whatsapp: '' }) as User;
const FAMILY = {
  children: [
    { id: 11, name: 'Luis López', grade: '3°', group: 'A', student_id: 'A-11' },
    { id: 12, name: 'Sofía López', grade: '1°', group: 'B', student_id: 'A-12' },
  ],
  cafeteria_balances: [
    { student: 11, student_name: 'Luis López', balance: '20.00', low: true, last_synced: '' },
    { student: 12, student_name: 'Sofía López', balance: '180.00', low: false, last_synced: '' },
  ],
};

describe('HeaderChildSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => useSelectedChildStore.setState({ childId: null }));
    useAuthStore.setState({ user: user('parent'), accessToken: 't', isAuthenticated: true });
  });

  it('shows the active child’s first name and writes the shared store (desktop popover)', async () => {
    stubViewport(1280);
    getDashboard.mockResolvedValue({ data: FAMILY } as never);
    renderWithProviders(<HeaderChildSwitcher />);
    const trigger = await screen.findByRole('button', { name: 'Alumno: Luis López. Cambiar de alumno' });
    expect(trigger).toHaveTextContent('Luis');
    await userEvent.click(trigger);
    const group = screen.getByRole('group', { name: 'Seleccionar alumno' });
    // Each row: name, grade and group, and the balance already loaded.
    expect(within(group).getByRole('button', { name: /Luis López/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByText('$180.00')).toBeInTheDocument();
    expect(within(group).getByText(/saldo bajo/)).toBeInTheDocument();
    await userEvent.click(within(group).getByRole('button', { name: /Sofía López/ }));
    expect(useSelectedChildStore.getState().childId).toBe(12);
    expect(await screen.findByRole('button', { name: /Alumno: Sofía López/ })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Seleccionar alumno' })).toBeNull();
  });

  it('opens as a sheet on phones, portalled to <body>', async () => {
    stubViewport(390);
    getDashboard.mockResolvedValue({ data: FAMILY } as never);
    const { container } = renderWithProviders(<HeaderChildSwitcher />);
    await userEvent.click(await screen.findByRole('button', { name: /Cambiar de alumno/ }));
    const sheet = screen.getByRole('dialog', { name: 'Elegir alumno' });
    expect(container.contains(sheet)).toBe(false);
    await userEvent.click(within(sheet).getByRole('button', { name: /Sofía López/ }));
    expect(useSelectedChildStore.getState().childId).toBe(12);
    expect(screen.queryByRole('dialog', { name: 'Elegir alumno' })).toBeNull();
  });

  it('follows a pick made elsewhere', async () => {
    stubViewport(1280);
    act(() => useSelectedChildStore.setState({ childId: 12 }));
    getDashboard.mockResolvedValue({ data: FAMILY } as never);
    renderWithProviders(<HeaderChildSwitcher />);
    expect(await screen.findByRole('button', { name: /Alumno: Sofía López/ })).toBeInTheDocument();
  });

  it('renders nothing for one child', async () => {
    getDashboard.mockResolvedValue({ data: { ...FAMILY, children: FAMILY.children.slice(0, 1) } } as never);
    const { container } = renderWithProviders(<HeaderChildSwitcher />);
    await vi.waitFor(() => expect(getDashboard).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('never asks for family data in the console', async () => {
    useAuthStore.setState({ user: user('admin'), accessToken: 't', isAuthenticated: true });
    const { container } = renderWithProviders(<HeaderChildSwitcher />);
    expect(container).toBeEmptyDOMElement();
    expect(getDashboard).not.toHaveBeenCalled();
  });
});

describe('shortNames', () => {
  it('uses the first name, two words when siblings share it', () => {
    const names = shortNames([
      { id: 1, name: 'María José Ruiz' },
      { id: 2, name: 'María Fernanda Ruiz' },
      { id: 3, name: 'Pablo Ruiz' },
    ]);
    expect([names.get(1), names.get(2), names.get(3)]).toEqual(['María José', 'María Fernanda', 'Pablo']);
  });
});
