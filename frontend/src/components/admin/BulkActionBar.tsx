import type { ReactNode } from 'react';
import { ChevronDown, FileDown, X } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import type { BulkActionDef } from '@/services/api';

interface Props {
  /** Effective selection size (the match count while `allMatching`). */
  count: number;
  allMatching?: boolean;
  /** Total rows matching the current filters; enables "Seleccionar las N que coinciden". */
  allMatchingCount?: number;
  onSelectAllMatching?: () => void;
  actions?: BulkActionDef[];
  onAction?: (action: BulkActionDef) => void;
  /** "Exportar seleccionados" as a plain button… */
  onExport?: () => void;
  /** …or as a ready-made `<ExportMenu forceSelected …/>` (formats menu). */
  exportMenu?: ReactNode;
  onClear: () => void;
  /** Plural noun: "filas", "reservas", "alumnos". */
  itemLabel?: string;
  busy?: boolean;
  /** How many actions render as buttons before the overflow menu (desktop). */
  inline?: number;
}

const ACTION_BTN =
  'inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-[36px]';

/**
 * Appears as soon as one row is selected (Data Ops round, C5): the count,
 * "Seleccionar las N que coinciden", the bulk actions, "Exportar
 * seleccionados" and "Limpiar". A sticky bar above the table on desktop; a
 * bottom sheet on phones, where cards carry the checkboxes.
 */
export function BulkActionBar({
  count, allMatching = false, allMatchingCount = 0, onSelectAllMatching, actions = [], onAction, onExport, exportMenu, onClear,
  itemLabel = 'filas', busy = false, inline = 3,
}: Props) {
  if (count <= 0) return null;
  const primary = actions.slice(0, inline);
  const overflow = actions.slice(inline);
  const canSelectAll = !!onSelectAllMatching && !allMatching && allMatchingCount > count;

  return (
    <div
      role="region"
      aria-label="Acciones en lote"
      className="fixed inset-x-0 bottom-0 z-40 mb-0 flex flex-wrap items-center gap-2 border-t border-brand-200 bg-brand-50 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-12px_rgba(16,12,40,0.25)] sm:sticky sm:top-0 sm:z-20 sm:mb-3 sm:rounded-xl2 sm:border sm:pb-3 sm:shadow-none"
    >
      <p className="text-sm text-brand-700" aria-live="polite">
        <strong className="font-semibold text-ink">{count.toLocaleString('es-MX')}</strong>{' '}
        {allMatching ? `${itemLabel} que coinciden con los filtros` : count === 1 ? itemLabel.replace(/s$/, '') : itemLabel}{' '}
        {count === 1 ? 'seleccionada' : 'seleccionadas'}
        {canSelectAll && (
          <>
            {' · '}
            <button type="button" onClick={onSelectAllMatching} className="font-semibold underline underline-offset-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40">
              Seleccionar las {allMatchingCount.toLocaleString('es-MX')} que coinciden
            </button>
          </>
        )}
      </p>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {primary.map((a) => {
          const Icon = a.icon;
          return (
            <button
              key={a.name}
              type="button"
              disabled={busy}
              onClick={() => onAction?.(a)}
              className={`${ACTION_BTN} ${a.danger ? 'bg-coral-600 text-white hover:bg-coral-700' : 'bg-purple text-white hover:bg-purple-mid'}`}
            >
              {Icon && <Icon size={15} aria-hidden="true" />}
              {a.label}
            </button>
          );
        })}
        {overflow.length > 0 && (
          <Dropdown
            width={240}
            trigger={({ open, toggle }) => (
              <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="menu" disabled={busy} className={`${ACTION_BTN} border-2 border-purple bg-white text-purple hover:bg-purple hover:text-white`}>
                Más <ChevronDown size={14} aria-hidden="true" />
              </button>
            )}
          >
            {({ close }) => (
              <div role="menu" aria-label="Más acciones" className="p-1.5">
                {overflow.map((a) => {
                  const Icon = a.icon;
                  return (
                    <button
                      key={a.name}
                      role="menuitem"
                      type="button"
                      onClick={() => { close(); onAction?.(a); }}
                      className={`flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-cream-2 ${a.danger ? 'text-coral-700' : 'text-ink'}`}
                    >
                      {Icon && <Icon size={15} aria-hidden="true" />}
                      {a.label}
                    </button>
                  );
                })}
              </div>
            )}
          </Dropdown>
        )}
        {exportMenu}
        {onExport && !exportMenu && (
          <button type="button" disabled={busy} onClick={onExport} className={`${ACTION_BTN} border-2 border-purple bg-white text-purple hover:bg-purple hover:text-white`}>
            <FileDown size={15} aria-hidden="true" /> Exportar seleccionados
          </button>
        )}
        <button
          type="button"
          onClick={onClear}
          aria-label="Limpiar selección"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-full px-2 text-sm font-medium text-muted hover:bg-white hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 sm:min-h-[36px] sm:min-w-[36px]"
        >
          <X size={16} aria-hidden="true" />
          <span className="hidden sm:inline">Limpiar</span>
        </button>
      </div>
    </div>
  );
}

export default BulkActionBar;
