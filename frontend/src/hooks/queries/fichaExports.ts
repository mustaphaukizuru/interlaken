import type { AxiosResponse } from 'axios';
import toast from 'react-hot-toast';
import { FileSpreadsheet, FileText } from 'lucide-react';
import type { ExportExtraItem } from '@/components/admin/ExportMenu';
import { api, downloadBlob } from '@/services/api';
import { apiErrorMessage, isOverCap } from '@/lib/apiErrors';
import type { RegistrationParams } from './admissions';

/**
 * «Ficha de inscripción» downloads (Fase 3): one ficha in Excel (the school's
 * own form) or PDF, a ZIP of up to 50, the «Concentrado de fichas» (one row
 * per student) and the blank form. The server names every file
 * (`Ficha_<Apellido>_<Nombre>_<ciclo>.xlsx`), so the name is read from
 * Content-Disposition and only falls back to a generic one.
 *
 * `downloadMyFicha` is the family's copy for the confirmation screen: their
 * own ficha as PDF, with the session token, once it was sent.
 */
export type FichaFormat = 'xlsx' | 'pdf';

/** Fichas per ZIP (the API answers 413 above it). */
export const FICHA_ZIP_CAP = 50;

export const FICHA_FORMAT_LABEL: Record<FichaFormat, string> = { xlsx: 'Excel', pdf: 'PDF' };
export const FICHA_FORMATS: FichaFormat[] = ['xlsx', 'pdf'];
const EXTRA_ICON = { xlsx: FileSpreadsheet, pdf: FileText } as const;

export type ConcentradoParams = Omit<RegistrationParams, 'page'> & { ids?: string };

const blob = { responseType: 'blob' as const };

export const fichaExportsApi = {
  ficha: (id: number, fmt: FichaFormat) =>
    api.get<Blob>(`/admissions/register/${id}/ficha/export/`, { params: { fmt }, ...blob }),
  zip: (ids: number[], fmt: FichaFormat) =>
    api.get<Blob>('/admissions/register/fichas/export/', { params: { ids: ids.join(','), fmt }, ...blob }),
  concentrado: (params: ConcentradoParams) =>
    api.get<Blob>('/admissions/register/fichas/concentrado/', { params: { ...params, fmt: 'xlsx' }, ...blob }),
  blank: (fmt: FichaFormat) => api.get<Blob>('/admissions/ficha/blank/', { params: { fmt }, ...blob }),
  mine: (id: number, sessionToken: string) =>
    api.get<Blob>(`/admissions/register/${id}/ficha/export/`, {
      params: { fmt: 'pdf' },
      headers: { 'X-Session-Token': sessionToken },
      ...blob,
    }),
};

/** `attachment; filename="Ficha_Lopez_Ana_2026-2027.pdf"` → the name; `fallback` when absent. */
export function filenameFromDisposition(header: unknown, fallback: string): string {
  if (typeof header !== 'string') return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try { return decodeURIComponent(star[1].trim()); } catch { /* fall through */ }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : fallback;
}

async function save(request: Promise<AxiosResponse<Blob>>, fallback: string): Promise<string> {
  const res = await request;
  const name = filenameFromDisposition(res.headers?.['content-disposition'], fallback);
  downloadBlob(res.data, name);
  return name;
}

export const downloadFicha = (id: number, fmt: FichaFormat) =>
  save(fichaExportsApi.ficha(id, fmt), `Ficha_de_inscripcion_${id}.${fmt}`);

export const downloadFichasZip = (ids: number[], fmt: FichaFormat) =>
  save(fichaExportsApi.zip(ids, fmt), `Fichas_de_inscripcion_${fmt}.zip`);

export const downloadConcentrado = (params: ConcentradoParams) =>
  save(fichaExportsApi.concentrado(params), 'concentrado-fichas.xlsx');

export const downloadBlankFicha = (fmt: FichaFormat) =>
  save(fichaExportsApi.blank(fmt), `Ficha_de_inscripcion_en_blanco.${fmt}`);

/**
 * The family's copy of its ficha (PDF), for the confirmation screen. Resolves
 * with the saved file name; rejects with the API error (409 before the ficha
 * is sent, 404 for a session that is not this ficha's). Show it with
 * `fichaErrorMessage`.
 */
export function downloadMyFicha(registrationId: number, sessionToken: string): Promise<string> {
  return save(fichaExportsApi.mine(registrationId, sessionToken), 'Ficha_de_inscripcion.pdf');
}

function blobText(data: Blob): Promise<string> {
  if (typeof data.text === 'function') return data.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(data);
  });
}

/**
 * A failed blob download carries its JSON body as a Blob: read it so the
 * server's own sentence («Puede descargar hasta 50 fichas a la vez…») shows.
 */
export async function fichaErrorMessage(err: unknown, fallback = 'No se pudo descargar la ficha.'): Promise<string> {
  const res = (err as { response?: { data?: unknown } } | undefined)?.response;
  if (res && typeof Blob !== 'undefined' && res.data instanceof Blob) {
    try {
      const body = JSON.parse(await blobText(res.data));
      return apiErrorMessage({ ...(err as object), response: { ...res, data: body } }, fallback);
    } catch {
      /* not JSON: use the status-based message */
    }
  }
  return apiErrorMessage(err, fallback);
}

/** Run a download with the console's progress toast; resolves `true` when the file was saved. */
export async function runFichaDownload(job: () => Promise<unknown>, what: string): Promise<boolean> {
  const id = toast.loading(`Generando ${what}…`);
  try {
    await job();
    toast.success('Archivo listo.', { id });
    return true;
  } catch (err) {
    toast.error(await fichaErrorMessage(err), { id, duration: isOverCap(err) ? 8000 : undefined });
    return false;
  }
}

/**
 * Extra entries of the Inscripciones «Exportar» menu: «Concentrado de fichas»
 * (the current filters, or the selection with «Solo seleccionados») and the
 * blank form.
 */
export function fichaExportExtras(filters: Omit<ConcentradoParams, 'ids'>, selectedIds: string | undefined): ExportExtraItem[] {
  return [
    {
      key: 'concentrado',
      label: 'Concentrado de fichas',
      hint: '.xlsx',
      run: ({ selectedOnly }) => runFichaDownload(
        () => downloadConcentrado({ ...filters, ids: selectedOnly ? selectedIds : undefined }),
        'el concentrado de fichas',
      ),
    },
    ...FICHA_FORMATS.map((fmt): ExportExtraItem => ({
      key: `blank-${fmt}`,
      label: `Ficha en blanco (${FICHA_FORMAT_LABEL[fmt]})`,
      hint: `.${fmt}`,
      icon: EXTRA_ICON[fmt],
      run: () => runFichaDownload(() => downloadBlankFicha(fmt), 'la ficha en blanco'),
    })),
  ];
}
