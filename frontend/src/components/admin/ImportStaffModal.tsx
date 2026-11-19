import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Briefcase, CheckCircle2, ListChecks, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { api } from '@/services/api';
import { apiErrorMessage } from '@/lib/apiErrors';
import { formatMXN } from '@/lib/format';

type Action = 'crear' | 'vincular_cuenta' | 'vincular' | 'al_dia' | 'convertir' | 'conflicto' | 'omitir';
type Flag = 'sin_actividad' | 'sin_correo' | 'codigo_distinto' | 'consola';

export interface StaffRow {
  loyverse_id: string;
  loyverse_name: string;
  name: string;
  code: string;
  email: string;
  balance: string;
  total_visits: number;
  last_visit: string | null;
  pending_receipts: number;
  flags: Flag[];
  action: Action;
  note: string;
  existing: { id: number | null; name: string; student_id: string; tipo: string; grade: string; role: string } | null;
  done?: boolean;
}

export interface StaffImportReport {
  total_customers: number;
  staff_customers: number;
  counts: Record<Action, number>;
  rows: StaffRow[];
  commit: boolean;
  created: number;
  attached: number;
  linked: number;
  converted: number;
  balance_seeded: string;
  recovered_receipts: number;
  errors: { code: string; name: string; error: string }[];
}

const ENDPOINT = '/accounts/admin/import-staff-loyverse/';

const ACTION: Record<Action, { label: string; variant: 'success' | 'info' | 'warning' | 'error' | 'neutral' }> = {
  crear: { label: 'Se creará', variant: 'success' },
  vincular_cuenta: { label: 'Cuenta existente', variant: 'info' },
  vincular: { label: 'Se vinculará', variant: 'info' },
  al_dia: { label: 'Al día', variant: 'neutral' },
  convertir: { label: 'Registrado como alumno', variant: 'warning' },
  conflicto: { label: 'Conflicto', variant: 'error' },
  omitir: { label: 'Se omite', variant: 'neutral' },
};
const FLAG: Record<Flag, string> = {
  sin_actividad: 'Sin actividad',
  sin_correo: 'Sin correo',
  codigo_distinto: 'Código distinto al correo',
  consola: 'Tiene consola',
};
type View = 'all' | Action | Flag;

const fmtDay = (iso: string | null) => (iso ? format(new Date(iso), 'd MMM yyyy', { locale: es }) : '—');

/**
 * «Importar personal desde Loyverse» (A3 + A5, admins only): the review of
 * every «ZP-» card first, then the import. Staff link by email first; a record
 * created as a pupil is offered «Convertir a Personal» (kept wallet and
 * history) and converted only when ticked; their parked purchases become
 * history and the result says how many.
 */
export function ImportStaffModal({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported?: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Importar personal desde Loyverse" maxWidth={1040}>
      <ImportStaffBody onClose={onClose} onImported={onImported} />
    </Modal>
  );
}

function ImportStaffBody({ onClose, onImported }: { onClose: () => void; onImported?: () => void }) {
  const [phase, setPhase] = useState<'loading' | 'review' | 'committing' | 'done' | 'error'>('loading');
  const [report, setReport] = useState<StaffImportReport | null>(null);
  const [result, setResult] = useState<StaffImportReport | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>('all');
  const [convert, setConvert] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.post<StaffImportReport>(ENDPOINT, { commit: '0' });
        if (cancelled) return;
        setReport(data);
        setPhase('review');
      } catch (e) {
        if (cancelled) return;
        setError(apiErrorMessage(e, 'No se pudo consultar Loyverse. Intente de nuevo.'));
        setPhase('error');
      }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  const rows = useMemo(() => report?.rows ?? [], [report]);
  const counts = report?.counts;
  const flagCounts = useMemo(() => {
    const c: Record<Flag, number> = { sin_actividad: 0, sin_correo: 0, codigo_distinto: 0, consola: 0 };
    rows.forEach((r) => r.flags.forEach((f) => { c[f] += 1; }));
    return c;
  }, [rows]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => (view === 'all' || r.action === view || r.flags.includes(view as Flag)) && (
      !q || [r.name, r.loyverse_name, r.code, r.email].some((v) => (v || '').toLowerCase().includes(q))));
  }, [rows, view, query]);

  const willWrite = (counts?.crear ?? 0) + (counts?.vincular_cuenta ?? 0) + (counts?.vincular ?? 0) + convert.size;

  async function commit() {
    setPhase('committing');
    try {
      const { data } = await api.post<StaffImportReport>(ENDPOINT, { commit: '1', convert: [...convert] });
      setResult(data);
      setPhase('done');
      toast.success('Personal importado desde Loyverse.');
      onImported?.();
    } catch (e) {
      setError(apiErrorMessage(e, 'No se pudo completar la importación.'));
      setPhase('error');
    }
  }

  if (phase === 'loading' || phase === 'committing') {
    return (
      <div className="py-10 text-center">
        <LoadingSpinner />
        <p className="mt-3 text-sm text-muted">{phase === 'committing' ? 'Importando al personal…' : 'Consultando Loyverse…'}</p>
      </div>
    );
  }
  if (phase === 'error') {
    return (
      <div className="space-y-4">
        <div role="alert" className="flex items-start gap-3 rounded-xl2 border border-coral/30 bg-coral-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-coral-dark" aria-hidden="true" />
          <p className="text-sm text-ink">{error}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
          <Button onClick={() => { setPhase('loading'); setError(''); setAttempt((a) => a + 1); }}>Reintentar</Button>
        </div>
      </div>
    );
  }
  if (phase === 'done' && result) {
    return <ImportResult result={result} onClose={onClose} />;
  }
  if (!report || !counts) return null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Se revisaron <strong>{report.total_customers}</strong> clientes de Loyverse: <strong>{report.staff_customers}</strong> son
        personal del colegio (nombre «ZP-…»). Se vinculan primero por correo y luego por código. Nada se guarda hasta que pulse Importar.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Se crearán" value={counts.crear} tone="primary" />
        <Stat label="Cuenta existente" value={counts.vincular_cuenta} tone="primary" />
        <Stat label="Se vincularán" value={counts.vincular} tone="primary" />
        <Stat label="Registrados como alumno" value={counts.convertir} tone={counts.convertir ? 'warn' : 'muted'} />
        <Stat label="Al día" value={counts.al_dia} tone="muted" />
        <Stat label="Conflictos" value={counts.conflicto + counts.omitir} tone={counts.conflicto ? 'warn' : 'muted'} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
          <input className="input-field pl-9" placeholder="Buscar nombre, código o correo…" aria-label="Buscar en el personal"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar la revisión">
        <Chip active={view === 'all'} onClick={() => setView('all')}>Todos ({rows.length})</Chip>
        {(Object.keys(ACTION) as Action[]).filter((a) => counts[a] > 0).map((a) => (
          <Chip key={a} active={view === a} onClick={() => setView(a)}>{ACTION[a].label} ({counts[a]})</Chip>
        ))}
        {(Object.keys(FLAG) as Flag[]).filter((f) => flagCounts[f] > 0).map((f) => (
          <Chip key={f} active={view === f} onClick={() => setView(f)}>{FLAG[f]} ({flagCounts[f]})</Chip>
        ))}
      </div>

      <DataTable<StaffRow>
        wrapClassName="max-h-[46vh]"
        rows={visible}
        rowKey={(r) => r.loyverse_id}
        rowLabel={(r) => r.name}
        caption="Personal en Loyverse"
        itemLabel="personas"
        empty={{ icon: ListChecks, title: 'Nadie coincide con la búsqueda' }}
        columns={[
          {
            id: 'name', header: 'Nombre', minWidth: 200, className: 'text-ink',
            cell: (r) => (
              <span className="block">
                <span className="font-medium">{r.name}</span>
                <span className="block text-xs text-subtle">{r.loyverse_name}</span>
              </span>
            ),
          },
          {
            id: 'code', header: 'Código y correo', minWidth: 190,
            cell: (r) => (
              <span className="block">
                <span className="font-mono text-xs text-ink">{r.code || '—'}</span>
                <span className="block break-all text-xs text-subtle">{r.email || 'sin correo'}</span>
              </span>
            ),
          },
          { id: 'balance', header: 'Saldo', align: 'right', minWidth: 90, className: 'font-medium text-ink', cell: (r) => formatMXN(r.balance) },
          {
            id: 'activity', header: 'Actividad', minWidth: 130, className: 'text-xs text-muted',
            cell: (r) => (r.total_visits === 0 ? <span className="text-subtle">Sin visitas</span> : (
              <span className="block">
                {r.total_visits} visita{r.total_visits === 1 ? '' : 's'}
                <span className="block text-subtle">Última: {fmtDay(r.last_visit)}</span>
                {r.pending_receipts > 0 && <span className="block text-purple">{r.pending_receipts} compra(s) por recuperar</span>}
              </span>
            )),
          },
          {
            id: 'action', header: 'Qué pasará', minWidth: 260,
            cell: (r) => (
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-1">
                  <Badge variant={ACTION[r.action].variant}>{ACTION[r.action].label}</Badge>
                  {r.flags.map((f) => <Badge key={f} variant={f === 'consola' ? 'info' : 'neutral'}>{FLAG[f]}</Badge>)}
                </div>
                {r.note && <p className="text-xs text-muted">{r.note}</p>}
                {r.action === 'convertir' && r.existing?.id && (
                  <label className="flex min-h-[36px] cursor-pointer items-center gap-2 text-sm font-semibold text-purple">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-purple"
                      checked={convert.has(r.existing.id)}
                      onChange={(e) => setConvert((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(r.existing!.id!); else next.delete(r.existing!.id!);
                        return next;
                      })}
                    />
                    Convertir a Personal
                  </label>
                )}
              </div>
            ),
          },
        ]}
      />
      {visible.length < rows.length && <p className="text-xs text-subtle">{visible.length} de {rows.length} persona(s).</p>}

      <div className="flex flex-col-reverse gap-2 border-t border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-subtle">
          Se crean con puesto «Sin asignar», su saldo inicial se copia de Loyverse una sola vez y entran al portal con su correo
          de Google del colegio. Un conflicto nunca se cambia solo.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
          {willWrite > 0 ? (
            <Button onClick={commit}><Briefcase className="h-4 w-4" aria-hidden="true" /> Importar {willWrite}</Button>
          ) : (
            <p className="flex items-center gap-1.5 text-sm text-green-dark"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Todo al día</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ImportResult({ result, onClose }: { result: StaffImportReport; onClose: () => void }) {
  const lines = [
    [result.created, 'creado(s)'],
    [result.attached, 'agregado(s) a una cuenta existente'],
    [result.linked, 'vinculado(s)'],
    [result.converted, 'convertido(s) a Personal'],
  ].filter(([n]) => Number(n) > 0) as [number, string][];
  return (
    <div className="space-y-4">
      <div role="status" className="flex items-start gap-2.5 rounded-xl border border-green-600/25 bg-green-50 px-4 py-3 text-sm text-green-800">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-700" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-semibold">{lines.length ? lines.map(([n, w]) => `${n} ${w}`).join(', ') : 'Nada que importar'}.</p>
          <p>Saldo inicial copiado de Loyverse: {formatMXN(result.balance_seeded)}.</p>
          <p>{result.recovered_receipts} compra(s) anteriores ahora aparecen en su historial (antes «sin alumno vinculado»).</p>
        </div>
      </div>
      {result.errors.length > 0 && (
        <div role="alert" className="rounded-xl border border-amber/40 bg-amber/[0.08] px-4 py-3 text-sm text-ink">
          <p className="font-semibold">{result.errors.length} no se pudieron importar:</p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {result.errors.map((e) => <li key={`${e.code}:${e.name}`}>{e.name} ({e.code || 'sin código'}): {e.error}</li>)}
          </ul>
        </div>
      )}
      <div className="flex justify-end"><Button onClick={onClose}>Listo</Button></div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`min-h-[36px] rounded-full border px-3 text-xs font-semibold transition-colors ${
        active ? 'border-purple bg-purple/10 text-purple' : 'border-line text-muted hover:text-ink'}`}>
      {children}
    </button>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'primary' | 'muted' | 'warn' }) {
  const cls = tone === 'primary' ? 'text-brand-700 bg-brand-50 border-brand-600/20'
    : tone === 'warn' ? 'text-ink bg-amber/[0.08] border-amber/40' : 'text-muted bg-cream border-line';
  return (
    <div className={`rounded-xl border px-3 py-2 ${cls}`}>
      <div className="text-lg font-bold leading-tight">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

export default ImportStaffModal;
