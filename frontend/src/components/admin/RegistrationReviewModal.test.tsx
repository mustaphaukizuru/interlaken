import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  api: { post: vi.fn(), get: vi.fn() },
  admissionsAdminApi: {
    getRegistration: vi.fn(),
    updateRegistrationStatus: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

// The documents block is its own component (Fase 4), tested in DocumentChecklist.test.tsx.
vi.mock('@/components/admin/admissions/DocumentChecklist', () => ({
  DocumentChecklist: ({ registrationId }: { registrationId: number }) => <div data-testid="checklist">Documentos de {registrationId}</div>,
}));

import toast from 'react-hot-toast';
import { RegistrationReviewModal } from './RegistrationReviewModal';
import { admissionsAdminApi, api } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import fichaSchema from '@/components/admissions/ficha/fixtures/schema.json';

const getRegistration = vi.mocked(admissionsAdminApi.getRegistration);
const updateStatus = vi.mocked(admissionsAdminApi.updateRegistrationStatus);
const toastSuccess = vi.mocked(toast.success);
const apiGet = vi.mocked(api.get);
const toastError = vi.mocked(toast.error);

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
  documents: [],
};

function renderModal(onClose = vi.fn()) {
  renderWithProviders(
    <RegistrationReviewModal id={9} open onClose={onClose} />,
    { route: '/admin/admisiones' },
  );
  return onClose;
}

describe('RegistrationReviewModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRegistration.mockResolvedValue({ data: baseReg } as never);
    // The staff-only review endpoint carries «Notas internas».
    apiGet.mockResolvedValue({ data: { id: 9, status: 'submitted', admin_notes: '' } } as never);
    updateStatus.mockResolvedValue({ data: {} } as never);
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

  it('shows the documents checklist of the registration', async () => {
    renderModal();
    expect(await screen.findByTestId('checklist')).toHaveTextContent('Documentos de 9');
  });

  it('saves status and notes, then closes on success', async () => {
    const onClose = renderModal();
    await screen.findByText('Consentimientos');

    fireEvent.change(screen.getByLabelText(/Estado de la revisión/i), {
      target: { value: 'approved' },
    });
    await waitFor(() => expect(screen.getByLabelText(/Notas internas/i)).toBeEnabled());
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
  it('offers only the allowed review moves and asks a reason for a reverse move', async () => {
    getRegistration.mockResolvedValue({ data: { ...baseReg, status: 'approved' } } as never);
    renderModal();
    const select = await screen.findByLabelText(/Estado de la revisión/i);
    const values = Array.from((select as HTMLSelectElement).options).map((o) => o.value);
    expect(values).toEqual(['reviewing', 'approved']);
    fireEvent.change(select, { target: { value: 'reviewing' } });
    const save = screen.getByRole('button', { name: /Guardar revisión/i });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Motivo del cambio/i), { target: { value: 'Falta firma' } });
    await userEvent.click(save);
    await waitFor(() => {
      expect(updateStatus).toHaveBeenCalledWith(9, { status: 'reviewing', note: 'Falta firma' });
    });
  });

  it('can skip the family email when approving', async () => {
    renderModal();
    fireEvent.change(await screen.findByLabelText(/Estado de la revisión/i), { target: { value: 'approved' } });
    await userEvent.click(screen.getByRole('checkbox', { name: /Notificar a la familia/i }));
    await userEvent.click(screen.getByRole('button', { name: /Guardar revisión/i }));
    await waitFor(() => {
      expect(updateStatus).toHaveBeenCalledWith(9, { status: 'approved', notify: false });
    });
  });

  // Launch review #5: the box started empty (the applicant detail has no notes),
  // and every «Guardar revisión» sent admin_notes: '' over a colleague's notes.
  it('shows the saved internal notes and keeps them when only the status changes', async () => {
    apiGet.mockResolvedValue({ data: { id: 9, status: 'submitted', admin_notes: 'Llamar el lunes' } } as never);
    renderModal();
    expect(await screen.findByDisplayValue('Llamar el lunes')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/admissions/register/9/status/');

    fireEvent.change(screen.getByLabelText(/Estado de la revisión/i), { target: { value: 'approved' } });
    await userEvent.click(screen.getByRole('button', { name: /Guardar revisión/i }));

    await waitFor(() => expect(updateStatus).toHaveBeenCalled());
    expect(updateStatus.mock.calls[0][1]).not.toHaveProperty('admin_notes');
  });

  it('does not let the notes be typed over (nor sent) when they could not be loaded', async () => {
    apiGet.mockRejectedValue(new Error('down'));
    renderModal();
    expect(await screen.findByText(/No se pudieron cargar las notas guardadas/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Notas internas/i)).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: /Guardar revisión/i }));
    await waitFor(() => expect(updateStatus).toHaveBeenCalled());
    expect(updateStatus.mock.calls[0][1]).not.toHaveProperty('admin_notes');
  });

  it('a ficha (version 2) shows its sections grouped like the Excel instead of the old summary', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/admissions/ficha/schema/') return { data: fichaSchema } as never;
      if (url === '/admissions/register/9/ficha/') {
        return { data: {
          id: 9, status: 'submitted', ficha_version: 2, editable: true, child_name: 'Sofía Ruiz', medical_masked: true,
          sections: { alumno: { child_given_names: 'Sofía', child_paternal_surname: 'Ruiz' }, padre: { not_applicable: true }, madre: {}, domicilio: {}, salud: {}, emergencia: {}, contacto: {} },
          firma: { signed_name: 'María Ruiz', signed_at: '2026-08-01T15:31:00Z', consent_photos_media: false, privacy_accepted_at: null, privacy_notice_version: '' },
          completeness: { sections: {}, complete: true },
        } } as never;
      }
      return { data: { id: 9, status: 'submitted', admin_notes: '' } } as never;
    });
    renderModal();
    expect(await screen.findByRole('heading', { name: 'Datos del alumno' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Datos del padre' }).closest('section')).toHaveTextContent('No aplica');
    expect(screen.getByText(/Datos de salud protegidos/)).toBeInTheDocument();
    expect(screen.getByText('María Ruiz')).toBeInTheDocument();
    // The old one-line summary is gone; consents and documents stay.
    expect(screen.queryByText('Tutor principal')).not.toBeInTheDocument();
    expect(screen.getByText('Consentimientos')).toBeInTheDocument();
  });
});
