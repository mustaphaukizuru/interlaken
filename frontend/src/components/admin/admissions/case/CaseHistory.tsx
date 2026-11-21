import { useState } from 'react';
import { History } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { CLOSED_OUTCOME_LABEL, fmtDay, fmtDayTime, money, stageMeta } from '@/lib/caseStages';
import type { CaseHistoryEntry } from '@/hooks/queries/cases';

type Variant = 'success' | 'info' | 'error' | 'warning' | 'neutral';

/** Field names as the office reads them; anything not listed stays out of the summary. */
const FIELD: Record<string, string> = {
  stage: 'Etapa',
  closed_outcome: 'Motivo de cierre',
  closed_reason: 'Detalle del cierre',
  note: 'Nota',
  reason: 'Motivo',
  informes_outcome: 'Resultado de informes',
  visit_outcome: 'Resultado de la visita',
  visit_note: 'Nota de la visita',
  reschedule: 'Reagendar la visita',
  exam_at: 'Examen',
  exam_results_at: 'Entrega de resultados',
  exam_notes: 'Notas del examen',
  exam_result: 'Resultado del examen',
  exam_result_reason: 'Motivo del resultado',
  documents_waived: 'Documentos dispensados',
  documents_waived_reason: 'Motivo de la dispensa',
  agreements_note: 'Acuerdos',
  child_first_name: 'Nombre del alumno',
  child_last_name: 'Apellidos del alumno',
  parent_name: 'Tutor',
  parent_email: 'Correo',
  parent_phone: 'Celular',
  relationship: 'Parentesco',
  previous_school: 'Colegio de procedencia',
  child_age: 'Edad',
  grade_applying: 'Grado',
  cycle: 'Ciclo',
  referral_source: 'Cómo nos conoció',
  notes: 'Notas internas',
  costs_sent_at: 'Cuotas enviadas',
  visit_link_sent_at: 'Liga de visita enviada',
  summary: 'Detalle',
  kind: 'Tipo',
  percent: 'Porcentaje',
  amount: 'Monto',
  duration: 'Duración',
  start_month: 'Desde',
  end_month: 'Hasta',
  authorized_by: 'Autorizó',
  paid_on: 'Fecha de pago',
  method: 'Forma de pago',
  reference: 'Referencia',
  status: 'Estado',
  outcome: 'Resultado',
  override: 'Excepción de administrador',
  student_id: 'Matrícula',
};

/** Fields shown only when nothing more specific explains the row. */
const QUIET = new Set(['status']);

const SENT: Record<string, string> = {
  costs: 'Cuotas por nivel',
  visit_link: 'Liga para agendar la visita',
  ficha_link: 'Liga de la ficha de inscripción',
  exam_date: 'Fecha del examen',
  exam_result_accepted: 'Resultado: aceptado',
  exam_result_not_accepted: 'Resultado: no aceptado',
};

const VALUE: Record<string, Record<string, string>> = {
  closed_outcome: CLOSED_OUTCOME_LABEL,
  informes_outcome: { continua_visita: 'Continúa a visita guiada', no_interesa: 'No le interesa' },
  visit_outcome: { agenda_examen: 'Asistió y agenda examen', no_interesa: 'Asistió, no le interesa', no_asistio: 'No asistió' },
  exam_result: { aceptado: 'Aceptado', no_aceptado: 'No aceptado' },
  kind: { inscripcion: 'Descuento en inscripción', beca_colegiatura: 'Beca en colegiatura', descuento_colegiatura: 'Descuento en colegiatura' },
  duration: { '3_meses': '3 meses', '6_meses': '6 meses', ciclo: '1 ciclo', permanente: 'Permanente', personalizado: 'Meses a la medida' },
  method: { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', otro: 'Otro' },
  status: {
    pending: 'Pendiente', contacted: 'Contactado', enrolled: 'Inscrito', rejected: 'No procedió',
    confirmed: 'Confirmada', attended: 'Asistió', no_show: 'No asistió', cancelled: 'Cancelada',
    draft: 'Borrador', submitted: 'Enviada', reviewing: 'En revisión', approved: 'Aprobada', complete: 'Completa',
  },
  outcome: { interested: 'Interesada', enrolling: 'Se inscribirá', not_now: 'No por ahora', declined: 'No le interesó' },
};

const DATE_FIELDS = new Set(['exam_at', 'exam_results_at', 'costs_sent_at', 'visit_link_sent_at']);
const MONTH_FIELDS = new Set(['start_month', 'end_month', 'paid_on']);

function show(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'sin dato';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (field === 'stage') return stageMeta(String(value)).label;
  if (DATE_FIELDS.has(field)) return fmtDayTime(String(value)) || String(value);
  if (MONTH_FIELDS.has(field)) return fmtDay(String(value)) || String(value);
  if (field === 'amount') return money(String(value));
  if (field === 'percent') return `${Number(value)}%`;
  if (typeof value === 'object') return '';
  const text = String(value);
  return VALUE[field]?.[text] ?? text;
}

/** One audit row as short sentences: «Etapa: Informes → Visita guiada». */
export function describeChanges(changes: Record<string, unknown>): string[] {
  const c = changes ?? {};
  const lines: string[] = [];
  const quiet: string[] = [];
  if (typeof c.sent === 'string') {
    const channel = c.channel === 'email' ? (c.email_sent ? 'por correo' : 'por correo (no salió)') : 'por WhatsApp';
    lines.push(`Envío: ${SENT[c.sent] ?? c.sent}, ${channel}`);
  }
  if (c.voided === true) lines.push('Anulado');
  if (c.student) lines.push('Se creó el alumno y las cuentas de la familia');
  if (c.booking && !Array.isArray(c.booking)) lines.push(`Visita vinculada (#${String(c.booking)})`);
  for (const [field, value] of Object.entries(c)) {
    const label = FIELD[field];
    if (!label) continue;
    let line = '';
    if (Array.isArray(value) && value.length === 2) {
      const [before, after] = value.map((v) => show(field, v));
      if (before !== after) line = `${label}: ${before} → ${after}`;
    } else {
      const text = show(field, value);
      if (text) line = `${label}: ${text}`;
    }
    if (line) (QUIET.has(field) ? quiet : lines).push(line);
  }
  return lines.length ? lines : quiet;
}

const ACTION: Record<string, { label: string; variant: Variant }> = {
  create: { label: 'Alta', variant: 'success' },
  update: { label: 'Cambio', variant: 'info' },
  delete: { label: 'Anulación', variant: 'error' },
  export: { label: 'Descarga', variant: 'neutral' },
};

function contextLabel(context: string): string {
  const text = context.replace(/^admissions: (expediente: )?/, '').replace(/^bookings: /, '').trim();
  if (!text || /^[\w.:-]+$/.test(text)) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const actorOf = (label: string) => (!label || /^system(:|$)/.test(label) ? 'Sistema' : label);

const PAGE = 12;

/**
 * Who did what on the case, newest first: the case itself, its ficha and
 * documents, the visits, becas and pagos, and the student it became. Built
 * from the append-only audit rows the API gathers (`history`).
 */
export function CaseHistory({ entries }: { entries: CaseHistoryEntry[] }) {
  const [shown, setShown] = useState(PAGE);
  if (entries.length === 0) {
    return (
      <p className="flex items-center gap-2 py-4 text-sm text-subtle">
        <History className="h-4 w-4" aria-hidden="true" /> Aún no hay movimientos.
      </p>
    );
  }
  return (
    <div>
      <ol className="relative space-y-4 border-l border-line pl-5" aria-label="Historial del expediente">
        {entries.slice(0, shown).map((e) => {
          const badge = ACTION[e.action] ?? { label: e.action, variant: 'neutral' as Variant };
          const lines = describeChanges(e.changes);
          const where = contextLabel(e.context);
          return (
            <li key={e.id} className="relative">
              <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-purple ring-1 ring-line" aria-hidden="true" />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Badge variant={badge.variant}>{badge.label}</Badge>
                <span className="text-sm font-semibold text-ink">{e.object_label}</span>
              </div>
              <p className="mt-0.5 text-xs text-subtle">
                <time dateTime={e.at}>{fmtDayTime(e.at)}</time> · {actorOf(e.actor)}
              </p>
              {lines.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-sm text-ink">
                  {lines.map((line, i) => <li key={`${i}-${line}`} className="break-words">{line}</li>)}
                </ul>
              )}
              {where && <p className="mt-0.5 text-xs text-muted">{where}</p>}
            </li>
          );
        })}
      </ol>
      {entries.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + PAGE * 2)}
          className="mt-3 inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-semibold text-purple hover:bg-purple/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40">
          Ver {Math.min(PAGE * 2, entries.length - shown)} movimientos más
        </button>
      )}
    </div>
  );
}

export default CaseHistory;
