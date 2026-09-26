import { useState } from 'react';
import { FileDown, FileSpreadsheet } from 'lucide-react';
import toast from 'react-hot-toast';
import { downloadBlob } from '@/services/api';
import { EXPORT_FORMAT_LABEL, exportFilename, type ExportFormat } from '@/services/dataOps';
import { apiErrorMessage, isOverCap } from '@/lib/apiErrors';

type PortalFormat = Extract<ExportFormat, 'csv' | 'xlsx'>;

interface Props {
  /** Download the list the family is looking at (filters + ordering) in `fmt`. */
  fetch: (fmt: PortalFormat) => Promise<Blob>;
  /** `{prefix}_{YYYY-MM-DD}.{ext}`. */
  filenamePrefix: string;
  /** What is being downloaded, for the group's accessible name ("movimientos"). */
  what: string;
  className?: string;
}

const ICON: Record<PortalFormat, typeof FileDown> = { csv: FileDown, xlsx: FileSpreadsheet };

/**
 * With `responseType: 'blob'` an error body (the 413 "Acote los filtros…"
 * sentence) also arrives as a Blob; read it back into JSON so the shared
 * mapper can show the server's words.
 */
function blobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  // Older engines (and jsdom) without Blob#text.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

async function withJsonBody(err: unknown): Promise<unknown> {
  const res = (err as { response?: { data?: unknown } } | undefined)?.response;
  if (res && typeof Blob !== 'undefined' && res.data instanceof Blob) {
    try {
      return { ...(err as object), response: { ...res, data: JSON.parse(await blobText(res.data)) } };
    } catch {
      return err;
    }
  }
  return err;
}

/**
 * The family portal's export control (Data Ops Phase 9): CSV and Excel of the
 * current, filtered and sorted history. Deliberately not the admin
 * `ExportMenu` (no selection, no PDF: the monthly statement and the receipts
 * are the family's printable documents), and small enough to live in the
 * portal page chunks without pulling admin modules into them.
 */
export function PortalExportButtons({ fetch, filenamePrefix, what, className = '' }: Props) {
  const [busy, setBusy] = useState<PortalFormat | null>(null);

  const run = async (fmt: PortalFormat) => {
    setBusy(fmt);
    const id = toast.loading(`Generando ${EXPORT_FORMAT_LABEL[fmt]}…`);
    try {
      downloadBlob(await fetch(fmt), exportFilename(filenamePrefix, fmt));
      toast.success('Archivo listo.', { id });
    } catch (raw) {
      const err = await withJsonBody(raw);
      toast.error(apiErrorMessage(err, `No se pudieron descargar los ${what}. Intente nuevamente.`), {
        id,
        duration: isOverCap(err) ? 8000 : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`flex flex-wrap gap-2 ${className}`} role="group" aria-label={`Descargar ${what}`}>
      {(['csv', 'xlsx'] as const).map((fmt) => {
        const Icon = ICON[fmt];
        return (
          <button
            key={fmt}
            type="button"
            onClick={() => run(fmt)}
            disabled={busy !== null}
            aria-busy={busy === fmt}
            aria-label={`Descargar ${what} en ${EXPORT_FORMAT_LABEL[fmt]}`}
            className="btn-outline inline-flex min-h-[44px] items-center gap-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:opacity-60"
          >
            <Icon size={15} aria-hidden="true" />
            {EXPORT_FORMAT_LABEL[fmt]}
          </button>
        );
      })}
    </div>
  );
}

export default PortalExportButtons;
