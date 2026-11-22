import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AreaDeniedState } from './AreaDeniedState';

const cashier = { role: 'staff' as const, staff_areas: ['cafeteria'] };

function renderAt(path: string, user = cashier) {
  return render(<MemoryRouter><AreaDeniedState user={user} path={path} /></MemoryRouter>);
}

describe('AreaDeniedState', () => {
  it('names the area the section needs and links to the account’s first section', () => {
    renderAt('/admin/alumnos/12');
    expect(screen.getByRole('alert')).toHaveTextContent('Requiere el área «Alumnos y familias».');
    expect(screen.getByRole('link', { name: 'Ir a mi consola' })).toHaveAttribute('href', '/admin/cafeteria');
  });

  it('says when a section is for administrators only', () => {
    renderAt('/admin/usuarios');
    expect(screen.getByRole('alert')).toHaveTextContent('Esta sección es solo para administradores.');
  });
});
