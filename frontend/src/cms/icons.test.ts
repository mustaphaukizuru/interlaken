import { describe, expect, it } from 'vitest';
import { CMS_ICONS } from './icons';
import { CMS_ICON_NAMES } from './iconRuntime';

describe('CMS icons', () => {
  it('the on-demand name list matches the curated set the editor offers', () => {
    expect([...CMS_ICON_NAMES].sort()).toEqual(Object.keys(CMS_ICONS).sort());
  });
});
