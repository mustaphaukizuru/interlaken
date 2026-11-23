import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Users } from 'lucide-react';
import { StatCard } from './StatCard';

describe('StatCard', () => {
  it('is a real link (and lifts on hover) only when it leads somewhere', () => {
    render(<MemoryRouter><StatCard to="/admin/alumnos" title="Alumnos activos" value={12} icon={Users} color="purple" /></MemoryRouter>);
    const link = screen.getByRole('link', { name: /Alumnos activos/ });
    expect(link).toHaveAttribute('href', '/admin/alumnos');
    expect(link).toHaveClass('hover-lift');
  });

  it('without a target it is a plain figure: no link, no hover lift', () => {
    const { container } = render(<StatCard title="Saldo" value="$1,200.00" icon={Users} color="green" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.querySelector('.hover-lift')).toBeNull();
  });
});
