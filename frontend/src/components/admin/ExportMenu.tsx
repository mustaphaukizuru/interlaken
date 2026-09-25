import { useState } from 'react';
import { Check, ChevronDown, FileDown, FileSpreadsheet, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import { Dropdown } from '@/components/ui/Dropdown';
import { downloadBlob } from '@/services/api';
import { EXPORT_FORMAT_LABEL, exportFilename, type ExportFormat } from '@/services/dataOps';
import { apiErrorMessage, isOverCap } from '@/lib/apiErrors';

/** v1 shape (kept for the pages not yet migrated): one entry per download. */
export interface ExportOption {
  key: string;
  label: string;
  /** Returns the blob to download; receives nothing, the caller closes over filters. */
  fetch: () => Promise<Blob>;
  filename: string;
}

interface LegacyProps {
  options: ExportOption[];
  label?: string;
}

interface V2Props {
  /** Fetch the current view (filters, search, sort) in one format; `selectedOnly` = "Solo seleccionados". */
  fetch: (fmt: ExportFormat, opts: { selectedOnly: boolean }) => Promise<Blob>;
  /** Formats offered, in menu order. One format = a single button. */
  formats?: ExportFormat[];
  /** `{prefix}_{YYYY-MM-DD}.{ext}`. */
  filenamePrefix: string;
  /** Rows currently selected; > 0 shows "Solo seleccionados (N)". */
  selectedCount?: number;
  /** Always export the selection (the bulk bar's "Exportar seleccionados"); hides the toggle. */
  forceSelected?: boolean;
  label?: string;
  className?: string;
}

type Props = LegacyProps | V2Props;

const FORMAT_ICON: Record<ExportFormat, typeof FileDown> = { csv: FileDown, xlsx: FileSpreadsheet, pdf: FileText };
const BTN = 'btn-outline min-h-[44px] text-sm sm:min-h-[40px]';
const failMessage = (err: unknown) => apiErrorMessage(err, 'No se pudo generar el archivo.');

async function runDownload(job: () => Promise<Blob>, filename: string, what: string) {
  const id = toast.loading(`Generando ${what}…`);
  try {
    const blob = await job();
    downloadBlob(blob, filename);
    toast.success('Archivo listo.', { id });
    return true;
  } catch (err) {
    // A 413 carries the server's "Acote los filtros: el límite es N filas." verbatim.
    toast.error(failMessage(err), { id, duration: isOverCap(err) ? 8000 : undefined });
    return false;
  }
}

/**
 * The only export UI of the console (Data Ops round, C3). CSV / Excel / PDF of
 * the current view, "Solo seleccionados (N)" when rows are selected, a
 * progress toast, and the server's cap message on 413. The v1 `options` form
 * stays for pages that have not migrated yet.
 */
export function ExportMenu(props: Props) {
  const [busy, setBusy] = useState(false);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const label = props.label ?? 'Exportar';

  if ('options' in props) return <LegacyExportMenu {...props} />;

  const { fetch, formats = ['csv', 'xlsx', 'pdf'], filenamePrefix, selectedCount = 0, forceSelected = false, className = '' } = props;
  const useSelected = (forceSelected || selectedOnly) && selectedCount > 0;

  const run = async (fmt: ExportFormat, close: () => void) => {
    close();
    setBusy(true);
    const what = `${EXPORT_FORMAT_LABEL[fmt]}${useSelected ? ` (${selectedCount} seleccionados)` : ''}`;
    await runDownload(() => fetch(fmt, { selectedOnly: useSelected }), exportFilename(filenamePrefix, fmt), what);
    setBusy(false);
  };

  if (formats.length === 1 && selectedCount === 0) {
    const fmt = formats[0];
    const Icon = FORMAT_ICON[fmt];
    return (
      <button type="button" className={`${BTN} ${className}`.trim()} disabled={busy} onClick={() => run(fmt, () => undefined)}>
        <Icon size={16} aria-hidden="true" /> {busy ? 'Generando…' : `${label} ${EXPORT_FORMAT_LABEL[fmt]}`}
      </button>
    );
  }

  return (
    <Dropdown
      width={260}
      trigger={({ open, toggle }) => (
        <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="menu" disabled={busy} className={`${BTN} ${className}`.trim()}>
          <FileDown size={16} aria-hidden="true" /> {busy ? 'Generando…' : label} <ChevronDown size={14} aria-hidden="true" />
        </button>
      )}
    >
      {({ close }) => (
        <div role="menu" aria-label="Formatos de exportación" className="p-1.5">
          {selectedCount > 0 && !forceSelected && (
            <>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={useSelected}
                onClick={() => setSelectedOnly((v) => !v)}
                className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-ink hover:bg-cream-2"
              >
                <span className={`flex h-4 w-4 items-center justify-center rounded border ${useSelected ? 'border-purple bg-purple text-white' : 'border-line bg-white'}`} aria-hidden="true">
                  {useSelected && <Check size={12} />}
                </span>
                Solo seleccionados ({selectedCount.toLocaleString('es-MX')})
              </button>
              <div className="my-1 border-t border-line" role="separator" />
            </>
          )}
          {formats.map((fmt) => {
            const Icon = FORMAT_ICON[fmt];
            return (
              <button
                key={fmt}
                role="menuitem"
                type="button"
                onClick={() => run(fmt, close)}
                className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-ink hover:bg-cream-2"
              >
                <Icon size={15} className="text-purple" aria-hidden="true" /> {EXPORT_FORMAT_LABEL[fmt]}
                <span className="ml-auto text-xs text-subtle">.{fmt}</span>
              </button>
            );
          })}
        </div>
      )}
    </Dropdown>
  );
}

function LegacyExportMenu({ options, label = 'Exportar' }: LegacyProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (o: ExportOption, close: () => void) => {
    close();
    setBusy(o.key);
    const stamp = new Date().toISOString().slice(0, 10);
    await runDownload(o.fetch, o.filename.replace('{date}', stamp), o.label.toLowerCase());
    setBusy(null);
  };
  if (options.length === 1) {
    const o = options[0];
    return (
      <button type="button" className={BTN} disabled={!!busy} onClick={() => run(o, () => undefined)}>
        <FileDown size={16} aria-hidden="true" /> {busy ? 'Generando…' : o.label}
      </button>
    );
  }
  return (
    <Dropdown
      width={240}
      trigger={({ open, toggle }) => (
        <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="menu" disabled={!!busy} className={BTN}>
          <FileDown size={16} aria-hidden="true" /> {busy ? 'Generando…' : label} <ChevronDown size={14} aria-hidden="true" />
        </button>
      )}
    >
      {({ close }) => (
        <div role="menu" className="p-1.5">
          {options.map((o) => (
            <button key={o.key} role="menuitem" type="button" onClick={() => run(o, close)} className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-ink hover:bg-cream-2">
              <FileDown size={15} className="text-purple" aria-hidden="true" /> {o.label}
            </button>
          ))}
        </div>
      )}
    </Dropdown>
  );
}

export default ExportMenu;
