import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/services/api', () => ({ api: { get: vi.fn() }, downloadBlob: vi.fn() }));
vi.mock('react-hot-toast', () => ({
  default: { loading: vi.fn(() => 't'), success: vi.fn(), error: vi.fn() },
}));

import toast from 'react-hot-toast';
import { api, downloadBlob } from '@/services/api';
import {
  downloadBlankFicha, downloadConcentrado, downloadFicha, downloadFichasZip, downloadMyFicha,
  fichaErrorMessage, fichaExportExtras, filenameFromDisposition, runFichaDownload,
} from './fichaExports';

const get = vi.mocked(api.get);
const blob = new Blob(['x']);
const withName = (name: string) => ({ data: blob, headers: { 'content-disposition': `attachment; filename="${name}"` } });

describe('fichaExports', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the file name the server chose', () => {
    expect(filenameFromDisposition('attachment; filename="Ficha_Ruiz_Luis_2026-2027.pdf"', 'x.pdf'))
      .toBe('Ficha_Ruiz_Luis_2026-2027.pdf');
    expect(filenameFromDisposition("attachment; filename*=UTF-8''Ficha%20A.pdf", 'x.pdf')).toBe('Ficha A.pdf');
    expect(filenameFromDisposition(undefined, 'x.pdf')).toBe('x.pdf');
    expect(filenameFromDisposition('inline', 'x.pdf')).toBe('x.pdf');
  });

  it('downloads one ficha in the asked format with the server name', async () => {
    get.mockResolvedValue(withName('Ficha_Ruiz_Luis_2026-2027.xlsx') as never);
    await expect(downloadFicha(3, 'xlsx')).resolves.toBe('Ficha_Ruiz_Luis_2026-2027.xlsx');
    expect(get).toHaveBeenCalledWith('/admissions/register/3/ficha/export/', { params: { fmt: 'xlsx' }, responseType: 'blob' });
    expect(downloadBlob).toHaveBeenCalledWith(blob, 'Ficha_Ruiz_Luis_2026-2027.xlsx');
  });

  it('the family copy sends the session token and asks for the PDF', async () => {
    get.mockResolvedValue({ data: blob, headers: {} } as never);
    await expect(downloadMyFicha(9, 'tok-123')).resolves.toBe('Ficha_de_inscripcion.pdf');
    expect(get).toHaveBeenCalledWith('/admissions/register/9/ficha/export/', {
      params: { fmt: 'pdf' }, headers: { 'X-Session-Token': 'tok-123' }, responseType: 'blob',
    });
    expect(downloadBlob).toHaveBeenCalledWith(blob, 'Ficha_de_inscripcion.pdf');
  });

  it('ZIP, concentrado and blank form hit their endpoints', async () => {
    get.mockResolvedValue({ data: blob, headers: {} } as never);
    await downloadFichasZip([1, 2], 'pdf');
    expect(get).toHaveBeenLastCalledWith('/admissions/register/fichas/export/', { params: { ids: '1,2', fmt: 'pdf' }, responseType: 'blob' });
    await downloadConcentrado({ status: 'submitted', ids: '4' });
    expect(get).toHaveBeenLastCalledWith('/admissions/register/fichas/concentrado/', {
      params: { status: 'submitted', ids: '4', fmt: 'xlsx' }, responseType: 'blob',
    });
    await downloadBlankFicha('pdf');
    expect(get).toHaveBeenLastCalledWith('/admissions/ficha/blank/', { params: { fmt: 'pdf' }, responseType: 'blob' });
    expect(downloadBlob).toHaveBeenLastCalledWith(blob, 'Ficha_de_inscripcion_en_blanco.pdf');
  });

  it('shows the server sentence carried in a blob error body', async () => {
    const body = new Blob([JSON.stringify({ detail: 'Puede descargar hasta 50 fichas a la vez. Elija menos fichas.' })]);
    const err = { response: { status: 413, data: body } };
    await expect(fichaErrorMessage(err)).resolves.toBe('Puede descargar hasta 50 fichas a la vez. Elija menos fichas.');
    await expect(fichaErrorMessage({ response: { status: 404, data: new Blob(['<html>']) } }))
      .resolves.toBe('El recurso ya no existe.');
  });

  it('runs a download with the progress toast', async () => {
    await expect(runFichaDownload(async () => 'ok', 'la ficha')).resolves.toBe(true);
    expect(toast.loading).toHaveBeenCalledWith('Generando la ficha…');
    expect(toast.success).toHaveBeenCalledWith('Archivo listo.', { id: 't' });
    const fail = { response: { status: 409, data: new Blob([JSON.stringify({ detail: 'Aún no.' })]) } };
    await expect(runFichaDownload(() => Promise.reject(fail), 'la ficha')).resolves.toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Aún no.', { id: 't', duration: undefined });
  });

  it('export menu extras: concentrado follows «Solo seleccionados», then the blank form', async () => {
    get.mockResolvedValue({ data: blob, headers: {} } as never);
    const items = fichaExportExtras({ status: 'submitted' }, '3,5');
    expect(items.map((i) => i.label)).toEqual(['Concentrado de fichas', 'Ficha en blanco (Excel)', 'Ficha en blanco (PDF)']);
    await items[0].run({ selectedOnly: true });
    expect(get).toHaveBeenLastCalledWith('/admissions/register/fichas/concentrado/', {
      params: { status: 'submitted', ids: '3,5', fmt: 'xlsx' }, responseType: 'blob',
    });
    await items[0].run({ selectedOnly: false });
    expect(get).toHaveBeenLastCalledWith('/admissions/register/fichas/concentrado/', {
      params: { status: 'submitted', ids: undefined, fmt: 'xlsx' }, responseType: 'blob',
    });
    await items[2].run({ selectedOnly: false });
    expect(get).toHaveBeenLastCalledWith('/admissions/ficha/blank/', { params: { fmt: 'pdf' }, responseType: 'blob' });
  });
});
