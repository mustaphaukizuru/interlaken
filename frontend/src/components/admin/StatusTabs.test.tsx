import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { StatusTabs } from './StatusTabs';

function Probe() {
  const { search } = useLocation();
  return <output data-testid="url">{search}</output>;
}

const OPTIONS = [
  { value: 'pending', label: 'Pendientes', count: 3 },
  { value: 'confirmed', label: 'Confirmadas', count: 12 },
];

const mount = (route: string) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <StatusTabs options={OPTIONS} allCount={15} label="Filtrar por estado" />
      <Probe />
    </MemoryRouter>,
  );

describe('StatusTabs', () => {
  it('renders a tablist with counts and marks the URL value as selected', () => {
    mount('/x?estado=confirmed');
    expect(screen.getByRole('tablist', { name: 'Filtrar por estado' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Confirmadas 12/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Todos 15/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('writes the param on click, resets the page, and clears it on "Todos"', async () => {
    mount('/x?page=4');
    await userEvent.click(screen.getByRole('tab', { name: /Pendientes/ }));
    expect(screen.getByTestId('url')).toHaveTextContent('?estado=pending');
    await userEvent.click(screen.getByRole('tab', { name: /Todos/ }));
    expect(screen.getByTestId('url')).toHaveTextContent('');
  });

  it('moves focus with the arrow keys (roving tabindex)', async () => {
    mount('/x');
    const all = screen.getByRole('tab', { name: /Todos/ });
    expect(all).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: /Pendientes/ })).toHaveAttribute('tabindex', '-1');
    all.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Pendientes/ })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: /Confirmadas/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(all).toHaveFocus();
  });
});
