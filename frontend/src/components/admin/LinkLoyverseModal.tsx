import { useEffect, useState } from 'react';
import { Link2, AlertTriangle, CheckCircle2, UserMinus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { portalApi } from '@/services/api';

/** An active student with no Loyverse customer: in practice, a leaver. */
export interface UnmatchedStudent {
  id: number; matricula: string; name: string; grade: string; status: string; balance: string;
}

interface Report {
  customers: number; students: number;
  linked: number; already_linked: number; skipped_conflict: number;
  unmatched_students: UnmatchedStudent[];
  unmatched_customer_count: number; duplicate_codes: string[];
}

type Phase = 'loading' | 'preview' | 'committing' | 'error';

/**
 * Backfills every student's Loyverse link (loyverse_id ← customer UUID) by
 * matching matrícula == customer_code. Previews the plan on open, then commits —
 * the same dry-run→apply flow as the CSV import.
 */
export function LinkLoyverseModal({ open, onClose, onLinked }: {
  open: boolean; onClose: () => void; onLinked?: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Vincular alumnos con Loyverse" maxWidth={520}>
      {/* Modal mounts children only while open, so each open re-previews
          (roster/customers may have changed) and closing discards the
          report/error state (no reset effect). */}
      <LinkLoyverseBody onClose={onClose} onLinked={onLinked} />
    </Modal>
  );
}

function LinkLoyverseBody({ onClose, onLinked }: {
  onClose: () => void; onLinked?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  // Fetch the dry-run preview on mount and on each retry. State already
  // starts at 'loading', so the effect only updates state from the promise
  // continuations (no synchronous setState).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await portalApi.linkLoyverse(false);
        if (cancelled) return;
        setReport(data);
        setPhase('preview');
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.response?.data?.error || 'No se pudo consultar Loyverse. Intente de nuevo.');
        setPhase('error');
      }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  const retry = () => {
    setPhase('loading'); setError('');
    setAttempt((a) => a + 1);
  };

  // Leavers. The school deletes a student's Loyverse customer when they go
  // and nothing else tells the app, so 36 graduates were still "activo" a
  // full cycle later. Selected rows go through the existing bulk status
  // endpoint (audited per row); the balance column is there so leftover money
  // is a visible decision, never a silent write-off.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmBaja, setConfirmBaja] = useState(false);
  const [bajaBusy, setBajaBusy] = useState(false);
  const unmatched = report?.unmatched_students ?? [];
  const allSelected = unmatched.length > 0 && unmatched.every((u) => selected.has(u.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(unmatched.map((u) => u.id)));
  const toggleOne = (id: number) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const selectedBalance = unmatched
    .filter((u) => selected.has(u.id))
    .reduce((sum, u) => sum + parseFloat(u.balance || '0'), 0);

  async function darDeBaja() {
    setBajaBusy(true);
    try {
      const { data } = await portalApi.bulkStudents({ ids: [...selected], action: 'status', value: 'withdrawn' });
      toast.success(`${data.updated} alumno(s) dados de baja.`);
      setConfirmBaja(false);
      setSelected(new Set());
      onLinked?.();
      retry();
    } catch {
      toast.error('No se pudo aplicar la baja.');
    } finally {
      setBajaBusy(false);
    }
  }

  async function commit() {
    setPhase('committing');
    try {
      const { data } = await portalApi.linkLoyverse(true);
      toast.success(`${data.linked} alumno(s) vinculado(s) con Loyverse.`);
      onLinked?.();
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'No se pudo completar la vinculación.');
      setPhase('error');
    }
  }

  return (
    <>
      {phase === 'loading' || phase === 'committing' ? (
        <div className="py-10 text-center">
          <LoadingSpinner />
          <p className="mt-3 text-sm text-muted">
            {phase === 'committing' ? 'Guardando vínculos…' : 'Consultando Loyverse…'}
          </p>
        </div>
      ) : phase === 'error' ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl2 border border-coral/30 bg-coral-50 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-coral-dark" />
            <p className="text-sm text-ink">{error}</p>
          </div>
          <p className="text-xs text-subtle">
            Si el error es de conexión (401/token), genere un nuevo token de acceso en
            Loyverse y colóquelo en <code>LOYVERSE_API_TOKEN</code>.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cerrar</Button>
            <Button onClick={retry}>Reintentar</Button>
          </div>
        </div>
      ) : report ? (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Se emparejaron <strong>{report.customers}</strong> clientes de Loyverse con{' '}
            <strong>{report.students}</strong> alumnos activos por matrícula.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <Stat label="Se vincularán" value={report.linked} tone="primary" />
            <Stat label="Ya vinculados" value={report.already_linked} tone="muted" />
            <Stat label="Sin coincidencia" value={report.unmatched_students.length} tone={report.unmatched_students.length ? 'warn' : 'muted'} />
            <Stat label="Conflictos (otro id)" value={report.skipped_conflict} tone={report.skipped_conflict ? 'warn' : 'muted'} />
          </div>

          {unmatched.length > 0 && (
            <div className="rounded-xl border border-line">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-subtle">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Seleccionar todos los alumnos sin cliente en Loyverse"
                  />
                  Sin cliente en Loyverse ({unmatched.length}): egresados o bajas no registradas
                </label>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={selected.size === 0}
                  onClick={() => setConfirmBaja(true)}
                >
                  <UserMinus size={14} aria-hidden="true" /> Dar de baja ({selected.size})
                </Button>
              </div>
              <ul className="max-h-64 divide-y divide-line overflow-y-auto text-sm">
                {unmatched.map((u) => (
                  <li key={u.id} className="flex items-center gap-3 px-3 py-1.5">
                    <input
                      type="checkbox"
                      checked={selected.has(u.id)}
                      onChange={() => toggleOne(u.id)}
                      aria-label={`Seleccionar a ${u.name}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ink">{u.name}</span>
                      <span className="block text-xs text-subtle">{u.matricula || '—'} · {u.grade || 'sin grado'}</span>
                    </span>
                    <span className={`whitespace-nowrap text-xs ${parseFloat(u.balance) > 0 ? 'font-semibold text-amber' : 'text-subtle'}`}>
                      ${parseFloat(u.balance || '0').toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ConfirmDialog
            open={confirmBaja}
            onClose={() => setConfirmBaja(false)}
            onConfirm={darDeBaja}
            loading={bajaBusy}
            title="Dar de baja definitiva"
            confirmLabel={`Dar de baja a ${selected.size}`}
            message={
              `Se marcarán ${selected.size} alumno(s) como baja definitiva: dejan de contar como activos, `
              + 'su cuenta de alumno ya no puede iniciar sesión y quedan en Auditoría. '
              + (selectedBalance > 0
                ? `Entre ellos queda un saldo de $${selectedBalance.toFixed(2)} en cafetería; la baja no lo toca — decida su devolución por separado.`
                : 'Ninguno de los seleccionados tiene saldo pendiente en cafetería.')
            }
          />

          {report.duplicate_codes.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-amber">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Códigos duplicados en Loyverse: {report.duplicate_codes.slice(0, 10).join(', ')} — se usó el primero.
            </p>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            {report.linked === 0 ? (
              <p className="flex items-center gap-1.5 text-sm text-green-dark">
                <CheckCircle2 className="h-4 w-4" /> Todo al día — nada por vincular.
              </p>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>Cerrar</Button>
              {report.linked > 0 && (
                <Button onClick={commit}>
                  <Link2 className="h-4 w-4" /> Vincular {report.linked} alumno(s)
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'primary' | 'muted' | 'warn' }) {
  const cls = tone === 'primary' ? 'text-brand-700 bg-brand-50 border-brand-600/20'
    : tone === 'warn' ? 'text-amber bg-amber/10 border-amber/30'
    : 'text-muted bg-cream border-line';
  return (
    <div className={`rounded-xl border px-3 py-2 ${cls}`}>
      <div className="text-lg font-bold leading-tight">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}
