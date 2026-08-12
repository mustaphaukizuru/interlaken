import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  admissionsAdminApi: {
    getRegistration: vi.fn(),
    updateRegistrationStatus: vi.fn(),
    verifyDocument: vi.fn(),
    downloadDocument: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

import toast from 'react-hot-toast';
import { RegistrationReviewModal } from './RegistrationReviewModal';
import { admissionsAdminApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const getRegistration = vi.mocked(admissionsAdminApi.getRegistration);
const updateStatus = vi.mocked(admissionsAdminApi.updateRegistrationStatus);
const verifyDocument = vi.mocked(admissionsAdminApi.verifyDocument);
const downloadDocument = vi.mocked(admissionsAdminApi.downloadDocument);
const toastSuccess = vi.mocked(toast.success);
const toastError = vi.mocked(toast.error);

const DOC = {
  id: 44,
  doc_type: 'birth_cert',
  filename: 'acta.pdf',
  is_verified: false,
  download_url: '/api/docs/44',
};

const baseReg = {
  id: 9,
  child_first_name: 'Sofía',
  child_last_name: 'Ruiz',
  child_dob: '2019-03-12',
  child_curp: '',
  child_nationality: 'MX',
  level: 'preescolar',
  grade_applying: '3° Preescolar',
  cycle: '2026-2027',
  parent1_name: 'María Ruiz',
  parent1_email: 'maria@test.mx',
  parent1_phone: '5511111111',
  parent1_occupation: '',
  parent2_name: '',
  parent2_email: '',
  parent2_phone: '',
  emergency_name: '',
  emergency_phone: '',
  emergency_rel: '',
  blood_type: 'O+',
  allergies: null,
  medical_notes: null,
  estatura: '1.10 m',
  peso: null,
  consent_medical_data: true,
  consent_photos_media: false,
  privacy_accepted_at: '2026-08-01T15:30:00Z',
  privacy_notice_version_label: '2026.1',
  status: 'submitted',
  submitted_at: '2026-08-01T15:31:00Z',
  admin_notes: '',
  documents: [] as typeof DOC[],
};

function renderModal(onClose = vi.fn()) {
  renderWithProviders(
    <RegistrationReviewModal id={9} open onClose={onClose} />,
    { route: '/admin/admisiones' },
  );
  return onClose;
}

describe('RegistrationReviewModal', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    getRegistration.mockResolvedValue({ data: baseReg } as never);
    updateStatus.mockResolvedValue({ data: {} } as never);
    verifyDocument.mockResolvedValue({ data: {} } as never);
    createObjectURL = vi.fn(() => 'blob:acta');
    revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows privacy, photo, and medical consent evidence for staff review', async () => {
    renderModal();

    expect(await screen.findByText('Consentimientos')).toBeInTheDocument();
    expect(screen.getByText('Aviso de Privacidad')).toBeInTheDocument();
    expect(screen.getByText(/v2026\.1/)).toBeInTheDocument();
    expect(screen.getByText('Fotos y medios')).toBeInTheDocument();
    expect(screen.getByText('No autorizado')).toBeInTheDocument();
    expect(screen.getByText('Datos de salud')).toBeInTheDocument();
    expect(screen.getByText('Autorizado')).toBeInTheDocument();
    expect(screen.getByText(/Estatura: 1\.10 m/)).toBeInTheDocument();
  });

  it('shows ErrorState with retry when the registration fails to load', async () => {
    getRegistration.mockRejectedValueOnce(new Error('network'));
    getRegistration.mockResolvedValue({ data: baseReg } as never);

    renderModal();

    expect(await screen.findByText(/No se pudo cargar la información/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Reintentar/i }));
    expect(await screen.findByText('Consentimientos')).toBeInTheDocument();
  });

  it('shows empty-documents copy when none are attached', async () => {
    renderModal();

    expect(await screen.findByText(/Documentos \(0\/0 verificados\)/i)).toBeInTheDocument();
    expect(screen.getByText('Sin documentos adjuntos.')).toBeInTheDocument();
  });

  it('lists documents and toggles verification', async () => {
    getRegistration.mockResolvedValue({
      data: { ...baseReg, documents: [DOC] },
    } as never);

    renderModal();

    expect(await screen.findByText('Acta de Nacimiento')).toBeInTheDocument();
    expect(screen.getByText(/· acta\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/Documentos \(0\/1 verificados\)/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^Verificar$/i }));
    await waitFor(() => {
      expect(verifyDocument).toHaveBeenCalledWith(44, true);
    });
  });

  it('downloads a document via authenticated blob and revokes the object URL', async () => {
    getRegistration.mockResolvedValue({
      data: { ...baseReg, documents: [DOC] },
    } as never);
    downloadDocument.mockResolvedValue({
      data: new Blob(['pdf'], { type: 'application/pdf' }),
    } as never);

    const click = vi.fn();
    const appendChild = vi.spyOn(document.body, 'appendChild');
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag);
      if (tag === 'a') {
        Object.defineProperty(el, 'click', { value: click });
      }
      return el;
    });

    renderModal();
    await screen.findByText('Acta de Nacimiento');
    await userEvent.click(screen.getByRole('button', { name: /Descargar acta\.pdf/i }));

    await waitFor(() => {
      expect(downloadDocument).toHaveBeenCalledWith(44);
      expect(createObjectURL).toHaveBeenCalled();
      expect(click).toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:acta');
    });

    appendChild.mockRestore();
  });

  it('toasts when document download fails', async () => {
    getRegistration.mockResolvedValue({
      data: { ...baseReg, documents: [DOC] },
    } as never);
    downloadDocument.mockRejectedValue(new Error('boom'));

    renderModal();
    await screen.findByText('Acta de Nacimiento');
    await userEvent.click(screen.getByRole('button', { name: /Descargar acta\.pdf/i }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('No se pudo descargar el documento.');
    });
  });

  it('saves status and notes, then closes on success', async () => {
    const onClose = renderModal();
    await screen.findByText('Consentimientos');

    fireEvent.change(screen.getByLabelText(/Estado de la revisión/i), {
      target: { value: 'approved' },
    });
    fireEvent.change(screen.getByLabelText(/Notas internas/i), {
      target: { value: 'Expediente completo' },
    });

    await userEvent.click(screen.getByRole('button', { name: /Guardar revisión/i }));

    await waitFor(() => {
      expect(updateStatus).toHaveBeenCalledWith(9, {
        status: 'approved',
        admin_notes: 'Expediente completo',
      });
    });
    expect(toastSuccess).toHaveBeenCalledWith('Inscripción actualizada.');
    expect(onClose).toHaveBeenCalled();
  });

  it('toasts when saving the review fails', async () => {
    updateStatus.mockRejectedValue(new Error('server'));
    const onClose = renderModal();
    await screen.findByText('Consentimientos');

    await userEvent.click(screen.getByRole('button', { name: /Guardar revisión/i }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('No se pudo guardar la revisión.');
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
