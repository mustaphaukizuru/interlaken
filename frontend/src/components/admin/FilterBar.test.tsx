import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { FilterBar } from './FilterBar';

function Probe() {
  const { search } = useLocation();
  return <output data-testid="url">{search}</output>;
}

const mount = (route: string, onClearExtra = vi.fn()) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <FilterBar
        search={{ placeholder: 'Buscar pagos' }}
        tabs={{ paramKey: 'estado', options: [{ value: 'success', label: 'Completado' }], label: 'Filtrar por estado' }}
        selects={[{ key: 'pasarela', label: 'Pasarela', options: [{ value: 'banorte', label: 'Banorte' }] }]}
        dateRange={{ idPrefix: 'pagos' }}
        extraChips={[{ key: 'alumno', label: 'Alumno: 12', onClear: onClearExtra }]}
      />
      <Probe />
    </MemoryRouter>,
  );

describe('FilterBar', () => {
  it('derives active-filter chips from the URL with human labels', () => {
    mount('/x?q=ana&estado=success&pasarela=banorte&desde=2026-09-01&hasta=2026-09-24');
    expect(screen.getByRole('button', { name: 'Quitar filtro: Búsqueda: “ana”' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quitar filtro: Estado: Completado' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quitar filtro: Pasarela: Banorte' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quitar filtro: Fechas: 2026-09-01 a 2026-09-24' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quitar filtro: Alumno: 12' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Pasarela' })).toHaveValue('banorte');
    expect(screen.getByRole('tab', { name: 'Completado' })).toHaveAttribute('aria-selected', 'true');
  });

  it('a chip clears its own param; "Limpiar todo" clears every known param and the extra chips', async () => {
    const onClearExtra = vi.fn();
    mount('/x?q=ana&estado=success&pasarela=banorte&desde=2026-09-01&page=2', onClearExtra);
    await userEvent.click(screen.getByRole('button', { name: 'Quitar filtro: Pasarela: Banorte' }));
    await waitFor(() => expect(screen.getByTestId('url')).not.toHaveTextContent('pasarela='));
    expect(screen.getByTestId('url')).toHaveTextContent('q=ana');

    await userEvent.click(screen.getByRole('button', { name: 'Limpiar todo' }));
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent(''));
    expect(onClearExtra).toHaveBeenCalled();
    // The search box follows the URL (no stale text left behind).
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Buscar pagos' })).toHaveValue(''));
  });

  it('selects write their param and reset the page', async () => {
    mount('/x?page=3');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Pasarela' }), 'banorte');
    expect(screen.getByTestId('url')).toHaveTextContent('?pasarela=banorte');
  });
});
