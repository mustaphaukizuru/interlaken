import { cleanup, render, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { Seo } from './Seo';
import { DEFAULT_TITLE } from '@/lib/siteMeta';

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
