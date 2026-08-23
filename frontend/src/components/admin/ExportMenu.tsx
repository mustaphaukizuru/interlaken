import { useState } from 'react';
import { FileDown, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { Dropdown } from '@/components/ui/Dropdown';
import { downloadBlob } from '@/services/api';

export interface ExportOption {
  key: string;
  label: string;
  /** Returns the blob to download; receives nothing, the caller closes over filters. */
  fetch: () => Promise<Blob>;
  filename: string;
}

/** One export button for every admin page (BACKLOG P1-H2): CSV/PDF options with progress toast. */
export function ExportMenu({ options, label = 'Exportar' }: { options: ExportOption[]; label?: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (o: ExportOption, close: () => void) => {
    close();
    setBusy(o.key);
    const id = toast.loading(`Generando ${o.label.toLowerCase()}…`);
    try {
      const blob = await o.fetch();
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, o.filename.replace('{date}', stamp));
      toast.success('Archivo listo.', { id });
    } catch {
      toast.error('No se pudo generar el archivo.', { id });
    } finally {
      setBusy(null);
    }
  };
  if (options.length === 1) {
    const o = options[0];
    return (
      <button type="button" className="btn-outline min-h-[40px] text-sm" disabled={!!busy} onClick={() => run(o, () => undefined)}>
        <FileDown size={16} aria-hidden="true" /> {busy ? 'Generando…' : o.label}
      </button>
    );
  }
  return (
    <Dropdown
      width={240}
      trigger={({ open, toggle }) => (
        <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="menu" disabled={!!busy} className="btn-outline min-h-[40px] text-sm">
          <FileDown size={16} aria-hidden="true" /> {busy ? 'Generando…' : label} <ChevronDown size={14} aria-hidden="true" />
        </button>
      )}
    >
      {({ close }) => (
        <div role="menu" className="p-1.5">
          {options.map((o) => (
            <button key={o.key} role="menuitem" type="button" onClick={() => run(o, close)} className="flex min-h-[40px] w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-ink hover:bg-cream-2">
              <FileDown size={15} className="text-purple" aria-hidden="true" /> {o.label}
            </button>
          ))}
        </div>
      )}
    </Dropdown>
  );
}

export default ExportMenu;
