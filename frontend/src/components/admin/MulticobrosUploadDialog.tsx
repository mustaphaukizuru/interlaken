import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  AlertTriangle, ArrowLeft, Ban, Check, CheckCircle2, CircleMinus, Clock, FileSearch, FileSpreadsheet, FileUp,
  FlaskConical, Info, Layers, ListChecks, SearchX, ShieldCheck, Undo2, Wallet, X, XCircle, type LucideIcon,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ReconcileBanorteForm, useInvalidateMoney, type BanorteRow } from '@/components/admin/BanorteDialogs';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { formatMXN } from '@/lib/format';
import {
  MC_ACCEPT, MC_WAITING, mcFileProblem, mcUploadProblem, multicobrosUploadApi,
  type McOutcome, type McProblem, type McReport, type McRow,
} from '@/services/multicobrosUpload';

type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral';
type Level = 'alarm' | 'warn' | undefined;

/** Each outcome as a row shows it: text and icon, never colour alone. */
const OUTCOME: Record<McOutcome, { label: string; done?: string; tone: Tone; icon: LucideIcon; level?: Level }> = {
  verificar: { label: 'Se verificará', done: 'Verificada', tone: 'success', icon: ShieldCheck },
  ya_verificada: { label: 'Ya verificada', tone: 'neutral', icon: CheckCircle2 },
  por_conciliar: { label: 'Requiere conciliación', tone: 'warning', icon: FileSearch, level: 'warn' },
  diferencia: { label: 'Diferencia', tone: 'error', icon: AlertTriangle, level: 'alarm' },
  no_aprobada_en_multicobros: { label: 'No aprobada en MultiCobros', tone: 'error', icon: XCircle, level: 'alarm' },
  no_aparece: { label: 'Banorte no lo muestra', tone: 'error', icon: SearchX, level: 'alarm' },
  devolucion: { label: 'Devolución', tone: 'warning', icon: Undo2, level: 'warn' },
  rechazada: { label: 'Rechazada', tone: 'neutral', icon: Ban },
  sin_pago: { label: 'Sin pago en la plataforma', tone: 'neutral', icon: CircleMinus },
  simulacion: { label: 'Simulación', tone: 'neutral', icon: FlaskConical },
};

type CardTone = 'primary' | 'alarm' | 'warn' | 'muted';
type Group = 'verificar' | 'conciliar' | 'diferencias' | 'no_aparece' | 'ya_verificada' | 'otros';

/** The review's stat cards, the ones that ask for action first. */
const GROUPS: { key: Group; label: string; icon: LucideIcon; outcomes: McOutcome[]; tone: CardTone }[] = [
  { key: 'verificar', label: 'Se verificarán', icon: ShieldCheck, outcomes: ['verificar'], tone: 'primary' },
  { key: 'conciliar', label: 'Requieren conciliación', icon: FileSearch, outcomes: ['por_conciliar'], tone: 'warn' },
  { key: 'diferencias', label: 'Diferencias', icon: AlertTriangle, outcomes: ['diferencia', 'no_aprobada_en_multicobros'], tone: 'alarm' },
  { key: 'no_aparece', label: 'Banorte no muestra', icon: SearchX, outcomes: ['no_aparece'], tone: 'alarm' },
  { key: 'ya_verificada', label: 'Ya verificadas', icon: CheckCircle2, outcomes: ['ya_verificada'], tone: 'muted' },
  { key: 'otros', label: 'Otros', icon: Layers, outcomes: ['devolucion', 'rechazada', 'sin_pago', 'simulacion'], tone: 'muted' },
];

/** What the table shows: everything, one card of the review, or one of the result. */
type Filter = 'all' | Group | 'applied' | 'waiting' | 'attention';

const STEPS = [
  { n: 1, label: 'Elegir archivo' },
  { n: 2, label: 'Revisar' },
  { n: 3, label: 'Listo' },
] as const;
type Step = (typeof STEPS)[number]['n'];

const POR_APLICAR = '/admin/cafeteria?tab=pos';
/** Rows drawn at once (a report holds up to 5,000): «Mostrar más» adds the next ones. */
const PAGE = 100;

const day = (iso: string | null) => (iso ? format(parseISO(iso), 'd MMM yyyy', { locale: es }) : '');
const dateRange = (r: McReport) =>
  !r.date_from ? '' : r.date_from === r.date_to ? ` del ${day(r.date_from)}` : ` del ${day(r.date_from)} al ${day(r.date_to)}`;
const rowKey = (r: McRow) => `${r.line ?? 'x'}:${r.control_number}`;
const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const kb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);
const needsAttention = (r: McRow) => !!OUTCOME[r.outcome].level;

function inFilter(r: McRow, f: Filter): boolean {
  if (f === 'all') return true;
  if (f === 'attention') return needsAttention(r);
  if (f === 'applied') return r.apply_state === 'applied';
  if (f === 'waiting') return MC_WAITING.has(r.apply_state);
  return GROUPS.find((g) => g.key === f)!.outcomes.includes(r.outcome);
}

/** The row as the «Conciliar con MultiCobros» form reads it. */
function asBanorteRow(r: McRow): BanorteRow {
  const c = r.reconcile;
  return {
    payment_id: r.pago_id,
    student_name: r.student_name,
    amount: c?.amount ?? r.amount ?? '0',
    created_at: c?.created_at ?? '',
    banorte: c ? {
      control_number: c.control_number, mode: c.mode, created_at: c.created_at,
      review_reason: c.review_reason, failure_label: c.failure_label, last_error: c.last_error,
    } : null,
  };
}

/**
 * «Subir reporte de MultiCobros», in three steps: choose the day's export,
 * review what will happen to each operation (nothing is written), and the
 * result. «Verificar N pagos» re-sends the same file; the server verifies the
 * matching approvals through the rule of «Verificar en MultiCobros» and
 * nothing else: an approval the platform did not receive is confirmed one by
 * one in «Conciliar», pre-filled with the report's values.
 */
export default function MulticobrosUploadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const invalidate = useInvalidateMoney();
  const inputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inFlight = useRef(false);
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<McProblem | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<'checking' | 'committing' | null>(null);
  const [report, setReport] = useState<McReport | null>(null);
  const [result, setResult] = useState<McReport | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [reconciling, setReconciling] = useState<McRow | null>(null);
  /** `por_conciliar` rows confirmed in this dialog. */
  const [reconciled, setReconciled] = useState<Set<string>>(new Set());

  // Each step announces itself: focus moves to its heading.
  const [moved, setMoved] = useState(false);
  useEffect(() => { if (moved) headingRef.current?.focus(); }, [step, moved]);
  const go = (next: Step) => { setMoved(true); setStep(next); };

  const requestClose = () => {
    if (busy === 'committing' && !window.confirm(
      'La verificación sigue en curso y terminará aunque cierre esta ventana. ¿Cerrar sin ver el resultado?')) return;
    onClose();
  };

  const pick = (next: File | null) => {
    setFile(next);
    setReport(null);
    setProblem(next ? mcFileProblem(next) : null);
  };
  const clearFile = () => {
    pick(null);
    if (inputRef.current) inputRef.current.value = '';
    inputRef.current?.focus();
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!busy) pick(e.dataTransfer.files?.[0] ?? null);
  };

  async function review() {
    if (!file || problem || inFlight.current) return;
    if (report) { go(2); return; } // «Atrás» kept it: same file, same preview.
    inFlight.current = true;
    setBusy('checking');
    try {
      const { data } = await multicobrosUploadApi.upload(file, { dryRun: true });
      setReport(data);
      setFilter('all');
      go(2);
    } catch (e) {
      setProblem(mcUploadProblem(e));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  async function commit() {
    if (!file || inFlight.current) return;
    inFlight.current = true;
    setBusy('committing');
    setProblem(null);
    try {
      // Stateless: the same File again; the server reads and matches it anew.
      const { data } = await multicobrosUploadApi.upload(file, { dryRun: false });
      setResult(data);
      setFilter('all');
      go(3);
      void invalidate();
    } catch (e) {
      setProblem(mcUploadProblem(e));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  const restart = () => {
    pick(null);
    setResult(null);
    setReconciled(new Set());
    setFilter('all');
    go(1);
  };

  const shown = step === 3 ? result : report;

  return (
    <Modal open={open} onClose={requestClose} title="Subir reporte de MultiCobros" maxWidth={1100} fullScreenOnPhone>
      <div className="flex min-h-0 flex-auto flex-col">
        {/* Phones: this area scrolls under the pinned action bar. Tablet and
            up: it fits the dialog and only the table scrolls. */}
        <div className="-mx-1 flex min-h-0 flex-auto flex-col gap-4 overflow-y-auto px-1 pb-1">
          <StepIndicator step={step} />
          <p className="sr-only" aria-live="polite">
            {busy === 'checking' ? 'Revisando el reporte…' : busy === 'committing' ? 'Verificando los pagos…' : ''}
          </p>

          {step === 1 && (
            <div className="space-y-4">
              <h4 ref={headingRef} tabIndex={-1} className="font-semibold text-ink focus:outline-none">Elija el reporte del día</h4>
              <p className="flex items-start gap-2 rounded-lg bg-cream px-3 py-2 text-sm text-ink">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-purple" aria-hidden="true" />
                <span>
                  <strong className="font-semibold">Dónde descargarlo:</strong> MultiCobros → Analítica → Reportes →
                  Transacciones Payworks 2 → Exportar.
                </span>
              </p>
              <div
                role="presentation"
                data-testid="mc-dropzone"
                onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={`rounded-xl2 border-2 border-dashed px-4 py-8 text-center transition-colors ${dragging ? 'border-purple bg-brand-50' : 'border-line bg-cream-2'}`}
              >
                <FileUp size={32} aria-hidden="true" className="mx-auto mb-3 text-purple" />
                <p className="text-sm font-medium text-ink">Arrastre aquí el archivo «MovimientosPayworks_export…»</p>
                <p className="mb-4 mt-1 text-xs text-muted">Acepta .xlsx o .csv, hasta 2 MB (5,000 operaciones).</p>
                <label className="btn-primary inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm focus-within:ring-2 focus-within:ring-purple/40 focus-within:ring-offset-2">
                  <FileSpreadsheet size={16} aria-hidden="true" /> Elegir archivo
                  <input
                    ref={inputRef}
                    type="file"
                    accept={MC_ACCEPT}
                    className="sr-only"
                    aria-label="Elegir el reporte de MultiCobros (.xlsx o .csv, hasta 2 MB)"
                    disabled={!!busy}
                    onChange={(e) => pick(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
              {file && (
                <div className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2">
                  <FileSpreadsheet className="h-5 w-5 shrink-0 text-purple" aria-hidden="true" />
                  <p className="min-w-0 flex-1 text-sm">
                    <span className="block break-all font-medium text-ink">{file.name}</span>
                    <span className="block text-xs text-muted">{kb(file.size)}{report ? ' · ya revisado' : ''}</span>
                  </p>
                  <button
                    type="button"
                    onClick={clearFile}
                    disabled={!!busy}
                    aria-label={`Quitar el archivo ${file.name}`}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-cream hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:opacity-50"
                  >
                    <X className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
              )}
              {problem && <ProblemBox problem={problem} />}
              <p className="flex items-start gap-1.5 text-xs text-muted">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                El archivo solo se lee para esta revisión y no se guarda. Nada cambia hasta que pulse «Verificar».
              </p>
            </div>
          )}

          {step === 2 && report && (
            <ReviewStep
              report={report}
              headingRef={headingRef}
              filter={filter}
              onFilter={setFilter}
              reconciled={reconciled}
              onReconcile={setReconciling}
              problem={problem}
            />
          )}

          {step === 3 && shown && (
            <DoneStep
              report={shown}
              headingRef={headingRef}
              filter={filter}
              onFilter={setFilter}
              reconciled={reconciled}
              onReconcile={setReconciling}
              onClose={onClose}
            />
          )}
        </div>

        <ActionBar>
          {step === 1 && (
            <>
              <Button variant="secondary" onClick={requestClose}>Cancelar</Button>
              <Button className="flex-1 sm:flex-none" onClick={review} loading={busy === 'checking'} disabled={!file || (!!problem && !problem.retry)}>
                {busy === 'checking' ? 'Revisando…' : report ? 'Continuar' : <><FileSearch className="h-4 w-4" aria-hidden="true" /> Revisar reporte</>}
              </Button>
            </>
          )}
          {step === 2 && report && (
            <VerifyActions
              count={report.counts.verificar}
              busy={busy === 'committing'}
              onBack={() => { setProblem(null); go(1); }}
              onCommit={commit}
            />
          )}
          {step === 3 && (
            <>
              <Button variant="secondary" onClick={restart}>Subir otro reporte</Button>
              <Button className="flex-1 sm:flex-none" onClick={onClose}>Listo</Button>
            </>
          )}
        </ActionBar>
      </div>

      {reconciling && (
        <Modal open onClose={() => setReconciling(null)} title="Conciliar con MultiCobros" maxWidth={520}>
          <ReconcileBanorteForm
            row={asBanorteRow(reconciling)}
            prefill={reconciling.prefill ?? undefined}
            onDone={() => setReconciled((prev) => new Set(prev).add(rowKey(reconciling)))}
            onClose={() => setReconciling(null)}
          />
        </Modal>
      )}
    </Modal>
  );
}

function StepIndicator({ step }: { step: Step }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-label="Pasos">
      {STEPS.map((s, i) => {
        const current = s.n === step;
        const past = s.n < step;
        return (
          <li key={s.n} aria-current={current ? 'step' : undefined} className="flex items-center gap-2">
            <span className={`flex items-center gap-1.5 ${current ? 'font-semibold text-purple' : past ? 'text-green-700' : 'text-muted'}`}>
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                current ? 'bg-purple text-white' : past ? 'bg-green-50 text-green-700 ring-1 ring-green-600/30' : 'bg-cream-2 text-muted'}`}>
                {past ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : s.n}
              </span>
              {s.label}
              {past && <span className="sr-only"> (hecho)</span>}
            </span>
            {i < STEPS.length - 1 && <span className="h-px w-5 bg-line sm:w-10" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

/** Pinned to the bottom of the dialog (the screen, on phones), above the safe area. */
function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-line bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:-mx-6 sm:px-6 sm:pb-6">
      <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  );
}

function VerifyActions({ count, busy, onBack, onCommit }: { count: number; busy: boolean; onBack: () => void; onCommit: () => void }) {
  return (
    <>
      {count === 0 && (
        <p id="mc-nothing" className="flex w-full items-start gap-1.5 text-sm text-muted sm:mr-auto sm:w-auto sm:flex-1">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          No hay pagos para verificar: ninguno coincide por completo con MultiCobros, o ya están verificados.
        </p>
      )}
      <Button variant="secondary" onClick={onBack} disabled={busy}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Atrás
      </Button>
      <Button className="flex-1 sm:flex-none" onClick={onCommit} loading={busy} disabled={count === 0} aria-describedby={count === 0 ? 'mc-nothing' : undefined}>
        {busy ? 'Verificando…' : <><ShieldCheck className="h-4 w-4" aria-hidden="true" /> Verificar {n(count, 'pago', 'pagos')}</>}
      </Button>
    </>
  );
}

function ProblemBox({ problem }: { problem: McProblem }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-coral/40 bg-coral-50 px-4 py-3 text-sm text-ink">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-coral-700" aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <p className="font-semibold">{problem.title}</p>
        {problem.detail && problem.detail !== problem.title && <p>{problem.detail}</p>}
        <p><strong className="font-semibold">Qué hacer:</strong> {problem.next}</p>
      </div>
    </div>
  );
}

interface ListProps {
  filter: Filter;
  onFilter: (f: Filter) => void;
  reconciled: Set<string>;
  onReconcile: (row: McRow) => void;
}
type HeadingRef = React.RefObject<HTMLHeadingElement>;

function ReviewStep({ report, problem, headingRef, filter, onFilter, reconciled, onReconcile }: ListProps & {
  report: McReport; problem: McProblem | null; headingRef: HeadingRef;
}) {
  const { counts } = report;
  const alarms = counts.diferencia + counts.no_aprobada_en_multicobros + counts.no_aparece;
  const cards = GROUPS.map((g) => {
    const value = g.outcomes.reduce((sum, o) => sum + counts[o], 0);
    // Red and amber only when there is something there; «Otros» turns amber
    // when it holds a refund of one of our payments.
    const tone: CardTone = g.key === 'otros' ? (counts.devolucion ? 'warn' : 'muted') : value ? g.tone : 'muted';
    const hint = g.key === 'otros' && counts.devolucion ? n(counts.devolucion, 'devolución', 'devoluciones') : undefined;
    return { key: g.key as Filter, label: g.label, icon: g.icon, value, tone, hint };
  });
  return (
    <div className="flex min-h-0 flex-auto flex-col gap-4">
      <div>
        <h4 ref={headingRef} tabIndex={-1} className="font-semibold text-ink focus:outline-none">Revise antes de verificar</h4>
        <p className="text-sm text-muted">
          {n(report.total_rows, 'operación', 'operaciones')}{dateRange(report)}. Nada se ha guardado todavía.
        </p>
      </div>
      <StatButtons cards={cards} filter={filter} onFilter={onFilter} label="Filtrar por resultado" />
      {alarms > 0 && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-coral/40 bg-coral-50 px-4 py-3 text-sm text-ink">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-coral-700" aria-hidden="true" />
          <p>
            <strong className="font-semibold">{n(alarms, 'pago no coincide', 'pagos no coinciden')} con MultiCobros.</strong>{' '}
            No los cargue en el POS y avise a dirección. Nunca se verifican desde el reporte.
          </p>
        </div>
      )}
      {problem && <ProblemBox problem={problem} />}
      <Rows key={filter} rows={report.rows} done={false} filter={filter} onFilter={onFilter} reconciled={reconciled} onReconcile={onReconcile} />
    </div>
  );
}

function DoneStep({ report, onClose, headingRef, filter, onFilter, reconciled, onReconcile }: ListProps & {
  report: McReport; onClose: () => void; headingRef: HeadingRef;
}) {
  const verified = report.verified ?? 0;
  const applied = report.applied ?? 0;
  const waiting = report.waiting ?? 0;
  const inWallet = Math.max(0, verified - applied - waiting);
  const attention = report.rows.filter(needsAttention).length;
  const cards: StatCard[] = [
    { key: 'verificar', label: 'Verificados', icon: ShieldCheck, value: verified, tone: verified ? 'primary' : 'muted' },
    { key: 'applied', label: 'Aplicados al saldo (ya en Loyverse)', icon: Wallet, value: applied, tone: applied ? 'primary' : 'muted' },
    { key: 'waiting', label: 'Esperan la carga en el POS', icon: Clock, value: waiting, tone: waiting ? 'warn' : 'muted' },
    ...(attention ? [{ key: 'attention' as Filter, label: 'Requieren atención', icon: AlertTriangle, value: attention, tone: 'alarm' as CardTone }] : []),
  ];
  return (
    <div className="flex min-h-0 flex-auto flex-col gap-4">
      <div role="status" className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
        verified ? 'border-green-600/25 bg-green-50 text-green-800' : 'border-line bg-cream text-ink'}`}>
        {verified
          ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-700" aria-hidden="true" />
          : <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />}
        <div className="min-w-0 space-y-1">
          <h4 ref={headingRef} tabIndex={-1} className="font-semibold focus:outline-none">
            {verified ? `${n(verified, 'pago verificado', 'pagos verificados')} en MultiCobros.` : 'No se verificó ningún pago.'}
          </h4>
          {applied > 0 && <p>{n(applied, 'ya estaba en Loyverse y se aplicó', 'ya estaban en Loyverse y se aplicaron')} al saldo; se avisó a la familia.</p>}
          {waiting > 0 && <p>{n(waiting, 'se aplica solo', 'se aplican solos')} en cuanto los cargue en el POS de Loyverse.</p>}
          {inWallet > 0 && <p>{n(inWallet, 'ya estaba', 'ya estaban')} en el saldo de la plataforma: márquelos en «Cargar en POS» al cargarlos en Loyverse.</p>}
          {waiting > 0 && (
            <p>
              <Link to={POR_APLICAR} onClick={onClose} className="inline-flex min-h-[44px] items-center font-semibold text-purple underline underline-offset-2 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 sm:min-h-0">
                Ir a «Por aplicar»
              </Link>
            </p>
          )}
        </div>
      </div>
      <StatButtons cards={cards} filter={filter} onFilter={onFilter} label="Filtrar el resultado" />
      <Rows key={filter} rows={report.rows} done filter={filter} onFilter={onFilter} reconciled={reconciled} onReconcile={onReconcile} />
    </div>
  );
}

interface StatCard { key: Filter; label: string; icon: LucideIcon; value: number; tone: CardTone; hint?: string }

const CARD_TONE: Record<CardTone, string> = {
  primary: 'border-brand-600/20 bg-brand-50 text-brand-700',
  alarm: 'border-coral/40 bg-coral-50 text-coral-700',
  warn: 'border-amber/40 bg-amber/[0.08] text-ink',
  muted: 'border-line bg-cream text-muted',
};

/** Stat cards that filter the list (real toggle buttons). */
function StatButtons({ cards, filter, onFilter, label }: { cards: StatCard[]; filter: Filter; onFilter: (f: Filter) => void; label: string }) {
  return (
    <div className={`grid grid-cols-2 gap-2 ${cards.length > 4 ? 'sm:grid-cols-3 lg:grid-cols-6' : 'md:grid-cols-4'}`} role="group" aria-label={label}>
      {cards.map(({ key, label: text, icon: Icon, value, tone, hint }) => {
        const active = filter === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => onFilter(active ? 'all' : key)}
            className={`relative flex min-h-[72px] items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-2 ${CARD_TONE[tone]} ${
              active ? 'ring-2 ring-purple ring-offset-1' : 'hover:border-purple/50'}`}
          >
            <Icon className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block font-head text-xl font-semibold leading-7 tabular-nums">{value}</span>
              <span className="block text-xs font-medium leading-4">{text}</span>
              {hint && <span className="mt-0.5 block text-[11px] leading-4">{hint}</span>}
            </span>
            {active && <Check className="absolute right-2 top-2 h-4 w-4 text-purple" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

function OutcomeBadge({ row, done }: { row: McRow; done: boolean }) {
  const o = OUTCOME[row.outcome];
  const Icon = done && row.outcome === 'verificar' ? CheckCircle2 : o.icon;
  return (
    <Badge variant={o.tone} className="gap-1 whitespace-normal text-left lg:whitespace-nowrap">
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {done && o.done ? o.done : o.label}
    </Badge>
  );
}

function Rows({ rows, done, filter, onFilter, reconciled, onReconcile }: ListProps & { rows: McRow[]; done: boolean }) {
  const matching = useMemo(() => rows.filter((r) => inFilter(r, filter)), [rows, filter]);
  // One layout in the DOM: cards below 768 px (phones and small tablets, the
  // console's DataTable breakpoint), the table from 768 px.
  const isTable = useMediaQuery('(min-width: 768px)');
  // The callers key this list by filter: a new filter starts again at PAGE.
  const [limit, setLimit] = useState(PAGE);
  const visible = matching.slice(0, limit);
  const conciliar = (r: McRow) => (r.outcome === 'por_conciliar' && r.pago_id != null ? (
    reconciled.has(rowKey(r)) ? (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Conciliada
      </span>
    ) : (
      <Button size="sm" variant="secondary" onClick={() => onReconcile(r)}
        aria-label={`Conciliar con MultiCobros el pago de ${r.student_name || `PAGO${r.pago_id}`}`}>
        <FileSearch className="h-3.5 w-3.5" aria-hidden="true" /> Conciliar
      </Button>
    )) : null);
  const tint = (r: McRow) => (OUTCOME[r.outcome].level === 'alarm' ? 'bg-coral-50/70' : OUTCOME[r.outcome].level === 'warn' ? 'bg-amber/[0.07]' : '');
  const reasonCls = (r: McRow) => (OUTCOME[r.outcome].level === 'alarm' ? 'font-medium text-coral-700' : 'text-ink');
  const facts = (r: McRow) => [r.control_number, r.card_last4 && `Tarjeta ···· ${r.card_last4}`, r.tipo && r.tipo.toLowerCase() !== 'venta' && r.tipo]
    .filter(Boolean).join(' · ');
  const who = (r: McRow) => (
    <>
      <span className="block break-words font-medium text-ink">{r.student_name || <span className="font-normal text-muted">Sin alumno en la plataforma</span>}</span>
      <span className="block text-xs text-muted">
        {[r.student_code, r.pago_id != null ? `PAGO${r.pago_id}` : ''].filter(Boolean).join(' · ') || ' '}
      </span>
    </>
  );
  const when = (r: McRow) => (r.date ? `${day(r.date)}${r.time ? `, ${r.time}` : ''}` : '-');

  return (
    <div className="flex min-h-0 flex-auto flex-col gap-2">
      {filter !== 'all' && (
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
          <span>Mostrando {n(matching.length, 'operación', 'operaciones')} de {rows.length}.</span>
          <button type="button" onClick={() => onFilter('all')}
            className="inline-flex min-h-[44px] items-center font-semibold text-purple underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 sm:min-h-0">
            Ver todas
          </button>
        </p>
      )}
      {matching.length === 0 ? (
        <div className="rounded-xl2 border border-line bg-cream px-4 py-8 text-center text-sm text-muted">
          <ListChecks className="mx-auto mb-2 h-6 w-6" aria-hidden="true" /> Nada con este filtro.
        </div>
      ) : (
        <>
          {/* Below 768 px: one card per operation, nothing scrolls sideways. */}
          {!isTable && <ul className="space-y-2" aria-label="Operaciones del reporte">
            {visible.map((r) => (
              <li key={rowKey(r)} className={`rounded-xl2 border border-line p-3 ${tint(r) || 'bg-white'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">{who(r)}</div>
                  <span className="shrink-0 text-right font-semibold tabular-nums text-ink">{r.amount ? formatMXN(r.amount) : '-'}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <OutcomeBadge row={r} done={done} />
                  <span className="text-xs text-muted">{when(r)}</span>
                </div>
                <p className={`mt-2 text-sm ${reasonCls(r)}`}>{r.message}</p>
                {facts(r) && <p className="mt-1 break-all font-mono text-xs text-muted">{facts(r)}</p>}
                {conciliar(r) && <div className="mt-2 [&>button]:w-full">{conciliar(r)}</div>}
              </li>
            ))}
          </ul>}
          {/* 768 px and up: a compact table, the one part of the dialog that
              scrolls. ``hidden md:block`` keeps index.css's card mode off it. */}
          {isTable && <div className="admin-table-wrap hidden min-h-[240px] flex-auto max-h-none md:block">
            <table className="admin-table admin-table--dense">
              <caption className="sr-only">Operaciones del reporte de MultiCobros</caption>
              <thead>
                <tr>
                  <th scope="col">Alumno y matrícula</th>
                  <th scope="col" className="!text-right">Monto</th>
                  <th scope="col" className="hidden lg:table-cell">Fecha</th>
                  <th scope="col">Resultado</th>
                  <th scope="col">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={rowKey(r)} className={tint(r)}>
                    <td className="min-w-[150px] max-w-[240px] align-top">
                      {who(r)}
                      <span className="block text-xs text-muted lg:hidden">{when(r)}</span>
                    </td>
                    <td className="num align-top font-semibold text-ink">{r.amount ? formatMXN(r.amount) : '-'}</td>
                    <td className="hidden whitespace-nowrap align-top text-xs text-muted lg:table-cell">{when(r)}</td>
                    <td className="min-w-[130px] align-top lg:min-w-[200px]"><OutcomeBadge row={r} done={done} /></td>
                    <td className="min-w-[200px] align-top">
                      <p className={`text-[13px] leading-5 ${reasonCls(r)}`}>{r.message}</p>
                      {facts(r) && <p className="break-all font-mono text-[11px] text-muted">{facts(r)}</p>}
                      {conciliar(r) && <div className="mt-1.5">{conciliar(r)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
          {matching.length > visible.length && (
            <div className="flex justify-center">
              <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
                Mostrar {Math.min(PAGE, matching.length - visible.length)} más (quedan {matching.length - visible.length})
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
