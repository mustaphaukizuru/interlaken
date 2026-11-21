import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { renderWithProviders } from '@/test/renderWithProviders';
import { DocumentChecklist } from './DocumentChecklist';
import { api } from '@/services/api';
import type { Checklist, ChecklistItem } from '@/hooks/queries/requiredDocs';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

const item = (o: Partial<ChecklistItem> & Pick<ChecklistItem, 'key' | 'name' | 'status'>): ChecklistItem => ({
  id: 1, description: '', physical_note: '', kind: 'upload', multiple_files: false, link_url: '', link_label: '',
  status_label: '', satisfied: false, reasons: [], files: [], manual: null, can_upload: true, ...o,
});
const file = (id: number, filename: string, status: 'pending' | 'approved' | 'rejected', review_note = '') => ({
  id, required_key: null, doc_type: 'other', filename, file_size: 2_400_000, uploaded_at: '2026-11-02T10:00:00Z', status, review_note,
  download_url: `/api/v1/admissions/documents/${id}/download/`,
});

const CHECKLIST: Checklist = {
  registration: 9, child_name: 'Sofía Ruiz', level: 'primaria', level_label: 'Primaria', ficha_submitted: true,
  items: [
    item({ key: 'ficha', name: 'Ficha de inscripción', kind: 'ficha', status: 'aprobado', satisfied: true, can_upload: false }),
    item({ key: 'acta-nacimiento', name: 'Acta de nacimiento', physical_note: 'Original y 2 copias', status: 'en_revision', files: [file(44, 'acta.pdf', 'pending')] }),
    item({ key: 'curp-alumno', name: 'CURP del alumno', status: 'rechazado', reasons: ['Borrosa'], files: [file(45, 'curp.jpg', 'rejected', 'Borrosa')] }),
    item({ key: 'boleta-sep', name: 'Boleta de la SEP', status: 'entregado_fisico', satisfied: true,
      manual: { state: 'entregado_fisico', state_label: 'Entregado en físico', note: 'Original cotejado', updated_by: 'Ana Admin', updated_at: '2026-11-03T10:00:00Z' } }),
    item({ key: 'ine-padres', name: 'INE de papá y mamá', status: 'falta' }),
  ],
  other_files: [],
  counts: { total: 5, done: 2, approved: 1, physical: 1, not_applicable: 0, in_review: 1, rejected: 1, missing: 1 },
  complete: false,
  missing: ['CURP del alumno (por corregir: Borrosa)', 'INE de papá y mamá'],
  parent_name: 'María Ruiz', parent_email: 'maria@test.mx', whatsapp_phone: '525511111111',
};

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const put = vi.mocked(api.put);
const patch = vi.mocked(api.patch);
const del = vi.mocked(api.delete);

beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation(async (url: string) => {
    if (url.endsWith('/download/')) return { data: new Blob(['pdf']) } as never;
    return { data: CHECKLIST } as never;
  });
});
afterEach(() => vi.unstubAllGlobals());

const render = () => renderWithProviders(<DocumentChecklist registrationId={9} />, { route: '/admin/admisiones' });
const row = (name: string) => screen.getByText(name, { selector: 'p' }).closest('li') as HTMLElement;

describe('DocumentChecklist', () => {
  it('shows each document with an icon-and-words status, the progress and the paper note', async () => {
    render();
    expect(await screen.findByText('Documentos · Primaria')).toBeInTheDocument();
    expect(screen.getByText('2 de 5')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Documentos listos' })).toHaveAttribute('aria-valuenow', '2');
    // The document's chip and its file both say it.
    expect(within(row('Acta de nacimiento')).getAllByText('En revisión')).toHaveLength(2);
    expect(within(row('Acta de nacimiento')).getByText(/En físico: Original y 2 copias/)).toBeInTheDocument();
    expect(within(row('CURP del alumno')).getByText('Motivo: Borrosa')).toBeInTheDocument();
    expect(within(row('Boleta de la SEP')).getByText('Original cotejado')).toBeInTheDocument();
    expect(within(row('Boleta de la SEP')).getByText(/por Ana Admin/)).toBeInTheDocument();
    expect(within(row('INE de papá y mamá')).getByText('Falta')).toBeInTheDocument();
  });

  it('approves a file and needs a reason to reject one', async () => {
    patch.mockResolvedValue({ data: {} } as never);
    render();
    await screen.findByText('Documentos · Primaria');
    await userEvent.click(screen.getByRole('button', { name: 'Aprobar acta.pdf' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admissions/documents/44/verify/', { status: 'approved', review_note: '' }));

    await userEvent.click(screen.getByRole('button', { name: 'Rechazar acta.pdf' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rechazar: Acta de nacimiento' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rechazar y avisar' }));
    expect(within(dialog).getByText(/Escriba el motivo/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Motivo del rechazo'), { target: { value: 'Falta una hoja' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rechazar y avisar' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admissions/documents/44/verify/', { status: 'rejected', review_note: 'Falta una hoja' }));
  });

  it('marks «Entregado en físico» with a note and clears a mark', async () => {
    put.mockResolvedValue({ data: CHECKLIST } as never);
    del.mockResolvedValue({ data: CHECKLIST } as never);
    render();
    await screen.findByText('Documentos · Primaria');
    await userEvent.click(within(row('INE de papá y mamá')).getByRole('button', { name: /Entregado en físico/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Marcar como entregado en físico' });
    fireEvent.change(within(dialog).getByLabelText('Nota (opcional)'), { target: { value: 'Copias de ambos' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Marcar entregado' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/admissions/admin/register/9/checklist/ine-padres/state/', { state: 'entregado_fisico', note: 'Copias de ambos' }));

    await userEvent.click(within(row('Boleta de la SEP')).getByRole('button', { name: /Quitar marca/ }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/admissions/admin/register/9/checklist/boleta-sep/state/'));
  });

  it('sends the email reminder', async () => {
    post.mockResolvedValue({ data: { channel: 'email', sent_to: 'maria@test.mx', missing: CHECKLIST.missing, text: 'x' } } as never);
    render();
    await userEvent.click(await screen.findByRole('button', { name: /Por correo/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admissions/admin/register/9/checklist/reminder/', { channel: 'email' }));
    expect(toast.success).toHaveBeenCalledWith('Recordatorio enviado a maria@test.mx.');
  });

  it('prepares the WhatsApp reminder and opens wa.me with the text', async () => {
    const text = 'Hola María Ruiz:\n\nNos falta recibir:\n• INE de papá y mamá';
    post.mockResolvedValue({ data: { channel: 'whatsapp', sent_to: '', missing: CHECKLIST.missing, text, whatsapp_text: text, whatsapp_phone: '525511111111' } } as never);
    render();
    await userEvent.click(await screen.findByRole('button', { name: /Por WhatsApp/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Recordatorio por WhatsApp' });
    expect(within(dialog).getByText(/Nos falta recibir/)).toBeInTheDocument();
    const link = within(dialog).getByRole('link', { name: /Abrir WhatsApp/ });
    expect(link.getAttribute('href')).toBe(`https://wa.me/525511111111?text=${encodeURIComponent(text)}`);
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('turns the reminder off when nothing is missing and says the file is complete', async () => {
    get.mockResolvedValue({ data: { ...CHECKLIST, complete: true, missing: [], counts: { ...CHECKLIST.counts, done: 5 } } } as never);
    render();
    expect(await screen.findByText('Expediente completo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Por correo/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Por WhatsApp/ })).toBeDisabled();
  });

  it('downloads through the authenticated endpoint', async () => {
    const createObjectURL = vi.fn(() => 'blob:acta');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Descargar acta.pdf' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/admissions/documents/44/download/', { responseType: 'blob' }));
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:acta'));
  });

  it('shows an error state with retry', async () => {
    get.mockRejectedValueOnce(new Error('down'));
    render();
    expect(await screen.findByText('No se pudieron cargar los documentos')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Reintentar/ }));
    expect(await screen.findByText('Documentos · Primaria')).toBeInTheDocument();
  });
});
