import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { apiErrorMessage } from '@/lib/apiErrors';
import type { BulkActionDef, BulkRequest, BulkResult } from '@/services/api';
import type { RowKey } from '@/hooks/useRowSelection';

interface Props {
  open: boolean;
  onClose: () => void;
  action: BulkActionDef | null;
  /** Plural noun for the plan: "reservas", "alumnos", "pagos". */
  entityLabel: string;
  /** Grammatical gender of `entityLabel` for the participles (procesadas / procesados). */
  gender?: 'f' | 'm';
  ids: RowKey[];
  /** With `allMatching`, the server resolves the ids from `filters`. */
  allMatching?: boolean;
  filters?: BulkRequest['filters'];
  /** Runs the request; wire it to `useBulk(entity, api).mutateAsync`. */
  execute: (body: BulkRequest) => Promise<BulkResult>;
  /** Called after a committed run (also after a retry), with the last result. */
  onDone?: (result: BulkResult) => void;
  /** Action parameters collected by the page (e.g. `{tag}`), sent with the dry run and the commit. */
  extraPayload?: Record<string, unknown>;
}

type Phase = 'planning' | 'plan' | 'plan-error' | 'running' | 'done';

/** Group skip reasons: "2 se omitirán porque ya están canceladas". */
function groupReasons(items: { reason: string }[]): { reason: string; n: number }[] {
  const map = new Map<string, number>();
  for (const s of items) map.set(s.reason, (map.get(s.reason) ?? 0) + 1);
  return Array.from(map, ([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n);
}

/**
 * Bulk confirmation in two steps (Data Ops round, C5): a `dry_run` first,
 * rendered as a plan ("Se confirmarán 14 reservas; 2 se omitirán porque ya
 * están canceladas"), then the commit, then per-row failures with
 * "Reintentar fallidas". Reverse transitions ask for a note; actions that
 * notify families expose the checkbox.
 */
export function BulkConfirmDialog({ open, onClose, action, entityLabel, gender = 'f', ids, allMatching = false, filters, execute, onDone, extraPayload }: Props) {
  const title = action ? `${action.label}: ${allMatching ? `tod${gender === 'm' ? 'os' : 'as'} l${gender === 'm' ? 'os' : 'as'} que coinciden` : `${ids.length} ${entityLabel}`}` : '';
  return (
    <Modal open={open && !!action} onClose={onClose} title={title} maxWidth={520}>
      {action && (
        // Modal unmounts its children when closed, so every opening is a fresh
        // body with its own dry run; the key only guards an action switch while open.
        <BulkConfirmBody
          key={action.name}
          action={action}
          entityLabel={entityLabel}
          gender={gender}
          ids={ids}
          allMatching={allMatching}
          filters={filters}
          execute={execute}
          onDone={onDone}
          onClose={onClose}
          extraPayload={extraPayload}
        />
      )}
    </Modal>
  );
}

function BulkConfirmBody({ action, entityLabel, gender = 'f', ids, allMatching, filters, execute, onDone, onClose, extraPayload }: Omit<Props, 'open' | 'action'> & { action: BulkActionDef }) {
  // es-MX participles agree with the entity noun: "reservas procesadas", "pagos procesados".
  const p = (stem: string) => `${stem}${gender === 'm' ? 'o' : 'a'}s`;
  const [phase, setPhase] = useState<Phase>('planning');
  const [plan, setPlan] = useState<BulkResult | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(true);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // Snapshot the selection at mount: `onDone` typically clears it while the
  // summary is still on screen, and a retry must target the ids that were
  // confirmed, not whatever the table holds now.
  const [snapshot] = useState(() => ({ ids, allMatching, filters, extraPayload }));
  const base = useMemo<Omit<BulkRequest, 'dry_run'>>(
    () => ({
      action: action.name,
      ids: snapshot.allMatching ? [] : snapshot.ids,
      all_matching: snapshot.allMatching,
      filters: snapshot.allMatching ? snapshot.filters : undefined,
      ...(snapshot.extraPayload ? { payload: snapshot.extraPayload } : {}),
    }),
    [action.name, snapshot],
  );

  const runDryRun = () => {
    setPhase('planning');
    setError('');
    execute({ ...base, dry_run: true })
      .then((r) => { setPlan(r); setPhase('plan'); })
      .catch((e) => { setError(apiErrorMessage(e, 'No se pudo preparar la acción.')); setPhase('plan-error'); });
  };
  // The dialog opens straight into the dry run; the body is keyed by the
  // selection, so a new selection is a fresh mount with its own plan.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    runDryRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus follows the phase: the note first when one is required, else the confirm button.
  useEffect(() => {
    if (phase === 'plan') (action.requiresNote ? noteRef.current : confirmRef.current)?.focus();
  }, [phase, action.requiresNote]);

  const payload = (): Record<string, unknown> => {
    const p: Record<string, unknown> = { ...(snapshot.extraPayload ?? {}) };
    if (action.requiresNote) p.note = note.trim();
    if (action.notifyOption) p.notify = notify;
    return p;
  };

  const commit = (subset?: RowKey[]) => {
    setPhase('running');
    setError('');
    const body: BulkRequest = subset
      ? { action: action.name, ids: subset, all_matching: false, payload: payload(), dry_run: false }
      : { ...base, payload: payload(), dry_run: false };
    execute(body)
      .then((r) => { setResult(r); setPhase('done'); onDone?.(r); })
      .catch((e) => { setError(apiErrorMessage(e, 'No se pudo aplicar la acción.')); setPhase('plan'); });
  };

  const verb = action.planVerb ?? `Se aplicará «${action.label}» a`;
  const willRun = plan ? plan.requested - plan.skipped.length - plan.failed.length : 0;
  const noteMissing = !!action.requiresNote && note.trim().length < 3;
  const skipGroups = plan ? groupReasons(plan.skipped) : [];

  return (
    <div className="space-y-4">
      {phase === 'planning' && (
        <p role="status" className="text-sm text-muted">Preparando la acción…</p>
      )}

      {phase === 'plan-error' && (
        <div className="space-y-3">
          <p className="text-sm text-coral-700" role="alert">{error}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>Cerrar</Button>
            <Button type="button" size="sm" onClick={runDryRun}><RefreshCw size={14} aria-hidden="true" /> Reintentar</Button>
          </div>
        </div>
      )}

      {(phase === 'plan' || phase === 'running') && plan && (
        <>
          <div className="flex gap-3">
            <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${action.danger ? 'bg-coral-50 text-coral-600' : 'bg-brand-50 text-purple'}`}>
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="space-y-1 text-sm text-muted">
              <p>
                {verb} <strong className="text-ink">{willRun.toLocaleString('es-MX')}</strong> {entityLabel}
                {plan.skipped.length > 0 && (
                  <>; <strong className="text-ink">{plan.skipped.length}</strong> se omitirán</>
                )}
                .
              </p>
              {skipGroups.length > 0 && (
                <ul className="list-disc pl-5 text-xs" aria-label="Motivos de omisión">
                  {skipGroups.map((g) => (
                    <li key={g.reason}>{g.n} porque {g.reason}</li>
                  ))}
                </ul>
              )}
              {plan.failed.length > 0 && (
                <p className="text-xs text-coral-700">{plan.failed.length} no se pueden procesar (ver detalle al terminar).</p>
              )}
              {snapshot.allMatching && <p className="text-xs">Se aplicará a tod{gender === 'm' ? 'os los' : 'as las'} {entityLabel} que coinciden con los filtros actuales.</p>}
            </div>
          </div>

          {action.requiresNote && (
            <div>
              <label htmlFor="bulk-note" className="label">Motivo (obligatorio)</label>
              <textarea
                id="bulk-note"
                ref={noteRef}
                className="input-field min-h-[88px]"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Se guardará en la bitácora de auditoría."
                aria-describedby="bulk-note-hint"
              />
              <p id="bulk-note-hint" className="mt-1 text-xs text-muted">Mínimo 3 caracteres.</p>
            </div>
          )}

          {action.notifyOption && (
            <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm text-ink">
              <input type="checkbox" className="h-4 w-4 rounded border-line text-purple focus:ring-purple/40" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              Notificar a las familias
            </label>
          )}

          {error && <p className="text-sm text-coral-700" role="alert">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={phase === 'running'}>Cancelar</Button>
            <Button
              ref={confirmRef}
              type="button"
              variant={action.danger ? 'danger' : 'primary'}
              size="sm"
              loading={phase === 'running'}
              disabled={willRun === 0 || noteMissing}
              onClick={() => commit()}
            >
              {action.label} ({willRun.toLocaleString('es-MX')})
            </Button>
          </div>
        </>
      )}

      {phase === 'done' && result && (
        <div className="space-y-3">
          <div className="flex gap-3">
            <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${result.failed.length ? 'bg-amber/10 text-amber' : 'bg-green-50 text-green-700'}`}>
              {result.failed.length ? <AlertTriangle className="h-5 w-5" aria-hidden="true" /> : <CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
            </span>
            <div className="text-sm text-muted" role="status">
              <p>
                <strong className="text-ink">{result.ok.toLocaleString('es-MX')}</strong> {entityLabel} {p('procesad')}
                {result.skipped.length > 0 && <>, {result.skipped.length} {p('omitid')}</>}
                {result.failed.length > 0 && <>, <strong className="text-coral-700">{result.failed.length} {p('fallid')}</strong></>}.
              </p>
            </div>
          </div>
          {result.failed.length > 0 && (
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-line bg-cream-2 p-2 text-xs" aria-label="Filas fallidas">
              {result.failed.map((f) => (
                <li key={String(f.id)} className="flex gap-2">
                  <span className="font-mono text-subtle">#{f.id}</span>
                  <span className="text-ink">{f.error}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            {result.failed.length > 0 && (
              <Button type="button" variant="secondary" size="sm" onClick={() => commit(result.failed.map((f) => f.id))}>
                <RefreshCw size={14} aria-hidden="true" /> Reintentar fallidas ({result.failed.length})
              </Button>
            )}
            <Button type="button" size="sm" onClick={onClose}>Cerrar</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default BulkConfirmDialog;
