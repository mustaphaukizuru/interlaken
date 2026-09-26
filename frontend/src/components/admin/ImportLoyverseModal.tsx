import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Download, AlertTriangle, CheckCircle2, Search, ListChecks } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { portalApi, type RosterChange } from '@/services/api';

interface ImportReport {
  total_customers: number;
  candidates: number;
  created: number;
  updated: number;
  unchanged: number;
  renamed: number;
  skipped_non_student: number;
  skipped_duplicate: number;
  balance_seeded: string;
  errors: { matricula: string; error: string }[];
  skipped: { customer_code: string; name: string; reason: string }[];
  changes: RosterChange[];
  commit: boolean;
}

interface LinkReport {
  linked: number;
  already_linked: number;
  unmatched_students: { matricula: string; name: string }[];
  changes: (Partial<RosterChange> & { matricula: string; name: string })[];
}

interface CombinedReport {
  import: ImportReport;
  link: LinkReport;
}

type Phase = 'loading' | 'preview' | 'committing' | 'error';

type Field = RosterChange['field'];
const FIELD_LABEL: Record<Field, string> = {
  nombre: 'Nombre', grado: 'Grado', grupo: 'Grupo', codigo: 'Código Loyverse', vinculo: 'Vínculo',
};
const FIELDS: Field[] = ['nombre', 'grado', 'grupo', 'codigo', 'vinculo'];

/** The import's rows plus the link pass's `vinculo` rows, one per student and field. */
export function mergeChanges(imp: RosterChange[], link: LinkReport['changes']): RosterChange[] {
  const seen = new Set(imp.map((c) => `${c.matricula}:${c.field}`));
  const extra = link
    .filter((c) => c.field && !seen.has(`${c.matricula}:${c.field}`))
    .map((c) => ({
      matricula: c.matricula, name: c.name, field: c.field as Field,
      before: c.before ?? '', after: c.after ?? '', action: c.action ?? 'actualizar',
    }));
  return [...imp, ...extra];
}

/**
 * Imports / refreshes the student roster from Loyverse customers, then links
 * unmatched roster rows. Same dry-run → apply flow as LinkLoyverseModal, and
 * since 2026-09-24 the preview lists exactly what the commit will change per
 * student (field, antes, después) instead of a ten-row sample, so the office
 * can see a rename or a grade change before it happens.
 */
export function ImportLoyverseModal({ open, onClose, onImported }: {
  open: boolean; onClose: () => void; onImported?: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Importar desde Loyverse" maxWidth={760}>
      {/* Modal mounts children only while open, so each open starts a fresh
          preview and closing discards report/error state (no reset effect). */}
      <ImportLoyverseBody onClose={onClose} onImported={onImported} />
    </Modal>
  );
}

function ImportLoyverseBody({ onClose, onImported }: {
  onClose: () => void; onImported?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [report, setReport] = useState<CombinedReport | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [field, setField] = useState<Field | 'all'>('all');

  // Fetch the dry-run preview on mount and on each retry. State already
  // starts at 'loading', so the effect only updates state from the promise
  // continuations (no synchronous setState).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await portalApi.importLoyverse(false);
        if (cancelled) return;
        setReport(data);
        setPhase('preview');
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.response?.data?.detail || e?.response?.data?.error || 'No se pudo consultar Loyverse. Intente de nuevo.');
        setPhase('error');
      }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  const retry = () => {
    setPhase('loading'); setError('');
    setAttempt((a) => a + 1);
  };

  async function commit() {
    setPhase('committing');
    try {
      const { data } = await portalApi.importLoyverse(true);
      const imp = data.import;
      const link = data.link;
      toast.success(
        `Importación: ${imp.created} creado(s), ${imp.updated} actualizado(s)`
        + (imp.renamed ? `, ${imp.renamed} nombre(s)` : '')
        + `; ${link.linked} vinculado(s).`,
      );
      onImported?.();
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.response?.data?.error || 'No se pudo completar la importación.');
      setPhase('error');
    }
  }

  const imp = report?.import;
  const link = report?.link;
  const wouldChange = (imp?.created ?? 0) + (imp?.updated ?? 0) + (link?.linked ?? 0);

  const changes = useMemo(
    () => (imp && link ? mergeChanges(imp.changes ?? [], link.changes ?? []) : []),
    [imp, link],
  );
  const counts = useMemo(() => {
    const c: Record<Field, number> = { nombre: 0, grado: 0, grupo: 0, codigo: 0, vinculo: 0 };
    for (const ch of changes) c[ch.field] += 1;
    return c;
  }, [changes]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return changes.filter((c) => (field === 'all' || c.field === field) && (
      !q || [c.matricula, c.name, c.before, c.after].some((v) => v.toLowerCase().includes(q))));
  }, [changes, field, query]);

  return (
    <>
      {phase === 'loading' || phase === 'committing' ? (
        <div className="py-10 text-center">
          <LoadingSpinner />
          <p className="mt-3 text-sm text-muted">
            {phase === 'committing' ? 'Guardando alumnos…' : 'Consultando Loyverse…'}
          </p>
        </div>
      ) : phase === 'error' ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl2 border border-coral/30 bg-coral-50 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-coral-dark" />
            <p className="text-sm text-ink">{error}</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cerrar</Button>
            <Button onClick={retry}>Reintentar</Button>
          </div>
        </div>
      ) : imp && link ? (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Se revisaron <strong>{imp.total_customers}</strong> clientes de Loyverse
            ({imp.candidates} alumnos, {imp.skipped_non_student + (imp.skipped_duplicate ?? 0)} omitidos).
            Loyverse manda: grado y grupo siguen su código; el nombre solo cambia cuando cambió en Loyverse.
          </p>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Se crearán" value={imp.created} tone="primary" />
            <Stat label="Se actualizarán" value={imp.updated} tone="muted" />
            <Stat label="Sin cambios" value={imp.unchanged ?? 0} tone="muted" />
            <Stat label="Se vincularán" value={link.linked} tone="primary" />
            <Stat label="Ya vinculados" value={link.already_linked} tone="muted" />
            <Stat label="Cambian de nombre" value={imp.renamed ?? 0} tone={imp.renamed ? 'primary' : 'muted'} />
          </div>

          {changes.length > 0 && (
            <section aria-label="Cambios por alumno" className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[200px] flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
                  <input
                    className="input-field pl-9"
                    placeholder="Buscar alumno, matrícula o valor…"
                    aria-label="Buscar en los cambios"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por campo">
                <Chip active={field === 'all'} onClick={() => setField('all')}>Todos ({changes.length})</Chip>
                {FIELDS.filter((f) => counts[f] > 0).map((f) => (
                  <Chip key={f} active={field === f} onClick={() => setField(f)}>{FIELD_LABEL[f]} ({counts[f]})</Chip>
                ))}
              </div>
              <DataTable
                wrapClassName="max-h-[40vh]"
                rows={visible}
                rowKey={(c) => `${c.matricula}:${c.field}`}
                itemLabel="cambios"
                empty={{ icon: ListChecks, title: 'Ningún cambio coincide con la búsqueda' }}
                columns={[
                  {
                    id: 'alumno', header: 'Alumno', className: 'text-ink',
                    cell: (c) => (
                      <span>
                        <span className="font-medium">{c.name || '—'}</span>
                        <span className="block font-mono text-xs text-subtle">{c.matricula}</span>
                      </span>
                    ),
                  },
                  {
                    id: 'campo', header: 'Campo',
                    cell: (c) => (
                      <Badge variant={c.action === 'crear' ? 'success' : 'info'}>
                        {c.action === 'crear' ? `Alta · ${FIELD_LABEL[c.field]}` : FIELD_LABEL[c.field]}
                      </Badge>
                    ),
                  },
                  { id: 'antes', header: 'Antes', className: 'text-muted', cell: (c) => c.before || '—' },
                  { id: 'despues', header: 'Después', className: 'font-medium text-ink', cell: (c) => c.after || '—' },
                ]}
              />
              {visible.length < changes.length && (
                <p className="text-xs text-subtle">{visible.length} de {changes.length} cambio(s).</p>
              )}
            </section>
          )}

          {imp.skipped?.length > 0 && (
            <details className="rounded-xl border border-line px-3 py-2 text-xs text-muted">
              <summary className="cursor-pointer font-semibold text-subtle">
                {imp.skipped_non_student + (imp.skipped_duplicate ?? 0)} cliente(s) de Loyverse omitidos: ver motivos
              </summary>
              <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto">
                {imp.skipped.map((s) => (
                  <li key={`${s.customer_code}:${s.name}`}>
                    <span className="font-mono">{s.customer_code || '—'}</span> {s.name}: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {imp.errors.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-amber">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {imp.errors.length} error(es) en filas — se omitirán al aplicar.
            </p>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            {wouldChange === 0 ? (
              <p className="flex items-center gap-1.5 text-sm text-green-dark">
                <CheckCircle2 className="h-4 w-4" /> Todo al día — nada por importar.
              </p>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>Cerrar</Button>
              {wouldChange > 0 && (
                <Button onClick={commit}>
                  <Download className="h-4 w-4" /> Importar {wouldChange} cambio(s)
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-[36px] rounded-full border px-3 text-xs font-semibold transition-colors ${
        active ? 'border-purple bg-purple/10 text-purple' : 'border-line text-muted hover:text-ink'}`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'primary' | 'muted' }) {
  const cls = tone === 'primary'
    ? 'text-brand-700 bg-brand-50 border-brand-600/20'
    : 'text-muted bg-cream border-line';
  return (
    <div className={`rounded-xl border px-3 py-2 ${cls}`}>
      <div className="text-lg font-bold leading-tight">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}
