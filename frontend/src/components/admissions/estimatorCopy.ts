/**
 * The visible labels of the Admisiones cost estimator (CostEstimator), editable
 * from the CMS section `admisiones.estimator`. The figures and the arithmetic
 * stay in code and in the price tables (console «Costos y precios»). Kept apart
 * from the component so the section module ships these defaults while the
 * estimator itself loads on demand.
 */
export interface EstimatorCopy {
  cardEyebrow: string; cardTitle: string;
  sectionLabel: string;
  /** The level buttons; each one shows the price rows whose name contains it. */
  sections: { label?: string }[];
  startSection: string;
  modalityLabel: string; newTag: string; returningTag: string;
  adminLabel: string; adminSub: string;
  newFeeLabel: string; returningFeeLabel: string; feeSub: string;
  tuitionLabel: string; tuitionMissing: string; perMonth: string;
  insuranceLabel: string; insuranceSub: string;
  noCost: string;
  notes: { text?: string; tone?: string }[];
  waLabel: string; allLabel: string; allHref: string;
  errorTitle: string; errorText: string;
}

export const ESTIMATOR_COPY: EstimatorCopy = {
  cardEyebrow: 'Estimador', cardTitle: '¿Cuánto cuesta por sección?',
  sectionLabel: 'Sección',
  sections: [{ label: 'Maternal' }, { label: 'Preescolar' }, { label: 'Primaria' }, { label: 'Secundaria' }],
  startSection: 'Preescolar',
  modalityLabel: 'Modalidad', newTag: 'Nuevo ingreso', returningTag: 'Reinscripción',
  adminLabel: 'Gastos administrativos', adminSub: 'Sin devolución',
  newFeeLabel: 'Cuota de inscripción', returningFeeLabel: 'Cuota de reinscripción', feeSub: 'Pago único por ciclo',
  tuitionLabel: 'Colegiatura mensual', tuitionMissing: 'Por confirmar', perMonth: '/ mes',
  insuranceLabel: 'Seguros y credenciales', insuranceSub: 'Anual · obligatorios',
  noCost: 'SIN COSTO',
  notes: [
    { text: 'La cuota de inscripción y reinscripción se divide en 4 parcialidades de enero a abril.', tone: 'purple' },
    { text: 'Las colegiaturas tienen un recargo del 5% mensual a partir del día 17.', tone: 'amber' },
  ],
  waLabel: 'Solicitar información', allLabel: 'Ver todos los costos', allHref: '/admisiones/costos',
  errorTitle: 'No fue posible cargar el estimador',
  errorText: 'Intente de nuevo o consulte los costos completos más tarde.',
};
