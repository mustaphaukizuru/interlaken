/**
 * Bitácora 14/10/2026, punto 10 (portal de familias): no Comunicados, no
 * Inscripciones, Pagos «Próximamente». The profile lock lives in ProfilePage.test.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import PagosProximamentePage from '@/pages/parent/PagosProximamentePage';
import { navGroupsByRole, mobileNavByRole } from '@/components/layout/navConfig';

describe('Bitácora 10 · portal de familias', () => {
  it('Pagos says «Próximamente» and points to where families pay today', () => {
    renderWithProviders(<PagosProximamentePage />);
    expect(screen.getByText('Próximamente')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Colegiaturas y boletas/ })).toHaveAttribute('href', 'https://interlaken.servoescolar.mx/');
    expect(screen.getByRole('link', { name: /Cafetería/ })).toHaveAttribute('href', '/portal/cafeteria');
  });

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
