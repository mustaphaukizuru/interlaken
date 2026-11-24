import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import GaleriaPage from './GaleriaPage';

const onDisk = (url: string) => existsSync(resolve(process.cwd(), 'public', decodeURIComponent(url).replace(/^\//, '')));

// The page is a CMS template now: it looks up a published version (react-query)
// before rendering its default sections.
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <GaleriaPage />
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

describe('GaleriaPage', () => {
  it('filters photos by category', async () => {
    renderPage();
    // 14 fotos distintas en "Todas" (logos removidos y duplicados
    // consolidados: varias se publicaban dos veces con nombres distintos);
    // "Instalaciones" deja 8.
    expect(await screen.findAllByRole('button', { name: /ampliar imagen/i })).toHaveLength(14);
    await userEvent.click(screen.getByRole('button', { name: 'Instalaciones' }));
    expect(screen.getAllByRole('button', { name: /ampliar imagen/i })).toHaveLength(8);
  });

  it('tiles offer the smaller files, and every candidate is a real file (QA 2026-11-24)', async () => {
    renderPage();
    const tiles = (await screen.findAllByRole('button', { name: /ampliar imagen/i })).map((b) => b.querySelector('img')!);
    const missing: string[] = [];
    for (const img of tiles) {
      const srcset = img.getAttribute('srcset') ?? '';
      expect(srcset, img.getAttribute('src')!).toMatch(/-480\.webp 480w/);
      expect(img.getAttribute('sizes')).toMatch(/\(min-width: 1152px\) 264px/);
      for (const candidate of srcset.split(', ')) {
        const parts = candidate.split(' ');
        // «url width»: a raw space inside the url would make the browser drop the list.
        expect(parts, candidate).toHaveLength(2);
        if (!onDisk(parts[0])) missing.push(parts[0]);
      }
      // The grid never lists the full-size file above 960w.
      expect(srcset).not.toMatch(/1600w/);
    }
    expect(missing).toEqual([]);
  });

  it('the lightbox may use the large file', async () => {
    renderPage();
    await userEvent.click((await screen.findAllByRole('button', { name: /ampliar imagen/i }))[0]);
    const img = screen.getByRole('dialog').querySelector('img')!;
    expect(img.getAttribute('srcset')).toMatch(/-480\.webp 480w, .+-960\.webp 960w, .+ 1600w$/);
    expect(img.getAttribute('sizes')).toBe('(min-width: 928px) 896px, calc(100vw - 32px)');
  });

  it('opens the lightbox, navigates with arrow keys and closes with Escape', async () => {
    renderPage();
    await userEvent.click(
      (await screen.findAllByRole('button', { name: /ampliar imagen/i }))[0],
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('1 / 14')).toBeInTheDocument();

    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText('2 / 14')).toBeInTheDocument();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByText('1 / 14')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
