import { describe, expect, it } from 'vitest';
import { applySnippets } from './CmsPage';
import { resolveSep, SEP_INCORPORATIONS } from '@/lib/sepIncorporations';

describe('site snippets', () => {
  it('substitutes known tokens and leaves unknown ones', () => {
    const out = applySnippets('<p>{{ direccion }} · {{horario}} · {{nope}}</p>', { address: 'Calle 1', office_hours: '7-15' });
    expect(out).toBe('<p>Calle 1 · 7-15 · {{nope}}</p>');
  });
  it('resolveSep falls back to the flyer values', () => {
    expect(resolveSep([])).toBe(SEP_INCORPORATIONS);
    expect(resolveSep([{ level: 'Primaria', label: 'X' }])).toHaveLength(1);
  });
});
