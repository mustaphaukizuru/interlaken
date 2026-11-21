import type { ReactNode } from 'react';
import { CheckCircle2, CircleAlert, CircleDashed, Send } from 'lucide-react';
import { clsx } from 'clsx';
import { GRADES } from '@/lib/grades';
import { fmtDayTime } from '@/lib/caseStages';
import type { GateItem } from '@/hooks/queries/cases';

/** The running school year (August to July) and the next one, as «AAAA-AAAA». */
export function cycleChoices(now = new Date()): { value: string; label: string }[] {
  const start = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  const running = `${start}-${start + 1}`;
  const next = `${start + 1}-${start + 2}`;
  return [
    { value: running, label: `${running} (ciclo en curso)` },
    { value: next, label: `${next} (próximo ciclo)` },
  ];
}

/** Cycle options plus the case's own value when it is neither (an older cycle). */
export function cycleOptionsWith(current: string) {
  const base = cycleChoices();
  return current && !base.some((o) => o.value === current) ? [{ value: current, label: current }, ...base] : base;
}

export const GRADE_OPTIONS = GRADES.map((g) => ({ value: g, label: g }));

/** Grade options plus the case's own value when it predates the list («Primaria 1°»). */
export function gradeOptionsWith(current: string) {
  return current && !GRADES.includes(current) ? [{ value: current, label: current }, ...GRADE_OPTIONS] : GRADE_OPTIONS;
}

/** The ficha's «Parentesco con el alumno» choices: a valid one prefills «Quién llena la ficha». */
export const RELATIONSHIPS = ['Madre', 'Padre', 'Tutor/a legal', 'Abuelo/a', 'Otro familiar'];

/** Relationship options plus the case's own value when it is another word («Padre/Madre»). */
export function relationshipOptionsWith(current: string) {
  const base = RELATIONSHIPS.map((r) => ({ value: r, label: r }));
  return current && !RELATIONSHIPS.includes(current) ? [{ value: current, label: current }, ...base] : base;
}

/** «Cuotas enviadas el 7 dic 2026, 09:30» or «Sin enviar», with its send button. */
export function SentRow({ label, sentAt, buttonLabel, onSend, disabled, hint }: {
  label: string;
  sentAt: string | null | undefined;
  buttonLabel: string;
  onSend: () => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-cream-2 px-3.5 py-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          {sentAt
            ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-700" aria-hidden="true" />
            : <CircleDashed className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />}
          {label}
        </p>
        <p className="mt-0.5 pl-6 text-xs text-muted">{sentAt ? `Enviado el ${fmtDayTime(sentAt)}` : hint || 'Sin enviar'}</p>
      </div>
      <button
        type="button"
        onClick={onSend}
        disabled={disabled}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-2 border-purple bg-white px-4 text-sm font-semibold text-purple transition hover:bg-purple hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Send size={15} aria-hidden="true" /> {sentAt ? `${buttonLabel} de nuevo` : buttonLabel}
      </button>
    </div>
  );
}

/** A labelled value in a definition list (empty → «Sin dato»). */
export function InfoRow({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div className={clsx('min-w-0', className)}>
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className={clsx('break-words text-sm', empty ? 'text-subtle' : 'text-ink')}>{empty ? 'Sin dato' : children}</dd>
    </div>
  );
}

/** «El expediente está cerrado…» note shown over the controls of a read-only card. */
export function ReadOnlyNote({ stage }: { stage: string }) {
  return (
    <p className="rounded-xl bg-cream px-3 py-2 text-sm text-muted">
      {stage === 'inscrito'
        ? 'El expediente ya está inscrito: esta etapa queda como registro.'
        : 'El expediente está cerrado. Reábralo para modificar esta etapa.'}
    </p>
  );
}

/** The «Marcar como inscrito» checklist: what is ready and what is missing, in words. */
export function GateList({ items }: { items: GateItem[] }) {
  return (
    <ul className="space-y-2" aria-label="Requisitos para inscribir">
      {items.map((g) => (
        <li key={g.key} className="flex items-start gap-2.5 rounded-xl border border-line bg-white px-3 py-2.5 text-sm">
          {g.ok
            ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-hidden="true" />
            : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber" aria-hidden="true" />}
          <span className="min-w-0">
            <span className="font-medium text-ink">{g.label}</span>
            <span className="sr-only">: {g.ok ? 'listo' : 'falta'}</span>
            {g.detail && <span className="block text-xs text-muted">{g.detail}</span>}
            {!g.ok && g.missing && g.missing.length > 0 && (
              <ul className="mt-1 list-disc pl-4 text-xs text-muted">
                {g.missing.slice(0, 8).map((m) => <li key={m}>{m}</li>)}
              </ul>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
