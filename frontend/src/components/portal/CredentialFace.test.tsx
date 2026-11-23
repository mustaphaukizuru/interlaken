import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { CredentialFace } from './CredentialFace';
import { gradeBadge, levelOf, photoSrc, schoolCycle, sepLines } from '@/lib/credential';
import type { CafeteriaCard } from '@/types';

const CARD = {
  student: { id: 1, name: 'Alejandro Alvarado Félix', grade: '5° Primaria', group: 'A', student_id: '09628', tipo: 'alumno', puesto: '', puesto_label: '', photo: '' },
  code: 'ci09628',
  linked: true,
  balance: '120.00',
  is_low_balance: false,
  points: null,
  consumption: { total: '0.00', since: null },
  loyverse: null,
} as unknown as CafeteriaCard;

const withStudent = (patch: Partial<CafeteriaCard['student']>) => ({ ...CARD, student: { ...CARD.student, ...patch } });

describe('the printed card’s wording', () => {
  it('writes the grade pill as printed («5A Primaria»)', () => {
    expect(gradeBadge('5° Primaria', 'A')).toBe('5A Primaria');
    expect(gradeBadge('1° Secundaria', 'B')).toBe('1B Secundaria');
    expect(gradeBadge('2° Preescolar', '')).toBe('2° Preescolar');
    expect(gradeBadge('Maternal', '')).toBe('Maternal');
    // Spellings it does not know keep the portal's line.
    expect(gradeBadge('4°', 'A')).toBe('4° · Grupo A');
  });

  it('reads the level from the grade', () => {
    expect(levelOf('Maternal')).toBe('maternal');
    expect(levelOf('3° Preescolar')).toBe('preescolar');
    expect(levelOf('6° Primaria')).toBe('primaria');
    expect(levelOf('2° Secundaria')).toBe('secundaria');
    expect(levelOf('4°')).toBeNull();
  });

  it('turns the school year in August', () => {
    expect(schoolCycle(new Date(2026, 10, 22))).toBe('2026-2027');
    expect(schoolCycle(new Date(2027, 2, 1))).toBe('2026-2027');
    expect(schoolCycle(new Date(2027, 7, 1))).toBe('2027-2028');
  });

  it('prints each level’s official SEP registration', () => {
    expect(sepLines('maternal')).toEqual({ cct: '15PJN1703K', lines: ['Incorporación AN0253'] });
    expect(sepLines('preescolar')).toEqual({ cct: '15PJN1703K', lines: ['Incorporación AN0253'] });
    expect(sepLines('primaria')).toEqual({ cct: '15PPR1767L', lines: ['Acuerdo No. 83043'] });
    expect(sepLines('secundaria')).toEqual({ cct: '15PES0730K', lines: ['Acuerdo No.', '206-016-1695-AC-052/93'] });
    expect(sepLines(null)).toBeNull();
  });

  it('asks Google for a picture sharp enough for the frame', () => {
    expect(photoSrc('https://lh3.googleusercontent.com/a/abc=s96-c')).toBe('https://lh3.googleusercontent.com/a/abc=s480-c');
    expect(photoSrc('/api/v1/accounts/avatar/3/abc/')).toBe('/api/v1/accounts/avatar/3/abc/');
  });
});

describe('CredentialFace', () => {
  it('shows the printed fields and the barcode of the Loyverse code', () => {
    render(<CredentialFace card={CARD} />);
    const card = screen.getByRole('region', { name: 'Credencial de Alejandro Alvarado Félix' });
    expect(within(card).getByText('5A Primaria')).toBeInTheDocument();
    expect(within(card).getByText('Alejandro Alvarado Félix')).toBeInTheDocument();
    expect(within(card).getByText('Matrícula')).toBeInTheDocument();
    expect(within(card).getByText('ci09628')).toBeInTheDocument();
    expect(within(card).getByText('C.C.T. 15PPR1767L')).toBeInTheDocument();
    expect(within(card).getByRole('img', { name: 'Código ci09628' })).toBeInTheDocument();
  });

  it('no photo: the empty frame, no broken image', () => {
    render(<CredentialFace card={CARD} />);
    expect(screen.queryByRole('img', { name: /^Foto de/ })).toBeNull();
  });

  it('the Google picture when there is one, and the empty frame if it fails to load', () => {
    render(<CredentialFace card={withStudent({ photo: 'https://lh3.googleusercontent.com/a/abc=s96-c' })} />);
    const img = screen.getByRole('img', { name: 'Foto de Alejandro Alvarado Félix' });
    expect(img.getAttribute('src')).toBe('https://lh3.googleusercontent.com/a/abc=s480-c');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    fireEvent.error(img);
    expect(screen.queryByRole('img', { name: /^Foto de/ })).toBeNull();
  });

  it('a staff card: the puesto in the pill, «Código», no level registration', () => {
    render(<CredentialFace card={withStudent({ name: 'Caja Ejemplo', grade: '', group: '', tipo: 'personal', puesto: 'cafeteria' as never, puesto_label: 'Cafetería' })} />);
    expect(screen.getByText('Cafetería')).toBeInTheDocument();
    expect(screen.getByText('Código')).toBeInTheDocument();
    expect(screen.queryByText('Matrícula')).toBeNull();
    expect(screen.queryByText(/C\.C\.T\./)).toBeNull();
  });
});
