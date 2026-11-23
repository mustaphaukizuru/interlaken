/** The «Se insertó {{anio}} · Deshacer» pop-up after a token chip (useTokenUndo). */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement, type ReactNode } from 'react';

const shown: { render: (t: { id: string }) => ReactNode; opts: unknown }[] = [];
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn((r: (t: { id: string }) => ReactNode, opts: unknown) => { shown.push({ render: r, opts }); return 'id'; }),
    error: vi.fn(),
    dismiss: vi.fn(),
  },
}));

import toast from 'react-hot-toast';
import { renderWithProviders } from '@/test/renderWithProviders';
import { TextField } from './TextField';
import { withoutToken } from './TokenChips';

function Field({ initial }: { initial: string }) {
  const [v, setV] = useState(initial);
  return <><TextField id="f" label="Estancia: subtítulo" value={v} onChange={setV} /><output data-testid="value">{v}</output></>;
}

/** The toast's content, rendered as react-hot-toast would. */
function lastToast(): ReactElement {
  return shown[shown.length - 1].render({ id: 'cms-token-insert' }) as ReactElement;
}

beforeEach(() => { shown.length = 0; vi.clearAllMocks(); });

describe('token chips: «Deshacer»', () => {
  it('announces the token with today\'s value and takes it out again', async () => {
    renderWithProviders(<Field initial="Precios 2026" />);
    const input = screen.getByLabelText('Estancia: subtítulo') as HTMLInputElement;
    await userEvent.click(input);
    input.setSelectionRange(input.value.length, input.value.length);
    await userEvent.click(screen.getByRole('button', { name: /Insertar Año en curso/ }));
    expect(screen.getByTestId('value')).toHaveTextContent('Precios 2026{{anio}}');
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(shown[0].opts).toMatchObject({ id: 'cms-token-insert', duration: 6000 });

    const year = String(new Date().getFullYear());
    const popup = render(lastToast());
    expect(popup.container).toHaveTextContent(`Se insertó {{anio}} (hoy: ${year}).`);
    await userEvent.click(popup.getByRole('button', { name: 'Deshacer' }));
    await waitFor(() => expect(screen.getByTestId('value')).toHaveTextContent(/^Precios 2026$/));
    expect(toast.dismiss).toHaveBeenCalledWith('cms-token-insert');
  });

  it('undoes the token even after more typing', async () => {
    renderWithProviders(<Field initial="Ciclo " />);
    const input = screen.getByLabelText('Estancia: subtítulo') as HTMLInputElement;
    await userEvent.click(input);
    input.setSelectionRange(input.value.length, input.value.length);
    await userEvent.click(screen.getByRole('button', { name: /Insertar Ciclo escolar/ }));
    await userEvent.type(input, ' abierto');
    expect(screen.getByTestId('value')).toHaveTextContent('Ciclo {{ciclo}} abierto');
    const popup = render(lastToast());
    await act(async () => { await userEvent.click(popup.getByRole('button', { name: 'Deshacer' })); });
    expect(screen.getByTestId('value').textContent).toBe('Ciclo abierto');
  });

  it('removes the occurrence nearest to where it was inserted', () => {
    expect(withoutToken('{{anio}} y {{anio}}', '{{anio}}', 11)).toBe('{{anio}} y ');
    expect(withoutToken('sin datos', '{{anio}}', 0)).toBeNull();
  });
});
