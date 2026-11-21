import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', async () => ({
  ...(await vi.importActual<typeof import('@/services/dataOps')>('@/services/dataOps')),
  api: { get: vi.fn() },
  downloadBlob: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({
  default: { loading: vi.fn(() => 't'), success: vi.fn(), error: vi.fn() },
}));

import { api, downloadBlob } from '@/services/api';
import { ExportMenu } from './ExportMenu';
import { FichaRowMenu, FichasZipMenu, StudentFichaDownload } from './FichaDownloads';

const get = vi.mocked(api.get);
const blob = new Blob(['x']);

describe('FichaDownloads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue({ data: blob, headers: { 'content-disposition': 'attachment; filename="Ficha_Ruiz_Luis_2026-2027.pdf"' } } as never);
  });

  it('row menu: «Ficha (Excel)» and «Ficha (PDF)» of that inscripción', async () => {
    const user = userEvent.setup();
    render(<FichaRowMenu id={3} childName="Luis Ruiz" />);
    await user.click(screen.getByRole('button', { name: 'Descargar la ficha de inscripción de Luis Ruiz' }));
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Ficha (Excel)', 'Ficha (PDF)']);
    await user.click(screen.getByRole('menuitem', { name: 'Ficha de Luis Ruiz en PDF' }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(blob, 'Ficha_Ruiz_Luis_2026-2027.pdf'));
    expect(get).toHaveBeenCalledWith('/admissions/register/3/ficha/export/', { params: { fmt: 'pdf' }, responseType: 'blob' });
  });

  it('bulk «Fichas (ZIP)» downloads the selection in the chosen format', async () => {
    const user = userEvent.setup();
    render(<FichasZipMenu ids={[3, 5]} />);
    await user.click(screen.getByRole('button', { name: /Fichas \(ZIP\)/ }));
    await user.click(screen.getByRole('menuitem', { name: /Excel/ }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/admissions/register/fichas/export/', {
      params: { ids: '3,5', fmt: 'xlsx' }, responseType: 'blob',
    }));
  });

  it('the ZIP is off above 50 fichas and for «todas las que coinciden»', () => {
    const many = Array.from({ length: 51 }, (_, i) => i + 1);
    const { rerender } = render(<FichasZipMenu ids={many} />);
    expect(screen.getByRole('button', { name: /Fichas \(ZIP\)/ })).toBeDisabled();
    expect(screen.getByText(/Seleccione hasta 50 fichas/)).toBeInTheDocument();
    rerender(<FichasZipMenu ids={[1, 2]} allMatching />);
    expect(screen.getByRole('button', { name: /Fichas \(ZIP\)/ })).toBeDisabled();
    rerender(<FichasZipMenu ids={[1, 2]} />);
    expect(screen.getByRole('button', { name: /Fichas \(ZIP\)/ })).toBeEnabled();
  });

  it('student file: «Ficha de inscripción» of its registration', async () => {
    const user = userEvent.setup();
    render(<StudentFichaDownload registrationId={12} />);
    await user.click(screen.getByRole('button', { name: /Ficha de inscripción/ }));
    await user.click(screen.getByRole('menuitem', { name: /Excel/ }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/admissions/register/12/ficha/export/', {
      params: { fmt: 'xlsx' }, responseType: 'blob',
    }));
  });

  it('ExportMenu lists extra downloads under the formats', async () => {
    const user = userEvent.setup();
    const run = vi.fn().mockResolvedValue(true);
    render(
      <ExportMenu filenamePrefix="inscripciones" fetch={vi.fn()} selectedCount={2}
        extraItems={[{ key: 'concentrado', label: 'Concentrado de fichas', hint: '.xlsx', run }]} />,
    );
    await user.click(screen.getByRole('button', { name: /Exportar/ }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: /Solo seleccionados/ }));
    expect(screen.getAllByRole('separator')).toHaveLength(2);
    await user.click(screen.getByRole('menuitem', { name: /Concentrado de fichas/ }));
    await waitFor(() => expect(run).toHaveBeenCalledWith({ selectedOnly: true }));
  });
});
