import { useEffect, useState } from 'react';
import { Link2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { portalApi } from '@/services/api';

interface Report {
  customers: number; students: number;
  linked: number; already_linked: number; skipped_conflict: number;
  unmatched_students: { matricula: string; name: string }[];
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
  const [phase, setPhase] = useState<Phase>('loading');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');

  async function preview() {
    setPhase('loading'); setError('');
    try {
      const { data } = await portalApi.linkLoyverse(false);
      setReport(data);
      setPhase('preview');
    } catch (e: any) {
      setError(e?.response?.data?.error || 'No se pudo consultar Loyverse. Intente de nuevo.');
      setPhase('error');
    }
  }

  // Re-preview each time the modal opens (roster/customers may have changed).
  useEffect(() => {
    if (open) preview();
    else { setReport(null); setError(''); }
  }, [open]);

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
    <Modal open={open} onClose={onClose} title="Vincular alumnos con Loyverse" maxWidth={520}>
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
            <Button onClick={preview}>Reintentar</Button>
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

          {report.unmatched_students.length > 0 && (
            <div className="rounded-xl border border-line">
              <p className="border-b border-line px-3 py-2 text-xs font-semibold text-subtle">
                Alumnos sin cliente en Loyverse (revise su matrícula)
              </p>
              <ul className="max-h-40 divide-y divide-line overflow-y-auto text-sm">
                {report.unmatched_students.slice(0, 25).map((u) => (
                  <li key={u.matricula} className="flex justify-between gap-3 px-3 py-1.5">
                    <span className="text-ink">{u.name}</span>
                    <span className="text-subtle">{u.matricula || '—'}</span>
                  </li>
                ))}
                {report.unmatched_students.length > 25 && (
                  <li className="px-3 py-1.5 text-xs text-subtle">
                    … y {report.unmatched_students.length - 25} más
                  </li>
                )}
              </ul>
            </div>
          )}

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
    </Modal>
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
