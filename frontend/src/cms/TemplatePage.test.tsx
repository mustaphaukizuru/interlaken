import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

vi.mock('@/services/api', () => ({ contentApi: { getPage: vi.fn() } }));

import { contentApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { TemplatePage } from './TemplatePage';
import { registerModule } from './sections';
import type { PageTemplate, SectionSpec } from './sections/types';

const getPage = vi.mocked(contentApi.getPage);

// A one-section test page: the section shows its `text` prop.
const Text = ({ text }: { text?: string }) => <p>{text}</p>;
const SPEC: SectionSpec = { type: 'pruebatp.text', group: 'pruebatp', label: 'Texto', description: '', fields: [], component: Text, defaults: { text: 'Texto integrado' } };
const SCREEN: PageTemplate = { slug: 'pantalla-prueba', path: '/pantalla-prueba', title: 'Pantalla', group: 'pruebatp', seo: {}, sections: ['pruebatp.text'], paintAtOnce: true };
const PAGE: PageTemplate = { ...SCREEN, slug: 'pagina-prueba', path: '/pagina-prueba', paintAtOnce: undefined };
registerModule({ sections: [SPEC], templates: [SCREEN, PAGE] });

const published = (slug: string, text: string) => ({ data: { slug, title: 'x', template: 'simple', seo: {}, published_at: null, blocks: [{ id: `${slug}-1`, type: 'pruebatp.text', props: { text } }] } });

beforeEach(() => vi.clearAllMocks());

describe('TemplatePage and the published copy', () => {
  it('an app screen paints its built-in copy at once, then takes the school’s edit', async () => {
    let answer: (v: unknown) => void = () => {};
    getPage.mockReturnValue(new Promise((r) => { answer = r; }) as never);
    renderWithProviders(<TemplatePage template={SCREEN} />);
    expect(screen.getByText('Texto integrado')).toBeInTheDocument();
    answer(published('pantalla-prueba', 'Texto editado'));
    expect(await screen.findByText('Texto editado')).toBeInTheDocument();
  });

  it.each([
    ['a server error', () => Promise.reject({ response: { status: 500 } })],
    ['a network error', () => Promise.reject(new Error('Network Error'))],
  ])('an app screen keeps the built-in copy after %s', async (_label, fail) => {
    getPage.mockImplementation(fail as never);
    renderWithProviders(<TemplatePage template={SCREEN} />);
    expect(screen.getByText('Texto integrado')).toBeInTheDocument();
    await waitFor(() => expect(getPage).toHaveBeenCalled());
    expect(screen.getByText('Texto integrado')).toBeInTheDocument();
  });

  it('an app screen does not wait for a CMS that never answers', () => {
    getPage.mockReturnValue(new Promise(() => {}) as never);
    renderWithProviders(<TemplatePage template={SCREEN} />);
    expect(screen.getByText('Texto integrado')).toBeInTheDocument();
  });

  it('a 204 (nothing published, no body) renders the built-in copy, like the old 404 did', async () => {
    // The server answers 204 for a page of the site with no published version
    // (it used to be a 404: red in every visitor's console).
    getPage.mockResolvedValue({ status: 204, data: '' } as never);
    const { container } = renderWithProviders(<TemplatePage template={PAGE} />);
    expect(await screen.findByText('Texto integrado')).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('an old server’s 404 still renders the built-in copy', async () => {
    getPage.mockRejectedValue({ response: { status: 404, data: { detail: 'No encontrado.' } } });
    renderWithProviders(<TemplatePage template={PAGE} />);
    expect(await screen.findByText('Texto integrado')).toBeInTheDocument();
  });

  it('any other page holds its paint until it knows whether a published version exists', async () => {
    getPage.mockResolvedValue(published('pagina-prueba', 'Texto editado') as never);
    const { container } = renderWithProviders(<TemplatePage template={PAGE} />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText('Texto integrado')).toBeNull();
    expect(await screen.findByText('Texto editado')).toBeInTheDocument();
  });
});
