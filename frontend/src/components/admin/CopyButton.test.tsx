import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: t };
});

import toast from 'react-hot-toast';
import { CopyButton } from './CopyButton';

describe('CopyButton', () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  it('copies the value, says «Copiado» and names what it copies', async () => {
    const u = userEvent.setup();
    // userEvent installs its own clipboard stub: put ours back after setup.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CopyButton value="IK000815" label="número de control" />);
    const button = screen.getByRole('button', { name: 'Copiar número de control' });
    expect(button).toHaveAttribute('type', 'button');
    await u.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('IK000815'));
    expect(toast.success).toHaveBeenCalledWith('Copiado');
  });

  it('tells staff to copy by hand when the browser refuses', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    const u = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CopyButton value="PAGO41" label="Referencia 1" />);
    await u.click(screen.getByRole('button', { name: 'Copiar Referencia 1' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });
});
