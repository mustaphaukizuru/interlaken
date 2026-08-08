import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';

vi.mock('@/services/api', () => ({
  admissionsAdminApi: {
    getRegistration: vi.fn(),
    updateRegistrationStatus: vi.fn(),
    verifyDocument: vi.fn(),
    downloadDocument: vi.fn(),
  },
}));

import { RegistrationReviewModal } from './RegistrationReviewModal';
import { admissionsAdminApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const getRegistration = vi.mocked(admissionsAdminApi.getRegistration);

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
  documents: [],
};

describe('RegistrationReviewModal consents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRegistration.mockResolvedValue({ data: baseReg } as never);
  });

  it('shows privacy, photo, and medical consent evidence for staff review', async () => {
    renderWithProviders(
      <RegistrationReviewModal id={9} open onClose={() => {}} />,
      { route: '/admin/admisiones' },
    );

    expect(await screen.findByText('Consentimientos')).toBeInTheDocument();
    expect(screen.getByText('Aviso de Privacidad')).toBeInTheDocument();
    expect(screen.getByText(/v2026\.1/)).toBeInTheDocument();
    expect(screen.getByText('Fotos y medios')).toBeInTheDocument();
    expect(screen.getByText('No autorizado')).toBeInTheDocument();
    expect(screen.getByText('Datos de salud')).toBeInTheDocument();
    expect(screen.getByText('Autorizado')).toBeInTheDocument();
    expect(screen.getByText(/Estatura: 1\.10 m/)).toBeInTheDocument();
  });
});
