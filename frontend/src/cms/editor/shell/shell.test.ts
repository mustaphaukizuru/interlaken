import { beforeAll, describe, expect, it } from 'vitest';
import type { CmsPageAdmin } from '@/services/api';
import { loadAllGroups } from '../../sections/loaders';
import { originalBlocks } from '../helpers';
import { isoToSchoolInput, schoolInputToIso } from './mxTime';
import { pageState, timeAgo } from './status';
import { draftConflictFrom, isLegacySeedRefusal } from './contracts';
import { blockSummary, splitLabel } from './blockLabels';

beforeAll(async () => { await loadAllGroups(); }, 60_000);

const page = (over: Partial<CmsPageAdmin>): CmsPageAdmin => ({
  id: 1, slug: 'nosotros', title: 'Nosotros', template: 'simple', status: 'draft', draft_blocks: [], seo: {},
  published_version_number: null, has_unpublished_changes: true, published_at: null, updated_at: '2026-11-19T10:00:00Z', ...over,
});

describe('mxTime', () => {
  it('reads and writes datetime-local values as Mexico City time, whatever the computer zone', () => {
    expect(schoolInputToIso('2026-12-03T08:00')).toBe('2026-12-03T14:00:00.000Z');
    expect(isoToSchoolInput('2026-12-03T14:00:00Z')).toBe('2026-12-03T08:00');
    expect(isoToSchoolInput(schoolInputToIso('2027-07-15T23:45'))).toBe('2027-07-15T23:45');
    expect(schoolInputToIso('')).toBeNull();
    expect(isoToSchoolInput(null)).toBe('');
  });
});

describe('page state', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  it('names every state with a label', () => {
    expect(pageState(undefined).label).toBe('Diseño original');
    expect(pageState(page({ draft_blocks: originalBlocks('nosotros') ?? [] }), { now }).key).toBe('original');
    expect(pageState(page({ draft_blocks: [{ id: 'a', type: 'rich_text', props: {} }], legacy_seed: false }), { now }).label).toBe('Borrador');
    expect(pageState(page({ legacy_seed: true }), { now }).label).toBe('Borrador antiguo');
    expect(pageState(page({ status: 'published', published_version_number: 2, has_unpublished_changes: false }), { now }).label).toBe('Publicada');
    expect(pageState(page({ status: 'published', published_version_number: 2 }), { now }).label).toBe('Cambios sin publicar');
    const scheduled = pageState(page({ publish_at: '2026-12-03T14:00:00Z', legacy_seed: false }), { now });
    expect(scheduled.label).toBe('Programada');
    expect(scheduled.detail).toMatch(/^Se publica el 3 dic/);
    expect(pageState(page({ publish_at: '2026-11-01T14:00:00Z', legacy_seed: false }), { now }).detail).toMatch(/^Atrasada/);
    expect(pageState(page({ review_requested_at: '2026-11-19T00:00:00Z', legacy_seed: false }), { now }).review).toBe(true);
  });

  it('counts time the way the bar shows it', () => {
    const now2 = Date.parse('2026-11-20T12:00:00Z');
    expect(timeAgo(now2 - 10_000, now2)).toBe('hace unos segundos');
    expect(timeAgo(now2 - 60_000, now2)).toBe('hace 1 min');
    expect(timeAgo(now2 - 3 * 3600_000, now2)).toBe('hace 3 h');
  });
});

describe('contracts', () => {
  const err = (status: number, data: object) => ({ response: { status, data } });
  it('reads C1 and C2 refusals and ignores other 409s', () => {
    expect(isLegacySeedRefusal(err(409, { code: 'legacy_seed_draft', detail: 'x' }))).toBe(true);
    expect(isLegacySeedRefusal(err(400, { code: 'legacy_seed_draft' }))).toBe(false);
    expect(draftConflictFrom(err(409, { code: 'draft_conflict', draft_revision: 4, draft_updated_by: 'Ana', draft_updated_at: '2026-11-20T10:00:00Z' })))
      .toEqual({ revision: 4, by: 'Ana', at: '2026-11-20T10:00:00Z' });
    expect(draftConflictFrom(err(409, { code: 'draft_conflict', draft_revision: 4, draft_updated_by: { full_name: 'Ana Ruiz' } }))?.by).toBe('Ana Ruiz');
    expect(draftConflictFrom(err(409, { code: 'other' }))).toBeNull();
  });
});

describe('block labels', () => {
  it('drops the page prefix and summarises the content', () => {
    expect(splitLabel('home.hero')).toEqual({ name: 'Portada', page: 'Inicio' });
    expect(blockSummary({ id: 'a', type: 'rich_text', props: { html: '<p>Hola <b>mundo</b></p>' } })).toBe('Hola mundo');
  });
});
