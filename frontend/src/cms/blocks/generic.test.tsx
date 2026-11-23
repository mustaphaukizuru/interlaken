/**
 * Generic blocks (UX refinement 2026-11-21): a page gets one h1 even with two
 * hero blocks, calendar dates read in es-MX, and gallery tiles reserve their
 * space before the photo loads.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

vi.mock('@/services/api', () => ({
  contentApi: { getSettings: vi.fn(() => new Promise(() => {})) },
  admissionsApi: {},
}));

import { renderWithProviders } from '@/test/renderWithProviders';
import GenericBlockView, { formatDateMx } from './generic';
import type { Block } from './registry';

const hero = (id: string, title: string): Block => ({ id, type: 'hero', props: { title } } as unknown as Block);

describe('generic blocks', () => {
  it('two hero blocks give the page one h1; the second titles itself with an h2', () => {
    renderWithProviders(
      <>
        <GenericBlockView block={hero('a', 'Bienvenidos')} />
        <GenericBlockView block={hero('b', 'Otra portada')} />
      </>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Bienvenidos' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Otra portada' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('formats ISO dates as es-MX words', () => {
    expect(formatDateMx('2026-12-05')).toBe('5 de diciembre de 2026');
    expect(formatDateMx('no-es-fecha')).toBe('no-es-fecha');
  });

  it('gallery tiles keep a 4:3 box and explicit size, so nothing jumps while photos load', () => {
    const { container } = renderWithProviders(
      <GenericBlockView block={{ id: 'g', type: 'gallery', props: { images: [{ image: '/assets/hopscotch.webp', caption: 'Recreo' }] } } as unknown as Block} />,
    );
    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('width');
    expect(img).toHaveAttribute('height');
    expect(img.parentElement).toHaveClass('aspect-[4/3]');
    expect(screen.getByText('Recreo')).toBeInTheDocument();
  });
});
