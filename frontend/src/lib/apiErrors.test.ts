import { describe, expect, it } from 'vitest';
import { apiErrorMessage, apiErrorStatus, apiFieldErrors, fieldErrorsOrNull, isOverCap } from './apiErrors';

const failure = (status: number, data: unknown) => ({ response: { status, data } });

describe('apiErrors', () => {
  it('maps {detail}', () => {
    const err = failure(400, { detail: 'No autorizado.' });
    expect(apiFieldErrors(err)).toEqual({ detail: 'No autorizado.' });
    expect(apiErrorMessage(err)).toBe('No autorizado.');
  });

  it('folds the legacy {error} shape into detail', () => {
    const err = failure(400, { error: 'Archivo inválido.' });
    expect(apiFieldErrors(err)).toEqual({ detail: 'Archivo inválido.' });
    expect(apiErrorMessage(err)).toBe('Archivo inválido.');
  });

  it('maps field dicts (first message wins) and nested serializers', () => {
    const err = failure(400, {
      student_id: ['Ya existe un alumno con esa matrícula.', 'otro'],
      grade: 'Requerido.',
      guardian: { email: ['Correo inválido.'] },
      non_field_errors: ['Combinación inválida.'],
    });
    expect(apiFieldErrors(err)).toEqual({
      student_id: 'Ya existe un alumno con esa matrícula.',
      grade: 'Requerido.',
      guardian: 'Correo inválido.',
      non_field_errors: 'Combinación inválida.',
      detail: 'Combinación inválida.',
    });
  });

  it('surfaces the 413 cap message from the server verbatim', () => {
    const err = failure(413, { detail: 'Acote los filtros: el límite es 10000 filas.' });
    expect(isOverCap(err)).toBe(true);
    expect(apiErrorStatus(err)).toBe(413);
    expect(apiErrorMessage(err)).toBe('Acote los filtros: el límite es 10000 filas.');
  });

  it('falls back to a status-based es-MX sentence when the body is not JSON', () => {
    expect(apiErrorMessage(failure(413, '<html>'))).toMatch(/supera el límite/);
    expect(apiErrorMessage(failure(429, ''))).toMatch(/Demasiadas solicitudes/);
    expect(apiErrorMessage(failure(403, null))).toMatch(/permiso/);
    expect(apiErrorMessage(failure(502, '<html>'))).toMatch(/servidor/);
  });

  it('uses the caller fallback for unknown failures and detects network errors', () => {
    expect(apiErrorMessage(new Error('boom'), 'Falló.')).toBe('Falló.');
    expect(apiErrorMessage({ code: 'ERR_NETWORK' })).toMatch(/Sin conexión/);
    expect(apiFieldErrors(new Error('boom'))).toEqual({});
    expect(fieldErrorsOrNull(new Error('boom'))).toBeNull();
    expect(fieldErrorsOrNull(failure(400, { a: ['x'] }))).toEqual({ a: 'x' });
  });
});
