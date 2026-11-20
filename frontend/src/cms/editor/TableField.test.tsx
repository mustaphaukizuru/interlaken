import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FieldSpec } from '../blocks/registry';
import type { TableValue } from '../blocks/table';
import { TableField } from './TableField';
import { BlockForm } from './BlockForm';

vi.mock('@/services/api', () => ({ contentApi: {} }));

const SPEC: FieldSpec = { key: 'table', label: 'Tabla', kind: 'table', required: true, limits: { columns: 3, rows: 4, cell: 300 } };
const START: TableValue = { columns: [{ label: 'Nivel' }, { label: 'Cuota', format: 'money' }], rows: [['Primaria', '6450'], ['Secundaria', '6990']], highlight: null };

function Harness({ onValue }: { onValue?: (v: TableValue) => void }) {
  const [value, setValue] = useState<TableValue>(START);
  return <TableField spec={SPEC} value={value} onChange={(v) => { setValue(v); onValue?.(v); }} />;
}

const lastValue = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1][0] as TableValue;
const cell = (r: number, c: string) => screen.getByLabelText(`Fila ${r}, ${c}`) as HTMLInputElement;

describe('TableField', () => {
  it('edits headers and cells in place', async () => {
    const u = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await u.clear(cell(1, 'Cuota'));
    await u.type(cell(1, 'Cuota'), '7000');
    await u.type(screen.getByLabelText('Encabezado de la columna 1'), ' escolar');
    const last = lastValue(onValue);
    expect(last.rows[0]).toEqual(['Primaria', '7000']);
    expect(last.columns[0].label).toBe('Nivel escolar');
  });

  it('moves like a spreadsheet: Enter and arrows between cells, Alt+↓ moves the row', async () => {
    const u = userEvent.setup();
    render(<Harness />);
    cell(1, 'Nivel').focus();
    await u.keyboard('{Enter}');
    expect(cell(2, 'Nivel')).toHaveFocus();
    await u.keyboard('{ArrowUp}');
    expect(cell(1, 'Nivel')).toHaveFocus();
    cell(1, 'Nivel').setSelectionRange(8, 8);
    await u.keyboard('{ArrowRight}');
    expect(cell(1, 'Cuota')).toHaveFocus();
    fireEvent.keyDown(cell(1, 'Cuota'), { key: 'ArrowDown', altKey: true });
    expect(cell(2, 'Nivel').value).toBe('Primaria');
    expect(cell(1, 'Nivel').value).toBe('Secundaria');
  });

  it('pastes cells copied from Excel, within the limits', () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    fireEvent.paste(cell(2, 'Nivel'), { clipboardData: { getData: () => 'Bachillerato\t7500\textra\textra2\nMaestría\t9000\n' } });
    const v = lastValue(onValue);
    expect(v.rows).toEqual([['Primaria', '6450', ''], ['Bachillerato', '7500', 'extra'], ['Maestría', '9000', '']]);
    expect(v.columns).toHaveLength(3);
    expect(screen.getByRole('status')).toHaveTextContent('Se pegaron 5 celdas; 1 no cupieron');
  });

  it('adds, highlights, reorders and removes rows and columns', async () => {
    const u = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await u.click(screen.getByRole('button', { name: 'Destacar la fila 2' }));
    expect((lastValue(onValue)).highlight).toBe(1);
    await u.click(screen.getByRole('button', { name: 'Subir la fila 2' }));
    expect((lastValue(onValue)).highlight).toBe(0);
    await u.click(screen.getByRole('button', { name: /Fila$/ }));
    await u.click(screen.getByRole('button', { name: /Columna$/ }));
    let v = lastValue(onValue);
    expect(v.rows).toHaveLength(3);
    expect(v.columns).toHaveLength(3);
    expect(screen.getByRole('button', { name: /Columna$/ })).toBeDisabled(); // 3 = limit
    await u.click(screen.getByRole('button', { name: 'Quitar la fila 1' }));
    v = lastValue(onValue);
    expect(v.highlight).toBeNull();
    expect(v.rows[0][0]).toBe('Primaria');
    const columns = screen.getByText('Columnas: formato y alineación').closest('details')!;
    await u.selectOptions(within(columns).getAllByLabelText('Formato')[0], 'percent');
    expect((lastValue(onValue)).columns[0].format).toBe('percent');
    await u.click(within(columns).getByRole('button', { name: 'Quitar la columna 3' }));
    expect((lastValue(onValue)).columns).toHaveLength(2);
  });

  it('is what BlockForm renders for the Tabla block', () => {
    render(<BlockForm block={{ id: 'b1', type: 'table', props: { title: 'Cuotas', table: START } }} onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Tabla *' })).toBeInTheDocument();
    expect(cell(1, 'Nivel').value).toBe('Primaria');
  });
});
