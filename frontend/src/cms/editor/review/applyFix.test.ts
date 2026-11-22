import { describe, expect, it } from 'vitest';
import { applyFix, setAtPath } from './applyFix';
import { COSTOS_BLOCKS, GLUED, ONLY_FEES, PRIVATE_LINK, VISIT } from './review.fixtures';
import type { ReviewIssue } from './types';

describe('setAtPath', () => {
  it('copies along the path and keeps the rest', () => {
    const props = { items: [{ title: 'A', text: 'x' }, { title: 'B' }], other: 1 };
    const next = setAtPath(props, 'items.1.title', 'C');
    expect(next).toEqual({ items: [{ title: 'A', text: 'x' }, { title: 'C' }], other: 1 });
    expect(props.items[1].title).toBe('B');
    expect(next.items).not.toBe(props.items);
    expect((next.items as unknown[])[0]).toBe(props.items[0]);
  });
});

describe('applyFix', () => {
  it('writes each quick fix of the incident into its field', () => {
    let blocks = COSTOS_BLOCKS;
    for (const issue of [PRIVATE_LINK, GLUED, ONLY_FEES]) blocks = applyFix(blocks, {}, issue)!.blocks!;
    expect(blocks[1].props).toMatchObject({ ctaPrimary: VISIT, daycareYear: 'Precios 2026', feesPending: '', tuitionPending: '{{ciclo}}' });
    expect(blocks[0]).toBe(COSTOS_BLOCKS[0]);
    expect(COSTOS_BLOCKS[1].props.daycareYear).toBe('Precios 2026{{anio}}');
  });

  it('fixes SEO texts and shows a hidden locked section', () => {
    const seoIssue = { ...GLUED, block_id: null, block_index: null, field: 'seo.title', fix: { kind: 'remove_token', label: 'Quitar {{anio}}', value: 'Costos 2026', preview: '' } } as ReviewIssue;
    expect(applyFix(COSTOS_BLOCKS, { title: 'Costos 2026{{anio}}', description: 'd' }, seoIssue)).toEqual({ seo: { title: 'Costos 2026', description: 'd' } });
    const hidden = [{ ...COSTOS_BLOCKS[0], hidden: true }];
    const show = { ...GLUED, block_id: 'costos-1', block_index: 0, field: '', fix: { kind: 'show_section', label: 'Mostrar la sección', value: null, preview: '' } } as ReviewIssue;
    expect(applyFix(hidden, {}, show)!.blocks![0].hidden).toBe(false);
  });

  it('has nothing to do without a fix or when the section is gone', () => {
    expect(applyFix(COSTOS_BLOCKS, {}, { ...GLUED, fix: null })).toBeNull();
    expect(applyFix([COSTOS_BLOCKS[0]], {}, { ...GLUED, block_index: 5 })).toBeNull();
  });
});
