import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'vitest-axe';

// No real HTTP / toasts while rendering the login surface.
vi.mock('@/services/api', () => ({
  api: { post: vi.fn() },
  authApi: { me: vi.fn(), googleLogin: vi.fn() },
  bootstrapSession: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

import LoginPage from '@/pages/auth/LoginPage';

/**
 * Runtime a11y smoke test (axe-core). Catches ARIA misuse, unlabeled controls
 * and role errors on a critical, form-heavy surface — complements the static
 * eslint-plugin-jsx-a11y pass. (Colour contrast isn't computable under jsdom, so
 * axe reports it as "incomplete", not a violation.)
 */
describe('accessibility smoke (axe)', () => {
  it('LoginPage has no detectable a11y violations', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>,
    );
    const results = await axe(container);
    // Assert on `violations` directly so no custom-matcher type augmentation is
    // needed; a failure prints the offending nodes.
    expect(results.violations).toEqual([]);
  });
});
