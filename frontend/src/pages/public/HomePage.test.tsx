import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/api', () => ({
  admissionsApi: { getOpenSchoolEvents: vi.fn(async () => ({ data: [] })) },
  contactApi: { send: vi.fn() },
}));

// Site settings reach components through useSiteSettings (react-query over
// contentApi.getSettings with SITE_DEFAULTS as placeholder). Mock the hook so
// each test controls video_url directly.
const mockUseSiteSettings = vi.fn();
vi.mock('@/hooks/useSiteSettings', () => ({
  useSiteSettings: () => mockUseSiteSettings(),
}));

import HomePage from './HomePage';
import { SITE_DEFAULTS } from '@/lib/siteContact';

function renderHome() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('HomePage — video institucional (admin-editable, ships hidden)', () => {
  beforeEach(() => {
    mockUseSiteSettings.mockReturnValue({ ...SITE_DEFAULTS });
  });

  it('renders no video section while video_url is empty (production default)', () => {
    renderHome();
    expect(screen.getByText('Formando líderes')).toBeInTheDocument();
    expect(screen.queryByText('Conócenos en video')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Reproducir el video institucional' }),
    ).not.toBeInTheDocument();
  });

  it('renders a click-to-load placeholder and only injects the iframe on click', async () => {
    mockUseSiteSettings.mockReturnValue({
      ...SITE_DEFAULTS,
      video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
    renderHome();

    expect(screen.getByText('Conócenos en video')).toBeInTheDocument();
    const play = screen.getByRole('button', { name: 'Reproducir el video institucional' });
    // No third-party iframe until the user opts in.
    expect(
      screen.queryByTitle('Video institucional del Colegio Interlaken'),
    ).not.toBeInTheDocument();

    await userEvent.click(play);

    const iframe = screen.getByTitle('Video institucional del Colegio Interlaken');
    expect(iframe).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0',
    );
    expect(
      screen.queryByRole('button', { name: 'Reproducir el video institucional' }),
    ).not.toBeInTheDocument();
  });

  it('falls back to a plain external link for unrecognized URLs', () => {
    mockUseSiteSettings.mockReturnValue({
      ...SITE_DEFAULTS,
      video_url: 'https://example.com/video-institucional.mp4',
    });
    renderHome();

    const link = screen.getByRole('link', { name: /Ver video institucional/ });
    expect(link).toHaveAttribute('href', 'https://example.com/video-institucional.mp4');
    expect(
      screen.queryByRole('button', { name: 'Reproducir el video institucional' }),
    ).not.toBeInTheDocument();
  });
});
