import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '@/components/ui/Modal';
import { useDirtyCloseGuard, useReportDirty, valuesDiffer } from './useDirtyCloseGuard';

describe('valuesDiffer', () => {
  it('compares values deeply and ignores key order', () => {
    expect(valuesDiffer({ a: 1, b: ['x', { c: '' }] }, { b: ['x', { c: '' }], a: 1 })).toBe(false);
    expect(valuesDiffer({ a: 1 }, { a: 2 })).toBe(true);
    expect(valuesDiffer({ a: [1, 2] }, { a: [2, 1] })).toBe(true);
    expect(valuesDiffer({ a: null }, { a: '' })).toBe(true);
    expect(valuesDiffer({ a: 1 }, { a: 1, b: undefined })).toBe(true);
  });
});

/** The form state lives next to the Modal (the hook gets `dirty` directly). */
function Inline({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const [name, setName] = useState('');
  const close = () => { setOpen(false); onClose(); };
  const guard = useDirtyCloseGuard(close, open && name !== '');
  return (
    <>
      <Modal open={open} onClose={guard.requestClose} title="Nuevo registro">
        <label htmlFor="n">Nombre</label>
        <input id="n" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" onClick={guard.requestClose}>Cancelar</button>
        <button type="button" onClick={close}>Guardar</button>
      </Modal>
      {guard.dialog}
    </>
  );
}

/** The form inside the Modal reports through `useReportDirty`. */
function Reported({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const close = () => { setOpen(false); onClose(); };
  const guard = useDirtyCloseGuard(close);
  return (
    <>
      <Modal open={open} onClose={guard.requestClose} title="Editar">
        <Body onDirty={guard.reportDirty} />
      </Modal>
      {guard.dialog}
    </>
  );
}
function Body({ onDirty }: { onDirty: (d: boolean) => void }) {
  const [note, setNote] = useState('hola');
  useReportDirty(note !== 'hola', onDirty);
  return (
    <>
      <label htmlFor="note">Nota</label>
      <input id="note" value={note} onChange={(e) => setNote(e.target.value)} />
    </>
  );
}

describe('useDirtyCloseGuard', () => {
  it('closes an untouched form without asking', async () => {
    const onClose = vi.fn();
    render(<Inline onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('¿Descartar los cambios?')).toBeNull();
  });

  it('asks before closing with changes; «Seguir editando» keeps them, «Descartar cambios» closes', async () => {
    const onClose = vi.fn();
    render(<Inline onClose={onClose} />);
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana');
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    const ask = screen.getByRole('dialog', { name: '¿Descartar los cambios?' });
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(within(ask).getByRole('button', { name: 'Seguir editando' }));
    expect(screen.queryByRole('dialog', { name: '¿Descartar los cambios?' })).toBeNull();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Ana');

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Descartar cambios' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Escape asks too, and only the question closes on the next Escape', async () => {
    const onClose = vi.fn();
    render(<Inline onClose={onClose} />);
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: '¿Descartar los cambios?' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '¿Descartar los cambios?' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Nuevo registro' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a value typed and put back is not a change', async () => {
    const onClose = vi.fn();
    render(<Inline onClose={onClose} />);
    await userEvent.type(screen.getByLabelText('Nombre'), 'A');
    await userEvent.clear(screen.getByLabelText('Nombre'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a successful save closes directly', async () => {
    const onClose = vi.fn();
    render(<Inline onClose={onClose} />);
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('¿Descartar los cambios?')).toBeNull();
  });

  it('works with a form that reports its own state', async () => {
    const onClose = vi.fn();
    render(<Reported onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks for a reporting form with changes', async () => {
    const onClose = vi.fn();
    render(<Reported onClose={onClose} />);
    await userEvent.type(screen.getByLabelText('Nota'), '!');
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.getByRole('dialog', { name: '¿Descartar los cambios?' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
