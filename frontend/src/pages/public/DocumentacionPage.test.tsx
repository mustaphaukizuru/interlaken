import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DocumentacionPage from './DocumentacionPage';
import { ADMISSION_DOCS } from '@/lib/admisionesDocs';

function renderPage() {
  // The page renders its CMS template, which looks up a published version first.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <DocumentacionPage />
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

describe('DocumentacionPage', () => {
  it('lists every required document', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Documentos requeridos' });
    for (const doc of ADMISSION_DOCS) {
      expect(screen.getByText(doc.label)).toBeInTheDocument();
    }
  });

  it('links CURP and Acta to the official gob.mx portals in a new tab', async () => {
    renderPage();
    const curpLinks = await screen.findAllByRole('link', { name: /consultar curp/i });
    expect(curpLinks.length).toBeGreaterThanOrEqual(2);
    for (const link of curpLinks) {
      expect(link).toHaveAttribute('href', 'https://www.gob.mx/curp/');
      expect(link).toHaveAttribute('target', '_blank');
    }
    expect(
      screen.getByRole('link', { name: /obtener acta en línea/i }),
    ).toHaveAttribute('href', 'https://www.gob.mx/ActaNacimiento/');
  });
});
