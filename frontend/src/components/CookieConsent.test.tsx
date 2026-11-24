/**
 * Consent and page views (QA 2026-11-23, BUG-4): «Aceptar» boots analytics and
 * reports the current page ONCE (AnalyticsListener does it; the banner used to
 * do it as well, counting the first page twice). «Rechazar» reports nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';

const analytics = vi.hoisted(() => ({ initAnalytics: vi.fn(), trackPageView: vi.fn() }));
vi.mock('@/services/analytics', () => ({ ...analytics, isAnalyticsConfigured: () => true, trackEvent: vi.fn() }));

import { CookieConsent } from './CookieConsent';
import { AnalyticsListener } from './analytics/AnalyticsListener';

describe('cookie consent and page views', () => {
  afterEach(() => { localStorage.clear(); vi.clearAllMocks(); });

  it('«Aceptar»: analytics boots and the page counts once', async () => {
    renderWithProviders(<><AnalyticsListener /><CookieConsent /></>, { route: '/admisiones' });
    expect(analytics.trackPageView).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'Aceptar' }, { timeout: 8000 }));
    expect(analytics.initAnalytics).toHaveBeenCalled();
    expect(analytics.trackPageView).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Aceptar' })).not.toBeInTheDocument();
  });

  it('«Rechazar»: nothing is counted', async () => {
    renderWithProviders(<><AnalyticsListener /><CookieConsent /></>, { route: '/' });
    await userEvent.click(await screen.findByRole('button', { name: 'Rechazar' }, { timeout: 8000 }));
    expect(analytics.initAnalytics).not.toHaveBeenCalled();
    expect(analytics.trackPageView).not.toHaveBeenCalled();
  });
});
