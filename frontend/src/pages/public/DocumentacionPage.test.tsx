import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/api', () => ({
  api: { get: vi.fn() },
  contentApi: { getPage: vi.fn() },
}));

import DocumentacionPage from './DocumentacionPage';
import { api, contentApi } from '@/services/api';
import type { PublicRequiredDocs } from '@/hooks/queries/requiredDocs';

const apiGet = vi.mocked(api.get);
const ALL = ['preescolar', 'primaria', 'secundaria'] as const;
type Row = PublicRequiredDocs['results'][number];
const doc = (key: string, name: string, levels: readonly string[], extra: Partial<Row> = {}) => ({
  key, name, description: '', physical_note: '', levels: [...levels], kind: 'upload', multiple_files: false,
  link_url: '', link_label: '', ...extra,
}) as Row;

const LIST: PublicRequiredDocs = {
  level: '',
  levels: [{ value: 'preescolar', label: 'Preescolar', count: 3 }, { value: 'primaria', label: 'Primaria', count: 3 }, { value: 'secundaria', label: 'Secundaria', count: 2 }],
  results: [
    doc('ficha', 'Ficha de inscripción', ALL, { kind: 'ficha', description: 'Se llena en línea.' }),
    doc('acta-nacimiento', 'Acta de nacimiento', ALL, { physical_note: 'Original y 2 copias', link_url: 'https://www.gob.mx/ActaNacimiento/', link_label: 'Obtener acta en línea' }),
    doc('cartilla-vacunacion', 'Cartilla de vacunación', ['preescolar']),
    doc('certificado-preescolar', 'Certificado de Preescolar', ['primaria']),
  ],
};

function renderPage(route = '/admisiones/documentacion') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[route]}>
          <DocumentacionPage />
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // No published CMS version: the template renders.
  vi.mocked(contentApi.getPage).mockRejectedValue({ response: { status: 404 } });
  apiGet.mockResolvedValue({ data: LIST } as never);
});

describe('DocumentacionPage', () => {
  it('lists the documents of one level per tab, from the Admisiones list', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Documentos requeridos' });
    expect(apiGet).toHaveBeenCalledWith('/admissions/required-documents/');
    const panel = await screen.findByRole('tabpanel');
    expect(await within(panel).findByText('Acta de nacimiento')).toBeInTheDocument();
    expect(within(panel).getByText('Cartilla de vacunación')).toBeInTheDocument();
    expect(within(panel).queryByText('Certificado de Preescolar')).not.toBeInTheDocument();
    expect(within(panel).getByText('Original y 2 copias')).toBeInTheDocument();
    expect(screen.getByText('3 documentos para Preescolar · 1 con trámite oficial en línea')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Primaria' }));
    expect(screen.getByRole('tab', { name: 'Primaria' })).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByRole('tabpanel')).getByText('Certificado de Preescolar')).toBeInTheDocument();
    expect(within(screen.getByRole('tabpanel')).queryByText('Cartilla de vacunación')).not.toBeInTheDocument();
  });

  it('moves between levels with the arrow keys', async () => {
    renderPage();
    const first = await screen.findByRole('tab', { name: 'Preescolar' });
    first.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Secundaria' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Secundaria' })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens on the level of the link (?nivel=)', async () => {
    renderPage('/admisiones/documentacion?nivel=primaria');
    expect(await screen.findByRole('tab', { name: 'Primaria' })).toHaveAttribute('aria-selected', 'true');
  });

  it('links the official procedures in a new tab', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: /obtener acta en línea/i });
    expect(link).toHaveAttribute('href', 'https://www.gob.mx/ActaNacimiento/');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('says so and offers a retry when the list does not load', async () => {
    apiGet.mockRejectedValue(new Error('down'));
    renderPage();
    expect(await screen.findByText('No se pudo cargar la lista de documentos', {}, { timeout: 4000 })).toBeInTheDocument();
    apiGet.mockResolvedValue({ data: LIST } as never);
    await userEvent.click(screen.getByRole('button', { name: /Reintentar/ }));
    expect(await screen.findByText('Acta de nacimiento')).toBeInTheDocument();
  });
});
