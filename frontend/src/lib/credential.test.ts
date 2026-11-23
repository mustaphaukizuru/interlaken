import { describe, expect, it } from 'vitest';
import { CARD_SEP } from './credential';
import { SEP_INCORPORATIONS } from './sepIncorporations';

describe('the credential’s SEP figures', () => {
  it('match the official list (lib/sepIncorporations) for every level', () => {
    for (const { level, label } of SEP_INCORPORATIONS) {
      const card = CARD_SEP[level];
      expect(label).toContain(`C.T. ${card.cct}`);
      expect(label).toContain(`Acuerdo ${card.acuerdo})`);
    }
  });
});
