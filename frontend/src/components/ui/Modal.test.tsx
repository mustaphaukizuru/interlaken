import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './Modal';

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    // A `space-y-6` parent gave the fixed backdrop a 24 px top margin (QA 2026-11-24).
    <div className="space-y-6" data-testid="page">
      <p>Antes</p>
      <button type="button" onClick={() => setOpen(true)}>Abrir</button>
      <Modal open={open} onClose={() => { onClose(); setOpen(false); }} title="Recargar cafetería">
        <input aria-label="Monto" />
        <button type="button">Continuar</button>
      </Modal>
    </div>
  );
}

describe('Modal', () => {
  it('renders into <body>, outside the page, with no margin on the backdrop (QA 2026-11-24)', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = screen.getByRole('dialog', { name: 'Recargar cafetería' });
    const backdrop = dialog.parentElement as HTMLElement;
    expect(screen.getByTestId('page').contains(dialog)).toBe(false);
    expect(backdrop.parentElement).toBe(document.body);
    expect(backdrop).toHaveClass('fixed', 'inset-0', 'm-0');
  });

  it('keeps focus inside, Escape, scroll lock and focus return', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Abrir' });
    await userEvent.click(opener);
    expect(document.body.style.overflow).toBe('hidden');
    // Focus starts inside the dialog, and Tab never leaves it (jsdom has no
    // layout, so the trap only sees the focused element: it stays put).
    const close = screen.getByRole('button', { name: 'Cerrar' });
    expect(close).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    expect(opener).toHaveFocus();
  });

  it('closes on a backdrop press, not on a press inside the panel', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    await userEvent.click(screen.getByLabelText('Monto'));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
