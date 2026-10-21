/**
 * Bitácora 14/10/2026, punto 10 (portal de familias): no Comunicados, no
 * Inscripciones. The colegiaturas «Próximamente» card was removed from Pagos
 * on 2026-10-20 (PaymentsPage.test). The profile lock lives in ProfilePage.test.
 */
import { describe, it, expect } from 'vitest';
import { navGroupsByRole, mobileNavByRole } from '@/components/layout/navConfig';

describe('Bitácora 10 · portal de familias', () => {
  it('the family menus no longer offer Comunicados or Inscripciones', () => {
    for (const role of ['parent', 'student'] as const) {
      const labels = [
        ...navGroupsByRole[role].flatMap((g) => g.items.map((i) => i.label)),
        ...mobileNavByRole[role].map((i) => i.label),
      ];
      expect(labels).not.toContain('Comunicados');
      expect(labels).not.toContain('Inscripciones');
      expect(labels).toContain('Pagos');
    }
  });
});
