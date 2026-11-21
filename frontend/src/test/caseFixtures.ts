import type { CaseDetail, GateItem } from '@/hooks/queries/cases';
import type { StageKey } from '@/lib/caseStages';

/**
 * A synthetic admission case (Expediente) as `GET admin/cases/<pk>/` returns
 * it, on any stage, for the console tests. Synthetic people only.
 */
const STAGE_LABEL: Record<StageKey, string> = {
  informes: 'Informes', visita: 'Visita guiada', examen: 'Examen', documentacion: 'Documentación y acuerdos', inscrito: 'Inscrito', cerrado: 'Cerrado',
};

const NEXT: Partial<Record<StageKey, { code: string; label: string }>> = {
  informes: { code: 'send_costs', label: 'Enviar cuotas' },
  visita: { code: 'visit_outcome', label: 'Registrar resultado de la visita' },
  examen: { code: 'schedule_exam', label: 'Agendar examen' },
  documentacion: { code: 'record_payment', label: 'Registrar pago de inscripción' },
};

export function gates(over: Partial<Record<'stage' | 'ficha' | 'documents' | 'payment', boolean>> = {}): { ready: boolean; items: GateItem[] } {
  const ok = { stage: true, ficha: true, documents: true, payment: true, ...over };
  const items: GateItem[] = [
    { key: 'stage', label: 'Expediente en «Documentación y acuerdos»', ok: ok.stage, detail: ok.stage ? '' : 'Está en «Examen».' },
    { key: 'ficha', label: 'Ficha de inscripción enviada por la familia', ok: ok.ficha, detail: ok.ficha ? '' : 'Aún no hay ficha.' },
    {
      key: 'documents', label: 'Documentos completos o dispensados', ok: ok.documents, state: ok.documents ? 'complete' : 'incomplete',
      detail: ok.documents ? '' : 'Faltan: Acta de nacimiento.', missing: ok.documents ? [] : ['Acta de nacimiento'], overridable: !ok.documents,
    },
    { key: 'payment', label: 'Pago de inscripción registrado', ok: ok.payment, detail: ok.payment ? '' : 'Registre el pago de inscripción que recibió el colegio.' },
  ];
  return { ready: items.every((i) => i.ok), items };
}

export function makeCase(stage: StageKey = 'informes', over: Partial<CaseDetail> = {}): CaseDetail {
  const closed = stage === 'cerrado';
  return {
    id: 7,
    child_name: 'Lucía Prueba Ejemplo',
    parent_name: 'Marta Ejemplo',
    parent_phone: '5512345678',
    parent_email: 'marta@ejemplo.test',
    level: 'primaria',
    level_label: 'Primaria',
    grade_applying: '2° Primaria',
    cycle: '2027-2028',
    stage,
    stage_label: STAGE_LABEL[stage],
    closed_outcome: closed ? 'no_interesa' : '',
    closed_outcome_label: closed ? 'No le interesa' : '',
    status: 'pending',
    next_action: NEXT[stage] ?? null,
    days_waiting: 3,
    stage_changed_at: '2026-11-18T10:00:00-06:00',
    exam_at: null,
    created_at: '2026-11-10T10:00:00-06:00',
    updated_at: '2026-11-18T10:00:00-06:00',
    lead: {
      child_first_name: 'Lucía', child_last_name: 'Prueba Ejemplo', child_dob: null, child_age: 7,
      previous_school: 'Colegio Ficticio', relationship: 'Madre', referral_source: 'Facebook', message: '', wants_visit: true, notes: '',
    },
    closed: closed ? { outcome: 'no_interesa', outcome_label: 'No le interesa', reason: 'Eligió otro colegio.', from_stage: 'visita', at: '2026-11-19T10:00:00-06:00' } : null,
    informes: { costs_sent_at: null, visit_link_sent_at: null, outcome: '', outcome_label: 'Sin registrar' },
    visita: { outcome: '', outcome_label: 'Sin registrar', outcome_at: null, note: '', bookings: [] },
    examen: { exam_at: null, exam_notes: '', exam_results_at: null, result: '', result_label: 'Sin resultado', reason: '', date_sent_at: null, result_sent_at: null },
    documentacion: { documents_waived: false, documents_waived_reason: '', documents_waived_at: null, agreements_note: '', discounts: [] },
    inscrito: { enrolled_at: null, payments: [], gates: gates({ stage: stage === 'documentacion', ficha: false, payment: false }) },
    ficha: null,
    ficha_link: closed
      ? { allowed: false, overridable: false, reason: 'El expediente está cerrado. Reábralo para modificarlo.', sent_at: null, can_override: false }
      : stage === 'documentacion'
        ? { allowed: true, overridable: false, reason: '', sent_at: null, can_override: false }
        : { allowed: false, overridable: true, reason: 'La ficha se envía cuando el examen ya está agendado.', sent_at: null, can_override: true },
    history: [
      {
        id: 1, at: '2026-11-18T10:00:00-06:00', actor: 'admin@ejemplo.test', action: 'update', object_type: 'admissions.preregistration',
        object_label: 'Expediente', object_id: '7', changes: { stage: ['informes', 'visita'], status: ['pending', 'contacted'] }, context: 'admissions: expediente: informes',
      },
      {
        id: 2, at: '2026-11-10T10:00:00-06:00', actor: 'admin@ejemplo.test', action: 'create', object_type: 'admissions.preregistration',
        object_label: 'Expediente', object_id: '7', changes: { via: 'expediente: nuevo prospecto', stage: 'informes' }, context: 'admissions: expediente: nuevo prospecto',
      },
    ],
    ...over,
  };
}
