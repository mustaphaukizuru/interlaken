import { act, render } from '@testing-library/react';
import { Suspense, lazy, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RouteSeo, Seo, resetSeoForTests } from './Seo';

const head = () => ({
  title: document.title,
  canonicals: [...document.head.querySelectorAll('link[rel="canonical"]')].map((l) => l.getAttribute('href')),
  description: document.head.querySelector('meta[name="description"]')?.getAttribute('content'),
  ogUrl: document.head.querySelector('meta[property="og:url"]')?.getAttribute('content'),
  robots: document.head.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null,
  ld: [...document.head.querySelectorAll('script[data-page-ld]')].map((s) => JSON.parse(s.textContent || '{}')),
});

beforeEach(() => {
  resetSeoForTests();
  // What spa.py serves for "/": one of each tag, values to be rewritten.
  document.head.innerHTML =
    '<title>Home</title><meta name="description" content="home"><link rel="canonical" href="https://interlaken.edu.mx/">' +
    '<meta property="og:url" content="https://interlaken.edu.mx/"><meta property="og:title" content="Home">';
});
afterEach(() => resetSeoForTests());

describe('RouteSeo', () => {
  it('rewrites the existing tags in place: one canonical, the route values', () => {
    render(<MemoryRouter initialEntries={['/admisiones']}><RouteSeo /></MemoryRouter>);
    const h = head();
    expect(h.canonicals).toEqual(['https://interlaken.edu.mx/admisiones']);
    expect(h.ogUrl).toBe('https://interlaken.edu.mx/admisiones');
    expect(h.title).toMatch(/^Admisiones .* · Colegio Interlaken$/);
    expect(h.description).toMatch(/requisitos/);
    expect(h.ld[0]['@type']).toBe('BreadcrumbList');
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1);
  });

  it('lets a page add JSON-LD and a CMS version override the text', () => {
    render(
      <MemoryRouter initialEntries={['/nosotros']}>
        <RouteSeo />
        <Seo jsonLd={{ '@type': 'FAQPage' }} />
        <Seo priority={2} title="Desde el CMS" description="Descripción del CMS para esta página." />
      </MemoryRouter>,
    );
    const h = head();
    expect(h.title).toBe('Desde el CMS · Colegio Interlaken');
    expect(h.description).toBe('Descripción del CMS para esta página.');
    expect(h.canonicals).toEqual(['https://interlaken.edu.mx/nosotros']);
    expect(h.ld.map((b) => b['@type'])).toEqual(['BreadcrumbList', 'FAQPage']);
  });

  it('marks a 404 noindex and clears it again on the next page', () => {
    let go: (v: boolean) => void = () => {};
    function Toggle() {
      const [missing, setMissing] = useState(true);
      go = setMissing;
      return missing ? <Seo noindex title="Página no encontrada" /> : null;
    }
    render(<MemoryRouter initialEntries={['/contacto']}><RouteSeo /><Toggle /></MemoryRouter>);
    expect(head().robots).toBe('noindex');
    act(() => go(false));
    expect(head().robots).toBeNull();
    expect(head().title).toBe('Contacto y ubicación · Colegio Interlaken');
  });

  it('keeps the route tags when a lazy page suspends after the layout is on screen', async () => {
    // The production failure: CmsOverride renders null while it asks the CMS,
    // the layout commits, then the lazy page suspends and React hides the
    // layout. react-helmet-async never re-registered RouteSeo after that.
    let resolve: () => void = () => {};
    const Page = lazy(() => new Promise<{ default: () => JSX.Element }>((r) => {
      resolve = () => r({ default: () => <p>page</p> });
    }));
    let show: (v: boolean) => void = () => {};
    function Late() {
      const [on, setOn] = useState(false);
      show = setOn;
      return on ? <Page /> : null;
    }
    render(
      <MemoryRouter initialEntries={['/admisiones']}>
        <Suspense fallback={<span>…</span>}>
          <RouteSeo />
          <Late />
        </Suspense>
      </MemoryRouter>,
    );
    act(() => show(true));
    await act(async () => { resolve(); await Promise.resolve(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(head().canonicals).toEqual(['https://interlaken.edu.mx/admisiones']);
    expect(head().title).toMatch(/^Admisiones/);
  });
});
