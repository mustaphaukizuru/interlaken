import { describe, expect, it } from 'vitest';
import { BLOCKS, type FieldSpec } from '../blocks/registry';
import { allSections, sectionSpec } from '../sections';
import { loadAllGroups } from '../sections/loaders';
import { hasSpecificHelp, helpFor, OVERRIDES } from './fieldHelp';

const walk = (fields: FieldSpec[], prefix = ''): [string, FieldSpec][] =>
  fields.flatMap((f): [string, FieldSpec][] => [[`${prefix}${f.key}`, f], ...(f.kind === 'items' ? walk(f.item ?? [], `${prefix}${f.key}[].`) : [])]);

describe('editor help texts', () => {
  it('every field of every section and block has help, and every text field has its own', async () => {
    await loadAllGroups();
    const missing: string[] = [];
    for (const s of [...BLOCKS, ...allSections()]) {
      for (const [path, f] of walk(s.fields)) {
        if (!helpFor(s.type, path, f)) missing.push(`${s.type} ${path}`);
        if ((f.kind === 'text' || f.kind === 'textarea' || f.kind === 'number' || f.kind === 'url') && !hasSpecificHelp(s.type, path, f)) missing.push(`${s.type} ${path} (texto sin ayuda propia)`);
      }
    }
    expect(missing).toEqual([]);
  }, 30_000);

  it('section-specific help points at fields that exist', async () => {
    await loadAllGroups();
    const stale: string[] = [];
    for (const [type, paths] of Object.entries(OVERRIDES)) {
      const spec = sectionSpec(type) ?? BLOCKS.find((b) => b.type === type);
      const known = new Set(walk(spec?.fields ?? []).map(([p]) => p));
      for (const p of Object.keys(paths)) if (!known.has(p)) stale.push(`${type} ${p}`);
    }
    expect(stale).toEqual([]);
  }, 30_000);

  it('help is plain Spanish: no keys, slugs, HTML tags or em/en dashes', async () => {
    await loadAllGroups();
    const bad: string[] = [];
    for (const s of [...BLOCKS, ...allSections()]) {
      for (const [path, f] of walk(s.fields)) {
        const h = helpFor(s.type, path, f) ?? '';
        if (/slug|<\w+>|src\b|[–—]/i.test(h)) bad.push(`${s.type} ${path}: ${h}`);
      }
    }
    expect(bad).toEqual([]);
  }, 30_000);
});
