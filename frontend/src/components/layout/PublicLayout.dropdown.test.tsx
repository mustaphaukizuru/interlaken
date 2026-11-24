/**
 * Laptop dropdowns with a mouse (QA 2026-11-23, BUG-1): the pointer arriving
 * opens a group; the click that usually follows on its label must not close
 * it again. A second click closes; keyboard and touch still toggle.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';

const hover = vi.hoisted(() => ({ capable: true }));
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => hover.capable }));
vi.mock('@/services/api', () => ({
  contentApi: { getSettings: vi.fn().mockRejectedValue(new Error('offline')) },
  portalApi: { getSiteNotices: vi.fn().mockResolvedValue({ data: [] }) },
}));

import { PublicLayout } from './PublicLayout';

const familias = () => within(screen.getByRole('banner').querySelector('nav')!).getByRole('button', { name: 'Familias' });

describe('laptop dropdowns', () => {
  it('mouse: hover opens, the click on the label keeps it open, a second click closes', () => {
    hover.capable = true;
    renderWithProviders(<PublicLayout />);
    fireEvent.mouseEnter(familias().parentElement!);
    expect(familias()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(familias());
    expect(familias()).toHaveAttribute('aria-expanded', 'true');
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Facturación' })).toBeInTheDocument();
    fireEvent.click(familias());
    expect(familias()).toHaveAttribute('aria-expanded', 'false');
  });

  it('mouse leaves and comes back: hover opens again', () => {
    hover.capable = true;
    renderWithProviders(<PublicLayout />);
    fireEvent.mouseEnter(familias().parentElement!);
    fireEvent.mouseLeave(familias().parentElement!);
    expect(familias()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.mouseEnter(familias().parentElement!);
    expect(familias()).toHaveAttribute('aria-expanded', 'true');
  });

  it('touch or keyboard (no hover): each click toggles', () => {
    hover.capable = false;
    renderWithProviders(<PublicLayout />);
    fireEvent.click(familias());
    expect(familias()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(familias());
    expect(familias()).toHaveAttribute('aria-expanded', 'false');
  });
});
