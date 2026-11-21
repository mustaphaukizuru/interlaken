import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import schemaJson from '@/components/admissions/ficha/fixtures/schema.json';
import type { FichaPayload, FichaSchema, Values } from '@/components/admissions/ficha/types';
import { FichaReadOnly } from './FichaReadOnly';

const schema = schemaJson as unknown as FichaSchema;

function ficha(sections: Record<string, Values>, extra: Partial<FichaPayload> = {}): FichaPayload {
  return {
    id: 9, status: 'submitted', status_label: 'Enviada', ficha_version: 2, editable: true, child_name: 'Ana Sofía López',
    level: 'primaria', level_label: 'Primaria', cycle: '2026-2027', pre_registration: 3, sections, medical_masked: false,
    firma: { privacy_accepted_at: '2026-11-20T11:00:00Z', privacy_notice_version: '2026.1', signed_name: 'Marta Hernández Gil',
      signed_at: '2026-11-20T11:00:00Z', consent_photos_media: true, signed_ip: '203.0.113.9' },
    completeness: { sections: { alumno: { complete: true, missing: [] }, domicilio: { complete: false, missing: ['address_street'] } }, complete: false },
    submitted_at: '2026-11-20T11:00:00Z', created_at: '2026-11-20T10:00:00Z', updated_at: '2026-11-20T11:00:00Z',
    ...extra,
  };
}

const SECTIONS = {
  contacto: { contact_name: 'Marta Hernández Gil', contact_email: 'marta.ficha@ejemplo.test', contact_phone: '5511112222', contact_relationship: 'Madre' },
  alumno: { child_given_names: 'Ana Sofía', child_paternal_surname: 'López', child_dob: '2020-05-01', child_sex: 'femenino', level: 'primaria', grade_applying: '1° Primaria' },
  domicilio: {},
  salud: { blood_type: 'O+', has_allergies: 'no', allergies: '' },
  padre: { not_applicable: true },
  madre: { not_applicable: false, given_names: 'Marta', occupation: 'otro', occupation_other: 'Música' },
  emergencia: { emergency_given_names: 'Rosa', emergency_surnames: 'Gil Ramos' },
};

describe('FichaReadOnly (Revisar inscripción)', () => {
  it('groups the ficha like the Excel, with option labels and dates as people read them', () => {
    render(<FichaReadOnly schema={schema} ficha={ficha(SECTIONS)} />);
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent?.replace('Faltan datos', '').trim());
    expect(titles).toEqual([
      'Datos del alumno', 'Domicilio', 'Datos adicionales (salud)', 'Datos del padre', 'Datos de la madre',
      'Contacto de emergencia', 'Firma', 'Quién llena la ficha',
    ]);
    const alumno = screen.getByRole('heading', { name: 'Datos del alumno' }).closest('section')!;
    expect(within(alumno).getByText('01/05/2020')).toBeInTheDocument();
    expect(within(alumno).getByText('Femenino')).toBeInTheDocument();
    expect(within(alumno).getByText('Primaria')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Domicilio/ })).toHaveTextContent('Faltan datos');
    expect(screen.getByRole('heading', { name: 'Datos del padre' }).closest('section')).toHaveTextContent('No aplica');
    const madre = screen.getByRole('heading', { name: 'Datos de la madre' }).closest('section')!;
    expect(within(madre).getByText('Música')).toBeInTheDocument();
    // «¿Cuáles?» alergias only when there are allergies.
    expect(screen.queryByText('¿Cuáles?')).not.toBeInTheDocument();
    expect(screen.getByText('203.0.113.9')).toBeInTheDocument();
  });

  it('says the health data is protected instead of showing blanks', () => {
    render(<FichaReadOnly schema={schema} ficha={ficha({ ...SECTIONS, salud: { blood_type: null } }, { medical_masked: true })} />);
    expect(screen.getByText(/Datos de salud protegidos/)).toBeInTheDocument();
    expect(screen.queryByText('Tipo de sangre')).not.toBeInTheDocument();
  });
});
