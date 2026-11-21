import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import AdminRequiredDocs from './AdminRequiredDocs';
import { api } from '@/services/api';
import type { RequiredDoc } from '@/hooks/queries/requiredDocs';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

const ALL = ['preescolar', 'primaria', 'secundaria'] as RequiredDoc['levels'];
const row = (id: number, key: string, name: string, levels: RequiredDoc['levels'], extra: Partial<RequiredDoc> = {}): RequiredDoc => ({
  id, key, name, description: '', physical_note: '', levels, kind: 'upload', multiple_files: false,
  link_url: '', link_label: '', active: true, order: id, upload_count: 0, created_at: '', updated_at: '', ...extra,
});
const LIST: RequiredDoc[] = [
  row(1, 'ficha', 'Ficha de inscripción', ALL, { kind: 'ficha' }),
  row(2, 'acta-nacimiento', 'Acta de nacimiento', ALL, { physical_note: 'Original y 2 copias', upload_count: 3 }),
  row(3, 'cartilla-vacunacion', 'Cartilla de vacunación', ['preescolar'], { multiple_files: true }),
  row(4, 'constancia-no-adeudo', 'Constancia de no adeudo', ['primaria', 'secundaria']),
];

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const patch = vi.mocked(api.patch);
const del = vi.mocked(api.delete);

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: LIST } as never);
});

const render = () => renderWithProviders(<AdminRequiredDocs />, { route: '/admin/admisiones/documentos' });
const card = (name: string) => screen.getByRole('heading', { name }).closest('li') as HTMLElement;

describe('AdminRequiredDocs', () => {
  it('lists every document with its levels, en físico note and per-level counts', async () => {
    render();
    expect(await screen.findByRole('heading', { name: 'Acta de nacimiento' })).toBeInTheDocument();
    expect(within(card('Acta de nacimiento')).getByText('Original y 2 copias')).toBeInTheDocument();
    expect(within(card('Acta de nacimiento')).getByText('3 archivos de familias')).toBeInTheDocument();
    expect(within(card('Cartilla de vacunación')).getByText('Varios archivos')).toBeInTheDocument();
    const summary = screen.getByRole('complementary', { name: 'Resumen por nivel' });
    expect(within(summary).getByText('Preescolar').nextSibling).toHaveTextContent('3 documentos');
    expect(within(summary).getByText('Primaria').nextSibling).toHaveTextContent('3 documentos');
    // Delete only where no family uploaded and never for the ficha.
    expect(screen.queryByRole('button', { name: 'Eliminar Acta de nacimiento' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar Ficha de inscripción' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eliminar Constancia de no adeudo' })).toBeInTheDocument();
  });

  it('filters by level', async () => {
    render();
    await screen.findByRole('heading', { name: 'Acta de nacimiento' });
    await userEvent.click(screen.getByRole('button', { name: /Primaria/ }));
    expect(screen.getByRole('button', { name: /Primaria/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('heading', { name: 'Cartilla de vacunación' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Constancia de no adeudo' })).toBeInTheDocument();
  });

  it('moves a document down, sending the whole order', async () => {
    post.mockResolvedValue({ data: LIST } as never);
    render();
    await screen.findByRole('heading', { name: 'Acta de nacimiento' });
    expect(screen.getByRole('button', { name: 'Subir Ficha de inscripción' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Bajar Acta de nacimiento' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admissions/admin/required-documents/reorder/', { ids: [1, 3, 2, 4] }));
  });

  it('in a level view a move swaps with the neighbour shown', async () => {
    post.mockResolvedValue({ data: LIST } as never);
    render();
    await screen.findByRole('heading', { name: 'Acta de nacimiento' });
    await userEvent.click(screen.getByRole('button', { name: /Primaria/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Subir Constancia de no adeudo' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admissions/admin/required-documents/reorder/', { ids: [1, 4, 3, 2] }));
  });

  it('adds a document, checking name and levels inline', async () => {
    post.mockResolvedValue({ data: row(5, 'carta', 'Carta de buena conducta', ['secundaria']) } as never);
    render();
    await screen.findByRole('heading', { name: 'Acta de nacimiento' });
    await userEvent.click(screen.getAllByRole('button', { name: /Agregar documento/ })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Agregar documento' });
    for (const label of ['Preescolar', 'Primaria', 'Secundaria']) {
      await userEvent.click(within(dialog).getByRole('checkbox', { name: label }));
    }
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar documento' }));
    expect(within(dialog).getByText('Escriba el nombre del documento.')).toBeInTheDocument();
    expect(within(dialog).getByText('Elija al menos un nivel.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Carta de buena conducta' } });
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Secundaria' }));
    fireEvent.change(within(dialog).getByLabelText('En físico (opcional)'), { target: { value: 'Original' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar documento' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admissions/admin/required-documents/', expect.objectContaining({
      name: 'Carta de buena conducta', levels: ['secundaria'], physical_note: 'Original', active: true,
    })));
  });

  it('shows the server field errors in the form', async () => {
    patch.mockRejectedValue({ response: { status: 400, data: { link_url: ['Introduzca una URL válida.'] } } });
    render();
    await screen.findByRole('heading', { name: 'Acta de nacimiento' });
    await userEvent.click(screen.getByRole('button', { name: 'Editar Acta de nacimiento' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar documento' });
    expect(within(dialog).getByLabelText('Nombre')).toHaveValue('Acta de nacimiento');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    expect(await within(dialog).findByText('Introduzca una URL válida.')).toBeInTheDocument();
  });

  it('hides a document and deletes one after confirming', async () => {
    patch.mockResolvedValue({ data: { ...LIST[2], active: false } } as never);
    del.mockResolvedValue({ data: null } as never);
    render();
    await screen.findByRole('heading', { name: 'Acta de nacimiento' });
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar Cartilla de vacunación' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admissions/admin/required-documents/3/', { active: false }));

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar Constancia de no adeudo' }));
    const confirm = await screen.findByRole('dialog', { name: 'Eliminar documento' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Eliminar documento' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/admissions/admin/required-documents/4/'));
  });

  it('has empty and error states', async () => {
    get.mockResolvedValueOnce({ data: [] } as never);
    const { unmount } = render();
    expect(await screen.findByText('Sin documentos')).toBeInTheDocument();
    unmount();
    get.mockRejectedValueOnce(new Error('down'));
    render();
    expect(await screen.findByText(/No se pudo cargar la información/)).toBeInTheDocument();
  });
});
