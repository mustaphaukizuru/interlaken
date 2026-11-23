import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BackToTop } from './BackToTop';

describe('BackToTop', () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });

  it('stays hidden near the top and appears after a screen and a half', () => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    render(<BackToTop />);
    const btn = document.querySelector('[data-back-to-top]') as HTMLButtonElement;
    expect(btn).toHaveAttribute('aria-label', 'Volver arriba');
    expect(btn).toHaveAttribute('aria-hidden', 'true');
    expect(btn).toHaveAttribute('tabindex', '-1');
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 1500 });
    act(() => { document.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(150); });
    expect(btn).not.toHaveAttribute('aria-hidden');
    expect(btn).toHaveAttribute('tabindex', '0');
    expect(btn).toHaveAccessibleName('Volver arriba');
  });

  it('scrolls to the top smoothly and hands the focus to the page title', () => {
    const scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    render(<><main id="contenido"><h1>Costos</h1></main><BackToTop /></>);
    fireEvent.click(document.querySelector('[data-back-to-top]') as HTMLButtonElement);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Costos' }));
  });
});
