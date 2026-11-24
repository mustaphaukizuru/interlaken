import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QuickActions } from './QuickActions';

describe('QuickActions (header «Nuevo»)', () => {
  it('names each entry for what it does, in plain Spanish (QA 2026-11-24)', async () => {
    render(<MemoryRouter><QuickActions /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));
    // It opens the cafetería list: the adjustment is made on the person.
    expect(screen.getByRole('menuitem', { name: 'Ajustar saldo (elegir alumno)' })).toHaveAttribute('href', '/admin/cafeteria');
    expect(screen.queryByRole('menuitem', { name: /Recarga manual/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Emergencia (a todos)' })).toHaveAttribute('href', '/admin/comunicados?emergencia=1');
    expect(screen.queryByText(/broadcast/i)).toBeNull();
  });
});
