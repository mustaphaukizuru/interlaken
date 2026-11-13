import { useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AlertTriangle, ArrowLeft, Check, Eye, GraduationCap, Info, Search, UserRound, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useStudentsList, type RosterStudent } from '@/hooks/queries/students';
import { useFamilyLink } from '@/hooks/queries/families';
import { apiErrorMessage } from '@/lib/apiErrors';
import { familiesApi, type FamilyPlan } from '@/services/familiesApi';
import { fromRoster, gradeLine, initial, type FamilyLinkMode, type PickedStudent } from './familyUtils';

// The step's buttons stay in reach while a long preview scrolls inside the dialog.
const FOOTER = 'sticky bottom-0 z-10 -mb-2 flex flex-col-reverse gap-2 border-t border-line bg-white pb-2 pt-3 sm:flex-row sm:justify-end';

interface Props {
  open: boolean;
  onClose: () => void;
  mode: FamilyLinkMode;
  /** Skip the picker (a suggestion already names the students). */
  preselected?: PickedStudent[];
  onDone?: (plan: FamilyPlan) => void;
}

/**
 * Link siblings in two steps: pick the students (debounced roster search),
 * then review the server's dry run (who joins, which families merge, which
 * logins start seeing which children) before anything changes. Opened from
 * a student's Familia tab, from a family, or from «Nueva familia».
 */
export function FamilyLinkDialog({ open, onClose, mode, preselected, onDone }: Props) {
  const title = mode.kind === 'family' ? `Agregar a ${mode.family.name}` : mode.kind === 'new' ? 'Nueva familia' : 'Vincular hermano';
  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth={640}>
      {/* Mounted only while open: every opening starts clean. */}
      <FamilyLinkBody mode={mode} preselected={preselected} onClose={onClose} onDone={onDone} />
    </Modal>
  );
}

function FamilyLinkBody({ mode, preselected, onClose, onDone }: Omit<Props, 'open'>) {
  const [picked, setPicked] = useState<PickedStudent[]>(preselected ?? []);
  const [step, setStep] = useState<'pick' | 'review'>(preselected?.length ? 'review' : 'pick');
  const minimum = mode.kind === 'new' ? 2 : 1;
  const studentIds = useMemo(() => {
    const ids = picked.map((p) => p.id);
    return mode.kind === 'student' ? [mode.anchor.id, ...ids.filter((i) => i !== mode.anchor.id)] : ids;
  }, [picked, mode]);

  return step === 'pick' ? (
    <PickStep mode={mode} picked={picked} setPicked={setPicked} minimum={minimum}
      onCancel={onClose} onNext={() => setStep('review')} />
  ) : (
    <ReviewStep mode={mode} studentIds={studentIds}
      onBack={preselected?.length ? undefined : () => setStep('pick')}
      onCancel={onClose}
      onDone={(plan) => { onDone?.(plan); onClose(); }} />
  );
}

// ── step 1: pick ─────────────────────────────────────────────────────────────
function PickStep({ mode, picked, setPicked, minimum, onCancel, onNext }: {
  mode: FamilyLinkMode;
  picked: PickedStudent[];
  setPicked: (next: PickedStudent[]) => void;
  minimum: number;
  onCancel: () => void;
  onNext: () => void;
}) {
  const inputId = useId();
  const hintId = useId();
  const [term, setTerm] = useState('');
  const q = useDebouncedValue(term.trim(), 250);
  const searching = q.length >= 2;
  const { data, isFetching, isError, refetch } = useStudentsList(
    { page: 1, page_size: 8, q: searching ? q : undefined },
    { enabled: searching },
  );
  const results = searching ? data?.results ?? [] : [];

  const blocked = (s: RosterStudent): string | null => {
    if (s.archived_at) return 'Archivado';
    if (mode.kind === 'student' && s.id === mode.anchor.id) return 'Es este alumno';
    if (mode.kind === 'student' && mode.anchor.family && fromRoster(s).family?.id === mode.anchor.family.id) return 'Ya es su hermano';
    if (mode.kind === 'family' && mode.memberIds.includes(s.id)) return 'Ya está en esta familia';
    return null;
  };
  const isPicked = (id: number) => picked.some((p) => p.id === id);
  const toggle = (s: RosterStudent) => {
    if (isPicked(s.id)) setPicked(picked.filter((p) => p.id !== s.id));
    else setPicked([...picked, fromRoster(s)]);
  };

  const lead = mode.kind === 'student'
    ? <>Busque a los hermanos de <strong className="text-ink">{mode.anchor.name}</strong>. Puede elegir varios.</>
    : mode.kind === 'family'
      ? <>Busque a los alumnos que se suman a <strong className="text-ink">{mode.family.name}</strong>.</>
      : <>Elija al menos dos hermanos. Después verá quién gana acceso antes de confirmar.</>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{lead}</p>

      {picked.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Alumnos elegidos">
          {picked.map((p) => (
            <li key={p.id} className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 py-1 pl-3 pr-1 text-sm font-medium text-brand-700">
              {p.name}
              <button type="button" onClick={() => setPicked(picked.filter((x) => x.id !== p.id))}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 sm:h-6 sm:w-6"
                aria-label={`Quitar a ${p.name}`}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div>
        <label htmlFor={inputId} className="label">Buscar alumno</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
          {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog's only task starts here */}
          <input id={inputId} type="text" inputMode="search" autoComplete="off" autoFocus
            className="input-field min-h-[44px] pl-9 text-base sm:text-sm"
            placeholder="Nombre, apellidos o matrícula (también ci09932)"
            aria-describedby={hintId}
            value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        <p id={hintId} className="mt-1 text-xs text-subtle">Escriba al menos 2 letras.</p>
      </div>

      <div className="min-h-[180px]" aria-live="polite" aria-busy={isFetching}>
        {!searching ? (
          <p className="rounded-xl bg-cream-2 px-4 py-6 text-center text-sm text-muted">
            Los resultados aparecen mientras escribe.
          </p>
        ) : isError ? (
          <div className="rounded-xl bg-coral-50 px-4 py-4 text-sm text-coral-700">
            No se pudo buscar. <button type="button" className="font-semibold underline" onClick={() => refetch()}>Reintentar</button>
          </div>
        ) : results.length === 0 && !isFetching ? (
          <p className="rounded-xl bg-cream-2 px-4 py-6 text-center text-sm text-muted">
            Nadie coincide con «{q}». Pruebe con un solo apellido o con la matrícula.
          </p>
        ) : (
          <ul className="divide-y divide-cream overflow-hidden rounded-xl border border-line" aria-label="Resultados">
            {results.map((s) => {
              const reason = blocked(s);
              const on = isPicked(s.id);
              const fam = fromRoster(s).family;
              return (
                <li key={s.id}>
                  <button type="button" disabled={!!reason} aria-pressed={on} onClick={() => toggle(s)}
                    className={`flex min-h-[56px] w-full items-center gap-3 px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple/40 disabled:cursor-not-allowed disabled:opacity-60 ${on ? 'bg-brand-50' : 'hover:bg-cream-2'}`}>
                    <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${on ? 'bg-purple text-white' : 'bg-cream text-purple'}`}>
                      {on ? <Check className="h-4 w-4" /> : initial(s.user.full_name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{s.user.full_name}</span>
                      <span className="block truncate text-xs text-subtle">{gradeLine(s)} · Matrícula {s.student_id}</span>
                    </span>
                    {reason ? (
                      <Badge>{reason}</Badge>
                    ) : fam ? (
                      <Badge variant="info">{fam.name}</Badge>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className={FOOTER}>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button type="button" onClick={onNext} disabled={picked.length < minimum}>
          <Eye className="h-4 w-4" aria-hidden="true" />
          Revisar ({picked.length})
        </Button>
      </div>
    </div>
  );
}

// ── step 2: review the dry run, then commit ─────────────────────────────────
const HEADLINE: Record<FamilyPlan['action'], string> = {
  create: 'Se creará una familia nueva',
  add: 'Se sumarán a una familia existente',
  merge: 'Se unirán dos familias',
  none: 'Ya están en la misma familia',
};

function ReviewStep({ mode, studentIds, onBack, onCancel, onDone }: {
  mode: FamilyLinkMode;
  studentIds: number[];
  onBack?: () => void;
  onCancel: () => void;
  onDone: (plan: FamilyPlan) => void;
}) {
  const nameId = useId();
  const commit = useFamilyLink();
  // `null` until the person edits it: the plan's name shows meanwhile.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);
  const familyId = mode.kind === 'family' ? mode.family.id : undefined;
  // The dry run is a read: fresh on every opening, never retried silently,
  // and kept outside the ['admin', 'families'] keys so the commit's refresh
  // does not re-plan a change that just happened.
  const preview = useQuery({
    queryKey: ['family-link-plan', familyId ?? null, studentIds],
    queryFn: async () => (await familiesApi.link({ student_ids: studentIds, family: familyId, dry_run: true })).data,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const plan = preview.data ?? null;
  const error = preview.isError ? apiErrorMessage(preview.error, 'No se pudo preparar el cambio.') : '';
  const name = nameDraft ?? plan?.name ?? '';
  const setName = (v: string) => setNameDraft(v);
  const runPlan = () => { void preview.refetch(); };

  const submit = () => {
    if (!plan) return;
    const trimmed = name.trim();
    commit.mutate({
      student_ids: studentIds,
      family: familyId,
      name: trimmed && trimmed !== plan.name ? trimmed : undefined,
      notify,
    }, {
      onSuccess: (done) => {
        toast.success(done.action === 'create' ? `Familia creada: ${done.result?.name ?? trimmed}.` : `Familia actualizada: ${done.result?.name ?? trimmed}.`);
        onDone(done);
      },
      onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo vincular.')),
    });
  };

  if (error) {
    return (
      <div className="space-y-4">
        <div role="alert" className="flex gap-3 rounded-xl bg-coral-50 px-4 py-3 text-sm text-coral-700">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{error}</p>
        </div>
        <div className={FOOTER}>
          {onBack ? <Button type="button" variant="ghost" onClick={onBack}><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Atrás</Button> : null}
          <Button type="button" variant="secondary" onClick={runPlan}>Reintentar</Button>
        </div>
      </div>
    );
  }
  if (!plan || preview.isFetching) {
    return <p role="status" className="py-8 text-center text-sm text-muted">Preparando la vista previa…</p>;
  }

  const adding = new Set(plan.adding.map((s) => s.id));
  const nothing = plan.action === 'none';
  const nameEditable = !nothing;

  return (
    <div className="space-y-5">
      <div className={`flex gap-3 rounded-xl px-4 py-3 text-sm ${plan.action === 'merge' ? 'bg-amber/10 text-ink' : 'bg-brand-50 text-brand-700'}`} role="status">
        {plan.action === 'merge'
          ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber" aria-hidden="true" />
          : <Info className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />}
        <div>
          <p className="font-semibold">{HEADLINE[plan.action]}</p>
          {plan.action === 'merge' && (
            <p className="mt-0.5 text-muted">
              {plan.merging.map((m) => `${m.name} (${m.students})`).join(', ')} se integra{plan.merging.length > 1 ? 'n' : ''} en{' '}
              <strong className="text-ink">{plan.family?.name}</strong>: todos sus alumnos quedarán como hermanos.
            </p>
          )}
          {plan.action === 'add' && plan.family && (
            <p className="mt-0.5">En <strong>{plan.family.name}</strong>.</p>
          )}
          {nothing && <p className="mt-0.5">No hay nada que cambiar.</p>}
        </div>
      </div>

      {nameEditable && (
        <div>
          <label htmlFor={nameId} className="label">Nombre de la familia</label>
          <input id={nameId} className="input-field min-h-[44px] text-base sm:text-sm" maxLength={150}
            value={name} onChange={(e) => setName(e.target.value)} />
          <p className="mt-1 text-xs text-subtle">Solo lo ve el colegio; ayuda a encontrarla.</p>
        </div>
      )}

      <section aria-labelledby={`${nameId}-members`}>
        <h4 id={`${nameId}-members`} className="text-xs font-semibold uppercase tracking-wide text-subtle">
          Hermanos ({plan.students_after.length})
        </h4>
        <ul className="mt-2 divide-y divide-cream rounded-xl border border-line">
          {plan.students_after.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cream text-xs font-bold text-purple">{initial(s.name)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{s.name}</span>
                <span className="block truncate text-xs text-subtle">{gradeLine(s)} · {s.student_id}</span>
              </span>
              {adding.has(s.id) && !nothing && <Badge variant="success">Se suma</Badge>}
            </li>
          ))}
        </ul>
      </section>

      {!nothing && (
        <section aria-labelledby={`${nameId}-access`}>
          <h4 id={`${nameId}-access`} className="text-xs font-semibold uppercase tracking-wide text-subtle">
            Quién gana acceso
          </h4>
          {plan.new_access.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Ninguna cuenta ve algo nuevo.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {plan.new_access.map((g) => (
                <li key={g.id} className="flex gap-3 rounded-xl bg-cream-2 px-3 py-2.5">
                  {g.kind === 'student'
                    ? <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-purple" aria-hidden="true" />
                    : <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-purple" aria-hidden="true" />}
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-medium text-ink">{g.email}</p>
                    <p className="text-xs text-muted">{g.kind_label}{g.is_active ? '' : ' · inactiva'} · verá a {g.gains.join(', ')}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-subtle">
            Cada cuenta de la familia verá en el portal el saldo, las recargas, los movimientos y el expediente de todos los hermanos.
          </p>
        </section>
      )}

      {!nothing && (
        <label className="flex min-h-[44px] cursor-pointer items-start gap-2.5 text-sm text-ink">
          <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-line text-purple focus:ring-purple/40"
            checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          <span>
            Avisar a la familia
            <span className="block text-xs text-subtle">Cada cuenta que gana acceso recibe un aviso en el portal y por correo.</span>
          </span>
        </label>
      )}

      <div className={FOOTER}>
        {onBack ? <Button type="button" variant="ghost" onClick={onBack} disabled={commit.isPending}><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Atrás</Button> : null}
        {nothing ? (
          <Button type="button" variant="secondary" onClick={onCancel}>Cerrar</Button>
        ) : (
          <>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={commit.isPending}>Cancelar</Button>
            <Button type="button" onClick={submit} loading={commit.isPending} disabled={commit.isPending || !name.trim()}>
              <Check className="h-4 w-4" aria-hidden="true" />
              {plan.action === 'create' ? 'Crear familia' : plan.action === 'merge' ? 'Unir familias' : 'Vincular'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
