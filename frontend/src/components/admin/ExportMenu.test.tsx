import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-hot-toast', () => ({
  default: { loading: vi.fn(() => 't1'), success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/services/api', async () => ({
  ...(await vi.importActual<typeof import('@/services/dataOps')>('@/services/dataOps')),
  downloadBlob: vi.fn(),
}));

import toast from 'react-hot-toast';
import { downloadBlob } from '@/services/api';
import { ExportMenu } from './ExportMenu';

const blob = new Blob(['a,b'], { type: 'text/csv' });
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('ExportMenu v2', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers CSV / Excel / PDF for the current view and names the file {prefix}_{date}.{ext}', async () => {
    const fetch = vi.fn().mockResolvedValue(blob);
    render(<ExportMenu filenamePrefix="pagos" fetch={fetch} />);
    await userEvent.click(screen.getByRole('button', { name: /Exportar/ }));
    const menu = screen.getByRole('menu', { name: 'Formatos de exportación' });
    expect(menu).toHaveTextContent('CSV');
    expect(menu).toHaveTextContent('Excel');
    expect(menu).toHaveTextContent('PDF');
    expect(screen.queryByRole('menuitemcheckbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: /Excel/ }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(blob, `pagos_${today()}.xlsx`));
    expect(fetch).toHaveBeenCalledWith('xlsx', { selectedOnly: false });
    expect(toast.loading).toHaveBeenCalledWith('Generando Excel…');
    expect(toast.success).toHaveBeenCalledWith('Archivo listo.', { id: 't1' });
  });

  it('adds "Solo seleccionados (N)" when rows are selected and passes it to the fetcher', async () => {
    const fetch = vi.fn().mockResolvedValue(blob);
    render(<ExportMenu filenamePrefix="pagos" fetch={fetch} selectedCount={3} />);
    await userEvent.click(screen.getByRole('button', { name: /Exportar/ }));
    const toggle = screen.getByRole('menuitemcheckbox', { name: 'Solo seleccionados (3)' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('menuitem', { name: /CSV/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('csv', { selectedOnly: true }));
    expect(toast.loading).toHaveBeenCalledWith('Generando CSV (3 seleccionados)…');
  });

  it('shows the server cap message on 413', async () => {
    const fetch = vi.fn().mockRejectedValue({ response: { status: 413, data: { detail: 'Acote los filtros: el límite es 10000 filas.' } } });
    render(<ExportMenu filenamePrefix="pagos" fetch={fetch} formats={['csv', 'xlsx']} />);
    await userEvent.click(screen.getByRole('button', { name: /Exportar/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /CSV/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Acote los filtros: el límite es 10000 filas.', { id: 't1', duration: 8000 }));
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it('renders a single button when one format is offered', async () => {
    const fetch = vi.fn().mockResolvedValue(blob);
    render(<ExportMenu filenamePrefix="auditoria" formats={['csv']} fetch={fetch} />);
    await userEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('csv', { selectedOnly: false }));
  });

  it('forceSelected exports the selection without the toggle (bulk bar)', async () => {
    const fetch = vi.fn().mockResolvedValue(blob);
    render(<ExportMenu label="Exportar seleccionados" filenamePrefix="pagos" fetch={fetch} selectedCount={2} forceSelected />);
    await userEvent.click(screen.getByRole('button', { name: /Exportar seleccionados/ }));
    expect(screen.queryByRole('menuitemcheckbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: /PDF/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('pdf', { selectedOnly: true }));
  });

  it('keeps the v1 options form working', async () => {
    const one = vi.fn().mockResolvedValue(blob);
    render(<ExportMenu options={[{ key: 'x', label: 'Exportar CSV', filename: 'x_{date}.csv', fetch: one }]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(blob, `x_${new Date().toISOString().slice(0, 10)}.csv`));
  });
});
