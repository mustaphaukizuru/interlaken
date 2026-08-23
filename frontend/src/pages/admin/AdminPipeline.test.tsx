import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import AdminPipeline, { docsLabel } from './AdminPipeline';

vi.mock('@/services/api', () => ({
  admissionsApi: {
    pipeline: vi.fn().mockResolvedValue({ data: { templates: { missing_docs: 'x' }, columns: [
      { status: 'submitted', label: 'Enviado', cards: [{ id: 1, child_name: 'Ana López', level: 'primaria', grade_applying: '1° Primaria', parent_name: 'María', parent_email: 'm@x.mx', parent_phone: '5512345678', status: 'submitted', submitted_at: null, updated_at: '', docs_verified: 1, docs_required: 6, missing: ['CURP', 'Fotografía', 'Boleta Anterior'], student: null }] },
      { status: 'reviewing', label: 'En Revisión', cards: [] },
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
    expect(screen.getByText('Expediente completo')).toBeInTheDocument();
  });
});
