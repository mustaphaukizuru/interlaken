import { describe, expect, it } from 'vitest';
import { apiErrors, moveBlock, newBlock, pageStatusLabel, slugify } from './helpers';

describe('cms editor helpers', () => {
  it('newBlock shapes props from the registry', () => {
    const b = newBlock('hero');
    expect(b.type).toBe('hero');
    expect(b.props.title).toBe('');
    expect(b.props.cta).toEqual({ label: '', href: '' });
    expect(b.id).toMatch(/^b_/);
    expect(newBlock('gallery').props.images).toEqual([]);
  });
  it('moveBlock reorders and ignores out-of-range', () => {
    const list = ['a', 'b', 'c'].map((id) => ({ id, type: 'rich_text', props: {} }));
    expect(moveBlock(list, 0, 2).map((b) => b.id)).toEqual(['b', 'c', 'a']);
    expect(moveBlock(list, 0, -1)).toBe(list);
    expect(moveBlock(list, 2, 3)).toBe(list);
  });
  it('slugify strips accents and punctuation', () => {
    expect(slugify('Curso de Verano 2026!')).toBe('curso-de-verano-2026');
    expect(slugify('  Niños  ')).toBe('ninos');
  });
  it('pageStatusLabel reflects draft/published/changes', () => {
    expect(pageStatusLabel({ status: 'draft', has_unpublished_changes: false }).label).toBe('Borrador');
    expect(pageStatusLabel({ status: 'published', has_unpublished_changes: true }).tone).toBe('warning');
    expect(pageStatusLabel({ status: 'published', has_unpublished_changes: false }).tone).toBe('success');
  });
  it('apiErrors flattens DRF payloads', () => {
    expect(apiErrors({ response: { data: { blocks: ['Bloque #2: falta "title".'], slug: 'ya existe' } } })).toEqual({ blocks: 'Bloque #2: falta "title".', slug: 'ya existe' });
    expect(apiErrors(new Error('x'))).toEqual({});
  });
});
