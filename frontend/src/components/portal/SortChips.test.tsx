import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SortChips } from './SortChips';
import type { SortState } from '@/components/ui/SortableTh';

const OPTIONS = [
  { key: 'date', label: 'Fecha' },
  { key: 'amount', label: 'Monto' },
];

function Harness({ initial = { key: '', dir: 'desc' } as SortState }) {
  const [sort, setSort] = useState<SortState>(initial);
  return (
    <>
      <SortChips options={OPTIONS} sort={sort} onSort={setSort} />
      <output data-testid="sort">{sort.key ? `${sort.dir === 'desc' ? '-' : ''}${sort.key}` : 'default'}</output>
    </>
  );
}

describe('SortChips', () => {
  it('is a labelled group of toggle buttons, none pressed by default', () => {
    render(<Harness />);
    expect(screen.getByRole('group', { name: 'Ordenar por' })).toBeInTheDocument();
    for (const name of ['Ordenar por Fecha', 'Ordenar por Monto']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('cycles desc → asc → server default, announcing the direction', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Ordenar por Monto' }));
    expect(screen.getByTestId('sort')).toHaveTextContent(/^-amount$/);
    const active = screen.getByRole('button', { name: 'Ordenar por Monto, descendente' });
    expect(active).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(active);
    expect(screen.getByTestId('sort')).toHaveTextContent(/^amount$/);
    await userEvent.click(screen.getByRole('button', { name: 'Ordenar por Monto, ascendente' }));
    expect(screen.getByTestId('sort')).toHaveTextContent(/^default$/);
  });

  it('switching key starts the new key descending', async () => {
    render(<Harness initial={{ key: 'amount', dir: 'asc' }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ordenar por Fecha' }));
    expect(screen.getByTestId('sort')).toHaveTextContent(/^-date$/);
    expect(screen.getByRole('button', { name: 'Ordenar por Monto' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('is keyboard operable', async () => {
    render(<Harness />);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Ordenar por Fecha' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('sort')).toHaveTextContent(/^-date$/);
  });
});
