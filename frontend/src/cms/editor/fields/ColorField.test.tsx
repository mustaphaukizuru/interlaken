import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { COLOR_OPTIONS } from '../../runtime';
import { ColorField, contrastOnWhite, SWATCH_GROUPS } from './ColorField';

describe('ColorField', () => {
  it('swatches use the theme tokens of index.css and cover every colour option', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf-8');
    for (const s of SWATCH_GROUPS.flatMap((g) => g.items)) {
      const name = s.value.slice(4, -1);
      const m = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
      expect(m?.[1].toLowerCase(), name).toBe(s.hex);
    }
    const values = new Set(SWATCH_GROUPS.flatMap((g) => g.items.map((s) => s.value)));
    expect(COLOR_OPTIONS.filter((o) => !values.has(o.value))).toEqual([]);
    expect(SWATCH_GROUPS[0].items.map((s) => s.label)).toEqual(['Verde', 'Verde claro', 'Coral']);
  });

  it('picks a swatch as a radio and moves with the arrows', async () => {
    const onChange = vi.fn();
    render(<ColorField id="c" label="Color" value="var(--green)" onChange={onChange} />);
    expect(screen.getByRole('radiogroup', { name: /Color/ })).toBeInTheDocument();
    const green = screen.getByRole('radio', { name: 'Verde' });
    expect(green).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: 'Coral' }));
    expect(onChange).toHaveBeenLastCalledWith('var(--coral)');
    fireEvent.keyDown(green, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('var(--green-mid)');
  });

  it('warns when a custom colour is hard to see on white', async () => {
    const onChange = vi.fn();
    render(<ColorField id="c" label="Color" value="#ffff99" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'Personalizado' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/se distingue poco sobre fondo blanco/)).toBeInTheDocument();
    const hex = screen.getByLabelText('O escriba el código');
    await userEvent.clear(hex);
    await userEvent.type(hex, '#1f3a8a');
    expect(onChange).toHaveBeenLastCalledWith('#1f3a8a');
    expect(contrastOnWhite('#1f3a8a')!).toBeGreaterThan(4.5);
    expect(contrastOnWhite('#ffffff')).toBeCloseTo(1);
  });
});
