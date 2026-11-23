import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ILLUSTRATION_NAMES, illustrationSrc } from './illustrations';
import { illustrationFor, resolveIllustration } from './illustrationTopics';
import { ILLUSTRATION_LABELS, ILLUSTRATION_OPTIONS } from './illustrationLabels';
import { LEVEL_STORIES } from './levelStories';

const NAMES = [...ILLUSTRATION_NAMES];

describe('illustrations', () => {
  it('every illustration exists at 640 and 320 px', () => {
    const missing = NAMES.flatMap((n) => [illustrationSrc(n), illustrationSrc(n, true)])
      .filter((src) => !existsSync(resolve(process.cwd(), 'public', `.${src}`)));
    expect(missing).toEqual([]);
  });

  it('the editor select offers «Sin ilustración» and every illustration, each with a Spanish label', () => {
    expect(ILLUSTRATION_OPTIONS[0]).toEqual({ value: 'none', label: 'Sin ilustración' });
    expect(ILLUSTRATION_OPTIONS.slice(1).map((o) => o.value)).toEqual(NAMES);
    expect(Object.keys(ILLUSTRATION_LABELS).sort()).toEqual([...NAMES].sort());
  });

  it('a choice wins, «none» hides, nothing chosen falls back to the title', () => {
    expect(resolveIllustration('arte', 'Bilingües para comunicarse con el mundo')).toBe('arte');
    expect(resolveIllustration('none', 'Bilingües para comunicarse con el mundo')).toBeUndefined();
    expect(resolveIllustration(undefined, 'Bilingües para comunicarse con el mundo')).toBe('bilingue');
    expect(resolveIllustration('not-a-name', 'Tareas que suman')).toBe('tareas');
    expect(resolveIllustration(undefined, 'Un título cualquiera')).toBeUndefined();
  });

  it('every titled part of the level texts finds an illustration', () => {
    const unmatched = Object.values(LEVEL_STORIES)
      .flatMap((l) => l.story.map((s) => s.title).filter((t): t is string => !!t))
      .filter((t) => !illustrationFor(t));
    expect(unmatched).toEqual([]);
  });
});
