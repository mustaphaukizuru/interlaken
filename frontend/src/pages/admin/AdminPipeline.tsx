import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Clock } from 'lucide-react';
import { clsx } from 'clsx';
import { PageHeader } from '@/components/layout/PageHeader';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { ALL_STAGES, STAGE_META, isStale, waitingText, type StageKey } from '@/lib/caseStages';
import { casesApi, caseKeys, type CaseListParams, type CaseRow } from '@/hooks/queries/cases';

/** Cards per column; the column header links to the full list when there are more. */
export const BOARD_LIMIT = 30;

/** Open stages show who waited longest first; Inscritos and Cerrados, the latest. */
export function columnParams(stage: StageKey): CaseListParams {
  const done = stage === 'inscrito' || stage === 'cerrado';
  return { stage, page_size: done ? 12 : BOARD_LIMIT, ordering: done ? '-stage_changed_at' : 'stage_changed_at' };
}

/**
 * /admin/admisiones/pipeline — the admission cases as a board (Fase 5): one
 * column per stage (Informes → Inscrito) plus Cerrados, with each column's
 * count, the child, grade, next step and days waiting. A card opens its
 * Expediente, where everything is done («Marcar como inscrito» included).
 */
export default function AdminPipeline() {
  const navigate = useNavigate();
  // One query for the six columns. (Not useQueries: it would add QueriesObserver
  // to the shared @tanstack chunk that every public page downloads.)
  const { data, isError, isLoading, refetch } = useQuery({
    queryKey: caseKeys.list({ board: true }),
    queryFn: () => Promise.all(ALL_STAGES.map(async (stage) => (await casesApi.list(columnParams(stage))).data)),
  });
  const counts = data?.find((c) => c.counts)?.counts ?? {};

  return (
    <>
      <PageHeader
        title="Pipeline de admisiones"
        subtitle="Cada expediente en su etapa, del primer informe a la inscripción. Toque una tarjeta para abrir su expediente."
        actions={(
          <Link to="/admin/admisiones" className="btn-outline inline-flex min-h-[44px] items-center gap-2">
            Lista de expedientes
          </Link>
        )}
      />
      {isError ? <ErrorState onRetry={() => refetch()} /> : isLoading || !data ? <ListSkeleton /> : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6" role="list" aria-label="Etapas del proceso">
          {ALL_STAGES.map((stage, i) => {
            const meta = STAGE_META[stage];
            const Icon = meta.icon;
            const cards = data[i]?.results ?? [];
            const total = counts[stage] ?? cards.length;
            return (
              <section key={stage} role="listitem" aria-labelledby={`col-${stage}`} className="flex min-w-0 flex-col rounded-xl2 bg-cream-2 p-2">
                <div className={clsx('mb-2 h-1 rounded-full', meta.dot)} aria-hidden="true" />
                <h2 id={`col-${stage}`} className="mb-2 flex items-center justify-between gap-2 px-1 text-sm font-bold text-ink">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <Icon size={15} className={meta.text} aria-hidden="true" />
                    <span className="truncate">{stage === 'cerrado' ? 'Cerrados' : meta.label}</span>
                  </span>
                  <span className="rounded-full bg-white px-2 text-xs font-semibold tabular-nums text-muted" aria-label={`${total} expedientes`}>{total}</span>
                </h2>
                <ul className="space-y-2">
                  {cards.length === 0 && <li className="rounded-lg border border-dashed border-line p-3 text-center text-xs text-subtle">Sin expedientes</li>}
                  {cards.map((c) => <BoardCard key={c.id} card={c} onOpen={() => navigate(`/admin/admisiones/${c.id}`)} />)}
                </ul>
                {total > cards.length && (
                  <Link to={`/admin/admisiones?etapa=${stage}`} className="mt-2 inline-flex min-h-[44px] items-center justify-center gap-1 rounded-lg text-xs font-semibold text-purple hover:bg-white">
                    Ver los {total} <ArrowRight size={13} aria-hidden="true" />
                  </Link>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function BoardCard({ card: c, onOpen }: { card: CaseRow; onOpen: () => void }) {
  const done = c.stage === 'inscrito' || c.stage === 'cerrado';
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Abrir el expediente de ${c.child_name}`}
        className="block min-h-[44px] w-full rounded-xl border border-line bg-white p-3 text-left text-sm shadow-card transition hover:border-purple/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
      >
        <span className="block truncate font-semibold text-ink">{c.child_name}</span>
        <span className="block truncate text-xs text-subtle">{c.grade_applying} · {c.parent_name}</span>
        {c.stage === 'cerrado' && c.closed_outcome_label && <span className="mt-1.5 block text-xs text-coral-700">{c.closed_outcome_label}</span>}
        {c.next_action && <span className="mt-1.5 block text-xs font-medium text-ink">{c.next_action.label}</span>}
        {!done && (
          <span className={clsx('mt-1 inline-flex items-center gap-1 text-xs', isStale(c.days_waiting) ? 'font-semibold text-amber' : 'text-muted')}>
            <Clock size={12} aria-hidden="true" /> {waitingText(c.days_waiting)}
          </span>
        )}
      </button>
    </li>
  );
}
