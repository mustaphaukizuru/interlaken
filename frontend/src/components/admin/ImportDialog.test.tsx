import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-hot-toast', () => ({ default: { loading: vi.fn(() => 't1'), success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/api', async () => ({
  ...(await vi.importActual<typeof import('@/services/dataOps')>('@/services/dataOps')),
  downloadBlob: vi.fn(),
}));

import { downloadBlob, type ImportApi, type ImportReport } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';
import { ImportDialog } from './ImportDialog';

const dryRun: ImportReport = {
  dry_run: true, total_rows: 3,
  counts: { crear: 1, actualizar: 1, omitir: 0, error: 1 },
  rows: [
    { line: 2, key: '09932', action: 'crear', errors: [], warnings: [], data: {} },
    { line: 3, key: '09938', action: 'actualizar', errors: [], warnings: ['CURP sin validar'], data: {} },
    { line: 4, key: '09932', action: 'error', errors: ['Duplicado de la fila 2'], warnings: [], data: {} },
  ],
};
const committed: ImportReport = { ...dryRun, dry_run: false, counts: { crear: 1, actualizar: 1, omitir: 1, error: 0 }, audit_id: 77 };

const csv = new File(['matricula,nombre\n09932,Ana\n'], 'alumnos.csv', { type: 'text/csv' });
const blob = new Blob(['x']);

function makeApi(): ImportApi {
  return {
    template: vi.fn(async () => ({ data: blob }) as never),
    upload: vi.fn(async (_file: File, opts) => {
      if (opts.report) return { data: blob } as never;
      return { data: opts.dryRun ? dryRun : committed } as never;
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  stubViewport(1280);
});

describe('ImportDialog', () => {
  it('downloads the CSV and Excel templates', async () => {
    const api = makeApi();
    renderWithProviders(<ImportDialog open onClose={() => {}} title="Importar alumnos" entity="students" api={api} />);
    await userEvent.click(screen.getByRole('button', { name: 'Descargar plantilla CSV' }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(blob, 'plantilla_students.csv'));
    await userEvent.click(screen.getByRole('button', { name: 'Descargar plantilla Excel' }));
    await waitFor(() => expect(api.template).toHaveBeenLastCalledWith('xlsx'));
    expect(downloadBlob).toHaveBeenLastCalledWith(blob, 'plantilla_students.xlsx');
  });

  it('rejects the wrong extension and files over 5 MB before uploading', async () => {
    const api = makeApi();
    renderWithProviders(<ImportDialog open onClose={() => {}} title="Importar" entity="students" api={api} />);
    const input = screen.getByLabelText(/Elegir archivo/) as HTMLInputElement;
    expect(input).toHaveAttribute('accept', '.csv,.xlsx');
    // user-event honours `accept` by default; bypass it to exercise the client-side check.
    await userEvent.upload(input, new File(['x'], 'lista.txt'), { applyAccept: false });
    expect(await screen.findByRole('alert')).toHaveTextContent('Formato no admitido: use un archivo .csv o .xlsx.');
    const big = new File([new ArrayBuffer(5 * 1024 * 1024 + 1)], 'grande.xlsx');
    await userEvent.upload(input, big, { applyAccept: false });
    expect(await screen.findByRole('alert')).toHaveTextContent('El archivo pesa 5 MB; el límite es 5 MB.');
    expect(api.upload).not.toHaveBeenCalled();
  });

  it('runs the dry run, shows the rows with result chips, downloads the error report and commits only valid rows', async () => {
    const api = makeApi();
    const onImported = vi.fn();
    renderWithProviders(<ImportDialog open onClose={() => {}} title="Importar alumnos" entity="students" api={api} onImported={onImported} />);

    await userEvent.upload(screen.getByLabelText(/Elegir archivo/), csv);
    await waitFor(() => expect(api.upload).toHaveBeenCalledWith(csv, { dryRun: true }));

    // Step 2: table + counts + chips.
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByText('Duplicado de la fila 2')).toBeInTheDocument();
    expect(within(table).getByText('CURP sin validar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Error (1)' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Error (1)' }));
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: 'Descargar reporte de errores' }));
    await waitFor(() => expect(api.upload).toHaveBeenLastCalledWith(csv, { dryRun: true, report: 'csv' }));
    expect(downloadBlob).toHaveBeenCalledWith(blob, 'reporte_students.csv');

    // Step 3: confirm is gated behind "solo las filas válidas" while errors exist.
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByText(/Se crearán/)).toHaveTextContent('Se crearán 1 y se actualizarán 1 registros; 1 con error.');
    const importBtn = screen.getByRole('button', { name: 'Importar 2 filas' });
    expect(importBtn).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Importar solo las filas válidas (2)' }));
    expect(importBtn).toBeEnabled();
    await userEvent.click(importBtn);
    await waitFor(() => expect(api.upload).toHaveBeenLastCalledWith(csv, { dryRun: false, validOnly: true }));

    // Step 4: summary + audit link.
    expect(await screen.findByRole('status')).toHaveTextContent('Importación completa: 1 creados, 1 actualizados, 1 omitidos.');
    expect(screen.getByRole('link', { name: 'Ver en auditoría' })).toHaveAttribute('href', '/admin/auditoria');
    expect(onImported).toHaveBeenCalledWith(committed);
  });

  it('accepts a dropped file (native drag-and-drop)', async () => {
    const api = makeApi();
    renderWithProviders(<ImportDialog open onClose={() => {}} title="Importar" entity="students" api={api} />);
    const zone = screen.getByTestId('dropzone');
    const dt = { files: [csv] } as unknown as DataTransfer;
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.dragEnter(zone, { dataTransfer: dt });
    fireEvent.drop(zone, { dataTransfer: dt });
    await waitFor(() => expect(api.upload).toHaveBeenCalledWith(csv, { dryRun: true }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('adds entity columns to the preview (extraColumns)', async () => {
    const api = makeApi();
    renderWithProviders(
      <ImportDialog open onClose={() => {}} title="Ajuste masivo" entity="cafeteria-balances" api={api}
        extraColumns={[{ id: 'saldo', header: 'Saldo resultante', cell: (r) => `saldo-${r.line}` }]} />,
    );
    await userEvent.upload(screen.getByLabelText(/Elegir archivo/) as HTMLInputElement, csv);
    expect(await screen.findByRole('columnheader', { name: 'Saldo resultante' })).toBeInTheDocument();
    expect(screen.getByText('saldo-2')).toBeInTheDocument();
  });
});
