import { useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, FileDown, FileSpreadsheet, FileUp, ShieldCheck, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { useImport } from '@/hooks/queries/dataOpsHooks';
import { apiErrorMessage } from '@/lib/apiErrors';
import { IMPORT_ACTION_META, IMPORT_ACTIONS } from '@/lib/status/importRow';
import { downloadBlob } from '@/services/api';
import {
  IMPORT_ACCEPT, IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, importFormatOf, validateImportFile,
  type ImportApi, type ImportFormat, type ImportReport, type ImportRow, type ImportRowAction,
} from '@/services/dataOps';

export interface ImportHeader {
  key: string;
  required?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** "Importar alumnos", "Cargar horarios de visita". */
  title: string;
  /** Query-key entity to invalidate after a commit (`students`, `slots`, …). */
  entity: string;
  related?: string[];
  api: ImportApi;
  /** Expected headers (`required` ones are highlighted). */
  headers?: ImportHeader[];
  /** File name prefix for the template downloads. */
  templatePrefix?: string;
  description?: ReactNode;
  /** Link shown in the summary; defaults to the audit log. */
  auditHref?: string;
  onImported?: (report: ImportReport) => void;
}

type Step = 1 | 2 | 3 | 4;

const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: 'Archivo' },
  { n: 2, label: 'Revisión' },
  { n: 3, label: 'Confirmación' },
  { n: 4, label: 'Resumen' },
];

const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1).replace('.0', '');

const ROW_COLUMNS: Column<ImportRow>[] = [
  { id: 'line', header: 'Fila', className: 'whitespace-nowrap text-muted tabular-nums', cell: (r) => r.line, hideable: false },
  { id: 'key', header: 'Clave', className: 'font-mono text-xs', cell: (r) => r.key || '—' },
  {
    id: 'action', header: 'Resultado', hideable: false,
    cell: (r) => <Badge variant={IMPORT_ACTION_META[r.action].variant}>{IMPORT_ACTION_META[r.action].label}</Badge>,
  },
  {
    id: 'detail', header: 'Detalle', className: 'text-xs',
    cell: (r) => (
      <div className="space-y-0.5">
        {r.errors.map((e, i) => <p key={`e${i}`} className="text-coral-700">{e}</p>)}
        {r.warnings.map((w, i) => <p key={`w${i}`} className="text-amber">{w}</p>)}
        {!r.errors.length && !r.warnings.length && <span className="text-subtle">—</span>}
      </div>
    ),
  },
];

/**
 * Generic import dialog (Data Ops round, C4), four steps: drop or choose a
 * .csv/.xlsx (5 MB client-side check, template links), the server dry-run in
 * a DataTable with result chips and the downloadable error report (the same
 * file re-posted with `report=`), the confirmation ("Importar solo las filas
 * válidas" when errors exist), and the summary with the audit link. A bottom
 * sheet on phones through `Modal`.
 */
export function ImportDialog({ open, onClose, title, entity, related, api, headers = [], templatePrefix, description, auditHref = '/admin/auditoria', onImported }: Props) {
  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth={760}>
      {/* Keyed by `open`: every opening starts at step 1 with no file. */}
      <ImportFlow key={String(open)} entity={entity} related={related} api={api} headers={headers} templatePrefix={templatePrefix ?? entity} description={description} auditHref={auditHref} onImported={onImported} onClose={onClose} />
    </Modal>
  );
}

function ImportFlow({ entity, related, api, headers, templatePrefix, description, auditHref, onImported, onClose }: Omit<Props, 'open' | 'title'> & { headers: ImportHeader[]; templatePrefix: string; auditHref: string }) {
  const { dryRun, commit, report, template } = useImport(entity, api, related);
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [filter, setFilter] = useState<ImportRowAction | null>(null);
  const [validOnly, setValidOnly] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [done, setDone] = useState<ImportReport | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (f: File | null) => {
    setPreview(null);
    setFilter(null);
    setValidOnly(false);
    if (!f) return;
    const err = validateImportFile(f);
    setFileError(err ?? '');
    setFile(err ? null : f);
    if (err) return;
    dryRun.mutate(f, {
      onSuccess: (r) => { setPreview(r); setStep(2); },
      onError: (e) => setFileError(apiErrorMessage(e, 'No se pudo procesar el archivo.')),
    });
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files?.[0] ?? null);
  };

  const downloadTemplate = (fmt: ImportFormat) =>
    template.mutate(fmt, {
      onSuccess: (blob) => downloadBlob(blob, `plantilla_${templatePrefix}.${fmt}`),
      onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo descargar la plantilla.')),
    });

  const downloadReport = () => {
    if (!file) return;
    const fmt = importFormatOf(file) ?? 'csv';
    const id = toast.loading('Generando reporte…');
    report.mutate({ file, fmt }, {
      onSuccess: (blob) => { downloadBlob(blob, `reporte_${templatePrefix}.${fmt}`); toast.success('Reporte listo.', { id }); },
      onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo generar el reporte.'), { id }),
    });
  };

  const runCommit = () => {
    if (!file) return;
    commit.mutate({ file, validOnly }, {
      onSuccess: (r) => { setDone(r); setStep(4); onImported?.(r); },
      onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo importar el archivo.')),
    });
  };

  const counts = preview?.counts;
  const errors = counts?.error ?? 0;
  const importable = preview ? preview.counts.crear + preview.counts.actualizar : 0;
  const rows = useMemo(() => (preview ? (filter ? preview.rows.filter((r) => r.action === filter) : preview.rows) : []), [preview, filter]);

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Pasos de la importación">
        {STEPS.map((s) => (
          <li key={s.n} aria-current={step === s.n ? 'step' : undefined} className={`flex items-center gap-1.5 ${step === s.n ? 'font-semibold text-purple' : step > s.n ? 'text-green-700' : 'text-subtle'}`}>
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${step === s.n ? 'bg-purple text-white' : step > s.n ? 'bg-green-50 text-green-700' : 'bg-cream-2'}`}>{s.n}</span>
            {s.label}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="space-y-4">
          {description && <div className="text-sm text-muted">{description}</div>}
          {headers.length > 0 && (
            <p className="text-xs text-muted">
              Encabezados:{' '}
              {headers.map((h, i) => (
                <span key={h.key}>
                  <code className={`rounded bg-cream-2 px-1 ${h.required ? 'font-semibold text-ink' : ''}`}>{h.key}</code>
                  {i < headers.length - 1 ? ', ' : ''}
                </span>
              ))}
              {headers.some((h) => h.required) && <> (en negrita, obligatorios)</>}.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-outline min-h-[44px] text-sm sm:min-h-[36px]" disabled={template.isPending} onClick={() => downloadTemplate('csv')}>
              <FileDown size={15} aria-hidden="true" /> Descargar plantilla CSV
            </button>
            <button type="button" className="btn-outline min-h-[44px] text-sm sm:min-h-[36px]" disabled={template.isPending} onClick={() => downloadTemplate('xlsx')}>
              <FileSpreadsheet size={15} aria-hidden="true" /> Descargar plantilla Excel
            </button>
          </div>
          {/* Native HTML5 drag-and-drop over the file input's label (no library). */}
          <div
            role="presentation"
            data-testid="dropzone"
            onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`rounded-xl2 border-2 border-dashed p-6 text-center transition-colors ${dragging ? 'border-purple bg-brand-50' : 'border-line bg-cream-2'}`}
          >
            <FileUp size={28} aria-hidden="true" className="mx-auto mb-2 text-purple" />
            <p className="text-sm text-ink">Arrastre aquí su archivo .csv o .xlsx</p>
            <p className="mb-3 text-xs text-muted">Hasta {mb(IMPORT_MAX_BYTES)} MB y {IMPORT_MAX_ROWS.toLocaleString('es-MX')} filas. Se mostrará una vista previa antes de escribir nada.</p>
            <label className="btn-primary inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm">
              <Upload size={15} aria-hidden="true" /> {file ? file.name : 'Elegir archivo'}
              <input ref={inputRef} type="file" accept={IMPORT_ACCEPT} className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          {dryRun.isPending && <p role="status" className="text-sm text-muted">Validando el archivo…</p>}
          {fileError && <p role="alert" className="text-sm text-coral-700">{fileError}</p>}
        </div>
      )}

      {step === 2 && preview && counts && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por resultado">
            <button type="button" aria-pressed={filter === null} onClick={() => setFilter(null)} className={`min-h-[36px] rounded-full px-3 text-xs font-medium ${filter === null ? 'bg-purple text-white' : 'bg-cream-2 text-muted hover:text-ink'}`}>
              Todas ({preview.total_rows})
            </button>
            {IMPORT_ACTIONS.map((a) => (
              <button key={a} type="button" aria-pressed={filter === a} onClick={() => setFilter(filter === a ? null : a)} className={`min-h-[36px] rounded-full px-3 text-xs font-medium ${filter === a ? 'bg-purple text-white' : 'bg-cream-2 text-muted hover:text-ink'}`}>
                {IMPORT_ACTION_META[a].label} ({counts[a]})
              </button>
            ))}
          </div>
          <DataTable<ImportRow>
            columns={ROW_COLUMNS}
            rows={rows}
            rowKey={(r) => r.line}
            wrapClassName="!max-h-72"
            caption="Vista previa de la importación"
            rowClassName={(r) => (r.action === 'error' ? 'bg-coral-50/40' : '')}
            empty={{ icon: ShieldCheck, title: 'Sin filas', description: 'Ninguna fila coincide con el filtro.' }}
          />
          {errors > 0 && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <AlertTriangle size={15} className="text-coral-600" aria-hidden="true" />
              {errors} {errors === 1 ? 'fila tiene errores' : 'filas tienen errores'}.
              <button type="button" onClick={downloadReport} disabled={report.isPending} className="font-semibold text-purple underline underline-offset-2 hover:text-ink">
                Descargar reporte de errores
              </button>
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => { setStep(1); setFile(null); setPreview(null); if (inputRef.current) inputRef.current.value = ''; }}>
              Elegir otro archivo
            </Button>
            <Button type="button" size="sm" disabled={importable === 0} onClick={() => setStep(3)}>
              Continuar
            </Button>
          </div>
        </div>
      )}

      {step === 3 && preview && counts && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-brand-50 text-purple">
              <Upload className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="text-sm text-muted">
              <p>
                Se crearán <strong className="text-ink">{counts.crear}</strong> y se actualizarán <strong className="text-ink">{counts.actualizar}</strong> registros
                {counts.omitir > 0 && <>; {counts.omitir} se omitirán</>}
                {errors > 0 && <>; <strong className="text-coral-700">{errors} con error</strong></>}.
              </p>
              <p className="mt-1 text-xs">Cada fila queda registrada en la bitácora de auditoría.</p>
            </div>
          </div>
          {errors > 0 && (
            <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm text-ink">
              <input type="checkbox" className="h-4 w-4 rounded border-line text-purple focus:ring-purple/40" checked={validOnly} onChange={(e) => setValidOnly(e.target.checked)} />
              Importar solo las filas válidas ({importable})
            </label>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setStep(2)} disabled={commit.isPending}>Volver</Button>
            <Button type="button" size="sm" loading={commit.isPending} disabled={importable === 0 || (errors > 0 && !validOnly)} onClick={runCommit}>
              Importar {importable} {importable === 1 ? 'fila' : 'filas'}
            </Button>
          </div>
        </div>
      )}

      {step === 4 && done && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${done.counts.error ? 'bg-amber/10 text-amber' : 'bg-green-50 text-green-700'}`}>
              {done.counts.error ? <AlertTriangle className="h-5 w-5" aria-hidden="true" /> : <CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
            </span>
            <div className="text-sm text-muted" role="status">
              <p>
                Importación completa: <strong className="text-ink">{done.counts.crear}</strong> creados, <strong className="text-ink">{done.counts.actualizar}</strong> actualizados
                {done.counts.omitir > 0 && <>, {done.counts.omitir} omitidos</>}
                {done.counts.error > 0 && <>, <strong className="text-coral-700">{done.counts.error} con error</strong></>}.
              </p>
              <p className="mt-1 text-xs">
                <Link to={auditHref} className="font-semibold text-purple underline underline-offset-2 hover:text-ink">Ver en auditoría</Link>
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={onClose}>Cerrar</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ImportDialog;
