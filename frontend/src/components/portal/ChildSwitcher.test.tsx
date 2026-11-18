import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChildSwitcher, CHIP_LIMIT, type SwitcherChild } from './ChildSwitcher';
import { useSelectedChildStore } from '@/store/selectedChildStore';

const family: SwitcherChild[] = [
  { id: 1, name: 'Emilia Torres', grade: '1° Primaria', group: 'A' },
  { id: 2, name: 'Joaquín Torres', grade: '4° Primaria', group: 'B' },
];

// An admin in the family portal sees the whole school.
const school: SwitcherChild[] = Array.from({ length: 40 }, (_, i) => ({
  id: 100 + i,
  name: ['Sofía Ruiz', 'Mateo Lara', 'Regina Peña', 'Diego Vega'][i % 4] + ` ${i}`,
  grade: ['1° Preescolar', '3° Primaria', '2° Secundaria'][i % 3],
  group: i % 2 ? 'B' : 'A',
}));

const stored = () => useSelectedChildStore.getState().childId;

beforeEach(() => {
  act(() => useSelectedChildStore.setState({ childId: null }));
});

describe('ChildSwitcher · a family', () => {
  it('keeps the chip row for a few children and selects one', async () => {
    render(<ChildSwitcher students={family} />);
    const group = screen.getByRole('group', { name: 'Seleccionar alumno' });
    expect(within(group).getAllByRole('button')).toHaveLength(2);
    expect(stored()).toBe(1); // defaults to the first child
    await userEvent.click(screen.getByRole('button', { name: /Joaquín Torres/ }));
    expect(stored()).toBe(2);
    expect(screen.getByRole('button', { name: /Joaquín Torres/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it(`still uses chips at exactly ${CHIP_LIMIT} children`, () => {
    render(<ChildSwitcher students={school.slice(0, CHIP_LIMIT)} />);
    expect(screen.getByRole('group', { name: 'Seleccionar alumno' })).toBeInTheDocument();
  });
});

describe('ChildSwitcher · the whole school (searchable)', () => {
  it('shows one button with the current alumno instead of a wall of chips', () => {
    act(() => useSelectedChildStore.setState({ childId: 105 }));
    render(<ChildSwitcher students={school} />);
    expect(screen.queryByRole('group', { name: 'Seleccionar alumno' })).toBeNull();
    const trigger = screen.getByRole('button', { name: /Alumno: Mateo Lara 5/ });
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger).toHaveTextContent('40 alumnos');
  });

  it('filters by name, grade or group (accents ignored) and picks with the keyboard', async () => {
    const user = userEvent.setup();
    render(<ChildSwitcher students={school} />);
    await user.click(screen.getByRole('button', { name: /Alumno:/ }));
    const box = screen.getByRole('combobox', { name: /Buscar alumno/ });
    expect(box).toHaveFocus();
    await user.type(box, 'sofia secundaria');
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.length).toBeGreaterThan(0);
    options.forEach((o) => {
      expect(o).toHaveTextContent(/Sofía Ruiz/);
      expect(o).toHaveTextContent(/2° Secundaria/);
    });
    await user.keyboard('{ArrowDown}');
    expect(box).toHaveAttribute('aria-activedescendant', options[1].id);
    await user.keyboard('{Enter}');
    expect(stored()).toBe(Number(school.find((c) => options[1].textContent?.startsWith(c.name))?.id));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('button', { name: /Alumno:/ })).toHaveFocus();
  });

  it('picks with the pointer and marks the current alumno as selected', async () => {
    const user = userEvent.setup();
    render(<ChildSwitcher students={school} />);
    await user.click(screen.getByRole('button', { name: /Alumno:/ }));
    await user.click(screen.getByRole('option', { name: /Diego Vega 3\b/ }));
    expect(stored()).toBe(103);
    await user.click(screen.getByRole('button', { name: /Alumno: Diego Vega 3/ }));
    expect(screen.getByRole('option', { name: /Diego Vega 3\b/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('says when nothing matches, and Escape closes without changing the choice', async () => {
    const user = userEvent.setup();
    act(() => useSelectedChildStore.setState({ childId: 101 }));
    render(<ChildSwitcher students={school} />);
    await user.click(screen.getByRole('button', { name: /Alumno:/ }));
    await user.type(screen.getByRole('combobox'), 'zzz');
    expect(screen.getByRole('status')).toHaveTextContent('Ningún alumno coincide con «zzz».');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(stored()).toBe(101);
  });

  it('offers «Todos los alumnos» when the page allows it', async () => {
    const user = userEvent.setup();
    act(() => useSelectedChildStore.setState({ childId: 104 }));
    render(<ChildSwitcher students={school} allowAll />);
    await user.click(screen.getByRole('button', { name: /Alumno:/ }));
    await user.click(screen.getByRole('option', { name: 'Todos los alumnos' }));
    expect(stored()).toBeNull();
  });

  it('shows the page-owned selection in controlled mode and writes picks to the store', async () => {
    const user = userEvent.setup();
    render(<ChildSwitcher students={school} selected={110} />);
    expect(screen.getByRole('button', { name: /Alumno: Regina Peña 10/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Alumno:/ }));
    await user.click(screen.getByRole('option', { name: /Mateo Lara 1\b/ }));
    expect(stored()).toBe(101);
  });
});
