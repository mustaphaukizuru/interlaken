import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InstallHint, resetInstallHintStateForTests } from './InstallHint';

const VISITS_KEY = 'pwa-portal-visits';
const DISMISS_KEY = 'pwa-install-hint-dismissed';

/** Dispatch a fake Chromium beforeinstallprompt with a controllable outcome. */
function fireInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const evt = new Event('beforeinstallprompt') as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string; platform: string }>;
  };
  evt.prompt = vi.fn().mockResolvedValue(undefined);
  evt.userChoice = Promise.resolve({ outcome, platform: 'web' });
  act(() => {
    window.dispatchEvent(evt);
  });
  return evt;
}

function setIOSUserAgent() {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1',
    configurable: true,
  });
}

const ORIGINAL_UA = window.navigator.userAgent;

describe('InstallHint', () => {
  beforeEach(() => {
    resetInstallHintStateForTests();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: ORIGINAL_UA,
      configurable: true,
    });
  });

  it('stays hidden on the first portal visit even with an install prompt', () => {
    render(<InstallHint />); // counts visit #1
    fireInstallPrompt();
    expect(
      screen.queryByRole('button', { name: /Agregar a pantalla de inicio/i }),
    ).not.toBeInTheDocument();
  });

  it('shows from the 2nd visit once beforeinstallprompt fired, and triggers it on tap', async () => {
    localStorage.setItem(VISITS_KEY, '1'); // this mount counts visit #2
    render(<InstallHint />);
    const evt = fireInstallPrompt('accepted');

    const btn = await screen.findByRole('button', { name: /Agregar a pantalla de inicio/i });
    await userEvent.setup().click(btn);
    expect(evt.prompt).toHaveBeenCalledTimes(1);
  });

  it('remembers dismissal forever', async () => {
    localStorage.setItem(VISITS_KEY, '5');
    const { unmount } = render(<InstallHint />);
    fireInstallPrompt();
    await screen.findByRole('button', { name: /Agregar a pantalla de inicio/i });

    await userEvent.setup().click(
      screen.getByRole('button', { name: /No volver a mostrar esta sugerencia/i }),
    );
    expect(localStorage.getItem(DISMISS_KEY)).toBe('1');
    expect(
      screen.queryByRole('button', { name: /Agregar a pantalla de inicio/i }),
    ).not.toBeInTheDocument();

    // A fresh mount (new visit) stays hidden.
    unmount();
    render(<InstallHint />);
    fireInstallPrompt();
    expect(
      screen.queryByRole('button', { name: /Agregar a pantalla de inicio/i }),
    ).not.toBeInTheDocument();
  });

  it('shows Safari share-sheet instructions on iOS without a native prompt', async () => {
    setIOSUserAgent();
    localStorage.setItem(VISITS_KEY, '3');
    render(<InstallHint />);

    expect(
      await screen.findByText(/Agregar a pantalla de inicio/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Compartir/i)).toBeInTheDocument();
    // Instructions only — no native install button on iOS.
    expect(
      screen.queryByRole('button', { name: /Agregar a pantalla de inicio/i }),
    ).not.toBeInTheDocument();
  });
});
