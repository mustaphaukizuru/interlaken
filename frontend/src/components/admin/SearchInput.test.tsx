import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SearchInput } from './SearchInput';

function Probe() {
  const { search } = useLocation();
  return <output data-testid="url">{search}</output>;
}

const mount = (route: string, paramKey?: string) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <SearchInput paramKey={paramKey} placeholder="Buscar alumno…" />
      <Probe />
    </MemoryRouter>,
  );

describe('SearchInput', () => {
  it('reads the URL param, writes it back debounced and resets the page', async () => {
    mount('/x?q=ana&page=3');
    const input = screen.getByRole('textbox', { name: 'Buscar alumno…' });
    expect(input).toHaveValue('ana');
    expect(input).toHaveAttribute('inputmode', 'search');
    await userEvent.clear(input);
    await userEvent.type(input, 'beto');
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('?q=beto'));
    expect(screen.getByTestId('url')).not.toHaveTextContent('page=');
  });

  it('clears with the button and with Escape', async () => {
    mount('/x?actor=ana', 'actor');
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent(''));
    expect(screen.queryByRole('button', { name: 'Limpiar búsqueda' })).not.toBeInTheDocument();
    const input = screen.getByRole('textbox');
    await userEvent.type(input, 'zoe');
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('?actor=zoe'));
    await userEvent.type(input, '{Escape}');
    expect(input).toHaveValue('');
    await waitFor(() => expect(screen.getByTestId('url')).not.toHaveTextContent('actor='));
  });
});
