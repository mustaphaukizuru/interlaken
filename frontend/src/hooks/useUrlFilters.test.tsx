import { describe, it, expect } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useActiveFilters, useUrlFilters, useUrlPage, useUrlSyncedSearch } from './useUrlFilters';

const wrapper = (route: string) => ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
);

describe('useUrlFilters', () => {
  it('reads params with a fallback and writes several at once, dropping empty values', () => {
    const { result } = renderHook(() => useUrlFilters(), { wrapper: wrapper('/x?estado=pending&page=2') });
    expect(result.current.get('estado')).toBe('pending');
    expect(result.current.get('nada', 'def')).toBe('def');
    act(() => result.current.set({ estado: null, tipo: 'open', page: '' }));
    expect(result.current.params.toString()).toBe('tipo=open');
  });

  it('useUrlPage parses ?page= (1 when absent or invalid) and omits page 1 when writing', () => {
    const { result } = renderHook(() => useUrlPage(), { wrapper: wrapper('/x?page=abc') });
    expect(result.current[0]).toBe(1);
    act(() => result.current[1](3));
    expect(result.current[0]).toBe(3);
    act(() => result.current[1](1));
    expect(result.current[0]).toBe(1);
  });

  it('useUrlPage takes a key so two paged lists on one screen keep their own place', () => {
    const { result } = renderHook(() => ({ a: useUrlPage('apage'), v: useUrlPage('vpage'), f: useUrlFilters() }), { wrapper: wrapper('/x?apage=2') });
    expect(result.current.a[0]).toBe(2);
    expect(result.current.v[0]).toBe(1);
    act(() => result.current.v[1](3));
    expect(result.current.f.params.toString()).toBe('apage=2&vpage=3');
  });

  it('useActiveFilters says whether any filter is set and clears them with the page', () => {
    const { result } = renderHook(() => ({ af: useActiveFilters(['q', 'estado']), f: useUrlFilters() }), { wrapper: wrapper('/x?estado=failed&page=2&tab=pos') });
    expect(result.current.af.active).toBe(true);
    act(() => result.current.af.clear());
    expect(result.current.af.active).toBe(false);
    expect(result.current.f.params.toString()).toBe('tab=pos');
  });

  it('useUrlSyncedSearch debounces input → URL, resets the page, and follows external URL changes', async () => {
    function Probe() {
      const { input, setInput, search } = useUrlSyncedSearch('q');
      const { set } = useUrlFilters();
      const { search: url } = useLocation();
      return (
        <>
          <input aria-label="q" value={input} onChange={(e) => setInput(e.target.value)} />
          <output data-testid="search">{search}</output>
          <output data-testid="url">{url}</output>
          <button type="button" onClick={() => set({ q: 'externo' })}>ext</button>
        </>
      );
    }
    render(<MemoryRouter initialEntries={['/x?page=4']}><Probe /></MemoryRouter>);
    const input = screen.getByRole('textbox', { name: 'q' });
    await userEvent.type(input, 'ana');
    // Immediate value, debounced URL.
    expect(input).toHaveValue('ana');
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('?q=ana'));
    expect(screen.getByTestId('search')).toHaveTextContent('ana');
    expect(screen.getByTestId('url')).not.toHaveTextContent('page=');

    await userEvent.click(screen.getByRole('button', { name: 'ext' }));
    await waitFor(() => expect(input).toHaveValue('externo'));
  });
});
