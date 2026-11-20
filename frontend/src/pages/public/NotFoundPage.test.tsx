import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The page is a CMS template now (cms/sections/notfound.tsx): no API in tests,
// so the published-page lookup and the site settings fall back to defaults.
vi.mock('@/services/api', () => ({ contentApi: {} }));

import NotFoundPage from './NotFoundPage';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/ruta-inexistente']}>
          <NotFoundPage />
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

describe('NotFoundPage', () => {
  it('shows the 404 message in Spanish', async () => {
    renderPage();
    expect(await screen.findByText('404')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Página no encontrada' }),
    ).toBeInTheDocument();
  });

  it('offers recovery links to home and contact', async () => {
    renderPage();
    expect(await screen.findByRole('link', { name: /ir al inicio/i })).toHaveAttribute('href', '/');
    expect(
      screen.getByRole('link', { name: /contactar al colegio/i }),
    ).toHaveAttribute('href', '/contacto');
  });
});
