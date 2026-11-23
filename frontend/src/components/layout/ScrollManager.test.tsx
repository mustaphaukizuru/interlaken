import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from 'react-router-dom';
import { decideScroll, ScrollManager } from './ScrollManager';

const loc = (pathname: string, hash = '', search = '') => ({ pathname, hash, search });

describe('decideScroll', () => {
  it('a new page starts at the top', () => {
    expect(decideScroll(loc('/'), loc('/costos'), 'PUSH', undefined)).toEqual({ kind: 'top' });
    expect(decideScroll(loc('/'), loc('/costos'), 'REPLACE', 500)).toEqual({ kind: 'top' });
  });
  it('Back and Forward return to where the page was left', () => {
    expect(decideScroll(loc('/costos'), loc('/'), 'POP', 1200)).toEqual({ kind: 'restore', y: 1200 });
    // Nothing remembered (e.g. a page opened in another tab): top.
    expect(decideScroll(loc('/costos'), loc('/'), 'POP', undefined)).toEqual({ kind: 'top' });
  });
  it('a section link lands on the section, smoothly only on the same page', () => {
    expect(decideScroll(loc('/'), loc('/admisiones', '#estimador'), 'PUSH', undefined)).toEqual({ kind: 'hash', hash: '#estimador', smooth: false });
    expect(decideScroll(loc('/admisiones'), loc('/admisiones', '#estimador'), 'PUSH', undefined)).toEqual({ kind: 'hash', hash: '#estimador', smooth: true });
  });
  it('a query change (table search, filters, page) keeps the position', () => {
    expect(decideScroll(loc('/admin/alumnos'), loc('/admin/alumnos', '', '?q=ana'), 'REPLACE', undefined)).toEqual({ kind: 'none' });
    expect(decideScroll(loc('/admin/alumnos'), loc('/admin/alumnos', '', '?page=2'), 'PUSH', undefined)).toEqual({ kind: 'none' });
  });
  it('first load: a reload restores, a shared section link jumps, otherwise nothing', () => {
    expect(decideScroll(null, loc('/'), 'POP', 300)).toEqual({ kind: 'restore', y: 300 });
    expect(decideScroll(null, loc('/admisiones', '#estimador'), 'POP', undefined)).toEqual({ kind: 'hash', hash: '#estimador', smooth: false });
    expect(decideScroll(null, loc('/'), 'POP', undefined)).toEqual({ kind: 'none' });
  });
});

let navigateTo: NavigateFunction | null = null;
const go = (to: string | number) => (typeof to === 'number' ? navigateTo?.(to) : navigateTo?.(to));
function Nav({ onReady }: { onReady: (n: NavigateFunction) => void }) {
  const navigate = useNavigate();
  useEffect(() => onReady(navigate), [navigate, onReady]);
  return null;
}
const keep = (n: NavigateFunction) => { navigateTo = n; };
function Page({ title, field = false }: { title: string; field?: boolean }) {
  return (
    <main id="contenido">
      <h1>{title}</h1>
      {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
      {field && <input aria-label="Buscar" autoFocus />}
      <section id="estimador">Estimador</section>
    </main>
  );
}
function app(initial = '/') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <ScrollManager />
      <Nav onReady={keep} />
      <Routes>
        <Route path="/" element={<Page title="Inicio" />} />
        <Route path="/costos" element={<Page title="Costos" />} />
        <Route path="/buscar" element={<Page title="Buscar" field />} />
        <Route path="/admisiones" element={<Page title="Admisiones" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ScrollManager', () => {
  const scrollTo = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    scrollTo.mockReset();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });
  afterEach(() => vi.useRealTimers());

  it('opens a new page at the top and focuses its title', () => {
    app('/');
    act(() => go('/costos'));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'auto' });
    act(() => { vi.advanceTimersByTime(60); });
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Costos' }));
    expect(screen.getByRole('heading', { name: 'Costos' })).toHaveAttribute('tabindex', '-1');
  });

  it('leaves the focus on a field the new page focused itself', () => {
    app('/');
    act(() => go('/buscar'));
    act(() => { vi.advanceTimersByTime(60); });
    expect(document.activeElement).toBe(screen.getByLabelText('Buscar'));
  });

  it('Back returns to the remembered position', () => {
    app('/');
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 900 });
    act(() => { document.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(200); });
    act(() => go('/costos'));
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    scrollTo.mockClear();
    act(() => go(-1));
    expect(scrollTo).toHaveBeenCalledWith({ top: 900, behavior: 'auto' });
  });

  it('a link to the page already open scrolls back to its top', () => {
    app('/');
    const a = document.createElement('a');
    a.href = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    document.body.appendChild(a);
    scrollTo.mockClear();
    act(() => { a.click(); vi.advanceTimersByTime(10); });
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    a.remove();
  });
});
