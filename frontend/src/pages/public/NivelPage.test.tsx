import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

vi.mock('@/hooks/useSep', () => ({ useSep: () => [{ level: 'Primaria', label: 'Incorporada a la SEP · Clave 15PPR0000X' }] }));

import { renderWithProviders } from '@/test/renderWithProviders';
import { LEVELS } from '@/lib/levels';
import { LEVEL_STORIES } from '@/lib/levelStories';
import NivelPage from './NivelPage';

const open = (slug: string) => renderWithProviders(
  <Routes><Route path="/niveles/:nivel" element={<NivelPage />} /></Routes>,
  { route: `/niveles/${slug}` },
);

describe('NivelPage: the school\'s own text for each level (owner, 2026-11-08)', () => {
  it('Primaria: hero headline and lead, every section, pull-quotes and the three programs', () => {
    open('primaria');
    expect(screen.getByRole('heading', { level: 1, name: 'Primaria' })).toBeInTheDocument();
    expect(screen.getByText('Aprender tiene sentido')).toBeInTheDocument();
    expect(screen.getByText('Queremos que nuestros alumnos no solo sepan más. Queremos que sepan qué hacer con lo que aprenden.')).toBeInTheDocument();

    for (const s of LEVEL_STORIES.primaria.story.filter((x) => x.title)) {
      expect(screen.getByRole('heading', { level: 2, name: s.title })).toBeInTheDocument();
    }
    // One-line statements set as pull-quotes.
    expect(screen.getByText('Más tarea no siempre significa más aprendizaje.').closest('blockquote')).not.toBeNull();
    expect(screen.getByText('“Yo puedo hacerlo.”').closest('blockquote')).not.toBeNull();

    // The programs: a card each, the name as the title, the sentence not repeating it.
    const programs = within(screen.getByRole('list', { name: 'Programas' })).getAllByRole('listitem');
    expect(programs).toHaveLength(3);
    expect(within(programs[0]).getByRole('heading', { name: 'Lee y Produce' })).toBeInTheDocument();
    expect(programs[0]).toHaveTextContent('Lee y Produceimpulsa la comprensión lectora');
    expect(programs[2]).toHaveTextContent('Con el Método Singapur, las matemáticas');

    // The document's bold phrases stay bold; no markup leaks as text.
    expect(screen.getByText('trabajo por proyectos').tagName).toBe('STRONG');
    expect(document.body.textContent).not.toContain('**');

    // A photo of the school, and the practical data and SEP block kept below.
    expect(screen.getByRole('img', { name: /Pasillo de salones de Primaria/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Seis grupos en este nivel' })).toBeInTheDocument();
    expect(screen.getByText(/Clave 15PPR0000X/)).toBeInTheDocument();
  });

  it.each(LEVELS.map((l) => [l.slug, l] as const))('%s renders its headline and every section title', (slug, level) => {
    open(slug);
    expect(screen.getByText(level.headline)).toBeInTheDocument();
    expect(screen.getByText(level.intro)).toBeInTheDocument();
    for (const s of LEVEL_STORIES[level.slug].story.filter((x) => x.title)) {
      expect(screen.getByRole('heading', { level: 2, name: s.title })).toBeInTheDocument();
    }
    expect(document.body.textContent).not.toContain('**');
  });

  it('keeps the two typo fixes from the documents', () => {
    open('preescolar');
    expect(screen.getByText('queremos que aprendan a comunicarse en él.').tagName).toBe('STRONG');
    open('secundaria');
    expect(document.body.textContent).toContain('lo que sienten y sus ideas, convivir');
    expect(document.body.textContent).not.toContain('sus ideas ,');
  });

  it('an unknown level goes to Preescolar', () => {
    renderWithProviders(
      <Routes>
        <Route path="/niveles/:nivel" element={<NivelPage />} />
      </Routes>,
      { route: '/niveles/universidad' },
    );
    expect(screen.queryByRole('heading', { level: 1, name: 'Universidad' })).toBeNull();
  });
});
