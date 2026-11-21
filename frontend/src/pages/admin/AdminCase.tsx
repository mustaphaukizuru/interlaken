import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, ArrowRightLeft, Ban, ChevronDown, Clock, FileText, Mail, MessageCircle, Phone, RotateCcw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Dropdown } from '@/components/ui/Dropdown';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { StudentFichaDownload } from '@/components/admin/FichaDownloads';
import { StageChip } from '@/components/admin/admissions/StageChip';
import { StageBar, stepStates } from '@/components/admin/admissions/case/StageBar';
import { cardDomId, cardToggleId } from '@/components/admin/admissions/case/StageCard';
import { InformesCard } from '@/components/admin/admissions/case/InformesCard';
import { VisitaCard } from '@/components/admin/admissions/case/VisitaCard';
import { ExamenCard } from '@/components/admin/admissions/case/ExamenCard';
import { DocumentacionCard } from '@/components/admin/admissions/case/DocumentacionCard';
import { InscripcionCard } from '@/components/admin/admissions/case/InscripcionCard';
import { CaseSidePanel, waLink } from '@/components/admin/admissions/case/CaseSidePanel';
import { SendDialog } from '@/components/admin/admissions/case/SendDialog';
import { CloseDialog, MoveDialog, ReopenDialog } from '@/components/admin/admissions/case/CaseDialogs';
import { api, downloadBlob } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { apiErrorStatus } from '@/lib/apiErrors';
import { fmtDay, isStale, phoneDigits, stageMeta, waitingText } from '@/lib/caseStages';
import { fichaErrorMessage } from '@/hooks/queries/fichaExports';
import { cuotasPreviewPath, useCase, type CaseAction, type CaseDetail } from '@/hooks/queries/cases';

type CardKey = 'informes' | 'visita' | 'examen' | 'documentacion' | 'inscrito';

/** What the «next action» button does for each code of `process.next_action`. */
type NextDo =
  | { kind: 'send'; action: CaseAction }
  | { kind: 'jump'; card: CardKey; focus?: string }
  | { kind: 'wait'; card: CardKey }
  | { kind: 'enroll' };

const NEXT: Record<string, NextDo> = {
  send_costs: { kind: 'send', action: 'send-costs' },
  send_visit_link: { kind: 'send', action: 'send-visit-link' },
  informes_outcome: { kind: 'jump', card: 'informes' },
  await_booking: { kind: 'wait', card: 'visita' },
  visit_scheduled: { kind: 'wait', card: 'visita' },
  visit_outcome: { kind: 'jump', card: 'visita' },
  schedule_exam: { kind: 'jump', card: 'examen', focus: 'exam-at' },
  send_exam_date: { kind: 'send', action: 'send-exam-date' },
  exam_scheduled: { kind: 'wait', card: 'examen' },
  exam_result: { kind: 'jump', card: 'examen' },
  send_ficha_link: { kind: 'send', action: 'send-ficha-link' },
  await_ficha: { kind: 'wait', card: 'documentacion' },
  review_documents: { kind: 'jump', card: 'documentacion' },
  record_payment: { kind: 'jump', card: 'inscrito' },
  enroll: { kind: 'enroll' },
};

function cardFor(d: CaseDetail): CardKey {
  if (d.stage === 'cerrado') {
    const from = d.closed?.from_stage;
    return (['informes', 'visita', 'examen', 'documentacion'] as string[]).includes(from ?? '') ? (from as CardKey) : 'informes';
  }
  return d.stage as CardKey;
}

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** /admin/admisiones/:caseId — the admission Expediente of one prospect (Fase 5). */
export default function AdminCase() {
  const { caseId } = useParams();
  const id = Number(caseId);
  const valid = Number.isInteger(id) && id > 0;
  const { data, isLoading, isError, error, refetch } = useCase(valid ? id : null);
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');

  if (!valid || apiErrorStatus(error) === 404) {
    return (
      <>
        <PageHeader title="Expediente" />
        <EmptyState icon={FileText} title="No encontramos este expediente"
          description="Puede que el enlace esté incompleto o que el expediente ya no exista."
          action={<Link to="/admin/admisiones" className="btn-secondary inline-flex min-h-[44px] items-center gap-2">Ir a Expedientes</Link>} />
      </>
    );
  }
  if (isError) return <><PageHeader title="Expediente" /><ErrorState onRetry={() => refetch()} /></>;
  if (isLoading || !data) {
    return (
      <div aria-busy="true">
        <PageHeader title="Expediente" />
        <ListSkeleton rows={6} />
      </div>
    );
  }
  return <CaseView key={data.id} detail={data} isAdmin={isAdmin} />;
}

function CaseView({ detail, isAdmin }: { detail: CaseDetail; isAdmin: boolean }) {
  const [open, setOpen] = useState<Set<CardKey>>(() => new Set([cardFor(detail)]));
  const [sending, setSending] = useState<CaseAction | null>(null);
  const [dialog, setDialog] = useState<'move' | 'close' | 'reopen' | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const states = stepStates(detail.stage, detail.closed?.from_stage);
  const openCase = detail.stage !== 'cerrado' && detail.stage !== 'inscrito';

  const toggle = (k: CardKey) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  const jump = useCallback((k: string, focusId?: string) => {
    setOpen((prev) => new Set(prev).add(k as CardKey));
    // After the card renders open: scroll to it and move focus there.
    window.requestAnimationFrame(() => {
      document.getElementById(cardDomId(k))?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      const target = (focusId && document.getElementById(focusId)) || document.getElementById(cardToggleId(k));
      target?.focus({ preventScroll: true });
    });
  }, []);

  const runNext = () => {
    const todo = detail.next_action ? NEXT[detail.next_action.code] : undefined;
    if (!todo) return;
    if (todo.kind === 'send') setSending(todo.action);
    else if (todo.kind === 'enroll') { jump('inscrito'); setEnrollOpen(true); }
    else jump(todo.card, todo.kind === 'jump' ? todo.focus : undefined);
  };

  const next = detail.next_action;
  const nextDo = next ? NEXT[next.code] : undefined;

  return (
    <>
      <Link to="/admin/admisiones" className="mb-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg text-sm font-semibold text-purple hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40">
        <ArrowLeft size={16} aria-hidden="true" /> Expedientes
      </Link>
      <PageHeader
        title={detail.child_name}
        subtitle={[detail.grade_applying, detail.level_label, detail.cycle ? `Ciclo ${detail.cycle}` : ''].filter(Boolean).join(' · ')}
        actions={<CaseMenu detail={detail} onPick={setDialog} />}
      />

      <div className="card mb-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Announced when an outcome moves the case (aria-live). */}
            <span data-testid="case-stage" role="status" aria-live="polite" aria-label={`Etapa: ${detail.stage_label}${detail.closed_outcome_label ? `, ${detail.closed_outcome_label}` : ''}`}>
              <StageChip stage={detail.stage} outcome={detail.closed_outcome_label} />
            </span>
            {openCase && (
              <span className={`inline-flex items-center gap-1 text-xs ${isStale(detail.days_waiting) ? 'font-semibold text-amber' : 'text-muted'}`}>
                <Clock size={13} aria-hidden="true" /> {detail.days_waiting > 0 ? `${waitingText(detail.days_waiting)} en esta etapa` : 'Llegó hoy a esta etapa'}
              </span>
            )}
          </div>
          <QuickActions detail={detail} />
        </div>

        {detail.closed && (
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-coral-50 px-4 py-3" role="status">
            <div className="min-w-0 text-sm">
              <p className="flex items-center gap-2 font-semibold text-coral-700">
                <Ban size={17} aria-hidden="true" /> Expediente cerrado: {detail.closed.outcome_label}
              </p>
              {detail.closed.reason && <p className="mt-1 text-ink">{detail.closed.reason}</p>}
              <p className="mt-1 text-xs text-muted">
                Se cerró en «{stageMeta(detail.closed.from_stage || 'informes').label}»{detail.closed.at ? ` el ${fmtDay(detail.closed.at)}` : ''}.
              </p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => setDialog('reopen')}>
              <RotateCcw size={15} aria-hidden="true" /> Reabrir
            </Button>
          </div>
        )}

        <StageBar stage={detail.stage} closedFrom={detail.closed?.from_stage} onJump={(s) => jump(s)} />

        {openCase && next && (
          <div role="group" aria-labelledby="case-next-step" className="flex flex-col gap-3 rounded-xl2 border border-line bg-cream-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p id="case-next-step" className="text-xs font-semibold uppercase tracking-wide text-subtle">Siguiente paso</p>
              <p className="text-sm font-semibold text-ink">{next.label}</p>
            </div>
            {nextDo?.kind === 'wait' ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => jump(nextDo.card)}>
                Ver la etapa <ArrowRight size={15} aria-hidden="true" />
              </Button>
            ) : nextDo ? (
              <Button type="button" onClick={runNext} className="w-full sm:w-auto">
                {next.label} <ArrowRight size={16} aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] lg:items-start">
        <div className="min-w-0 space-y-4">
          <InformesCard detail={detail} state={states.informes} open={open.has('informes')} onToggle={() => toggle('informes')} onSend={setSending} />
          <VisitaCard detail={detail} state={states.visita} open={open.has('visita')} onToggle={() => toggle('visita')} onSend={setSending} />
          <ExamenCard detail={detail} state={states.examen} open={open.has('examen')} onToggle={() => toggle('examen')} onSend={setSending} />
          <DocumentacionCard detail={detail} state={states.documentacion} open={open.has('documentacion')} onToggle={() => toggle('documentacion')}
            onSend={setSending} isAdmin={isAdmin} />
          <InscripcionCard detail={detail} state={states.inscrito} open={open.has('inscrito')} onToggle={() => toggle('inscrito')}
            isAdmin={isAdmin} enrollOpen={enrollOpen} setEnrollOpen={setEnrollOpen} />
        </div>
        <CaseSidePanel detail={detail} />
      </div>

      <SendDialog open={!!sending} onClose={() => setSending(null)} action={sending} detail={detail} isAdmin={isAdmin} />
      <MoveDialog open={dialog === 'move'} onClose={() => setDialog(null)} detail={detail} />
      <CloseDialog open={dialog === 'close'} onClose={() => setDialog(null)} detail={detail} />
      <ReopenDialog open={dialog === 'reopen'} onClose={() => setDialog(null)} detail={detail} />
    </>
  );
}

const QUICK = 'inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-line bg-white px-3.5 text-sm font-semibold text-ink transition hover:border-purple/40 hover:text-purple focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40';

/** WhatsApp, llamar, correo, «Exportar ficha» and the staff preview of «Cuotas (PDF)». */
function QuickActions({ detail }: { detail: CaseDetail }) {
  const digits = phoneDigits(detail.parent_phone);
  const wa = waLink(detail);
  const ficha = detail.ficha;
  const [busy, setBusy] = useState(false);

  const openCuotas = async () => {
    // Opened inside the tap: iPad Safari blocks a tab opened after an await.
    let win: Window | null;
    try { win = window.open('about:blank', '_blank'); } catch { win = null; }
    setBusy(true);
    try {
      const level = detail.level || 'todos';
      const res = await api.get<Blob>(cuotasPreviewPath(level), { responseType: 'blob' });
      if (win && !win.closed) {
        const url = URL.createObjectURL(res.data);
        win.location.href = url;
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        downloadBlob(res.data, `cuotas-${level}.pdf`);
      }
    } catch (e) {
      win?.close();
      toast.error(await fichaErrorMessage(e, 'No se pudieron generar las cuotas.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer" className={QUICK} aria-label={`WhatsApp a ${detail.parent_name}`}>
          <MessageCircle size={16} aria-hidden="true" /> WhatsApp
        </a>
      )}
      {digits && (
        <a href={`tel:+52${digits}`} className={QUICK} aria-label={`Llamar a ${detail.parent_name}`}>
          <Phone size={16} aria-hidden="true" /> Llamar
        </a>
      )}
      {detail.parent_email && (
        <a href={`mailto:${detail.parent_email}`} className={QUICK} aria-label={`Correo a ${detail.parent_name}`}>
          <Mail size={16} aria-hidden="true" /> Correo
        </a>
      )}
      {ficha && ficha.status !== 'draft' && <StudentFichaDownload registrationId={ficha.id} label="Exportar ficha" />}
      <button type="button" className={QUICK} onClick={() => void openCuotas()} disabled={busy}>
        <FileText size={16} aria-hidden="true" /> {busy ? 'Generando…' : 'Cuotas (PDF)'}
      </button>
    </div>
  );
}

/** «Más acciones»: change stage, close (open cases) or reopen (closed ones). */
function CaseMenu({ detail, onPick }: { detail: CaseDetail; onPick: (d: 'move' | 'close' | 'reopen') => void }) {
  const openCase = detail.stage !== 'cerrado' && detail.stage !== 'inscrito';
  if (detail.stage === 'inscrito') return null;
  const item = 'flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-ink hover:bg-cream-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40';
  return (
    <Dropdown
      width={260}
      trigger={({ open, toggle }) => (
        <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="true"
          className="btn-outline inline-flex min-h-[44px] items-center gap-2 text-sm">
          Más acciones <ChevronDown size={15} aria-hidden="true" />
        </button>
      )}
    >
      {({ close }) => (
        <div className="p-1.5">
          {openCase ? (
            <>
              <button type="button" className={item} onClick={() => { close(); onPick('move'); }}>
                <ArrowRightLeft size={16} className="text-purple" aria-hidden="true" /> Cambiar de etapa…
              </button>
              <button type="button" className={`${item} text-coral-700`} onClick={() => { close(); onPick('close'); }}>
                <Ban size={16} aria-hidden="true" /> Cerrar expediente…
              </button>
            </>
          ) : (
            <button type="button" className={item} onClick={() => { close(); onPick('reopen'); }}>
              <RotateCcw size={16} className="text-purple" aria-hidden="true" /> Reabrir expediente…
            </button>
          )}
        </div>
      )}
    </Dropdown>
  );
}
