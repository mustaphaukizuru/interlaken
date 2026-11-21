/**
 * caseStages.ts — the admission process of Colegio Interlaken (Proceso.xlsx)
 * as the console shows it: 1 Informes → 2 Visita guiada → 3 Examen →
 * 4 Documentación y acuerdos → 5 Inscrito, plus «Cerrado» (No le interesa,
 * No asistió, No aceptado). One palette and one icon per stage, used by the
 * Expedientes list, the board, the StageBar and every chip, so a stage reads
 * the same everywhere. Colour is never the only signal: each chip carries its
 * icon and its words.
 *
 * Mirrors `backend/apps/admissions/models.py` (PreRegistration.Stage); the
 * server is the authority on moves.
 */
import {
  CircleSlash, FolderOpen, GraduationCap, MapPin, MessageSquareText, PenLine, type LucideIcon,
} from 'lucide-react';

export type StageKey = 'informes' | 'visita' | 'examen' | 'documentacion' | 'inscrito' | 'cerrado';
export type OpenStage = 'informes' | 'visita' | 'examen' | 'documentacion';

/** The five steps of the process, in order (cerrado is an outcome, not a step). */
export const PROCESS_STAGES: Exclude<StageKey, 'cerrado'>[] = ['informes', 'visita', 'examen', 'documentacion', 'inscrito'];
export const OPEN_STAGES: OpenStage[] = ['informes', 'visita', 'examen', 'documentacion'];
export const ALL_STAGES: StageKey[] = [...PROCESS_STAGES, 'cerrado'];

export interface StageMeta {
  label: string;
  /** Short word for chips and tabs on narrow screens. */
  short: string;
  /** 1-5 for the process steps; null for «Cerrado». */
  step: number | null;
  icon: LucideIcon;
  /** Tinted pill: background, text and ring (brand tokens only). */
  chip: string;
  /** Solid marker: StageBar dot, board column rule. */
  dot: string;
  /** Text colour of the marker on white. */
  text: string;
}

export const STAGE_META: Record<StageKey, StageMeta> = {
  informes: {
    label: 'Informes', short: 'Informes', step: 1, icon: MessageSquareText,
    chip: 'bg-cream text-ink ring-subtle/30', dot: 'bg-subtle', text: 'text-ink',
  },
  visita: {
    label: 'Visita guiada', short: 'Visita', step: 2, icon: MapPin,
    chip: 'bg-amber/10 text-amber ring-amber/30', dot: 'bg-amber', text: 'text-amber',
  },
  examen: {
    label: 'Examen', short: 'Examen', step: 3, icon: PenLine,
    chip: 'bg-pink-light text-pink-dark ring-pink/25', dot: 'bg-pink', text: 'text-pink-dark',
  },
  documentacion: {
    label: 'Documentación y acuerdos', short: 'Documentación', step: 4, icon: FolderOpen,
    chip: 'bg-brand-50 text-brand-700 ring-brand-600/20', dot: 'bg-purple', text: 'text-purple',
  },
  inscrito: {
    label: 'Inscrito', short: 'Inscrito', step: 5, icon: GraduationCap,
    chip: 'bg-green-50 text-green-700 ring-green-600/20', dot: 'bg-green-strong', text: 'text-green-700',
  },
  cerrado: {
    label: 'Cerrado', short: 'Cerrado', step: null, icon: CircleSlash,
    chip: 'bg-coral-50 text-coral-700 ring-coral-600/20', dot: 'bg-coral-600', text: 'text-coral-700',
  },
};

export const stageMeta = (stage: string): StageMeta => STAGE_META[stage as StageKey] ?? STAGE_META.informes;

/** Index of a stage in the process (cerrado: -1). */
export const stageIndex = (stage: string) => PROCESS_STAGES.indexOf(stage as Exclude<StageKey, 'cerrado'>);

/** Outcomes a person may pick when closing a case (no_procedio is legacy only). */
export const CLOSE_OUTCOMES: { value: string; label: string }[] = [
  { value: 'no_interesa', label: 'No le interesa' },
  { value: 'no_asistio', label: 'No asistió' },
  { value: 'no_aceptado', label: 'No aceptado' },
];

export const CLOSED_OUTCOME_LABEL: Record<string, string> = {
  no_interesa: 'No le interesa',
  no_asistio: 'No asistió',
  no_aceptado: 'No aceptado',
  no_procedio: 'No procedió',
};

/** Tabs of the Expedientes list (stage chips with counts). */
export const STAGE_TABS: { value: StageKey; label: string }[] = [
  { value: 'informes', label: 'Informes' },
  { value: 'visita', label: 'Visita' },
  { value: 'examen', label: 'Examen' },
  { value: 'documentacion', label: 'Documentación' },
  { value: 'inscrito', label: 'Inscritos' },
  { value: 'cerrado', label: 'Cerrados' },
];

/** «Hoy», «1 día», «12 días»: how long a case has waited in its stage. */
export function waitingText(days: number | null | undefined): string {
  if (days == null) return '';
  if (days <= 0) return 'Hoy';
  return days === 1 ? '1 día' : `${days.toLocaleString('es-MX')} días`;
}

/** Long waits stand out (a week without movement). */
export const isStale = (days: number | null | undefined) => (days ?? 0) >= 7;

const DATE_FMT: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
const TIME_FMT: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false };

/** «7 dic 2026» (school time zone is the browser's: the office is in Mexico). */
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-MX', DATE_FMT);
}

/** «7 dic 2026, 09:30». */
export function fmtDayTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('es-MX', DATE_FMT)}, ${d.toLocaleTimeString('es-MX', TIME_FMT)}`;
}

/** ISO datetime → the value of an `<input type="datetime-local">` (local time). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `<input type="datetime-local">` value → ISO with the browser's offset (the API is tz-aware). */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Today as YYYY-MM-DD in local time (max of a payment date). */
export function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** «$9,500.00». */
export function money(value: string | number | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : value ?? 0;
  return Number.isFinite(n) ? n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) : '';
}

/** Ten digits of a Mexican phone (wa.me needs 52 + 10). */
export function phoneDigits(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}
