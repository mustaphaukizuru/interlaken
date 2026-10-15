/**
 * Bitácora 14/10/2026, punto 10 (portal de familias): no Comunicados, no
 * Inscripciones; in Pagos only colegiaturas are «Próximamente» (cafetería is
 * paid in the portal). The profile lock lives in ProfilePage.test.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { ColegiaturasCard } from '@/pages/parent/PaymentsPage';
import { navGroupsByRole, mobileNavByRole } from '@/components/layout/navConfig';

describe('Bitácora 10 · portal de familias', () => {
  it('only colegiaturas are «Próximamente»; they point to ServoEscolar', () => {
    renderWithProviders(<ColegiaturasCard />);
    expect(screen.getByText('Próximamente')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Colegiaturas y boletas/ }))
      .toHaveAttribute('href', 'https://interlaken.servoescolar.mx/');
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
