import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input } from './Input';

describe('Input', () => {
  it('gives every field its own id, even with the same label (QA 2026-11-24: 15 inputs «texto»)', () => {
    render(<><Input label="Texto" defaultValue="Inicio" hint="Lo que se lee" /><Input label="Texto" defaultValue="Admisiones" error="Requerido." /></>);
    const [first, second] = screen.getAllByLabelText('Texto') as HTMLInputElement[];
    expect(first.value).toBe('Inicio');
    expect(second.value).toBe('Admisiones');
    expect(first.id).not.toBe(second.id);
    expect(document.querySelectorAll(`[id="${first.id}"]`)).toHaveLength(1);
    // Hint and error stay tied to their own field.
    expect(first).toHaveAccessibleDescription('Lo que se lee');
    expect(second).toHaveAccessibleDescription('Requerido.');
  });

  it('keeps an id it is given', () => {
    render(<Input id="sf-email" label="Correo" />);
    expect(screen.getByLabelText('Correo')).toHaveAttribute('id', 'sf-email');
  });
});
