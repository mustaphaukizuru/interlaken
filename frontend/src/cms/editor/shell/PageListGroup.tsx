import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, History, Pencil, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { PageRow } from './pageList';
import { ReviewChip, StatusChip } from './StatusChip';
import { timeAgo } from './status';

interface Props {
  title: string;
  /** Accessible name of the list. */
  listLabel: string;
  rows: PageRow[];
  total: number;
  base: string;
  isAdmin: boolean;
  /** Admin selection of pages that exist in the CMS (bulk actions, export). */
  selected?: Set<string | number>;
  onToggle?: (id: number) => void;
  onToggleAll?: (ids: number[], on: boolean) => void;
  onCustomise?: (row: PageRow) => void;
  customising?: string | null;
  onDelete?: (row: PageRow) => void;
  headerAction?: ReactNode;
  empty: ReactNode;
  now: number;
}

/** «Editar» and «Personalizar» share one size so the column lines up. */
const mainAction = 'inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 md:w-[150px] md:flex-none';
const iconLink = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-subtle hover:bg-cream hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40';

/**
 * One group of «Contenido» (public pages, or the school's own pages): a table
 * layout from 768 px and cards on phones, with the state in words and icon,
 * who edited last and when, and the page's actions.
 */
export function PageListGroup({ title, listLabel, rows, total, base, isAdmin, selected, onToggle, onToggleAll, onCustomise, customising, onDelete, headerAction, empty, now }: Props) {
  const selectable = rows.filter((r) => r.page).map((r) => r.page!.id);
  const allOn = !!selected && selectable.length > 0 && selectable.every((id) => selected.has(id));
  const headingId = `group-${listLabel.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <section aria-labelledby={headingId} className="card !p-0">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          {selected && onToggleAll && selectable.length > 0 && (
            <input type="checkbox" className="h-5 w-5 rounded border-line text-purple focus:ring-purple/40" checked={allOn}
              aria-label={allOn ? `Quitar la selección de ${listLabel}` : `Seleccionar todas: ${listLabel}`} onChange={() => onToggleAll(selectable, !allOn)} />
          )}
          <h2 id={headingId} className="font-semibold text-ink">
            {title} <span className="font-normal text-subtle">({rows.length === total ? total : `${rows.length} de ${total}`})</span>
          </h2>
        </div>
        {headerAction}
      </header>
      {rows.length === 0 ? <div className="px-4 py-6 sm:px-5">{empty}</div> : (
        <>
          <div aria-hidden="true" className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1.2fr)_auto] gap-4 border-b border-line px-5 py-2 text-xs font-semibold uppercase tracking-wide text-subtle md:grid">
            <span className={selected ? 'pl-9' : ''}>Página</span><span>Estado</span><span>Última edición</span><span className="w-[250px] text-right">Acciones</span>
          </div>
          <ul className="divide-y divide-line" aria-label={listLabel}>
            {rows.map((r) => {
              const p = r.page;
              const edit = p ? `${base}/${p.id}` : null;
              const canDelete = isAdmin && !!onDelete && !!p && p.status !== 'published' && !p.published_version_number;
              return (
                <li key={r.key} data-state={r.state.key} className="grid gap-3 px-4 py-3 sm:px-5 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1.2fr)_auto] md:items-center md:gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    {selected && onToggle && (
                      p ? <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 rounded border-line text-purple focus:ring-purple/40" checked={selected.has(p.id)}
                        aria-label={`Seleccionar ${r.title}`} onChange={() => onToggle(p.id)} />
                        : <span className="h-5 w-5 shrink-0" aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      {edit ? <Link to={edit} className="font-semibold text-ink hover:text-purple">{r.title}</Link> : <span className="font-semibold text-ink">{r.title}</span>}
                      <p className="truncate font-mono text-xs text-subtle">{r.path ?? 'Página de error 404 (sin dirección propia)'}</p>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <span className="sr-only">Estado: </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusChip state={r.state} />
                      {r.state.review && <ReviewChip />}
                    </div>
                    {r.state.detail && <p className="mt-0.5 text-xs text-subtle">{r.state.detail}</p>}
                  </div>
                  <div className="min-w-0 text-xs text-muted">
                    <span className="sr-only">Última edición: </span>
                    {r.editedAt ? (
                      <span><span className="md:hidden">Editada </span>{r.editedBy ? <><span className="font-semibold text-ink">{r.editedBy}</span> · </> : null}{timeAgo(r.editedAt, now)}</span>
                    ) : <span className="text-subtle">Sin cambios todavía</span>}
                  </div>
                  <div className="flex items-center gap-1 md:w-[250px] md:justify-end">
                    {edit ? (
                      <Link to={edit} className={`${mainAction} border-2 border-purple bg-white text-purple hover:bg-purple hover:text-white`} aria-label={`Editar ${r.title}`}>
                        <Pencil size={15} aria-hidden="true" /> Editar
                      </Link>
                    ) : (
                      <Button size="md" className={`${mainAction} !px-4`} onClick={() => onCustomise?.(r)} loading={customising === r.slug} disabled={!!customising} aria-label={`Personalizar ${r.title}`}>
                        <Sparkles size={15} aria-hidden="true" /> Personalizar
                      </Button>
                    )}
                    {r.live && r.path ? (
                      <a href={r.path} target="_blank" rel="noopener noreferrer" className={iconLink} aria-label={`Ver ${r.title} en el sitio (abre otra pestaña)`} title="Ver en el sitio">
                        <ExternalLink size={17} aria-hidden="true" />
                      </a>
                    ) : <span className="h-11 w-11 shrink-0" aria-hidden="true" />}
                    {isAdmin && (p?.published_version_number ? (
                      <Link to={`${edit}?versiones=1`} className={iconLink} aria-label={`Versiones de ${r.title}`} title="Versiones publicadas">
                        <History size={17} aria-hidden="true" />
                      </Link>
                    ) : canDelete ? (
                      <button type="button" className={`${iconLink} hover:text-coral-700`} onClick={() => onDelete?.(r)} aria-label={`Eliminar el borrador de ${r.title}`} title="Eliminar el borrador">
                        <Trash2 size={17} aria-hidden="true" />
                      </button>
                    ) : <span className="h-11 w-11 shrink-0" aria-hidden="true" />)}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
