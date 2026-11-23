/**
 * «Volver arriba» shares the WhatsApp button's column (owner, 2026-11-23):
 * right edges on one vertical line whatever their sizes, out of the way while
 * the quick contact actions are open.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('@/hooks/useSiteSettings', () => ({ useSiteSettings: () => ({ whatsapp_number: '5215550000000', chrome: {} }) }));

import { WhatsAppFloat } from './WhatsAppFloat';
import { BackToTop } from '@/components/layout/BackToTop';

describe('WhatsAppFloat with «Volver arriba» above', () => {
  it('stacks it over the bubble, right edges aligned; the column lets clicks through', () => {
    renderWithProviders(<WhatsAppFloat stickyCtaVisible={false} above={<BackToTop inline />} />);
    const bubble = screen.getByRole('button', { name: 'Contactar al colegio' });
    const top = document.querySelector<HTMLButtonElement>('[data-back-to-top]')!;
    const column = bubble.parentElement!;
    expect(column).toHaveClass('flex-col', 'items-end');
    expect(column.firstElementChild).toBe(top);
    // In the column, not fixed on its own.
    expect(top).not.toHaveClass('fixed');
    expect(column.parentElement).toHaveClass('pointer-events-none', 'fixed');
    expect(bubble).toHaveClass('pointer-events-auto');
  });

  it('steps aside while the quick contact actions are open', async () => {
    renderWithProviders(<WhatsAppFloat stickyCtaVisible={false} above={<BackToTop inline />} />);
    await userEvent.click(screen.getByRole('button', { name: 'Contactar al colegio' }));
    expect(screen.getByRole('list', { name: 'Contacto rápido' })).toBeInTheDocument();
    expect(document.querySelector('[data-back-to-top]')).toBeNull();
  });
});
