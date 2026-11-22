import { useState } from 'react';
import { ChevronDown, FileArchive, FileSpreadsheet, FileText } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { RowActionsMenu } from '@/components/admin/RowActionsMenu';
import {
  FICHA_FORMAT_LABEL, FICHA_ZIP_CAP, downloadFicha, downloadFichasZip, runFichaDownload, type FichaFormat,
} from '@/hooks/queries/fichaExports';

/**
 * «Ficha de inscripción» downloads in the console (Fase 3): the row menu of
 * the Inscripciones table, the ZIP of the selection and the student file's
 * button. The data layer (and the Exportar menu's extra entries,
 * `fichaExportExtras`) lives in `hooks/queries/fichaExports.ts`.
 */

const FORMATS: FichaFormat[] = ['xlsx', 'pdf'];
const ICON = { xlsx: FileSpreadsheet, pdf: FileText } as const;
const BTN = 'btn-outline min-h-[44px] text-sm sm:min-h-[40px]';
const ITEM = 'flex min-h-[44px] w-full items-center gap-2 rounded-sm px-3 text-left text-sm text-ink hover:bg-cream-2 disabled:opacity-50';

/** Row «⋯» menu: «Ficha (Excel)» / «Ficha (PDF)». */
export function FichaRowMenu({ id, childName }: { id: number; childName: string }) {
  return (
    <RowActionsMenu
      label={`Descargar la ficha de inscripción de ${childName}`}
      items={FORMATS.map((fmt) => ({
        key: `ficha-${fmt}`,
        label: `Ficha (${FICHA_FORMAT_LABEL[fmt]})`,
        icon: ICON[fmt],
        ariaLabel: `Ficha de ${childName} en ${FICHA_FORMAT_LABEL[fmt]}`,
        onSelect: () => { void runFichaDownload(() => downloadFicha(id, fmt), `la ficha de ${childName}`); },
      }))}
    />
  );
}

/** A trigger button with an Excel / PDF menu. */
function FormatMenu({ label, icon: Icon, onPick, disabled, hint }: {
  label: string;
  icon: typeof FileText;
  onPick: (fmt: FichaFormat) => Promise<unknown>;
  disabled?: boolean;
  hint?: string;
}) {
  const [busy, setBusy] = useState(false);
  const pick = async (fmt: FichaFormat, close: () => void) => {
    close();
    setBusy(true);
    try { await onPick(fmt); } finally { setBusy(false); }
  };
  return (
    <Dropdown
      width={240}
      align="left"
      trigger={({ open, toggle }) => (
        <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="menu"
          disabled={busy || disabled} title={hint} className={BTN}>
          <Icon size={16} aria-hidden="true" /> {busy ? 'Generando…' : label} <ChevronDown size={14} aria-hidden="true" />
        </button>
      )}
    >
      {({ close }) => (
        <div role="menu" aria-label={label} className="p-1.5">
          {FORMATS.map((fmt) => {
            const FmtIcon = ICON[fmt];
            return (
              <button key={fmt} type="button" role="menuitem" className={ITEM} onClick={() => pick(fmt, close)}>
                <FmtIcon size={15} className="text-purple" aria-hidden="true" /> {FICHA_FORMAT_LABEL[fmt]}
                <span className="ml-auto text-xs text-subtle">.{fmt}</span>
              </button>
            );
          })}
        </div>
      )}
    </Dropdown>
  );
}

/** Bulk bar: «Fichas (ZIP)» of the selected rows (up to 50, page selection only). */
export function FichasZipMenu({ ids, allMatching = false }: { ids: number[]; allMatching?: boolean }) {
  const tooMany = allMatching || ids.length > FICHA_ZIP_CAP;
  const hint = tooMany ? `Seleccione hasta ${FICHA_ZIP_CAP} fichas en la tabla para descargarlas en un ZIP.` : undefined;
  return (
    <>
      <FormatMenu
        label="Fichas (ZIP)"
        icon={FileArchive}
        disabled={tooMany || ids.length === 0}
        hint={hint}
        onPick={(fmt) => runFichaDownload(() => downloadFichasZip(ids, fmt), `el ZIP de ${ids.length} fichas`)}
      />
      {tooMany && <span className="sr-only">{hint}</span>}
    </>
  );
}

/** Student file (and the Expediente's «Exportar ficha»): the ficha in Excel / PDF. */
export function StudentFichaDownload({ registrationId, label = 'Ficha de inscripción' }: { registrationId: number; label?: string }) {
  return (
    <FormatMenu
      label={label}
      icon={FileText}
      onPick={(fmt) => runFichaDownload(() => downloadFicha(registrationId, fmt), 'la ficha de inscripción')}
    />
  );
}
