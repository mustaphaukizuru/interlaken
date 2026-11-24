/**
 * «Móvil» and «Tableta» preview in a real device frame (2026-11-23): the
 * page's media queries and `svh` read the frame, not the console's window.
 */
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { PreviewPane, type Device } from './PreviewPane';
import type { Block } from '../../blocks/registry';

const BLOCKS = [{ id: 'a', type: 'rich_text', props: { html: '<p>Hola familias</p>' } }] as Block[];

function renderPane(device: Device, onSelect = vi.fn()) {
  const previewRef = createRef<HTMLDivElement>();
  const view = renderWithProviders(
    <PreviewPane blocks={BLOCKS} selectedId={null} onSelect={onSelect} device={device} onDevice={vi.fn()} previewRef={previewRef} />,
  );
  return { ...view, previewRef, onSelect };
}

const frameOf = () => screen.queryByTitle(/^Vista previa: /) as HTMLIFrameElement | null;

describe('PreviewPane device frames', () => {
  afterEach(() => { document.head.querySelectorAll('[data-test-sheet]').forEach((n) => n.remove()); });

  it('«Escritorio» renders inline, as before (no frame)', async () => {
    const { previewRef } = renderPane('desktop');
    expect(frameOf()).toBeNull();
    expect(await screen.findByText('Hola familias')).toBeInTheDocument();
    expect(previewRef.current?.querySelector('[data-block-id="a"]')).not.toBeNull();
  });

  it('«Móvil» renders in a 390 px frame; a click on a section still selects it', async () => {
    const { previewRef, onSelect } = renderPane('mobile');
    const frame = frameOf()!;
    expect(frame).toHaveAttribute('title', 'Vista previa: Móvil');
    expect(frame.style.width).toBe('390px');
    const body = frame.contentDocument!.body;
    const section = await within(body).findByRole('button', { name: 'Editar bloque: Texto' });
    expect(within(body).getByText('Hola familias')).toBeInTheDocument();
    // Not in the console's own document.
    expect(screen.queryByText('Hola familias')).toBeNull();
    // previewRef points inside the frame (AdminPageEditor scrolls the selection into view through it).
    expect(previewRef.current?.querySelector('[data-block-id="a"]')).toBe(section);
    fireEvent.click(section);
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('«Tableta» is an 820 px frame', () => {
    renderPane('tablet');
    expect(frameOf()).toHaveAttribute('title', 'Vista previa: Tableta');
    expect(frameOf()!.style.width).toBe('820px');
  });

  it('the frame carries the console\'s stylesheets and follows their changes', async () => {
    const sheet = document.createElement('style');
    sheet.setAttribute('data-test-sheet', '');
    sheet.textContent = '.x{color:red}';
    document.head.appendChild(sheet);
    renderPane('mobile');
    const head = frameOf()!.contentDocument!.head;
    const copy = () => Array.from(head.querySelectorAll('style')).find((s) => s.textContent?.includes('.x{'));
    await waitFor(() => expect(copy()).toBeDefined());
    // Vite's HMR rewrites a <style>: the copy follows.
    sheet.textContent = '.x{color:blue}';
    await waitFor(() => expect(copy()?.textContent).toBe('.x{color:blue}'));
    // A new sheet arrives; a removed one leaves.
    const extra = document.createElement('style');
    extra.setAttribute('data-test-sheet', '');
    extra.textContent = '.y{color:green}';
    document.head.appendChild(extra);
    await waitFor(() => expect(Array.from(head.querySelectorAll('style')).some((s) => s.textContent === '.y{color:green}')).toBe(true));
    extra.remove();
    await waitFor(() => expect(Array.from(head.querySelectorAll('style')).some((s) => s.textContent === '.y{color:green}')).toBe(false));
    // A viewport meta of the device's width.
    expect(head.querySelector('meta[name="viewport"]')).toHaveAttribute('content', 'width=390, initial-scale=1');
  });

  it('without a frame document (some test browsers), the preview renders inline at the device width', async () => {
    const spy = vi.spyOn(HTMLIFrameElement.prototype, 'contentDocument', 'get').mockReturnValue(null);
    try {
      const { previewRef } = renderPane('mobile');
      expect(await screen.findByText('Hola familias')).toBeInTheDocument();
      expect(frameOf()).toBeNull();
      expect(previewRef.current).toHaveStyle({ width: '390px' });
    } finally {
      spy.mockRestore();
    }
  });
});
