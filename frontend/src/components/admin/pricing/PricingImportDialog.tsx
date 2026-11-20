/**
 * Import the price list from Excel: the file is read and checked by the API
 * (nothing is written), every change is shown old → new against the saved
 * prices, and «Cargar en el editor» puts the rows in the editor, where they
 * are reviewed in the preview and saved with «Guardar cambios».
 */
import { useRef, useState, type DragEvent } from 'react';
import { AlertTriangle, CheckCircle2, FileDown, FileUp, Upload } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { apiErrorMessage } from '@/lib/apiErrors';
import { pricingAdminApi, type PricingImportResult, type PricingTableKey } from '@/services/pricingAdminApi';
import { ChangeList, changesLabel } from './ChangeList';
import { diffRows, fromServer, TABLES, type EditRow, type RowChange } from './model';

interface Props {
  open: boolean;
  onClose: () => void;
  /** The saved rows of each table (what the import is compared with). */
  saved: Record<PricingTableKey, EditRow[]>;
  /** Tables with changes not saved yet: loading the file replaces them. */
  unsaved: PricingTableKey[];
  onExport: () => void;
  onLoad: (tables: Partial<Record<PricingTableKey, EditRow[]>>) => void;
}

const MAX_BYTES = 2 * 1024 * 1024;

export function PricingImportDialog({ open, onClose, saved, unsaved, onExport, onLoad }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Importar precios desde Excel" maxWidth={760}>
      <ImportFlow key={String(open)} saved={saved} unsaved={unsaved} onExport={onExport} onLoad={(t) => { onLoad(t); onClose(); }} />
    </Modal>
  );
}

function ImportFlow({ saved, unsaved, onExport, onLoad }: Omit<Props, 'open' | 'onClose'>) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [fileName, setFileName] = useState('');
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<PricingImportResult | null>(null);

  const read = async (file: File | null) => {
    setProblem('');
    setResult(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) { setProblem('Use el archivo de Excel (.xlsx) que descarga «Exportar Excel».'); return; }
    if (file.size > MAX_BYTES) { setProblem('El archivo pesa más de 2 MB.'); return; }
    setFileName(file.name);
    setBusy(true);
    try {
      setResult((await pricingAdminApi.importXlsx(file)).data);
    } catch (e) {
      setProblem(apiErrorMessage(e, 'No se pudo leer el archivo.'));
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setDragging(false); void read(e.dataTransfer.files?.[0] ?? null); };

  if (result) {
    const found = TABLES.filter((t) => result.tables[t.key]);
    const parsed = Object.fromEntries(found.map((t) => [t.key, fromServer(t, result.tables[t.key]!.rows)])) as Partial<Record<PricingTableKey, EditRow[]>>;
    const changes = Object.fromEntries(found.map((t) => [t.key, diffRows(t, saved[t.key], parsed[t.key]!)])) as Record<string, RowChange[]>;
    const errorCount = found.reduce((n, t) => n + result.tables[t.key]!.errors.length, 0);
    const total = found.reduce((n, t) => n + changes[t.key].length, 0);
    const replaced = found.filter((t) => unsaved.includes(t.key) && changes[t.key]);
    const untouched = TABLES.filter((t) => !result.tables[t.key]);
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted">
          <strong className="text-ink">{fileName}</strong>: {errorCount > 0
            ? <span className="font-semibold text-coral-700">{errorCount === 1 ? '1 dato por corregir' : `${errorCount} datos por corregir`} antes de cargarlo.</span>
            : total > 0 ? <>{changesLabel(total)} frente a los precios guardados.</> : 'sin cambios frente a los precios guardados.'}
        </p>
        <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
          {found.map((t) => {
            const errs = result.tables[t.key]!.errors;
            if (errs.length) {
              return (
                <section key={t.key} aria-labelledby={`imp-${t.key}`} className="rounded-xl border border-coral-600/30 bg-coral-50/40">
                  <h3 id={`imp-${t.key}`} className="border-b border-coral-600/20 px-4 py-2.5 font-head text-sm font-bold text-ink">{t.title} <span className="font-normal text-subtle">(hoja «{result.tables[t.key]!.sheet}»)</span></h3>
                  <ul className="space-y-1 px-4 py-3 text-[13px]">
                    {errs.map((e, i) => (
                      <li key={i} className="flex gap-2 text-coral-700">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>{e.line ? `Fila ${e.line}` : 'Hoja'}{e.label ? `, ${e.label}` : ''}: {e.message}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            }
            if (!changes[t.key].length) {
              return <p key={t.key} className="flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm text-muted"><CheckCircle2 className="h-4 w-4 text-green-700" aria-hidden="true" />{t.title}: sin cambios.</p>;
            }
            return <ChangeList key={t.key} def={t} changes={changes[t.key]} />;
          })}
          {(untouched.length > 0 || result.ignored_sheets.length > 0) && (
            <p className="text-xs text-subtle">
              {untouched.length > 0 && <>No vienen en el archivo y no se tocan: {untouched.map((t) => t.title).join(', ')}. </>}
              {result.ignored_sheets.length > 0 && <>Hojas que no son de precios: {result.ignored_sheets.join(', ')}.</>}
            </p>
          )}
        </div>
        {replaced.length > 0 && errorCount === 0 && (
          <p className="flex gap-2 rounded-xl bg-amber/10 px-3 py-2 text-sm text-ink">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" aria-hidden="true" />
            Reemplaza lo que editó sin guardar en {replaced.map((t) => t.title).join(', ')}.
          </p>
        )}
        <p className="text-xs text-subtle">Todavía no se guarda nada: al cargarlo, revise la vista previa y pulse «Guardar cambios».</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => { setResult(null); if (input.current) input.current.value = ''; }}>Elegir otro archivo</Button>
          <Button type="button" size="sm" disabled={errorCount > 0 || total === 0}
            onClick={() => onLoad(Object.fromEntries(found.filter((t) => changes[t.key].length).map((t) => [t.key, parsed[t.key]])))}>
            {total > 0 && errorCount === 0 ? `Cargar ${changesLabel(total)} en el editor` : 'Cargar en el editor'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>Descargue el Excel con los precios de hoy (una hoja por tabla).</li>
        <li>Cambie montos y textos, agregue filas al final o borre filas completas. No cambie la columna «ID».</li>
        <li>Súbalo aquí: verá cada cambio antes de cargarlo en el editor.</li>
      </ol>
      <button type="button" className="btn-outline min-h-[44px] gap-2 !px-4 !py-2 text-sm" onClick={onExport}>
        <FileDown size={15} aria-hidden="true" /> Descargar el Excel actual
      </button>
      <div
        role="presentation"
        data-testid="pricing-dropzone"
        onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-xl2 border-2 border-dashed p-6 text-center transition-colors ${dragging ? 'border-green bg-green-50' : 'border-line bg-cream-2'}`}
      >
        <FileUp size={28} aria-hidden="true" className="mx-auto mb-2 text-green-700" />
        <p className="text-sm text-ink">Arrastre aquí el archivo .xlsx</p>
        <p className="mb-3 text-xs text-muted">Hasta 2 MB. Las hojas que no vengan en el archivo no se tocan.</p>
        <label className="btn-primary inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm">
          <Upload size={15} aria-hidden="true" /> {fileName || 'Elegir archivo'}
          <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => void read(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      {busy && <p role="status" className="text-sm text-muted">Revisando el archivo…</p>}
      {problem && <p role="alert" className="text-sm text-coral-700">{problem}</p>}
    </div>
  );
}

export default PricingImportDialog;
