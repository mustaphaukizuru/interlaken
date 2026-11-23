import { act, cleanup, render as rtlRender, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { SITE_DEFAULTS } from '@/lib/siteContact';
import { Suspense, lazy, useState } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RouteSeo, Seo, loadRouteMeta, resetSeoForTests } from './Seo';
import { DEFAULT_TITLE } from '@/lib/siteMeta';

/** RouteSeo reads the site settings (the month the cycle changes, Costos' price years): seed them, no network. */
function render(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(['site-settings'], SITE_DEFAULTS);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return rtlRender(ui, { wrapper });
}

const head = () => ({
  title: document.title,
  canonicals: [...document.head.querySelectorAll('link[rel="canonical"]')].map((l) => l.getAttribute('href')),
  description: document.head.querySelector('meta[name="description"]')?.getAttribute('content'),
  ogUrl: document.head.querySelector('meta[property="og:url"]')?.getAttribute('content'),
  robots: document.head.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null,
  ld: [...document.head.querySelectorAll('script[data-page-ld]')].map((s) => JSON.parse(s.textContent || '{}')),
});

// RouteSeo loads the route table after first paint; have it ready so it renders at once.
beforeAll(async () => {
  await loadRouteMeta();
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

  it('keeps the head the server wrote until the route table has loaded', () => {
    // No RouteSeo yet (table still loading): a page-level <Seo> adding JSON-LD
    // must not reset the server's title and description to the site defaults.
    document.head.innerHTML =
      '<title>Admisiones 2026–2027 · Colegio Interlaken</title><meta name="description" content="server">' +
      '<link rel="canonical" href="https://interlaken.edu.mx/admisiones">';
    window.history.pushState({}, '', '/admisiones');
    render(<MemoryRouter initialEntries={['/admisiones']}><Seo jsonLd={{ '@type': 'FAQPage' }} /></MemoryRouter>);
    expect(head().title).toBe('Admisiones 2026–2027 · Colegio Interlaken');
    expect(head().description).toBe('server');
    expect(head().canonicals).toEqual(['https://interlaken.edu.mx/admisiones']);
    expect(head().ld.map((b) => b['@type'])).toEqual(['FAQPage']);
    window.history.pushState({}, '', '/');
  });
});

async function expectTitle(props: Parameters<typeof Seo>[0], expected: string) {
  render(<HelmetProvider><MemoryRouter><Seo {...props} /></MemoryRouter></HelmetProvider>);
  await waitFor(() => expect(document.title).toBe(expected));
  cleanup();
  document.title = '';
}

describe('Seo title', () => {
  afterEach(() => { document.title = ''; });

  it('appends the site name once', async () => {
    await expectTitle({ title: 'Costos' }, 'Costos · Colegio Interlaken');
  });

  it('never appends it to a title that already names the school (old CMS titles, the home brand title)', async () => {
    await expectTitle({ title: 'Costos · Colegio Interlaken' }, 'Costos · Colegio Interlaken');
    await expectTitle({ title: DEFAULT_TITLE }, DEFAULT_TITLE);
  });
});
