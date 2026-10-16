import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import AdminPipeline, { docsLabel } from './AdminPipeline';
import { admissionsApi } from '@/services/api';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/api', () => ({
  admissionsApi: {
    pipeline: vi.fn().mockResolvedValue({ data: { templates: { missing_docs: 'x' }, bounded: true, complete_window_days: 90, columns: [
      { status: 'submitted', label: 'Enviado', cards: [{ id: 1, child_name: 'Ana López', level: 'primaria', grade_applying: '1° Primaria', parent_name: 'María', parent_email: 'm@x.mx', parent_phone: '5512345678', status: 'submitted', submitted_at: null, updated_at: '', docs_verified: 1, docs_required: 6, missing: ['CURP', 'Fotografía', 'Boleta Anterior'], student: null }] },
      { status: 'reviewing', label: 'En Revisión', cards: [{ id: 3, child_name: 'Carla Ruiz', level: 'primaria', grade_applying: '3° Primaria', parent_name: 'Eva', parent_email: 'e@x.mx', parent_phone: '', status: 'reviewing', submitted_at: null, updated_at: '', docs_verified: 6, docs_required: 6, missing: [], student: null }] },
      { status: 'approved', label: 'Aprobado', cards: [{ id: 2, child_name: 'Bruno Soto', level: 'preescolar', grade_applying: '2° Preescolar', parent_name: 'Laura', parent_email: 'l@x.mx', parent_phone: '', status: 'approved', submitted_at: null, updated_at: '', docs_verified: 6, docs_required: 6, missing: [], student: null }] },
      { status: 'complete', label: 'Inscripción Completa', cards: [] },
      { status: 'rejected', label: 'Rechazado', cards: [] },
    ] } }),
    requestDocs: vi.fn(), convert: vi.fn(),
  },
}));
vi.mock('@/hooks/useSiteSettings', () => ({ useSiteSettings: () => ({ contact_email: 'info@x.mx', whatsapp_number: '' }) }));

describe('AdminPipeline', () => {
  it('docsLabel summarises the checklist', () => {
    expect(docsLabel({ docs_verified: 6, docs_required: 6, missing: [] })).toBe('Expediente completo');
    expect(docsLabel({ docs_verified: 1, docs_required: 6, missing: ['CURP', 'Foto', 'Boleta'] })).toBe('Faltan 3: CURP, Foto…');
  });
  it('renders columns with the right actions per status', async () => {
    renderWithProviders(<AdminPipeline />, { route: '/admin/admisiones/pipeline' });
    expect(await screen.findByText('Ana López')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pedir documentos/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Convertir en alumno/ })).toBeInTheDocument();
    expect(screen.getAllByText('Expediente completo').length).toBeGreaterThan(0);
  });
  it('says the board is bounded and links to the full list', async () => {
    renderWithProviders(<AdminPipeline />, { route: '/admin/admisiones/pipeline' });
    expect(await screen.findByText(/completados en los últimos 90 días/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver todos' })).toHaveAttribute('href', '/admin/admisiones?vista=inscripciones');
  });
  it('offers «Convertir» only on approved cards (not «En revisión»)', async () => {
    renderWithProviders(<AdminPipeline />, { route: '/admin/admisiones/pipeline' });
    expect(await screen.findByText('Carla Ruiz')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Convertir en alumno/ })).toHaveLength(1);
  });
  it('lists guardians that were not linked because their email belongs to a non-family account', async () => {
    vi.mocked(admissionsApi.convert).mockResolvedValue({ data: {
      student: 9, student_id: '260002', already: false,
      credentials: [{ email: 'l@x.mx', password: 'Abc123xyz9', name: 'Laura' }],
      unlinked: [{ email: 'maestra@x.mx', name: 'Pedro', reason: 'Ese correo pertenece a una cuenta de «Personal».' }],
    } } as never);
    renderWithProviders(<AdminPipeline />, { route: '/admin/admisiones/pipeline' });
    await userEvent.click(await screen.findByRole('button', { name: /Convertir en alumno/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Crear alumno y cuentas' }));
    const list = await screen.findByRole('list', { name: 'Tutores no vinculados' });
    expect(within(list).getByText(/maestra@x.mx/)).toBeInTheDocument();
    await waitFor(() => expect(admissionsApi.convert).toHaveBeenCalledWith(2, expect.any(Object)));
  });
});
