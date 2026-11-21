/**
 * «Subir reporte de MultiCobros» (POST /payments/admin/multicobros-upload/).
 *
 * Stateless: the preview (`dry_run`) and the commit send the same File; the
 * server reads it in memory and never keeps it. Only the cafetería admin
 * dialog imports this module (its own lazy chunk).
 */
import { api } from './api';
import { apiErrorCode, apiErrorMessage, apiErrorStatus } from '@/lib/apiErrors';

export type McOutcome =
  | 'verificar'
  | 'ya_verificada'
  | 'diferencia'
  | 'por_conciliar'
  | 'no_aprobada_en_multicobros'
  | 'devolucion'
  | 'rechazada'
  | 'sin_pago'
  | 'simulacion'
  | 'no_aparece';

/** After the commit, what happened to a verified top-up's balance. */
export type McApplyState =
  | ''
  | 'applied'
  | 'waiting_pos'
  | 'waiting_verification'
  | 'pos_unknown'
  | 'pending_sync'
  /** The app writes it into Loyverse itself within minutes (do not load it by hand). */
  | 'auto_waiting'
  | 'not_applicable';

export const MC_WAITING: ReadonlySet<McApplyState> = new Set<McApplyState>([
  'waiting_pos', 'waiting_verification', 'pos_unknown', 'pending_sync', 'auto_waiting',
]);

export interface McRow {
  /** Line in the file; `null` for `no_aparece` (ours, absent from the file). */
  line: number | null;
  control_number: string;
  pago_id: number | null;
  /** From the school's database, never from the file. */
  student_name: string;
  student_code: string;
  amount: string | null;
  date: string | null;
  time: string;
  outcome: McOutcome;
  message: string;
  /** Last 4 digits of the card at most. */
  card_last4: string;
  tipo: string;
  resultado: string;
  apply_state: McApplyState;
  /** `por_conciliar` only: the report's values for «Conciliar con MultiCobros». */
  prefill: { referencia: string; codigo_aut: string; amount: string } | null;
  reconcile: {
    control_number: string;
    created_at: string;
    mode: string;
    review_reason: string;
    failure_label: string;
    last_error: string;
    amount: string;
  } | null;
}

export interface McReport {
  dry_run: boolean;
  total_rows: number;
  date_from: string | null;
  date_to: string | null;
  counts: Record<McOutcome, number>;
  rows: McRow[];
  /** Commit only. */
  verified?: number;
  applied?: number;
  waiting?: number;
}

/** A refusal said as staff need it: what happened and what to do next. */
export interface McProblem {
  title: string;
  detail: string;
  next: string;
  /** The same file may work on a second try (network, server): «Revisar» stays on. */
  retry?: boolean;
}

export const MC_ACCEPT = '.xlsx,.csv';
export const MC_MAX_BYTES = 2 * 1024 * 1024;
export const MC_MAX_ROWS = 5000;

/** A file the server would refuse, said before uploading it (`null`: fine). */
export function mcFileProblem(file: File): McProblem | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xls')) {
    return {
      title: 'Formato no compatible (.xls)',
      detail: 'Los archivos .xls de Excel 97-2003 no se pueden leer.',
      next: 'En MultiCobros exporte el reporte en .xlsx o .csv y súbalo de nuevo.',
    };
  }
  if (!name.endsWith('.xlsx') && !name.endsWith('.csv')) {
    return {
      title: 'Formato no compatible',
      detail: `«${file.name}» no es un reporte .xlsx ni .csv.`,
      next: 'Suba el archivo que exporta MultiCobros («MovimientosPayworks_export…»).',
    };
  }
  if (file.size === 0) {
    return {
      title: 'El archivo está vacío',
      detail: `«${file.name}» no tiene contenido.`,
      next: 'Exporte el reporte de nuevo en MultiCobros.',
    };
  }
  if (file.size > MC_MAX_BYTES) {
    return {
      title: 'El archivo es demasiado grande',
      detail: 'El límite es de 2 MB.',
      next: 'Exporte menos días en MultiCobros (por ejemplo, solo ayer y hoy).',
    };
  }
  return null;
}

/** What the server's refusal means for staff (its own words only where they
 *  add something, such as the missing columns). */
export function mcUploadProblem(err: unknown): McProblem {
  const detail = apiErrorMessage(err, 'No se pudo revisar el reporte.');
  if (apiErrorStatus(err) === 413) {
    return { title: 'El reporte es demasiado grande', detail: 'El límite es de 2 MB y 5,000 operaciones.', next: 'Exporte menos días en MultiCobros (por ejemplo, solo ayer y hoy) y súbalo de nuevo.' };
  }
  switch (apiErrorCode(err)) {
    case 'other_merchant':
      return { title: 'Este reporte es de otra afiliación', detail: 'No es de la afiliación del colegio, así que no se revisó ninguna operación.', next: 'En MultiCobros elija la afiliación del colegio y exporte el reporte otra vez.' };
    case 'unsupported_format':
      return { title: 'Formato no compatible', detail: 'Solo se leen reportes .xlsx o .csv.', next: 'Exporte el reporte de nuevo en MultiCobros en .xlsx o .csv.' };
    case 'empty_report':
      return { title: 'El reporte no tiene operaciones', detail: 'El archivo no trae ninguna operación de las fechas elegidas.', next: 'Revise las fechas que eligió en MultiCobros y expórtelo otra vez.' };
    case 'missing_columns':
      return { title: 'No es el reporte esperado', detail, next: 'Use el reporte «Transacciones Payworks 2» de MultiCobros.' };
    case 'unreadable':
      return { title: 'No se pudo leer el archivo', detail: 'Está dañado o no es un reporte de Excel válido.', next: 'Expórtelo de nuevo y súbalo sin abrirlo ni guardarlo en Excel.' };
    default:
      return { title: 'No se pudo revisar el reporte', detail, next: 'Intente de nuevo. Si vuelve a pasar, avise a dirección.', retry: true };
  }
}

export const multicobrosUploadApi = {
  upload: (file: File, { dryRun }: { dryRun: boolean }) => {
    const form = new FormData();
    form.append('file', file);
    form.append('dry_run', dryRun ? '1' : '0');
    return api.post<McReport>('/payments/admin/multicobros-upload/', form);
  },
};
