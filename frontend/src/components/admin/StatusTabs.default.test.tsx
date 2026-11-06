import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { StatusTabs } from './StatusTabs';
import { renderWithProviders } from '@/test/renderWithProviders';

function Where() {
  const { search } = useLocation();
  return <output>{search || 'sin filtro'}</output>;
}

const OPTIONS = [{ value: 'active', label: 'Activo' }, { value: 'todos', label: 'Todos' }];

describe('StatusTabs with a default tab', () => {
  it('is on while the URL says nothing, and picking it clears the URL', async () => {
    renderWithProviders(<><StatusTabs options={OPTIONS} allLabel={null} defaultValue="active" /><Where /></>);
    expect(screen.getByRole('tab', { name: 'Activo' })).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('tab', { name: 'Todos' }));
    expect(screen.getByRole('status')).toHaveTextContent('?estado=todos');
    expect(screen.getByRole('tab', { name: 'Activo' })).toHaveAttribute('aria-selected', 'false');

    await userEvent.click(screen.getByRole('tab', { name: 'Activo' }));
    expect(screen.getByRole('status')).toHaveTextContent('sin filtro');
  });
});
