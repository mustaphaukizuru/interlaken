import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/push', () => ({
  enablePush: vi.fn(),
  isPushSubscribed: vi.fn(),
  isPushSupported: vi.fn(),
  pushPermission: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import toast from 'react-hot-toast';
import { PushOptIn } from './PushOptIn';
import { enablePush, isPushSubscribed, isPushSupported, pushPermission } from '@/services/push';

const BANNER = /Active los avisos en este dispositivo/;

describe('PushOptIn (QA 2026-11-24)', () => {
  beforeEach(() => {
    vi.mocked(isPushSupported).mockReturnValue(true);
    vi.mocked(pushPermission).mockReturnValue('default');
    vi.mocked(isPushSubscribed).mockResolvedValue(false);
  });

  it('hides on a device that already granted and is subscribed', async () => {
    vi.mocked(pushPermission).mockReturnValue('granted');
    vi.mocked(isPushSubscribed).mockResolvedValue(true);
    const { container } = render(<PushOptIn />);
    await waitFor(() => expect(isPushSubscribed).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('granted but this device has no subscription: offers it again', async () => {
    vi.mocked(pushPermission).mockReturnValue('granted');
    render(<PushOptIn />);
    expect(await screen.findByRole('button', { name: BANNER })).toBeInTheDocument();
  });

  it('«Ahora no» closes it and the choice is remembered', async () => {
    const { unmount } = render(<PushOptIn />);
    await userEvent.click(screen.getByRole('button', { name: 'Ahora no' }));
    expect(screen.queryByRole('button', { name: BANNER })).toBeNull();
    unmount();
    const { container } = render(<PushOptIn />);
    expect(container).toBeEmptyDOMElement();
  });

  it('still renders when the browser storage is blocked', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<PushOptIn />);
    expect(screen.getByRole('button', { name: BANNER })).toBeInTheDocument();
    getItem.mockRestore();
  });

  it('a refused permission says so without an em-dash', async () => {
    vi.mocked(enablePush).mockResolvedValue(false);
    render(<PushOptIn />);
    await userEvent.click(screen.getByRole('button', { name: BANNER }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Permiso no otorgado: puede activarlo después.', { icon: '🔕' }));
  });

  it('never shows once permission was denied', () => {
    vi.mocked(pushPermission).mockReturnValue('denied');
    const { container } = render(<PushOptIn />);
    expect(container).toBeEmptyDOMElement();
  });
});
