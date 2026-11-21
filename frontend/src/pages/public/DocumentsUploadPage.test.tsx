import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import type { ChecklistItem, FamilyChecklist } from '@/hooks/queries/requiredDocs';

vi.mock('@/services/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  admissionsApi: { exchangeAccess: vi.fn() },
  contentApi: { getPage: vi.fn() },
}));

import DocumentsUploadPage from './DocumentsUploadPage';
import { admissionsApi, api, contentApi } from '@/services/api';

const item = (o: Partial<ChecklistItem> & Pick<ChecklistItem, 'key' | 'name' | 'status'>): ChecklistItem => ({
  id: 1, description: '', physical_note: '', kind: 'upload', multiple_files: false, link_url: '', link_label: '',
  status_label: '', satisfied: ['aprobado', 'entregado_fisico', 'no_aplica'].includes(o.status), reasons: [], files: [],
  manual: null, can_upload: !['aprobado', 'entregado_fisico', 'no_aplica'].includes(o.status), ...o,
});
const file = (id: number, filename: string, status: 'pending' | 'approved' | 'rejected', review_note = '') => ({
  id, required_key: null, doc_type: 'other', filename, file_size: 1000, uploaded_at: '2026-11-02T10:00:00Z', status, review_note, download_url: '',
});

const LIST: FamilyChecklist = {
  registration: 7, child_name: 'Leo Prueba', level: 'preescolar', level_label: 'Preescolar', ficha_submitted: true,
  counts: { total: 5, done: 2, approved: 1, physical: 1, not_applicable: 0, in_review: 0, rejected: 2, missing: 1 },
  complete: false,
  limits: { max_bytes: 10 * 1024 * 1024, extensions: ['.pdf', '.jpg', '.jpeg', '.png'], max_files: 10 },
  items: [
    item({ key: 'ficha', name: 'Ficha de inscripción', kind: 'ficha', status: 'aprobado' }),
    item({ key: 'acta-nacimiento', name: 'Acta de nacimiento', physical_note: 'Original y 2 copias', status: 'entregado_fisico' }),
    item({ key: 'curp-alumno', name: 'CURP del alumno', status: 'rechazado', reasons: ['No se lee'], files: [file(5, 'curp.jpg', 'rejected', 'No se lee')] }),
    item({ key: 'ine-padres', name: 'INE de papá y mamá', multiple_files: true, status: 'rechazado',
      files: [file(8, 'ine-papa.jpg', 'approved'), file(9, 'ine-mama.jpg', 'rejected', 'Falta el reverso')] }),
    item({ key: 'cartilla-vacunacion', name: 'Cartilla de vacunación', description: 'Carátula y esquema.', status: 'falta' }),
  ],
};

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const exchange = vi.mocked(admissionsApi.exchangeAccess);
let n = 0;
let token = '';

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  // exchangeOnce caches per link for the tab: a fresh token per test.
  n += 1;
  token = `tok-${n}-abcdefghijklmnop`;
  vi.mocked(contentApi.getPage).mockRejectedValue({ response: { status: 404 } });
  exchange.mockResolvedValue({ data: { session_token: 'sess-1', expires_at: '2099-01-01T00:00:00Z' } } as never);
  get.mockResolvedValue({ data: LIST } as never);
  post.mockImplementation((async (_url: string, _body: unknown, config?: { onUploadProgress?: (e: { loaded: number; total: number }) => void }) => {
    config?.onUploadProgress?.({ loaded: 50, total: 100 });
    return { data: {} };
  }) as never);
});

const render = () => renderWithProviders(<DocumentsUploadPage />, { route: `/inscripcion/documentos?rid=7&token=${token}` });
const card = (name: string) => screen.getByRole('heading', { name }).closest('li') as HTMLElement;
const pdf = (name = 'doc.pdf', size = 2000) => new File([new Uint8Array(size)], name, { type: 'application/pdf' });

describe('DocumentsUploadPage (family)', () => {
  it('redeems the link once and lists the level with statuses, paper notes and reasons', async () => {
    render();
    expect(await screen.findByRole('heading', { name: 'CURP del alumno' })).toBeInTheDocument();
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(exchange).toHaveBeenCalledWith(7, token);
    expect(get).toHaveBeenCalledWith('/admissions/register/7/documents/list/', { headers: { 'X-Session-Token': 'sess-1' } });
    expect(screen.getByText('Leo Prueba')).toBeInTheDocument();
    expect(screen.getByText('Preescolar')).toBeInTheDocument();
    expect(screen.getByText('2 de 5 documentos listos')).toBeInTheDocument();
    expect(within(card('Ficha de inscripción')).getByText('Enviada')).toBeInTheDocument();
    expect(within(card('Acta de nacimiento')).getByText('Entregado en físico')).toBeInTheDocument();
    expect(within(card('Acta de nacimiento')).getByText('Original y 2 copias')).toBeInTheDocument();
    // Done: nothing to upload there.
    expect(within(card('Acta de nacimiento')).queryByLabelText(/Elegir archivo|Reemplazar/)).not.toBeInTheDocument();
    expect(within(card('CURP del alumno')).getByText('Por corregir')).toBeInTheDocument();
    expect(within(card('CURP del alumno')).getByText('Motivo: No se lee')).toBeInTheDocument();
    expect(within(card('Cartilla de vacunación')).getByText('Falta')).toBeInTheDocument();
  });

  it('uploads with the document key, a progress bar and refreshes the list', async () => {
    render();
    await screen.findByRole('heading', { name: 'Cartilla de vacunación' });
    const input = within(card('Cartilla de vacunación')).getByLabelText('Elegir archivo');
    expect(input).toHaveAttribute('accept', 'image/*,application/pdf');
    await userEvent.upload(input, pdf('cartilla.pdf'));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, body] = post.mock.calls[0] as [string, FormData];
    expect(url).toBe('/admissions/register/7/documents/');
    expect(body.get('required_key')).toBe('cartilla-vacunacion');
    expect((body.get('file') as File).name).toBe('cartilla.pdf');
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('cartilla.pdf: Documento subido.');
  });

  it('checks size and type before sending', async () => {
    render();
    await screen.findByRole('heading', { name: 'Cartilla de vacunación' });
    const input = within(card('Cartilla de vacunación')).getByLabelText('Elegir archivo');
    await userEvent.upload(input, pdf('grande.pdf', 11 * 1024 * 1024));
    expect(await within(card('Cartilla de vacunación')).findByRole('alert')).toHaveTextContent('El archivo grande.pdf supera 10 MB');
    expect(input).toHaveAttribute('aria-describedby', 'doc-error-cartilla-vacunacion');
    expect(post).not.toHaveBeenCalled();
  });

  it('takes several files and replaces a rejected one where the document allows it', async () => {
    render();
    await screen.findByRole('heading', { name: 'INE de papá y mamá' });
    const ine = card('INE de papá y mamá');
    expect(within(ine).getByText('Motivo: Falta el reverso')).toBeInTheDocument();
    const add = within(ine).getByLabelText('Agregar otro archivo');
    expect(add).toHaveAttribute('multiple');
    await userEvent.upload(add, [pdf('a.pdf'), pdf('b.pdf')]);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));

    post.mockClear();
    await userEvent.upload(within(ine).getByLabelText('Reemplazar'), pdf('ine-mama-2.pdf'));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect((post.mock.calls[0][1] as FormData).get('replaces')).toBe('9');
  });

  it('shows the server reason when an upload is refused', async () => {
    post.mockRejectedValue({ response: { status: 400, data: { detail: 'Este documento admite un solo archivo.' } } });
    render();
    await screen.findByRole('heading', { name: 'CURP del alumno' });
    await userEvent.upload(within(card('CURP del alumno')).getByLabelText('Reemplazar'), pdf('curp2.pdf'));
    expect(await within(card('CURP del alumno')).findByText('Este documento admite un solo archivo.')).toBeInTheDocument();
  });

  it('keeps the session for the tab: a reload does not redeem the link again', async () => {
    const { unmount } = render();
    await screen.findByRole('heading', { name: 'CURP del alumno' });
    unmount();
    exchange.mockClear();
    render();
    expect(await screen.findByRole('heading', { name: 'CURP del alumno' })).toBeInTheDocument();
    expect(exchange).not.toHaveBeenCalled();
  });

  it('says the link is used or expired', async () => {
    exchange.mockRejectedValue({ response: { status: 401 } });
    render();
    expect(await screen.findByRole('alert')).toHaveTextContent('Este enlace ya se usó o caducó');
    expect(get).not.toHaveBeenCalled();
  });

  it('offers a retry when the list does not load', async () => {
    get.mockRejectedValueOnce({ response: { status: 500 } });
    render();
    expect(await screen.findByText(/No se pudo cargar la lista de documentos/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Reintentar/ }));
    expect(await screen.findByRole('heading', { name: 'CURP del alumno' })).toBeInTheDocument();
  });

  it('offers the camera on phones', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes('coarse'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      render();
      await screen.findByRole('heading', { name: 'Cartilla de vacunación' });
      const cam = within(card('Cartilla de vacunación')).getByLabelText('Tomar foto');
      expect(cam).toHaveAttribute('capture', 'environment');
      expect(cam).toHaveAttribute('accept', 'image/*');
    } finally {
      window.matchMedia = original;
    }
  });

  it('celebrates calmly when everything is in', async () => {
    get.mockResolvedValue({ data: { ...LIST, complete: true, items: LIST.items.slice(0, 2), counts: { ...LIST.counts, total: 2, done: 2 } } } as never);
    render();
    expect(await screen.findByText('Sus documentos están completos')).toBeInTheDocument();
  });
});
