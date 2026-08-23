import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import AdminPages from './AdminPages';

vi.mock('@/services/api', () => ({
  contentApi: {
    adminListPages: vi.fn().mockResolvedValue({ data: [
      { id: 1, slug: 'verano', title: 'Curso de verano', template: 'landing', status: 'published', has_unpublished_changes: true, draft_blocks: [], seo: {}, published_version_number: 2, published_at: null, updated_at: '' },
      { id: 2, slug: 'becas', title: 'Becas', template: 'simple', status: 'draft', has_unpublished_changes: false, draft_blocks: [], seo: {}, published_version_number: null, published_at: null, updated_at: '' },
    ] }),
  },
}));

describe('AdminPages', () => {
  it('lists pages with status and edit links', async () => {
    renderWithProviders(<AdminPages />, { route: '/admin/contenido' });
    expect(await screen.findByText('Curso de verano')).toBeInTheDocument();
    expect(screen.getByText('Publicada · cambios sin publicar')).toBeInTheDocument();
    expect(screen.getByText('Borrador')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Editar Becas' })).toHaveAttribute('href', '/admin/contenido/2');
  });
});
