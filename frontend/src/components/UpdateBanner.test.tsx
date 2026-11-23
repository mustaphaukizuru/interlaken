import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { UpdateBanner } from './UpdateBanner';
import { freshPageLoad } from '@/lib/appUpdate';

describe('UpdateBanner', () => {
  it('offers «Actualizar» and never reloads by itself', () => {
    const onReload = vi.fn();
    render(<UpdateBanner onReload={onReload} />);
    expect(screen.getByRole('status')).toHaveTextContent('Hay una versión nueva.');
    expect(onReload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('«Más tarde» hides it', () => {
    render(<UpdateBanner onReload={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Más tarde' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('waits while the person is typing in a field', () => {
    render(<><input aria-label="Nombre" /><UpdateBanner onReload={vi.fn()} /></>);
    act(() => screen.getByLabelText('Nombre').focus());
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('freshPageLoad', () => {
  it('reloads at once only in the first seconds and when nobody is typing', () => {
    expect(freshPageLoad(2000)).toBe(true);
    expect(freshPageLoad(20000)).toBe(false);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(freshPageLoad(2000)).toBe(false);
    input.remove();
  });
});
