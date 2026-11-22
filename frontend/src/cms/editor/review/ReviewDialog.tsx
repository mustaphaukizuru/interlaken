/**
 * «Revisión antes de publicar» (backend: content/publish_checks.py).
 *
 * Opened by «Revisar» and «Publicar» (or «Solicitar aprobación» for staff):
 * what blocks publishing (red) and what deserves a second look (amber), each
 * with «Ir al campo» and its one-click fix, then «Qué cambia», the draft
 * against what the site shows today as visitors will read it. «Publicar»
 * works only with nothing to correct and, when warnings remain, once
 * «Entiendo las advertencias» is ticked.
 */
import { useId, useState, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, Lightbulb, RotateCcw, Send, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { isSeoField } from './applyFix';
import { issuePlace } from './format';
import type { ReviewChange, ReviewIssue, ReviewReport } from './types';

interface Props {
  open: boolean;
  onClose: () => void;
  pageTitle: string;
  report: ReviewReport | null;
  /** The review is running (first load or after a fix). */
  loading: boolean;
  error?: string | null;
  onRetry: () => void;
  onFix: (issue: ReviewIssue) => void;
  onJump: (issue: ReviewIssue) => void;
  /** Dirección publishes; staff ask for approval. */
  canPublish: boolean;
  onPublish: (acknowledged: string[]) => void;
  publishing: boolean;
  onRequest?: () => void;
  requesting?: boolean;
  /** Already requested, or published with nothing new: the main action stays off. */
  nothingToDo?: string | null;
  /** «Descartar cambios» (pages with a published version and pending edits). */
  discard?: { onConfirm: () => void; busy: boolean; version: number | null } | null;
}

export function ReviewDialog(props: Props) {
  const { open, onClose, report, loading, error } = props;
  return (
    <Modal open={open} onClose={onClose} title="Revisión antes de publicar" maxWidth={760} fullScreenOnPhone>
      {loading && !report ? (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 text-sm text-muted" role="status">
          <LoadingSpinner /> Revisando la página…
        </div>
      ) : error && !report ? (
        <div className="space-y-3 text-sm" role="alert">
          <p className="text-coral-700">{error}</p>
          <Button variant="secondary" size="md" onClick={props.onRetry}>Volver a revisar</Button>
        </div>
      ) : report ? (
        <ReviewBody {...props} report={report} />
      ) : null}
    </Modal>
  );
}

function ReviewBody({ pageTitle, report, loading, onClose, onFix, onJump, canPublish, onPublish, publishing, onRequest, requesting, nothingToDo, discard }: Props & { report: ReviewReport }) {
  const { errors, warnings, suggestions, changes } = report;
  const warnKey = warnings.map((w) => w.key).join('|');
  // The tick counts only for the warnings it was given on: a new one unticks it.
  const [ack, setAck] = useState<{ key: string; on: boolean }>({ key: '', on: false });
  const acknowledged = ack.on && ack.key === warnKey;
  const [discarding, setDiscarding] = useState(false);
  const ackId = useId();

  const blocked = errors.length > 0;
  const needsAck = warnings.length > 0 && !acknowledged;
  const publishOff = loading || publishing || blocked || needsAck || !!nothingToDo;
  const requestOff = loading || !!requesting || blocked || !!nothingToDo;
  const why = blocked
    ? `Corrija ${errors.length === 1 ? 'el problema marcado en rojo' : `los ${errors.length} problemas marcados en rojo`} para poder ${canPublish ? 'publicar' : 'pedir la aprobación'}.`
    : canPublish && needsAck ? 'Revise las advertencias y marque «Entiendo las advertencias» para publicar.'
      : nothingToDo ?? '';

  return (
    <div className="space-y-5">
      <Summary pageTitle={pageTitle} errors={errors.length} warnings={warnings.length} loading={loading} />

      {errors.length > 0 && (
        <IssueGroup title="Por corregir" hint="Impiden publicar." tone="error" issues={errors} onFix={onFix} onJump={onJump} busy={loading} />
      )}
      {warnings.length > 0 && (
        <IssueGroup title="Advertencias" hint="Pueden publicarse, pero casi siempre son un descuido." tone="warning" issues={warnings} onFix={onFix} onJump={onJump} busy={loading} />
      )}
      {suggestions.length > 0 && (
        <details className="group rounded-xl border border-line bg-white p-3">
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink sm:min-h-[32px]">
            <ChevronDown size={16} className="shrink-0 -rotate-90 transition-transform group-open:rotate-0" aria-hidden="true" />
            <Lightbulb size={16} className="shrink-0 text-subtle" aria-hidden="true" />
            Sugerencias ({suggestions.length})
            <span className="font-normal text-subtle">· no impiden publicar</span>
          </summary>
          <ul className="mt-2 space-y-1.5 text-sm">
            {suggestions.map((s) => <li key={s.key} className="text-ink">{s.message}</li>)}
          </ul>
        </details>
      )}

      <Changes changes={changes} baseline={report.baseline} />

      <div className="sticky bottom-0 z-20 -mx-4 border-t border-line bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:-mx-6 sm:px-6 sm:pb-6">
        {warnings.length > 0 && !blocked && canPublish && (
          <label htmlFor={ackId} className="mb-3 flex min-h-[44px] items-center gap-3 rounded-lg bg-amber/10 px-3 text-sm font-semibold text-ink">
            <input
              id={ackId}
              type="checkbox"
              className="h-5 w-5 accent-purple"
              checked={acknowledged}
              onChange={(e) => setAck({ key: warnKey, on: e.target.checked })}
            />
            Entiendo las advertencias
          </label>
        )}
        {why && <p className="mb-2 text-xs text-muted" id={`${ackId}-why`}>{why}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {discard && (
            <Button variant="ghost" size="md" onClick={() => setDiscarding(true)} disabled={discard.busy || publishing} className="!text-coral-700 hover:!bg-coral-50">
              <RotateCcw size={16} aria-hidden="true" /> Descartar cambios
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="secondary" size="md" onClick={onClose}>Seguir editando</Button>
          {canPublish ? (
            <Button variant="cta" size="md" onClick={() => onPublish(warnings.map((w) => w.key))} loading={publishing} disabled={publishOff}
              aria-describedby={why ? `${ackId}-why` : undefined}>
              <Upload size={17} aria-hidden="true" /> Publicar
            </Button>
          ) : onRequest ? (
            <Button variant="cta" size="md" onClick={onRequest} loading={requesting} disabled={requestOff} aria-describedby={why ? `${ackId}-why` : undefined}>
              <Send size={17} aria-hidden="true" /> Solicitar aprobación
            </Button>
          ) : null}
        </div>
      </div>

      {discard && (
        <ConfirmDialog
          open={discarding}
          title="¿Descartar los cambios sin publicar?"
          message={`El borrador vuelve a ser igual a lo que el sitio muestra hoy${discard.version ? ` (versión ${discard.version})` : ''}. Se pierden los cambios sin publicar de esta página, también los de otras personas. Las versiones publicadas se conservan.`}
          confirmLabel="Descartar cambios"
          loading={discard.busy}
          onConfirm={() => { discard.onConfirm(); setDiscarding(false); }}
          onClose={() => setDiscarding(false)}
        />
      )}
    </div>
  );
}

function Summary({ pageTitle, errors, warnings, loading }: { pageTitle: string; errors: number; warnings: number; loading: boolean }) {
  const tone = errors ? 'border-coral-200 bg-coral-50 text-coral-700' : warnings ? 'border-amber/40 bg-amber/10 text-ink' : 'border-green-600/20 bg-green-50 text-green-700';
  const Icon = errors ? AlertCircle : warnings ? AlertTriangle : CheckCircle2;
  const text = errors
    ? `«${pageTitle}» todavía no se puede publicar: ${errors === 1 ? 'hay 1 problema' : `hay ${errors} problemas`} por corregir${warnings ? ` y ${warnings === 1 ? '1 advertencia' : `${warnings} advertencias`}` : ''}.`
    : warnings
      ? `«${pageTitle}» puede publicarse, pero revise ${warnings === 1 ? 'la advertencia' : `las ${warnings} advertencias`}.`
      : `«${pageTitle}»: todo en orden, lista para publicar.`;
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold ${tone}`} role="status" aria-live="polite">
      <Icon size={18} className="mt-px shrink-0" aria-hidden="true" />
      <span>{text}{loading && <span className="font-normal"> Revisando de nuevo…</span>}</span>
    </div>
  );
}

function IssueGroup({ title, hint, tone, issues, onFix, onJump, busy }: {
  title: string; hint: string; tone: 'error' | 'warning'; issues: ReviewIssue[]; onFix: (i: ReviewIssue) => void; onJump: (i: ReviewIssue) => void; busy: boolean;
}) {
  const headingId = useId();
  const Icon = tone === 'error' ? AlertCircle : AlertTriangle;
  const box = tone === 'error' ? 'border-coral-200 bg-coral-50/50' : 'border-amber/40 bg-amber/[0.06]';
  const icon = tone === 'error' ? 'text-coral-600' : 'text-amber';
  return (
    <section aria-labelledby={headingId}>
      <h4 id={headingId} className="mb-2 flex items-baseline gap-2 text-sm font-bold text-ink">
        {title} ({issues.length}) <span className="text-xs font-normal text-subtle">{hint}</span>
      </h4>
      <ul className="space-y-2">
        {issues.map((issue) => (
          <IssueItem key={issue.key} issue={issue} box={box} icon={<Icon size={17} className={`mt-0.5 shrink-0 ${icon}`} aria-label={tone === 'error' ? 'Por corregir' : 'Advertencia'} />} onFix={onFix} onJump={onJump} busy={busy} />
        ))}
      </ul>
    </section>
  );
}

function IssueItem({ issue, box, icon, onFix, onJump, busy }: { issue: ReviewIssue; box: string; icon: ReactNode; onFix: (i: ReviewIssue) => void; onJump: (i: ReviewIssue) => void; busy: boolean }) {
  const id = useId();
  const fix = issue.fix;
  const canJump = !!issue.block_id || isSeoField(issue.field);
  const place = issuePlace(issue);
  const showPreview = !!issue.preview && issue.code !== 'private_link';
  return (
    <li className={`rounded-xl border p-3 ${box}`} data-issue={issue.code}>
      <div className="flex items-start gap-2">
        {icon}
        <div className="min-w-0 flex-1" id={`${id}-text`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-subtle">{place}</p>
          <p className="mt-0.5 text-sm text-ink">{issue.field_message || issue.message}</p>
          {showPreview && <p className="mt-1 text-xs text-muted">Hoy se vería: <span className="font-semibold text-ink">«{issue.preview}»</span></p>}
          {fix && fix.kind !== 'show_section' && (
            <p className="mt-0.5 text-xs text-muted">Con la corrección quedará: <span className="font-semibold text-ink">{fix.preview ? `«${fix.preview}»` : '(vacío)'}</span></p>
          )}
        </div>
      </div>
      {(fix || canJump) && (
        <div className="mt-2 flex flex-wrap gap-2 pl-6">
          {fix && (
            <Button size="sm" variant="secondary" onClick={() => onFix(issue)} disabled={busy} aria-describedby={`${id}-text`}>
              {fix.label}
            </Button>
          )}
          {canJump && (
            <Button size="sm" variant="ghost" onClick={() => onJump(issue)} aria-describedby={`${id}-text`}>
              Ir al campo <ArrowRight size={14} aria-hidden="true" />
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

const CHANGE_LABEL: Record<ReviewChange['kind'], string> = {
  added: 'Sección nueva',
  removed: 'Sección quitada',
  hidden: 'Sección ocultada',
  shown: 'Sección visible otra vez',
  changed: 'Cambió',
  moved: 'Orden de las secciones',
  more: 'Más cambios',
};

const BASELINE: Record<ReviewReport['baseline'], string> = {
  published: 'Comparado con lo que el sitio muestra hoy (la versión publicada).',
  design: 'Primera publicación: comparado con el diseño original de la página.',
  none: 'Página nueva: todo lo que aparece aquí se verá en el sitio.',
};

/** «Qué cambia»: changes grouped by section, as visitors will read them. */
function Changes({ changes, baseline }: { changes: ReviewChange[]; baseline: ReviewReport['baseline'] }) {
  const headingId = useId();
  const groups: { key: string; title: string; items: ReviewChange[] }[] = [];
  for (const c of changes) {
    const key = c.field.startsWith('seo.') ? 'seo' : c.block_id ?? `${c.kind}-${groups.length}`;
    const title = c.field.startsWith('seo.') ? 'SEO (buscadores y redes)' : c.block_label
      ? `${typeof c.block_index === 'number' ? `Sección ${c.block_index + 1} · ` : ''}${c.block_label}` : 'Página';
    const g = groups.find((x) => x.key === key);
    if (g) g.items.push(c);
    else groups.push({ key, title, items: [c] });
  }
  return (
    <section aria-labelledby={headingId}>
      <h4 id={headingId} className="text-sm font-bold text-ink">Qué cambia {changes.length > 0 && <span className="font-normal text-subtle">({changes.length})</span>}</h4>
      <p className="mb-2 text-xs text-muted">{BASELINE[baseline]}</p>
      {changes.length === 0 ? (
        <p className="rounded-xl border border-line bg-cream-2 px-3 py-2.5 text-sm text-muted">No hay cambios: el borrador es igual a lo que muestra el sitio.</p>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <div key={g.key} className="rounded-xl border border-line bg-white">
              <p className="border-b border-line px-3 py-2 text-xs font-semibold text-ink">{g.title}</p>
              <ul className="divide-y divide-line">
                {g.items.map((c, n) => <ChangeRow key={`${c.kind}-${c.field}-${n}`} change={c} />)}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ChangeRow({ change: c }: { change: ReviewChange }) {
  if (c.kind !== 'changed') {
    const text = c.kind === 'removed' || c.kind === 'hidden' ? c.before : c.after;
    return (
      <li className="px-3 py-2 text-sm">
        <span className="font-semibold text-ink">{CHANGE_LABEL[c.kind]}</span>
        {text && <span className="text-muted">: «{text}»</span>}
      </li>
    );
  }
  return (
    <li className="px-3 py-2 text-sm" data-change-field={c.field}>
      <p className="text-xs font-semibold text-subtle">{c.field_label || c.field}</p>
      <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
        <dt className="text-xs text-subtle">Antes</dt>
        <dd className={`min-w-0 break-words text-muted ${c.before ? 'line-through decoration-subtle/60' : 'italic'}`}>{c.before || '(vacío)'}</dd>
        <dt className="text-xs text-subtle">Ahora</dt>
        <dd className="min-w-0 break-words font-semibold text-ink">{c.after || <span className="font-normal italic text-muted">(vacío)</span>}</dd>
      </dl>
      {c.after_code && <p className="mt-1 break-words font-mono text-[11px] text-subtle">Guardado como: {c.after_code}</p>}
    </li>
  );
}
