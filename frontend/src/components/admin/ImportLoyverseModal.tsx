import { useEffect, useState } from 'react';
import { Download, AlertTriangle, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { portalApi } from '@/services/api';

interface ImportReport {
  total_customers: number;
  candidates: number;
  created: number;
  updated: number;
  skipped_non_student: number;
  balance_seeded: string;
  errors: { matricula: string; error: string }[];
  samples: {
    matricula: string; name: string; grade: string; group: string;
    points: string; action: string;
  }[];
  commit: boolean;
}

interface LinkReport {
  linked: number;
  already_linked: number;
  unmatched_students: { matricula: string; name: string }[];
}

interface CombinedReport {
  import: ImportReport;
  link: LinkReport;
}

type Phase = 'loading' | 'preview' | 'committing' | 'error';

/**
 * Imports / refreshes the student roster from Loyverse customers, then links
 * unmatched roster rows. Same dry-run → apply flow as LinkLoyverseModal.
 */
export function ImportLoyverseModal({ open, onClose, onImported }: {
  open: boolean; onClose: () => void; onImported?: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Importar desde Loyverse" maxWidth={520}>
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

  async function commit() {
    setPhase('committing');
    try {
      const { data } = await portalApi.importLoyverse(true);
      const imp = data.import;
      const link = data.link;
      toast.success(
        `Importación: ${imp.created} creado(s), ${imp.updated} actualizado(s); `
        + `${link.linked} vinculado(s).`,
      );
      onImported?.();
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'No se pudo completar la importación.');
      setPhase('error');
    }
  }

  const imp = report?.import;
  const link = report?.link;
  const wouldChange = (imp?.created ?? 0) + (imp?.updated ?? 0) + (link?.linked ?? 0);

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
            ({imp.candidates} alumnos, {imp.skipped_non_student} omitidos).
          </p>

          <div className="grid grid-cols-2 gap-2">
            <Stat label="Se crearán" value={imp.created} tone="primary" />
            <Stat label="Se actualizarán" value={imp.updated} tone="muted" />
            <Stat label="Se vincularán" value={link.linked} tone="primary" />
            <Stat label="Ya vinculados" value={link.already_linked} tone="muted" />
          </div>

          {imp.samples.length > 0 && (
            <div className="rounded-xl border border-line">
              <p className="border-b border-line px-3 py-2 text-xs font-semibold text-subtle">
                Muestra
              </p>
              <ul className="max-h-40 divide-y divide-line overflow-y-auto text-sm">
                {imp.samples.map((s) => (
                  <li key={s.matricula} className="flex justify-between gap-3 px-3 py-1.5">
                    <span className="text-ink">
                      <span className="text-xs text-subtle">[{s.action}] </span>
                      {s.name}
                    </span>
                    <span className="text-subtle">{s.matricula}</span>
                  </li>
                ))}
              </ul>
            </div>
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
